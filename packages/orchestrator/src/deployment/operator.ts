import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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
import { createGitHubPullRequestClient } from "@pact/verifier/github";
import { createPactCompletionSigner } from "@pact/verifier/signer";
import {
  createPublicClient,
  encodeFunctionData,
  http,
  keccak256,
  parseEventLogs,
  stringToHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { prepareTransactionRequest } from "viem/actions";
import { DEFAULT_ARC_RPC_TIMEOUT_MS, createArcReadClient } from "../chain.js";
import { createPhase4AOrchestrator } from "../service.js";
import { createRelayChainClient } from "../relay/chain.js";
import { createPactRelayService } from "../relay/service.js";
import { createPactRelaySigner } from "../relay/signer.js";
import { FileDeploymentJournal } from "./file-journal.js";
import { verifyDeploymentIntegrity } from "./integrity.js";
import {
  assertDeploymentManifest,
  assertMainnetGate,
  loadDeploymentManifest,
} from "./manifest.js";
import {
  assertControlledE2EAmount,
  assertGrossZeroFeeSettlement,
  calculateGasFee,
  controlledE2EWindow,
  parseUsdcBaseUnits,
  reconcileArcNativeBalance,
} from "./safety.js";
import {
  executeDeploymentTransaction,
  type DeploymentTransactionRecord,
} from "./transaction.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const jobCreatedEvent = {
  type: "event",
  name: "JobCreated",
  anonymous: false,
  inputs: [
    { name: "jobId", type: "uint256", indexed: true },
    { name: "client", type: "address", indexed: true },
    { name: "provider", type: "address", indexed: true },
    { name: "evaluator", type: "address", indexed: false },
    { name: "expiredAt", type: "uint48", indexed: false },
    { name: "hook", type: "address", indexed: false },
  ],
} as const;
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
  readonly bytecode: { readonly object: Hex };
}

interface OperatorState {
  readonly schemaVersion: 1;
  readonly manifestIdentity: Hex;
  readonly pactId: string;
  readonly clientBefore: string;
  readonly providerBefore: string;
  readonly escrowBefore: string;
  readonly treasuryBefore: string;
  readonly evaluatorBefore: string;
  readonly relayGasBefore: string;
  readonly completionDeadline: string;
  readonly expiredAt: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "")
    throw new Error(`${name} is required`);
  return value;
}

function key(name: string): Hex {
  const value = required(name);
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${name} is invalid`);
  return value as Hex;
}

async function artifact(path: string): Promise<FoundryArtifact> {
  return JSON.parse(await readFile(path, "utf8")) as FoundryArtifact;
}

function uuidFromHash(value: Hex): string {
  const raw = value.slice(2, 34);
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-5${raw.slice(13, 16)}-a${raw.slice(17, 20)}-${raw.slice(20, 32)}`;
}

async function main(): Promise<void> {
  const repositoryRoot = resolve(import.meta.dirname, "../../../..");
  const manifestPath = resolve(required("PACT_E2E_MANIFEST_PATH"));
  const manifest = await loadDeploymentManifest(manifestPath);
  const readTimeoutMs =
    manifest.network === "arc-testnet" ? 15_000 : DEFAULT_ARC_RPC_TIMEOUT_MS;
  const rpcUrl = required("PACT_E2E_RPC_URL");
  if (
    required("PACT_E2E_CONFIRM") !==
    `RUN ${manifest.network} ${manifest.chainId}`
  )
    throw new Error(
      "explicit PACT_E2E_CONFIRM acknowledgement does not match the manifest",
    );
  const amount = parseUsdcBaseUnits(required("PACT_E2E_USDC_BASE_UNITS"));
  assertControlledE2EAmount(manifest.network, amount);
  const clientAccount = privateKeyToAccount(key("PACT_E2E_CLIENT_PRIVATE_KEY"));
  const providerAccount = privateKeyToAccount(
    key("PACT_E2E_PROVIDER_PRIVATE_KEY"),
  );
  const verifierKey = key("PACT_VERIFIER_PRIVATE_KEY");
  const relayKey = key("PACT_RELAY_PRIVATE_KEY");
  const verifierAccount = privateKeyToAccount(verifierKey);
  const relayAccount = privateKeyToAccount(relayKey);
  if (verifierAccount.address !== manifest.pactEvaluator.verifier)
    throw new Error("verifier key does not match manifest");
  if (verifierAccount.address === relayAccount.address)
    throw new Error("Pact verifier and relay must be distinct");
  if (clientAccount.address === providerAccount.address)
    throw new Error("client and provider must be distinct");
  if (
    clientAccount.address === manifest.erc8183.treasury ||
    providerAccount.address === manifest.erc8183.treasury
  )
    throw new Error(
      "client, provider, and treasury must be distinct for accounting",
    );
  const journalPath = resolve(required("PACT_E2E_JOURNAL_PATH"));
  const statePath = resolve(required("PACT_E2E_STATE_PATH"));
  if (
    journalPath.startsWith(`${repositoryRoot}/`) ||
    statePath.startsWith(`${repositoryRoot}/`)
  )
    throw new Error(
      "operator journal and state must be outside the repository",
    );

  const gitCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
  if (gitCommit !== manifest.gitCommit) {
    try {
      execFileSync(
        "git",
        [
          "diff",
          "--quiet",
          manifest.gitCommit,
          gitCommit,
          "--",
          "packages/contracts",
        ],
        { cwd: repositoryRoot },
      );
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "status" in error &&
        error.status === 1
      )
        throw new Error("deployed contract source differs from manifest");
      throw error;
    }
  }
  if (
    manifest.network === "arc-mainnet" &&
    required("PACT_MAINNET_E2E_APPROVAL") !== `APPROVED ${gitCommit}`
  )
    throw new Error("explicit commit-bound Mainnet E2E approval is required");
  const contracts = resolve(repositoryRoot, "packages/contracts/out");
  const [erc8183, evaluatorArtifact, usdcArtifact] = await Promise.all([
    artifact(resolve(contracts, "ERC8183.sol/ERC8183.json")),
    artifact(resolve(contracts, "PactEvaluator.sol/PactEvaluator.json")),
    artifact(resolve(contracts, "IERC20.sol/IERC20.json")),
  ]);
  const evaluatorArtifactHash = keccak256(evaluatorArtifact.bytecode.object);
  if (evaluatorArtifactHash !== manifest.pactEvaluator.artifactBytecodeHash)
    throw new Error("PactEvaluator artifact differs from manifest release");
  if (manifest.network === "arc-mainnet")
    assertMainnetGate(
      gitCommit,
      evaluatorArtifactHash,
      await loadDeploymentManifest(required("PACT_TESTNET_MANIFEST_PATH")),
    );
  await verifyDeploymentIntegrity(rpcUrl, manifest, readTimeoutMs);
  const manifestIdentity = keccak256(stringToHex(JSON.stringify(manifest)));

  const publicClient = createPublicClient({
    transport: http(rpcUrl, { retryCount: 0, timeout: 10_000 }),
  });
  const journal = await FileDeploymentJournal.open(journalPath);
  const send = async (
    step: string,
    account: PrivateKeyAccount,
    to: Address,
    data: Hex,
  ): Promise<DeploymentTransactionRecord> => {
    const existing = await journal.load(step);
    if (existing?.state === "CONFIRMED") return existing;
    await verifyDeploymentIntegrity(rpcUrl, manifest, readTimeoutMs);
    if (existing === undefined || existing.state === "PREPARED")
      await publicClient.call({ account: account.address, to, data });
    const result = await executeDeploymentTransaction({
      step,
      journal,
      prepare: async () => {
        const nonce = await publicClient.getTransactionCount({
          address: account.address,
          blockTag: "pending",
        });
        const request = await prepareTransactionRequest(publicClient, {
          account: account.address,
          chain: undefined,
          chainId: Number(manifest.chainId),
          to,
          data,
          nonce,
        });
        return {
          serializedTransaction: await account.signTransaction(
            request as never,
          ),
          nonce,
        };
      },
      broadcast: (serializedTransaction) =>
        publicClient.sendRawTransaction({ serializedTransaction }),
      observe: async (transactionHash) => {
        try {
          const receipt = await publicClient.getTransactionReceipt({
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
        `${step} is ${result.state}; rerun only to reconcile its exact hash`,
      );
    return result;
  };
  const balance = (owner: Address) =>
    publicClient.readContract({
      address: manifest.usdc.address,
      abi: usdcArtifact.abi,
      functionName: "balanceOf",
      args: [owner],
    }) as Promise<bigint>;
  let state: OperatorState;
  try {
    state = JSON.parse(await readFile(statePath, "utf8")) as OperatorState;
  } catch (error) {
    if (!(error instanceof Error) || !/ENOENT/.test(error.message)) throw error;
    const [balances, initialBlock] = await Promise.all([
      Promise.all([
        balance(clientAccount.address),
        balance(providerAccount.address),
        balance(manifest.erc8183.proxy),
        balance(manifest.erc8183.treasury),
        balance(manifest.pactEvaluator.address),
        publicClient.getBalance({ address: relayAccount.address }),
      ]),
      publicClient.getBlock(),
    ]);
    const seed = keccak256(
      stringToHex(
        `${manifest.chainId}:${manifest.pactEvaluator.address}:${Date.now()}`,
      ),
    );
    const window = controlledE2EWindow(
      manifest.network,
      initialBlock.timestamp,
    );
    state = {
      schemaVersion: 1,
      manifestIdentity,
      pactId: uuidFromHash(seed),
      clientBefore: balances[0].toString(),
      providerBefore: balances[1].toString(),
      escrowBefore: balances[2].toString(),
      treasuryBefore: balances[3].toString(),
      evaluatorBefore: balances[4].toString(),
      relayGasBefore: balances[5].toString(),
      completionDeadline: window.completionDeadline.toString(),
      expiredAt: window.expiredAt.toString(),
    };
    await mkdir(dirname(statePath), { recursive: true });
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
  }
  if (state.schemaVersion !== 1 || state.manifestIdentity !== manifestIdentity)
    throw new Error(
      "operator state belongs to a different deployment manifest",
    );

  const condition = normalizeGithubPrMergedCondition({
    provider: "github",
    repository: required("PACT_E2E_GITHUB_REPOSITORY"),
    pullRequest: Number(required("PACT_E2E_GITHUB_PULL_REQUEST")),
    baseBranch: required("PACT_E2E_GITHUB_BASE_BRANCH"),
    event: "PR_MERGED",
  });
  const conditionHash = hashGithubPrMergedCondition(condition);
  const completionDeadline = BigInt(state.completionDeadline);
  const expiredAt = BigInt(state.expiredAt);
  const create = await send(
    "e2e-create-job",
    clientAccount,
    manifest.erc8183.proxy,
    encodeFunctionData({
      abi: erc8183.abi,
      functionName: "createJob",
      args: [
        providerAccount.address,
        manifest.pactEvaluator.address,
        expiredAt,
        "Pact controlled PR_MERGED settlement",
        ZERO_ADDRESS,
        0n,
      ],
    }),
  );
  const createReceipt = await publicClient.getTransactionReceipt({
    hash: create.transactionHash,
  });
  const created = parseEventLogs({
    abi: [jobCreatedEvent],
    logs: createReceipt.logs,
    eventName: "JobCreated",
  });
  if (created.length !== 1 || created[0] === undefined)
    throw new Error("canonical JobCreated event missing");
  const jobId = created[0].args.jobId;
  const bind = await send(
    "e2e-bind-condition",
    clientAccount,
    manifest.pactEvaluator.address,
    encodeFunctionData({
      abi: evaluatorArtifact.abi,
      functionName: "bindCondition",
      args: [jobId, conditionHash, completionDeadline, verifierAccount.address],
    }),
  );
  const setBudget = await send(
    "e2e-set-budget",
    providerAccount,
    manifest.erc8183.proxy,
    encodeFunctionData({
      abi: erc8183.abi,
      functionName: "setBudget",
      args: [jobId, manifest.usdc.address, amount, "0x"],
    }),
  );
  const approve = await send(
    "e2e-approve-usdc",
    clientAccount,
    manifest.usdc.address,
    encodeFunctionData({
      abi: usdcArtifact.abi,
      functionName: "approve",
      args: [manifest.erc8183.proxy, amount],
    }),
  );
  const fund = await send(
    "e2e-fund",
    clientAccount,
    manifest.erc8183.proxy,
    encodeFunctionData({
      abi: erc8183.abi,
      functionName: "fund",
      args: [jobId, manifest.usdc.address, amount, "0x"],
    }),
  );
  const submit = await send(
    "e2e-submit",
    providerAccount,
    manifest.erc8183.proxy,
    encodeFunctionData({
      abi: erc8183.abi,
      functionName: "submit",
      args: [jobId, conditionHash, "0x"],
    }),
  );
  const jobBeforeCompletion = (await publicClient.readContract({
    address: manifest.erc8183.proxy,
    abi: erc8183.abi,
    functionName: "getJob",
    args: [jobId],
  })) as { readonly budget: bigint; readonly settledAmount: bigint };

  const database = createPactDatabaseFromEnv(process.env);
  try {
    const pactRepository = new PostgresPactRepository(database);
    const jobKey = hashPactJobIdentity(
      normalizePactJobIdentity({
        chainId: BigInt(manifest.chainId),
        commerceContract: manifest.erc8183.proxy,
        jobId,
      }),
    );
    const pact: PactRecord = {
      id: state.pactId,
      chainId: BigInt(manifest.chainId),
      commerceContract: manifest.erc8183.proxy,
      pactEvaluator: manifest.pactEvaluator.address,
      jobId,
      jobKey,
      condition,
      conditionHash,
      completionDeadline,
    };
    if ((await pactRepository.getPact(state.pactId)) === undefined)
      await pactRepository.createPact(pact);
    const operation = await pactRepository.enqueueManualOperation(
      state.pactId,
      `phase5:${jobKey}:${gitCommit}`,
    );
    const github = createGitHubPullRequestClient({
      ...(process.env.GITHUB_TOKEN === undefined
        ? {}
        : { token: process.env.GITHUB_TOKEN }),
    });
    const orchestrator = createPhase4AOrchestrator({
      repository: pactRepository,
      github,
      arc: createArcReadClient({ rpcUrl, timeoutMs: readTimeoutMs }),
      signer: createPactCompletionSigner({ privateKey: verifierKey }),
      configuredChainId: BigInt(manifest.chainId),
      configuredPactEvaluator: manifest.pactEvaluator.address,
      configuredCommerceContract: manifest.erc8183.proxy,
    });
    const prepared = await orchestrator.processOperation(operation.id);
    if (prepared.state !== "READY_TO_RELAY")
      throw new Error(
        `backend did not reach READY_TO_RELAY: ${prepared.state}:${prepared.code ?? ""}`,
      );
    await verifyDeploymentIntegrity(rpcUrl, manifest, readTimeoutMs);
    const relayRepository = new PostgresRelayRepository(database);
    const readyArtifacts = await relayRepository.listReadyToRelayArtifacts(10);
    const readyArtifact = readyArtifacts.find(
      (candidate) => candidate.operationId === operation.id,
    );
    if (readyArtifact === undefined)
      throw new Error("durable READY_TO_RELAY artifact is missing");
    const relayChain = createRelayChainClient({ rpcUrl, readTimeoutMs });
    const relayService = createPactRelayService({
      repository: relayRepository,
      chain: relayChain,
      transport: relayChain.broadcast,
      signer: createPactRelaySigner({
        privateKey: relayKey,
        verifierAddress: verifierAccount.address,
      }),
      configuredChainId: BigInt(manifest.chainId),
      configuredPactEvaluator: manifest.pactEvaluator.address,
      configuredCommerceContract: manifest.erc8183.proxy,
    });
    const submitted = await relayService.process();
    if (submitted.state !== "SUBMITTED")
      throw new Error(
        `relay did not submit: ${submitted.state}:${submitted.code ?? ""}`,
      );
    const [settled] = await relayService.reconcile();
    if (settled?.state !== "SETTLED")
      throw new Error(`relay did not settle: ${settled?.state ?? "missing"}`);
    assert(submitted.expectedTxHash !== undefined);
    const settlementReceipt = await publicClient.getTransactionReceipt({
      hash: submitted.expectedTxHash as Hex,
    });
    const completionEvents = parseEventLogs({
      abi: [jobCompletedEvent],
      logs: settlementReceipt.logs,
      eventName: "JobCompleted",
    });
    if (completionEvents.length !== 1)
      throw new Error("canonical ERC-8183 JobCompleted event is missing");
    assert.equal(
      completionEvents[0]?.args.reason,
      readyArtifact.attestation.evidenceHash,
    );
    const after = await Promise.all([
      balance(clientAccount.address),
      balance(providerAccount.address),
      balance(manifest.erc8183.proxy),
      balance(manifest.erc8183.treasury),
      balance(manifest.pactEvaluator.address),
      publicClient.getBalance({ address: relayAccount.address }),
    ]);
    const finalJob = (await publicClient.readContract({
      address: manifest.erc8183.proxy,
      abi: erc8183.abi,
      functionName: "getJob",
      args: [jobId],
    })) as {
      readonly status: number;
      readonly budget: bigint;
      readonly settledAmount: bigint;
    };
    const fundReceipt = await publicClient.getTransactionReceipt({
      hash: fund.transactionHash,
    });
    const canonicalTransfers = (logs: typeof settlementReceipt.logs) =>
      parseEventLogs({
        abi: [transferEvent],
        logs: logs.filter(
          (log) =>
            log.address.toLowerCase() === manifest.usdc.address.toLowerCase(),
        ),
        eventName: "Transfer",
        strict: true,
      });
    const transferTotal = (
      logs: ReturnType<typeof canonicalTransfers>,
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
    const fundingTransfers = canonicalTransfers(fundReceipt.logs);
    const settlementTransfers = canonicalTransfers(settlementReceipt.logs);
    const fundingTransferToEscrow = transferTotal(
      fundingTransfers,
      clientAccount.address,
      manifest.erc8183.proxy,
    );
    const providerPayoutFromEscrow = transferTotal(
      settlementTransfers,
      manifest.erc8183.proxy,
      providerAccount.address,
    );
    const treasuryApplicationTransfer = transferTotal(
      settlementTransfers,
      manifest.erc8183.proxy,
      manifest.erc8183.treasury,
    );
    const evaluatorApplicationTransfer = transferTotal(
      settlementTransfers,
      manifest.erc8183.proxy,
      manifest.pactEvaluator.address,
    );
    assertGrossZeroFeeSettlement({
      expectedBudget: amount,
      jobBudget: finalJob.budget,
      settledAmountBeforeCompletion: jobBeforeCompletion.settledAmount,
      settledAmountAfterCompletion: finalJob.settledAmount,
      jobStatus: finalJob.status,
      fundingTransferToEscrow,
      providerPayoutFromEscrow,
      treasuryApplicationTransfer,
      evaluatorApplicationTransfer,
      escrowBefore: BigInt(state.escrowBefore),
      escrowAfter: after[2],
    });
    const receiptGas = async (transactionHash: Hex) => {
      const receipt = await publicClient.getTransactionReceipt({
        hash: transactionHash,
      });
      const gasFee = calculateGasFee({
        gasUsed: receipt.gasUsed,
        effectiveGasPrice: receipt.effectiveGasPrice,
      });
      return {
        transactionHash,
        gasUsed: receipt.gasUsed.toString(),
        effectiveGasPrice: receipt.effectiveGasPrice.toString(),
        gasFee: gasFee.toString(),
      };
    };
    const gasGroup = async (hashes: readonly Hex[]) => {
      const transactions = await Promise.all(hashes.map(receiptGas));
      return {
        totalGasFee: transactions
          .reduce(
            (total, transaction) => total + BigInt(transaction.gasFee),
            0n,
          )
          .toString(),
        transactions,
      };
    };
    const gasAccounting = {
      deployer: await gasGroup([
        manifest.deploymentTransactions.implementation,
        manifest.deploymentTransactions.proxy,
        manifest.deploymentTransactions.allowUsdc,
        manifest.deploymentTransactions.evaluator,
      ]),
      client: await gasGroup([
        create.transactionHash,
        bind.transactionHash,
        approve.transactionHash,
        fund.transactionHash,
      ]),
      provider: await gasGroup([
        setBudget.transactionHash,
        submit.transactionHash,
      ]),
      relay: await gasGroup([submitted.expectedTxHash as Hex]),
    };
    const [implementationReceipt, evaluatorDeploymentReceipt] =
      await Promise.all([
        publicClient.getTransactionReceipt({
          hash: manifest.deploymentTransactions.implementation,
        }),
        publicClient.getTransactionReceipt({
          hash: manifest.deploymentTransactions.evaluator,
        }),
      ]);
    const nativeBalanceWindow = async (
      address: Address,
      beforeBlock: bigint,
      afterBlock: bigint,
    ) => {
      const [before, after] = await Promise.all([
        publicClient.getBalance({ address, blockNumber: beforeBlock }),
        publicClient.getBalance({ address, blockNumber: afterBlock }),
      ]);
      return {
        before: before.toString(),
        after: after.toString(),
        change: (after - before).toString(),
        beforeBlock: beforeBlock.toString(),
        afterBlock: afterBlock.toString(),
      };
    };
    const e2eBeforeBlock = createReceipt.blockNumber - 1n;
    const nativeBalanceDiagnostics = {
      deployer: await nativeBalanceWindow(
        manifest.deployer,
        implementationReceipt.blockNumber - 1n,
        evaluatorDeploymentReceipt.blockNumber,
      ),
      client: await nativeBalanceWindow(
        clientAccount.address,
        e2eBeforeBlock,
        settlementReceipt.blockNumber,
      ),
      provider: await nativeBalanceWindow(
        providerAccount.address,
        e2eBeforeBlock,
        settlementReceipt.blockNumber,
      ),
      relay: await nativeBalanceWindow(
        relayAccount.address,
        e2eBeforeBlock,
        settlementReceipt.blockNumber,
      ),
      treasury: {
        classification: "PASSIVE_NO_CONTROLLED_TRANSACTIONS",
        totalGasFee: "0",
      },
      evaluator: {
        classification: "CONTRACT_NOT_GAS_PAYING_EOA",
        totalGasFee: "0",
      },
    };
    reconcileArcNativeBalance({
      nativeBefore: BigInt(nativeBalanceDiagnostics.client.before),
      nativeAfter: BigInt(nativeBalanceDiagnostics.client.after),
      applicationInflows: 0n,
      applicationOutflows: fundingTransferToEscrow,
      gasFees: BigInt(gasAccounting.client.totalGasFee),
    });
    reconcileArcNativeBalance({
      nativeBefore: BigInt(nativeBalanceDiagnostics.provider.before),
      nativeAfter: BigInt(nativeBalanceDiagnostics.provider.after),
      applicationInflows: providerPayoutFromEscrow,
      applicationOutflows: 0n,
      gasFees: BigInt(gasAccounting.provider.totalGasFee),
    });
    reconcileArcNativeBalance({
      nativeBefore: BigInt(nativeBalanceDiagnostics.relay.before),
      nativeAfter: BigInt(nativeBalanceDiagnostics.relay.after),
      applicationInflows: 0n,
      applicationOutflows: 0n,
      gasFees: BigInt(gasAccounting.relay.totalGasFee),
    });
    const intent =
      submitted.intentId === undefined
        ? undefined
        : await relayRepository.getIntent(submitted.intentId);
    if (intent?.state !== "SETTLED")
      throw new Error("durable relay intent is not SETTLED");
    const result = {
      jobId: jobId.toString(),
      conditionHash,
      evidenceHash: readyArtifact.attestation.evidenceHash,
      attestationDigest: prepared.attestationDigest,
      settlementTransactionHash: submitted.expectedTxHash,
      eventBlockNumber: intent.eventBlockNumber?.toString(),
      eventLogIndex: intent.eventLogIndex,
      client: clientAccount.address,
      provider: providerAccount.address,
      budget: amount.toString(),
      grossAccounting: {
        jobBudget: finalJob.budget.toString(),
        settledAmount: finalJob.settledAmount.toString(),
        pinnedCompletePayoutBasis: (
          finalJob.budget - jobBeforeCompletion.settledAmount
        ).toString(),
        fundingTransferToEscrow: fundingTransferToEscrow.toString(),
        providerPayoutFromEscrow: providerPayoutFromEscrow.toString(),
        treasuryApplicationTransfer: treasuryApplicationTransfer.toString(),
        evaluatorApplicationTransfer: evaluatorApplicationTransfer.toString(),
        escrowBefore: state.escrowBefore,
        escrowAfter: after[2].toString(),
      },
      gasAccounting,
      nativeBalanceDiagnostics,
      erc20BalanceDiagnostics: {
        clientBefore: state.clientBefore,
        clientAfter: after[0].toString(),
        providerBefore: state.providerBefore,
        providerAfter: after[1].toString(),
        treasuryBefore: state.treasuryBefore,
        treasuryAfter: after[3].toString(),
        evaluatorBefore: state.evaluatorBefore,
        evaluatorAfter: after[4].toString(),
      },
      relayGasBefore: state.relayGasBefore,
      relayGasAfter: after[5].toString(),
    };
    const resultHash = keccak256(stringToHex(JSON.stringify(result)));
    if (manifest.network === "arc-testnet") {
      const gated = assertDeploymentManifest({
        ...manifest,
        testnetGate: {
          status: "PASS",
          deploymentGitCommit: manifest.gitCommit,
          e2eRuntimeCommit: gitCommit,
          erc8183SourceCommit: manifest.erc8183.sourceCommit,
          evaluatorCodeHash: evaluatorArtifactHash,
          completedAt: new Date().toISOString(),
          resultHash,
        },
      });
      const temporary = `${manifestPath}.tmp`;
      await writeFile(temporary, `${JSON.stringify(gated, null, 2)}\n`, {
        mode: 0o644,
      });
      await rename(temporary, manifestPath);
    }
    process.stdout.write(
      `${JSON.stringify({ status: "PASS", ...result, resultHash }, null, 2)}\n`,
    );
  } finally {
    await database.close();
  }
}

await main();
