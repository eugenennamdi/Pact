import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PostgresPactRepository,
  PostgresRelayRepository,
  createPactDatabaseFromEnv,
  type PactRecord,
} from "@pact/database";
import {
  hashGithubPrMergedCondition,
  hashPactJobIdentity,
  normalizeGithubPrMergedCondition,
  normalizePactJobIdentity,
} from "@pact/protocol";
import type { GitHubPullRequestClient } from "@pact/verifier/github";
import { createPactCompletionSigner } from "@pact/verifier/signer";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  getAddress,
  parseEventLogs,
  http,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createArcReadClient } from "../chain.js";
import { createPhase4AOrchestrator } from "../service.js";
import { createRelayChainClient } from "../relay/chain.js";
import { createPactRelayService } from "../relay/service.js";
import { createPactRelaySigner } from "../relay/signer.js";
import { assertGrossZeroFeeSettlement } from "./safety.js";

const ANVIL_PATH = "/Users/apple/.foundry/bin/anvil";
const CHAIN_ID = 31_337;
const RELAY_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const VERIFIER_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const BUDGET = 1_000_000n;
const jobCompletedEvent = {
  type: "event",
  name: "JobCompleted",
  anonymous: false,
  inputs: [
    { name: "jobId", type: "uint256", indexed: true },
    { name: "evaluator", type: "address", indexed: true },
    { name: "reason", type: "bytes32", indexed: false },
  ],
} as const;
const transferEvent = {
  type: "event",
  name: "Transfer",
  anonymous: false,
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "value", type: "uint256", indexed: false },
  ],
} as const;

interface FoundryArtifact {
  readonly abi: Abi;
  readonly bytecode: Hex;
}

async function artifact(path: string): Promise<FoundryArtifact> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as {
    readonly abi: Abi;
    readonly bytecode: { readonly object: Hex };
  };
  return { abi: parsed.abi, bytecode: parsed.bytecode.object };
}

async function waitForRpc(url: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_chainId",
          params: [],
        }),
      });
      if (response.ok) return;
    } catch {
      // Local child is starting.
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("Anvil RPC did not become ready");
}

function address(value: Address | null | undefined, label: string): Address {
  if (value === null || value === undefined)
    throw new Error(`${label} address is missing`);
  return getAddress(value);
}

async function main(): Promise<void> {
  if (process.env.PACT_PHASE5_LOCAL_E2E !== "1") {
    process.stdout.write(
      "SKIP: set PACT_PHASE5_LOCAL_E2E=1 for the local full-flow gate\n",
    );
    return;
  }
  const port = Number(process.env.PACT_PHASE5_LOCAL_E2E_PORT ?? "58546");
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535)
    throw new Error("PACT_PHASE5_LOCAL_E2E_PORT is invalid");
  const rpcUrl = `http://127.0.0.1:${port}`;
  const database = createPactDatabaseFromEnv(process.env);
  let anvil: ChildProcess | undefined;
  try {
    anvil = spawn(
      ANVIL_PATH,
      [
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--chain-id",
        String(CHAIN_ID),
      ],
      { stdio: "ignore" },
    );
    await waitForRpc(rpcUrl);
    const chain = defineChain({
      id: CHAIN_ID,
      name: "Pact Phase 5 Anvil",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    });
    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl, { retryCount: 0 }),
    });
    const wallet = createWalletClient({
      chain,
      transport: http(rpcUrl, { retryCount: 0 }),
    });
    const accounts = await wallet.getAddresses();
    const relay = privateKeyToAccount(RELAY_KEY);
    const verifier = privateKeyToAccount(VERIFIER_KEY);
    assert.equal(address(accounts[0], "relay"), relay.address);
    assert.equal(address(accounts[1], "verifier"), verifier.address);
    const admin = address(accounts[2], "admin");
    const client = address(accounts[3], "client");
    const provider = address(accounts[4], "provider");

    const root = fileURLToPath(
      new URL("../../../contracts/out/", import.meta.url),
    );
    const [erc8183, proxyArtifact, evaluatorArtifact, tokenArtifact] =
      await Promise.all([
        artifact(resolve(root, "ERC8183.sol/ERC8183.json")),
        artifact(
          resolve(
            root,
            "PactManagedERC8183Proxy.sol/PactManagedERC8183Proxy.json",
          ),
        ),
        artifact(resolve(root, "PactEvaluator.sol/PactEvaluator.json")),
        artifact(resolve(root, "MockArcUSDC.sol/MockArcUSDC.json")),
      ]);
    const deploy = async (
      abi: Abi,
      bytecode: Hex,
      args: readonly unknown[] = [],
    ): Promise<Address> => {
      const hash = await wallet.deployContract({
        account: admin,
        abi,
        bytecode,
        args,
      });
      return address(
        (await publicClient.waitForTransactionReceipt({ hash }))
          .contractAddress,
        "deployed contract",
      );
    };
    const implementation = await deploy(erc8183.abi, erc8183.bytecode);
    const initialization = encodeFunctionData({
      abi: erc8183.abi,
      functionName: "initialize",
      args: [admin, admin],
    });
    const commerce = await deploy(proxyArtifact.abi, proxyArtifact.bytecode, [
      implementation,
      initialization,
    ]);
    const evaluator = await deploy(
      evaluatorArtifact.abi,
      evaluatorArtifact.bytecode,
      [commerce, verifier.address, admin],
    );
    const usdc = await deploy(tokenArtifact.abi, tokenArtifact.bytecode, [
      client,
      BUDGET,
    ]);
    const balance = (owner: Address) =>
      publicClient.readContract({
        address: usdc,
        abi: tokenArtifact.abi,
        functionName: "balanceOf",
        args: [owner],
      }) as Promise<bigint>;
    const escrowBefore = await balance(commerce);
    const write = async (
      account: Address,
      target: Address,
      abi: Abi,
      functionName: string,
      args: readonly unknown[],
    ): Promise<Hex> => {
      const { request } = await publicClient.simulateContract({
        account,
        address: target,
        abi,
        functionName,
        args,
      } as never);
      const hash = await wallet.writeContract(request as never);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      assert.equal(receipt.status, "success");
      return hash;
    };
    await write(admin, commerce, erc8183.abi, "setPaymentTokenAllowed", [
      usdc,
      true,
    ]);

    const block = await publicClient.getBlock();
    const completionDeadline = block.timestamp + 500n;
    const expiredAt = block.timestamp + 1_000n;
    const condition = normalizeGithubPrMergedCondition({
      provider: "github",
      repository: "pact-local/phase5",
      pullRequest: 5,
      baseBranch: "main",
      event: "PR_MERGED",
    });
    const conditionHash = hashGithubPrMergedCondition(condition);
    await write(client, commerce, erc8183.abi, "createJob", [
      provider,
      evaluator,
      expiredAt,
      "Phase 5 full backend path",
      "0x0000000000000000000000000000000000000000",
      0n,
    ]);
    const jobId = (await publicClient.readContract({
      address: commerce,
      abi: erc8183.abi,
      functionName: "jobCounter",
    })) as bigint;
    await write(client, evaluator, evaluatorArtifact.abi, "bindCondition", [
      jobId,
      conditionHash,
      completionDeadline,
      verifier.address,
    ]);
    await write(provider, commerce, erc8183.abi, "setBudget", [
      jobId,
      usdc,
      BUDGET,
      "0x",
    ]);
    await write(client, usdc, tokenArtifact.abi, "approve", [commerce, BUDGET]);
    const fundHash = await write(client, commerce, erc8183.abi, "fund", [
      jobId,
      usdc,
      BUDGET,
      "0x",
    ]);
    await write(provider, commerce, erc8183.abi, "submit", [
      jobId,
      conditionHash,
      "0x",
    ]);
    const jobBeforeCompletion = (await publicClient.readContract({
      address: commerce,
      abi: erc8183.abi,
      functionName: "getJob",
      args: [jobId],
    })) as { readonly budget: bigint; readonly settledAmount: bigint };

    const now = (await publicClient.getBlock()).timestamp;
    const mergedAt = now - 10n;
    const metadata = {
      number: condition.pullRequest,
      state: "closed" as const,
      merged: true,
      mergedAt: new Date(Number(mergedAt) * 1_000)
        .toISOString()
        .replace(".000Z", "Z"),
      mergeCommitSha: "0123456789abcdef0123456789abcdef01234567",
      baseRepository: condition.repository,
      baseBranch: condition.baseBranch,
      privateRepository: false,
    };
    const github: GitHubPullRequestClient = {
      getPullRequest: async () => ({ ok: true, value: metadata }),
      checkPullRequestMerged: async () => ({
        ok: true,
        value: { merged: true },
      }),
    };
    const pactRepository = new PostgresPactRepository(database);
    const jobKey = hashPactJobIdentity(
      normalizePactJobIdentity({
        chainId: BigInt(CHAIN_ID),
        commerceContract: commerce,
        jobId,
      }),
    );
    const pact: PactRecord = {
      id: crypto.randomUUID(),
      chainId: BigInt(CHAIN_ID),
      commerceContract: commerce,
      pactEvaluator: evaluator,
      jobId,
      jobKey,
      condition,
      conditionHash,
      completionDeadline,
    };
    await pactRepository.createPact(pact);
    const operation = await pactRepository.enqueueManualOperation(
      pact.id,
      `phase5-local:${crypto.randomUUID()}`,
    );
    const orchestrator = createPhase4AOrchestrator({
      repository: pactRepository,
      github,
      arc: createArcReadClient({ rpcUrl }),
      signer: createPactCompletionSigner({ privateKey: VERIFIER_KEY }),
      configuredChainId: BigInt(CHAIN_ID),
      configuredPactEvaluator: evaluator,
      configuredCommerceContract: commerce,
      nowSeconds: () => now,
    });
    const verified = await orchestrator.processOperation(operation.id);
    assert.equal(verified.state, "READY_TO_RELAY");

    const relayRepository = new PostgresRelayRepository(database);
    const ready = await relayRepository.listReadyToRelayArtifacts(10);
    const artifactForPact = ready.find(
      (candidate) => candidate.pact.id === pact.id,
    );
    assert(artifactForPact !== undefined);
    const relayChain = createRelayChainClient({ rpcUrl });
    let dispatches = 0;
    const relayService = createPactRelayService({
      repository: relayRepository,
      chain: relayChain,
      transport: {
        async sendRawTransaction(serializedTransaction) {
          dispatches++;
          return relayChain.broadcast.sendRawTransaction(serializedTransaction);
        },
      },
      signer: createPactRelaySigner({
        privateKey: RELAY_KEY,
        verifierAddress: verifier.address,
      }),
      configuredChainId: BigInt(CHAIN_ID),
      configuredPactEvaluator: evaluator,
      configuredCommerceContract: commerce,
    });
    const submitted = await relayService.process();
    assert.equal(submitted.state, "SUBMITTED");
    const [settled] = await relayService.reconcile();
    assert.equal(settled?.state, "SETTLED");
    assert.equal(dispatches, 1);
    assert(submitted.expectedTxHash !== undefined);
    const receipt = await publicClient.getTransactionReceipt({
      hash: submitted.expectedTxHash as Hex,
    });
    const completed = parseEventLogs({
      abi: [jobCompletedEvent],
      logs: receipt.logs,
      eventName: "JobCompleted",
    });
    assert.equal(completed.length, 1);
    assert.equal(
      completed[0]?.args.reason,
      artifactForPact.attestation.evidenceHash,
    );

    const escrowAfter = await balance(commerce);
    const job = (await publicClient.readContract({
      address: commerce,
      abi: erc8183.abi,
      functionName: "getJob",
      args: [jobId],
    })) as {
      readonly status: number;
      readonly budget: bigint;
      readonly settledAmount: bigint;
    };
    const fundReceipt = await publicClient.getTransactionReceipt({
      hash: fundHash,
    });
    const transfers = (logs: typeof receipt.logs) =>
      parseEventLogs({
        abi: [transferEvent],
        logs: logs.filter(
          (log) => log.address.toLowerCase() === usdc.toLowerCase(),
        ),
        eventName: "Transfer",
        strict: true,
      });
    const sum = (
      logs: ReturnType<typeof transfers>,
      from: Address,
      to: Address,
    ) =>
      logs
        .filter(
          (log) =>
            log.args.from.toLowerCase() === from.toLowerCase() &&
            log.args.to.toLowerCase() === to.toLowerCase(),
        )
        .reduce((total, log) => total + log.args.value, 0n);
    const fundingTransfers = transfers(fundReceipt.logs);
    const settlementTransfers = transfers(receipt.logs);
    assertGrossZeroFeeSettlement({
      expectedBudget: BUDGET,
      jobBudget: job.budget,
      settledAmountBeforeCompletion: jobBeforeCompletion.settledAmount,
      settledAmountAfterCompletion: job.settledAmount,
      jobStatus: job.status,
      fundingTransferToEscrow: sum(fundingTransfers, client, commerce),
      providerPayoutFromEscrow: sum(settlementTransfers, commerce, provider),
      treasuryApplicationTransfer: sum(settlementTransfers, commerce, admin),
      evaluatorApplicationTransfer: sum(
        settlementTransfers,
        commerce,
        evaluator,
      ),
      escrowBefore,
      escrowAfter,
    });
    assert.equal(job.status, 3);
    process.stdout.write(
      `PASS: Phase 5 local full flow job=${jobId} evidence=${artifactForPact.attestation.evidenceHash} tx=${submitted.expectedTxHash}\n`,
    );
  } finally {
    await database.close();
    if (anvil !== undefined) {
      if (anvil.exitCode === null && anvil.signalCode === null) {
        anvil.kill("SIGTERM");
        await new Promise<void>((done) => anvil?.once("exit", () => done()));
      }
    }
  }
}

await main();
