import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  createPublicClient,
  encodeDeployData,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  http,
  keccak256,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { prepareTransactionRequest } from "viem/actions";
import {
  ARC_MAINNET_CHAIN_ID,
  ARC_TESTNET_CHAIN_ID,
  ARC_USDC_ADDRESS,
  ERC8183_NORMATIVE_REVISION,
  ERC8183_SOURCE_COMMIT,
  assertDeploymentManifest,
  assertMainnetGate,
  loadDeploymentManifest,
  type DeploymentManifest,
  type PactNetwork,
} from "./manifest.js";
import { verifyDeploymentIntegrity } from "./integrity.js";
import { FileDeploymentJournal } from "./file-journal.js";
import {
  executeDeploymentTransaction,
  type DeploymentTransactionRecord,
} from "./transaction.js";

interface FoundryArtifact {
  readonly abi: Abi;
  readonly bytecode: { readonly object: Hex };
  readonly deployedBytecode: { readonly object: Hex };
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "")
    throw new Error(`${name} is required`);
  return value;
}

function requiredAddress(name: string): Address {
  return getAddress(required(name));
}

async function artifact(path: string): Promise<FoundryArtifact> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as FoundryArtifact;
  if (
    !parsed.bytecode.object.startsWith("0x") ||
    !parsed.deployedBytecode.object.startsWith("0x")
  )
    throw new Error(`invalid Foundry artifact: ${path}`);
  return parsed;
}

async function main(): Promise<void> {
  const repository = resolve(import.meta.dirname, "../../../..");
  const network = required("PACT_DEPLOY_NETWORK") as PactNetwork;
  if (network !== "arc-testnet" && network !== "arc-mainnet")
    throw new Error("PACT_DEPLOY_NETWORK must be arc-testnet or arc-mainnet");
  const chainId =
    network === "arc-testnet" ? ARC_TESTNET_CHAIN_ID : ARC_MAINNET_CHAIN_ID;
  if (required("PACT_DEPLOY_CONFIRM") !== `DEPLOY ${network} ${chainId}`)
    throw new Error(
      "explicit PACT_DEPLOY_CONFIRM acknowledgement does not match the target",
    );
  const rpcUrl = required("PACT_DEPLOY_RPC_URL");
  const account = privateKeyToAccount(
    required("PACT_DEPLOYER_PRIVATE_KEY") as Hex,
  );
  const defaultAdmin = requiredAddress("PACT_ERC8183_DEFAULT_ADMIN");
  const admin = requiredAddress("PACT_ERC8183_ADMIN");
  if (admin !== defaultAdmin)
    throw new Error(
      "the pinned implementation grants both roles to one initializer admin",
    );
  const treasury = requiredAddress("PACT_ERC8183_TREASURY");
  const verifier = requiredAddress("PACT_VERIFIER_ADDRESS");
  const relay = requiredAddress("PACT_RELAY_ADDRESS");
  if (relay === verifier)
    throw new Error("Pact verifier and relay must be distinct");
  const evaluatorAdmin = requiredAddress("PACT_EVALUATOR_ADMIN");
  const journalPath = resolve(required("PACT_DEPLOY_JOURNAL_PATH"));
  if (journalPath.startsWith(`${repository}/`))
    throw new Error("deployment journal must be stored outside the repository");

  const dirty = execFileSync("git", ["status", "--porcelain"], {
    cwd: repository,
    encoding: "utf8",
  });
  if (dirty !== "") throw new Error("deployment requires a clean Git worktree");
  const gitCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repository,
    encoding: "utf8",
  }).trim();
  if (!/^[0-9a-f]{40}$/.test(gitCommit))
    throw new Error("unable to resolve full release commit");
  if (
    network === "arc-mainnet" &&
    required("PACT_MAINNET_DEPLOY_APPROVAL") !== `APPROVED ${gitCommit}`
  )
    throw new Error(
      "explicit commit-bound Mainnet deployment approval is required",
    );

  const contracts = resolve(repository, "packages/contracts/out");
  const [erc8183, proxyArtifact, evaluatorArtifact] = await Promise.all([
    artifact(resolve(contracts, "ERC8183.sol/ERC8183.json")),
    artifact(
      resolve(
        contracts,
        "PactManagedERC8183Proxy.sol/PactManagedERC8183Proxy.json",
      ),
    ),
    artifact(resolve(contracts, "PactEvaluator.sol/PactEvaluator.json")),
  ]);
  const evaluatorArtifactHash = keccak256(evaluatorArtifact.bytecode.object);
  if (network === "arc-mainnet") {
    const testnet = await loadDeploymentManifest(
      required("PACT_TESTNET_MANIFEST_PATH"),
    );
    assertMainnetGate(gitCommit, evaluatorArtifactHash, testnet);
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        review: "PACT_DEPLOYMENT_PREFLIGHT",
        network,
        chainId: chainId.toString(),
        deployer: account.address,
        defaultAdmin,
        admin,
        treasury,
        verifier,
        relay,
        evaluatorAdmin,
        usdc: ARC_USDC_ADDRESS,
        erc8183SourceCommit: ERC8183_SOURCE_COMMIT,
        pactGitCommit: gitCommit,
        platformFeeBps: "0",
        evaluatorFeeBps: "0",
        hooks: "NONE",
      },
      null,
      2,
    )}\n`,
  );

  const client = createPublicClient({
    transport: http(rpcUrl, { retryCount: 0, timeout: 10_000 }),
  });
  if (BigInt(await client.getChainId()) !== chainId)
    throw new Error("RPC chain ID does not match target");
  const usdcCode = await client.getCode({ address: ARC_USDC_ADDRESS });
  if (usdcCode === undefined || usdcCode === "0x")
    throw new Error("canonical Arc USDC code is missing");
  const decimals = await client.readContract({
    address: ARC_USDC_ADDRESS,
    abi: [
      {
        type: "function",
        name: "decimals",
        stateMutability: "view",
        inputs: [],
        outputs: [{ type: "uint8" }],
      },
    ],
    functionName: "decimals",
  });
  if (decimals !== 6) throw new Error("canonical Arc USDC decimals mismatch");

  const journal = await FileDeploymentJournal.open(journalPath);
  const transact = async (
    step: string,
    data: Hex,
    to?: Address,
  ): Promise<DeploymentTransactionRecord> => {
    const journalStep = `${network}:${gitCommit}:${step}`;
    const result = await executeDeploymentTransaction({
      step: journalStep,
      journal,
      prepare: async () => {
        const nonce = await client.getTransactionCount({
          address: account.address,
          blockTag: "pending",
        });
        const request = await prepareTransactionRequest(client, {
          account: account.address,
          chain: undefined,
          chainId: Number(chainId),
          data,
          nonce,
          ...(to === undefined ? {} : { to }),
        });
        const serializedTransaction = await account.signTransaction(
          request as never,
        );
        return { serializedTransaction, nonce };
      },
      broadcast: (serializedTransaction) =>
        client.sendRawTransaction({ serializedTransaction }),
      observe: async (transactionHash) => {
        try {
          const receipt = await client.getTransactionReceipt({
            hash: transactionHash,
          });
          return receipt.status === "success"
            ? { status: "SUCCESS", blockNumber: receipt.blockNumber }
            : { status: "REVERTED", blockNumber: receipt.blockNumber };
        } catch (error) {
          if (
            error instanceof Error &&
            /not found|could not be found/i.test(error.message)
          )
            return { status: "PENDING" };
          throw error;
        }
      },
    });
    if (result.state !== "CONFIRMED")
      throw new Error(
        `${step} is ${result.state}; rerun only to reconcile the persisted transaction`,
      );
    return result;
  };
  const deployedAddress = async (
    record: DeploymentTransactionRecord,
    label: string,
  ): Promise<Address> => {
    const receipt = await client.getTransactionReceipt({
      hash: record.transactionHash,
    });
    if (
      receipt.status !== "success" ||
      receipt.contractAddress === null ||
      receipt.contractAddress === undefined
    )
      throw new Error(`${label} deployment receipt has no contract address`);
    const actual = getAddress(receipt.contractAddress);
    const expected = getContractAddress({
      from: account.address,
      nonce: BigInt(record.nonce),
    });
    if (actual !== expected)
      throw new Error(
        `${label} deployment address does not match sender/nonce`,
      );
    return actual;
  };

  const implementationTx = await transact(
    "erc8183-implementation",
    encodeDeployData({ abi: erc8183.abi, bytecode: erc8183.bytecode.object }),
  );
  const implementation = await deployedAddress(
    implementationTx,
    "ERC-8183 implementation",
  );
  const initialization = encodeFunctionData({
    abi: erc8183.abi,
    functionName: "initialize",
    args: [treasury, admin],
  });
  const proxyTx = await transact(
    "erc8183-proxy",
    encodeDeployData({
      abi: proxyArtifact.abi,
      bytecode: proxyArtifact.bytecode.object,
      args: [implementation, initialization],
    }),
  );
  const proxy = await deployedAddress(proxyTx, "ERC-8183 proxy");
  const allowTx = await transact(
    "allow-arc-usdc",
    encodeFunctionData({
      abi: erc8183.abi,
      functionName: "setPaymentTokenAllowed",
      args: [ARC_USDC_ADDRESS, true],
    }),
    proxy,
  );
  const evaluatorTx = await transact(
    "pact-evaluator",
    encodeDeployData({
      abi: evaluatorArtifact.abi,
      bytecode: evaluatorArtifact.bytecode.object,
      args: [proxy, verifier, evaluatorAdmin],
    }),
  );
  const evaluator = await deployedAddress(evaluatorTx, "PactEvaluator");
  const [proxyCode, implementationCode, evaluatorCode, block] =
    await Promise.all([
      client.getCode({ address: proxy }),
      client.getCode({ address: implementation }),
      client.getCode({ address: evaluator }),
      client.getBlock(),
    ]);
  if (!proxyCode || !implementationCode || !evaluatorCode)
    throw new Error("deployed code is missing");
  const manifest: DeploymentManifest = assertDeploymentManifest({
    schemaVersion: 1,
    status: "DEPLOYED",
    network,
    chainId: chainId.toString(),
    deploymentTimestamp: new Date().toISOString(),
    deploymentBlock: block.number.toString(),
    deployer: account.address,
    gitCommit,
    usdc: { address: ARC_USDC_ADDRESS, decimals: 6 },
    erc8183: {
      classification: "PACT_MANAGED_PINNED",
      proxy,
      implementation,
      proxyCodeHash: keccak256(proxyCode),
      implementationCodeHash: keccak256(implementationCode),
      sourceCommit: ERC8183_SOURCE_COMMIT,
      normativeRevision: ERC8183_NORMATIVE_REVISION,
      defaultAdmin,
      admin,
      treasury,
      platformFeeBps: "0",
      evaluatorFeeBps: "0",
      paused: false,
      paymentTokenAllowed: true,
      hookPolicy: "NONE",
    },
    pactEvaluator: {
      address: evaluator,
      codeHash: keccak256(evaluatorCode),
      artifactBytecodeHash: evaluatorArtifactHash,
      commerceContract: proxy,
      verifier,
      admin: evaluatorAdmin,
      domainVersion: "2",
    },
    toolchain: {
      solidity: "0.8.28",
      evmTarget: "cancun",
      foundryVersion: (
        await readFile(
          resolve(repository, "packages/contracts/FOUNDRY_VERSION"),
          "utf8",
        )
      ).trim(),
      openZeppelinVersion: "5.6.1",
      viemVersion: "2.56.9",
    },
    deploymentTransactions: {
      implementation: implementationTx.transactionHash,
      proxy: proxyTx.transactionHash,
      allowUsdc: allowTx.transactionHash,
      evaluator: evaluatorTx.transactionHash,
    },
    sourceVerification: {
      erc8183Implementation: "UNAVAILABLE",
      erc8183Proxy: "UNAVAILABLE",
      pactEvaluator: "UNAVAILABLE",
    },
  });
  await verifyDeploymentIntegrity(rpcUrl, manifest);
  const outputPath = required("PACT_DEPLOY_MANIFEST_PATH");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: "wx",
    mode: 0o644,
  });
  process.stdout.write(
    `deployment verified and manifest written: ${outputPath}\n`,
  );
}

await main();
