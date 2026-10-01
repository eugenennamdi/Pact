import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
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
import {
  createGitHubPullRequestClient,
  verifyGitHubPrMerged,
} from "@pact/verifier/github";
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
  mainnetGateResultHash,
} from "./manifest.js";
import {
  assertRemainingRunAffordability,
  assertControlledE2EAmount,
  assertGrossZeroFeeSettlement,
  calculateGasFee,
  controlledE2EOperationTrigger,
  controlledE2EWindow,
  parseUsdcBaseUnits,
  reconcileArcNativeBalance,
  type ControlledFinancialStep,
} from "./safety.js";
import {
  FileControlledOperatorState,
  advanceControlledOperatorState,
  assertControlledOperatorIdentity,
  parseControlledOperatorAction,
  type ControlledOperatorState,
} from "./staged-operator.js";
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

async function runControlledOperator(): Promise<void> {
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
  const operationScope = required("PACT_E2E_OPERATION_SCOPE");
  const action = parseControlledOperatorAction(required("PACT_E2E_ACTION"));
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
  const balance = (owner: Address) =>
    publicClient.readContract({
      address: manifest.usdc.address,
      abi: usdcArtifact.abi,
      functionName: "balanceOf",
      args: [owner],
    }) as Promise<bigint>;
  const condition = normalizeGithubPrMergedCondition({
    provider: "github",
    repository: required("PACT_E2E_GITHUB_REPOSITORY"),
    pullRequest: Number(required("PACT_E2E_GITHUB_PULL_REQUEST")),
    baseBranch: required("PACT_E2E_GITHUB_BASE_BRANCH"),
    event: "PR_MERGED",
  });
  const conditionHash = hashGithubPrMergedCondition(condition);
  const stateStore = FileControlledOperatorState.open(statePath);
  const loadedState = await stateStore.load();
  let state: ControlledOperatorState;
  if (loadedState === undefined) {
    if (action !== "prepare") throw new Error("OPERATOR_PREPARE_REQUIRED");
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
      schemaVersion: 2,
      stage: "DEPLOYED",
      manifestIdentity,
      network: manifest.network,
      chainId: manifest.chainId,
      operationScope,
      pactId: uuidFromHash(seed),
      commerceContract: manifest.erc8183.proxy,
      pactEvaluator: manifest.pactEvaluator.address,
      client: clientAccount.address,
      provider: providerAccount.address,
      verifier: verifierAccount.address,
      relay: relayAccount.address,
      repository: condition.repository,
      pullRequest: condition.pullRequest,
      baseBranch: condition.baseBranch,
      conditionHash,
      amount: amount.toString(),
      clientBefore: balances[0].toString(),
      providerBefore: balances[1].toString(),
      escrowBefore: balances[2].toString(),
      treasuryBefore: balances[3].toString(),
      evaluatorBefore: balances[4].toString(),
      relayGasBefore: balances[5].toString(),
      completionDeadline: window.completionDeadline.toString(),
      expiredAt: window.expiredAt.toString(),
      transactions: {},
      affordabilityChecks: [],
    };
    await stateStore.create(state);
  } else {
    state = loadedState;
  }
  assertControlledOperatorIdentity(state, {
    manifestIdentity,
    network: manifest.network,
    chainId: manifest.chainId,
    operationScope,
    commerceContract: manifest.erc8183.proxy,
    pactEvaluator: manifest.pactEvaluator.address,
    client: clientAccount.address,
    provider: providerAccount.address,
    verifier: verifierAccount.address,
    relay: relayAccount.address,
    repository: condition.repository,
    pullRequest: condition.pullRequest,
    baseBranch: condition.baseBranch,
    conditionHash,
    amount: amount.toString(),
  });
  const transaction = (name: string): Hex => {
    const hash = state.transactions[name];
    if (hash === undefined)
      throw new Error(`OPERATOR_STATE_MISSING_TRANSACTION:${name}`);
    return hash;
  };
  const completionDeadline = BigInt(state.completionDeadline);
  const expiredAt = BigInt(state.expiredAt);
  const github = createGitHubPullRequestClient({
    ...(process.env.GITHUB_TOKEN === undefined ||
    process.env.GITHUB_TOKEN.trim() === ""
      ? {}
      : { token: process.env.GITHUB_TOKEN }),
  });
  const observeCondition = async () => {
    const block = await publicClient.getBlock({ blockTag: "latest" });
    return verifyGitHubPrMerged({
      condition,
      completionDeadline,
      observedAt: block.timestamp,
      client: github,
    });
  };
  const journal = await FileDeploymentJournal.open(journalPath);
  const send = async (
    step: string,
    financialStep: ControlledFinancialStep,
    remainingSteps: readonly ControlledFinancialStep[],
    applicationReserveBaseUnits: bigint,
    account: PrivateKeyAccount,
    to: Address,
    data: Hex,
  ): Promise<DeploymentTransactionRecord> => {
    const existing = await journal.load(step);
    if (existing?.state === "CONFIRMED") return existing;
    await verifyDeploymentIntegrity(rpcUrl, manifest, readTimeoutMs);
    const affordabilityBlock = await publicClient.getBlock({
      blockTag: "latest",
    });
    const [senderBalance, observedGasPrice] = await Promise.all([
      publicClient.getBalance({ address: account.address }),
      publicClient.getGasPrice(),
    ]);
    const affordability = assertRemainingRunAffordability({
      senderBalance,
      observedGasPrice,
      steps: [financialStep, ...remainingSteps],
      applicationReserveBaseUnits,
    });
    state = {
      ...state,
      affordabilityChecks: [
        ...state.affordabilityChecks,
        {
          step,
          sender: account.address,
          blockNumber: affordabilityBlock.number.toString(),
          senderBalance: affordability.senderBalance.toString(),
          observedGasPrice: affordability.observedGasPrice.toString(),
          planningGasPrice: affordability.planningGasPrice.toString(),
          gasRequirement: affordability.gasRequirement.toString(),
          applicationReserveBaseUnits:
            affordability.applicationReserveBaseUnits.toString(),
          totalRequirement: affordability.totalRequirement.toString(),
        },
      ],
    };
    await stateStore.save(state);
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
  if (action === "prepare") {
    if (
      state.stage === "DEPLOYED" &&
      state.initialConditionResult === undefined
    ) {
      const initial = await observeCondition();
      if (
        initial.status !== "NOT_SATISFIED" ||
        initial.reason !== "PULL_REQUEST_NOT_MERGED" ||
        !initial.retryable
      )
        throw new Error(`INITIAL_CONDITION_NOT_OPEN:${initial.status}`);
      state = { ...state, initialConditionResult: "NOT_SATISFIED_RETRYABLE" };
      await stateStore.save(state);
    }
    if (state.stage === "DEPLOYED") {
      const create = await send(
        "e2e-create-job",
        "e2e-create-job",
        ["e2e-bind-condition", "e2e-approve-usdc", "e2e-fund"],
        amount,
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
      const jobKey = hashPactJobIdentity(
        normalizePactJobIdentity({
          chainId: BigInt(manifest.chainId),
          commerceContract: manifest.erc8183.proxy,
          jobId,
        }),
      );
      state = advanceControlledOperatorState(state, "JOB_CREATED", {
        jobId: jobId.toString(),
        jobKey,
        transactions: {
          ...state.transactions,
          createJob: create.transactionHash,
        },
      });
      await stateStore.save(state);
    }
    const jobId = BigInt(state.jobId!);
    if (state.stage === "JOB_CREATED") {
      const bind = await send(
        "e2e-bind-condition",
        "e2e-bind-condition",
        ["e2e-approve-usdc", "e2e-fund"],
        amount,
        clientAccount,
        manifest.pactEvaluator.address,
        encodeFunctionData({
          abi: evaluatorArtifact.abi,
          functionName: "bindCondition",
          args: [
            jobId,
            conditionHash,
            completionDeadline,
            verifierAccount.address,
          ],
        }),
      );
      state = advanceControlledOperatorState(state, "CONDITION_BOUND", {
        transactions: {
          ...state.transactions,
          bindCondition: bind.transactionHash,
        },
      });
      await stateStore.save(state);
    }
    if (state.stage === "CONDITION_BOUND") {
      const setBudget = await send(
        "e2e-set-budget",
        "e2e-set-budget",
        ["e2e-submit"],
        0n,
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
        "e2e-approve-usdc",
        ["e2e-fund"],
        amount,
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
        "e2e-fund",
        [],
        amount,
        clientAccount,
        manifest.erc8183.proxy,
        encodeFunctionData({
          abi: erc8183.abi,
          functionName: "fund",
          args: [jobId, manifest.usdc.address, amount, "0x"],
        }),
      );
      state = advanceControlledOperatorState(state, "FUNDED", {
        transactions: {
          ...state.transactions,
          setBudget: setBudget.transactionHash,
          approveUsdc: approve.transactionHash,
          fund: fund.transactionHash,
        },
      });
      await stateStore.save(state);
    }
    if (state.stage === "FUNDED") {
      const submit = await send(
        "e2e-submit",
        "e2e-submit",
        [],
        0n,
        providerAccount,
        manifest.erc8183.proxy,
        encodeFunctionData({
          abi: erc8183.abi,
          functionName: "submit",
          args: [jobId, conditionHash, "0x"],
        }),
      );
      state = advanceControlledOperatorState(state, "SUBMITTED", {
        transactions: {
          ...state.transactions,
          submit: submit.transactionHash,
        },
      });
      await stateStore.save(state);
    }
    if (state.stage === "SUBMITTED") {
      const snapshot = await createArcReadClient({
        rpcUrl,
        timeoutMs: readTimeoutMs,
      }).readSnapshot({
        pactEvaluator: manifest.pactEvaluator.address,
        commerceContract: manifest.erc8183.proxy,
        jobId,
      });
      if (
        snapshot.jobStatus !== 2 ||
        !snapshot.bindingExists ||
        snapshot.bindingAccepted ||
        snapshot.jobKey !== state.jobKey ||
        snapshot.bindingConditionHash !== conditionHash
      )
        throw new Error("SUBMITTED_CHECKPOINT_CANONICAL_STATE_MISMATCH");
      state = advanceControlledOperatorState(state, "AWAITING_CONDITION");
      await stateStore.save(state);
    }
    if (state.stage !== "AWAITING_CONDITION")
      throw new Error(`PREPARE_STAGE_INVALID:${state.stage}`);
    process.stdout.write(
      `${JSON.stringify({ status: "AWAITING_CONDITION", stage: state.stage, jobId: state.jobId, conditionHash }, null, 2)}\n`,
    );
    return;
  }

  if (
    state.stage === "DEPLOYED" ||
    state.stage === "JOB_CREATED" ||
    state.stage === "CONDITION_BOUND" ||
    state.stage === "FUNDED" ||
    state.stage === "SUBMITTED"
  )
    throw new Error("OPERATOR_PREPARE_INCOMPLETE");
  const jobId = BigInt(state.jobId!);
  const canonicalBeforeResume = await createArcReadClient({
    rpcUrl,
    timeoutMs: readTimeoutMs,
  }).readSnapshot({
    pactEvaluator: manifest.pactEvaluator.address,
    commerceContract: manifest.erc8183.proxy,
    jobId,
  });
  if (
    canonicalBeforeResume.chainId !== BigInt(manifest.chainId) ||
    canonicalBeforeResume.commerceContract !== manifest.erc8183.proxy ||
    canonicalBeforeResume.pactEvaluator !== manifest.pactEvaluator.address ||
    canonicalBeforeResume.jobKey !== state.jobKey ||
    canonicalBeforeResume.bindingConditionHash !== conditionHash ||
    canonicalBeforeResume.bindingCompletionDeadline !== completionDeadline ||
    canonicalBeforeResume.bindingVerifier !== verifierAccount.address ||
    canonicalBeforeResume.jobClient !== clientAccount.address ||
    canonicalBeforeResume.jobProvider !== providerAccount.address ||
    canonicalBeforeResume.jobEvaluator !== manifest.pactEvaluator.address ||
    canonicalBeforeResume.jobExpiredAt !== expiredAt ||
    !canonicalBeforeResume.bindingExists
  )
    throw new Error("OPERATOR_RESUME_CANONICAL_STATE_MISMATCH");
  if (state.stage === "SETTLED") {
    if (
      canonicalBeforeResume.jobStatus !== 3 ||
      !canonicalBeforeResume.bindingAccepted
    )
      throw new Error("OPERATOR_SETTLED_STATE_MISMATCH");
  } else if (
    canonicalBeforeResume.jobStatus !== 2 ||
    canonicalBeforeResume.bindingAccepted ||
    canonicalBeforeResume.verifierRevoked ||
    canonicalBeforeResume.blockTimestamp >= expiredAt
  ) {
    throw new Error("OPERATOR_RESUME_NOT_SUBMITTED");
  }
  if (state.stage === "AWAITING_CONDITION") {
    const verification = await observeCondition();
    if (verification.status === "NOT_SATISFIED") {
      state = {
        ...state,
        falseResumeCount: (state.falseResumeCount ?? 0) + 1,
      };
      await stateStore.save(state);
      process.stdout.write(
        `${JSON.stringify({ status: "AWAITING_CONDITION", stage: state.stage, reason: verification.reason, databaseWrites: 0, financialWrites: 0 }, null, 2)}\n`,
      );
      return;
    }
    if (verification.status !== "SATISFIED")
      throw new Error(`CONDITION_INDETERMINATE:${verification.reason}`);
    state = advanceControlledOperatorState(state, "CONDITION_SATISFIED");
    await stateStore.save(state);
  } else if (state.stage !== "SETTLED") {
    const verification = await observeCondition();
    if (verification.status !== "SATISFIED")
      throw new Error(`OPERATOR_RESUME_CONDITION_DRIFT:${verification.status}`);
  }
  const jobBeforeCompletion = (await publicClient.readContract({
    address: manifest.erc8183.proxy,
    abi: erc8183.abi,
    functionName: "getJob",
    args: [jobId],
  })) as { readonly budget: bigint; readonly settledAmount: bigint };

  const database = createPactDatabaseFromEnv(process.env);
  try {
    const pactRepository = new PostgresPactRepository(database);
    const jobKey = state.jobKey!;
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
    let operationId = state.operationId;
    if (state.stage === "CONDITION_SATISFIED") {
      if ((await pactRepository.getPact(state.pactId)) === undefined)
        await pactRepository.createPact(pact);
      const operation = await pactRepository.enqueueManualOperation(
        state.pactId,
        controlledE2EOperationTrigger({
          jobKey,
          runtimeCommit: gitCommit,
          scope: operationScope,
        }),
      );
      operationId = operation.id;
      state = advanceControlledOperatorState(state, "PHASE4A_ENQUEUED", {
        operationId,
      });
      await stateStore.save(state);
    }
    if (operationId === undefined)
      throw new Error("OPERATOR_STATE_MISSING_OPERATION");
    const orchestrator = createPhase4AOrchestrator({
      repository: pactRepository,
      github,
      arc: createArcReadClient({ rpcUrl, timeoutMs: readTimeoutMs }),
      signer: createPactCompletionSigner({ privateKey: verifierKey }),
      configuredChainId: BigInt(manifest.chainId),
      configuredPactEvaluator: manifest.pactEvaluator.address,
      configuredCommerceContract: manifest.erc8183.proxy,
    });
    if (state.stage === "PHASE4A_ENQUEUED") {
      const prepared = await orchestrator.processOperation(operationId);
      if (prepared.state !== "READY_TO_RELAY")
        throw new Error(
          `backend did not reach READY_TO_RELAY: ${prepared.state}:${prepared.code ?? ""}`,
        );
      state = advanceControlledOperatorState(state, "READY_TO_RELAY");
      await stateStore.save(state);
    }
    if (state.stage !== "READY_TO_RELAY" && state.stage !== "SETTLED")
      throw new Error(`RESUME_STAGE_INVALID:${state.stage}`);
    await verifyDeploymentIntegrity(rpcUrl, manifest, readTimeoutMs);
    const relayRepository = new PostgresRelayRepository(database);
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
    const previouslySettled = await (async () => {
      const settledIntents = await relayRepository.listIntents(["SETTLED"], 25);
      for (const candidate of settledIntents) {
        const artifact = await relayRepository.findArtifactByIntent(
          candidate.id,
        );
        if (artifact?.operationId === operationId) return candidate;
      }
      return undefined;
    })();
    if (previouslySettled === undefined) {
      const [relayBalance, gasPrice] = await Promise.all([
        publicClient.getBalance({ address: relayAccount.address }),
        publicClient.getGasPrice(),
      ]);
      const affordability = assertRemainingRunAffordability({
        senderBalance: relayBalance,
        observedGasPrice: gasPrice,
        steps: ["e2e-settle"],
      });
      const affordabilityBlock = await publicClient.getBlock({
        blockTag: "latest",
      });
      state = {
        ...state,
        affordabilityChecks: [
          ...state.affordabilityChecks,
          {
            step: "e2e-settle",
            sender: relayAccount.address,
            blockNumber: affordabilityBlock.number.toString(),
            senderBalance: affordability.senderBalance.toString(),
            observedGasPrice: affordability.observedGasPrice.toString(),
            planningGasPrice: affordability.planningGasPrice.toString(),
            gasRequirement: affordability.gasRequirement.toString(),
            applicationReserveBaseUnits: "0",
            totalRequirement: affordability.totalRequirement.toString(),
          },
        ],
      };
      await stateStore.save(state);
    }
    const processed =
      previouslySettled === undefined
        ? await relayService.process()
        : { state: "IDLE" as const };
    if (
      processed.state !== "SUBMITTED" &&
      processed.state !== "BROADCAST_UNKNOWN" &&
      processed.state !== "IDLE"
    )
      throw new Error(
        `relay did not submit or resume: ${processed.state}:${processed.code ?? ""}`,
      );
    const reconciled =
      previouslySettled === undefined ? await relayService.reconcile() : [];
    let settlementIntent = await (async () => {
      const settledResult = reconciled.find(
        (candidate) => candidate.state === "SETTLED",
      );
      if (settledResult?.intentId !== undefined)
        return relayRepository.getIntent(settledResult.intentId);
      const settledIntents = await relayRepository.listIntents(["SETTLED"], 10);
      for (const candidate of settledIntents) {
        const artifact = await relayRepository.findArtifactByIntent(
          candidate.id,
        );
        if (artifact?.operationId === operationId) return candidate;
      }
      return undefined;
    })();
    if (settlementIntent?.state !== "SETTLED")
      throw new Error(
        `relay did not settle: ${reconciled[0]?.state ?? processed.state}`,
      );
    const readyArtifact = await relayRepository.findArtifactByIntent(
      settlementIntent.id,
    );
    if (readyArtifact === undefined)
      throw new Error("durable READY_TO_RELAY artifact is missing");
    const settlementTransactionHash = settlementIntent.canonicalTxHash;
    if (settlementTransactionHash === null)
      throw new Error("settled relay intent lacks canonical transaction hash");
    const settlementReceipt = await publicClient.getTransactionReceipt({
      hash: settlementTransactionHash,
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
      hash: transaction("fund"),
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
        transaction("createJob"),
        transaction("bindCondition"),
        transaction("approveUsdc"),
        transaction("fund"),
      ]),
      provider: await gasGroup([
        transaction("setBudget"),
        transaction("submit"),
      ]),
      relay: await gasGroup([settlementTransactionHash]),
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
    const createReceipt = await publicClient.getTransactionReceipt({
      hash: transaction("createJob"),
    });
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
    settlementIntent = await relayRepository.getIntent(settlementIntent.id);
    if (settlementIntent?.state !== "SETTLED")
      throw new Error("durable relay intent is not SETTLED");
    if (state.stage === "READY_TO_RELAY") {
      state = advanceControlledOperatorState(state, "SETTLED", {
        settlementTransactionHash,
      });
      await stateStore.save(state);
    }
    const result = {
      jobId: jobId.toString(),
      conditionHash,
      evidenceHash: readyArtifact.attestation.evidenceHash,
      attestationDigest: readyArtifact.attestation.digest,
      settlementTransactionHash,
      eventBlockNumber: settlementIntent.eventBlockNumber?.toString(),
      eventLogIndex: settlementIntent.eventLogIndex,
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
          jobId: jobId.toString(),
          github: {
            repository: condition.repository,
            pullRequest: condition.pullRequest,
            baseBranch: condition.baseBranch,
            mergeCommitSha: readyArtifact.evidence.mergeCommitSha,
          },
          conditionHash,
          evidenceHash: readyArtifact.attestation.evidenceHash,
          attestationDigest: readyArtifact.attestation.digest,
          settlementTransactionHash,
          event: {
            blockNumber:
              settlementIntent.eventBlockNumber?.toString() ??
              (() => {
                throw new Error("settled relay intent lacks event block");
              })(),
            logIndex:
              settlementIntent.eventLogIndex ??
              (() => {
                throw new Error("settled relay intent lacks event log index");
              })(),
          },
          runtimeCodeHashes: {
            erc8183Proxy: manifest.erc8183.proxyCodeHash,
            erc8183Implementation: manifest.erc8183.implementationCodeHash,
            pactEvaluator: manifest.pactEvaluator.codeHash,
          },
        },
      });
      const temporary = `${manifestPath}.tmp`;
      await writeFile(temporary, `${JSON.stringify(gated, null, 2)}\n`, {
        mode: 0o644,
      });
      await rename(temporary, manifestPath);
    } else {
      if (finalJob.settledAmount !== 0n)
        throw new Error("MAINNET_GATE_PREEXISTING_CLAIM_FORBIDDEN");
      const finalSnapshot = await createArcReadClient({
        rpcUrl,
        timeoutMs: readTimeoutMs,
      }).readSnapshot({
        pactEvaluator: manifest.pactEvaluator.address,
        commerceContract: manifest.erc8183.proxy,
        jobId,
      });
      if (!finalSnapshot.bindingAccepted || finalSnapshot.jobStatus !== 3)
        throw new Error("MAINNET_GATE_FINAL_STATE_INVALID");
      if (
        settlementReceipt.blockHash === null ||
        settlementIntent.eventBlockNumber === null ||
        settlementIntent.eventBlockHash === null ||
        settlementIntent.eventLogIndex === null ||
        completionEvents[0] === undefined ||
        completionEvents[0].blockHash === null ||
        completionEvents[0].logIndex === null
      )
        throw new Error("MAINNET_GATE_EVENT_COORDINATES_MISSING");
      const gateWithoutHash = {
        schemaVersion: 1 as const,
        status: "PASS" as const,
        chainId: "5042" as const,
        mainnetReleaseCommit: gitCommit,
        erc8183SourceCommit: manifest.erc8183.sourceCommit,
        completedAt: new Date().toISOString(),
        contracts: {
          implementation: manifest.erc8183.implementation,
          proxy: manifest.erc8183.proxy,
          pactEvaluator: manifest.pactEvaluator.address,
        },
        runtimeCodeHashes: {
          erc8183Implementation: manifest.erc8183.implementationCodeHash,
          erc8183Proxy: manifest.erc8183.proxyCodeHash,
          pactEvaluator: manifest.pactEvaluator.codeHash,
        },
        roles: {
          operator: manifest.deployer,
          treasury: manifest.erc8183.treasury,
          provider: providerAccount.address,
          verifier: verifierAccount.address,
          relay: relayAccount.address,
        },
        deploymentTransactions: manifest.deploymentTransactions,
        jobId: jobId.toString(),
        github: {
          repository: condition.repository,
          pullRequest: condition.pullRequest,
          baseBranch: condition.baseBranch,
          mergeCommitSha: readyArtifact.evidence.mergeCommitSha,
          mergedAt: new Date(
            Number(readyArtifact.evidence.mergedAt) * 1_000,
          ).toISOString(),
        },
        conditionHash,
        evidenceHash: readyArtifact.attestation.evidenceHash,
        attestationDigest: readyArtifact.attestation.digest,
        settlement: {
          transactionHash: settlementTransactionHash,
          receiptBlockNumber: settlementReceipt.blockNumber.toString(),
          receiptBlockHash: settlementReceipt.blockHash,
          pactCompletionAccepted: {
            blockNumber: settlementIntent.eventBlockNumber.toString(),
            blockHash: settlementIntent.eventBlockHash,
            logIndex: settlementIntent.eventLogIndex,
          },
          jobCompleted: {
            blockNumber: completionEvents[0].blockNumber.toString(),
            blockHash: completionEvents[0].blockHash,
            logIndex: completionEvents[0].logIndex,
          },
        },
        broadcastAttemptCount: settlementIntent.broadcastAttemptCount as 1,
        economics: {
          budget: amount.toString(),
          grossFunding: fundingTransferToEscrow.toString(),
          grossProviderPayout: providerPayoutFromEscrow.toString(),
          treasuryApplicationPayout: "0" as const,
          evaluatorApplicationPayout: "0" as const,
          settledAmount: "0" as const,
          completionReason: readyArtifact.attestation.evidenceHash,
        },
        finalState: {
          jobStatus: 3 as const,
          bindingAccepted: true as const,
        },
      };
      if (settlementIntent.broadcastAttemptCount !== 1)
        throw new Error("MAINNET_GATE_BROADCAST_COUNT_INVALID");
      const gated = assertDeploymentManifest({
        ...manifest,
        mainnetGate: {
          ...gateWithoutHash,
          resultHash: mainnetGateResultHash(gateWithoutHash),
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

async function main(): Promise<void> {
  const statePath = resolve(required("PACT_E2E_STATE_PATH"));
  const releaseOperatorLock =
    await FileControlledOperatorState.acquireExclusive(statePath);
  try {
    await runControlledOperator();
  } finally {
    await releaseOperatorLock();
  }
}

await main();
