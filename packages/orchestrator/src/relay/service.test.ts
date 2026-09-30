import type {
  CanonicalRelayOutcome,
  PersistedChainSnapshot,
  PersistedRelayTransaction,
  ReadyToRelayArtifact,
  RelayIntentRecord,
  RelayNonceReservation,
  RelayState,
} from "@pact/database";
import {
  hashGithubPrMergedCondition,
  hashPactCompletionAttestation,
  hashPactGitHubPrMergedEvidenceV1,
  hashPactJobIdentity,
  normalizeGithubPrMergedCondition,
  normalizePactGitHubPrMergedEvidenceV1,
  normalizePactJobIdentity,
} from "@pact/protocol";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import type {
  RelayBroadcastTransport,
  RelayChainClient,
  RelayCompletionEvent,
  RelayReceiptObservation,
} from "./chain.js";
import { RelayRpcReadError } from "./chain.js";
import { createPactRelayService, type RelayRepository } from "./service.js";
import { createPactRelaySigner } from "./signer.js";

const verifierKey =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8413f4603b6b78690d";
const relayKey =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const verifier = privateKeyToAccount(verifierKey).address;
const relay = privateKeyToAccount(relayKey).address;
const evaluator = "0x2222222222222222222222222222222222222222" as const;
const commerce = "0x1111111111111111111111111111111111111111" as const;

function artifact(): ReadyToRelayArtifact {
  const condition = normalizeGithubPrMergedCondition({
    provider: "github",
    repository: "pact-protocol/demo",
    pullRequest: 81,
    baseBranch: "main",
    event: "PR_MERGED",
  });
  const conditionHash = hashGithubPrMergedCondition(condition);
  const evidence = normalizePactGitHubPrMergedEvidenceV1({
    conditionHash,
    repository: condition.repository,
    pullRequest: condition.pullRequest,
    baseBranch: condition.baseBranch,
    mergeCommitSha: "0x0123456789abcdef0123456789abcdef01234567",
    mergedAt: 1_800_000_000n,
    observedAt: 1_800_000_010n,
  });
  const evidenceHash = hashPactGitHubPrMergedEvidenceV1(evidence);
  const jobKey = hashPactJobIdentity(
    normalizePactJobIdentity({
      chainId: 5042n,
      commerceContract: commerce,
      jobId: 81n,
    }),
  );
  const message = {
    commerceContract: commerce,
    jobId: 81n,
    conditionHash,
    evidenceHash,
    satisfiedAt: evidence.mergedAt,
    verifiedAt: evidence.observedAt,
    validUntil: 1_800_000_300n,
  } as const;
  return {
    operationId: "123e4567-e89b-42d3-a456-426614174001",
    pact: {
      id: "123e4567-e89b-42d3-a456-426614174000",
      chainId: 5042n,
      commerceContract: commerce,
      pactEvaluator: evaluator,
      jobId: 81n,
      jobKey,
      condition,
      conditionHash,
      completionDeadline: 1_800_000_120n,
    },
    evidence,
    attestation: {
      digest: hashPactCompletionAttestation(
        { chainId: 5042n, verifyingContract: evaluator },
        message,
      ),
      signature: `0x${"11".repeat(65)}`,
      signer: verifier,
      chainId: 5042n,
      verifyingContract: evaluator,
      ...message,
      jobKey,
    },
    readyBlockNumber: 100n,
  };
}

function baseIntent(value: ReadyToRelayArtifact): RelayIntentRecord {
  return {
    id: "123e4567-e89b-42d3-a456-426614174002",
    pactRecordId: value.pact.id,
    attestationDigest: value.attestation.digest,
    state: "PREPARING",
    code: null,
    retryable: false,
    chainId: 5042n,
    relayAddress: relay,
    pactEvaluator: evaluator,
    commerceContract: commerce,
    nonce: 0,
    calldata: null,
    serializedTransaction: null,
    expectedTxHash: null,
    transactionType: null,
    gasLimit: null,
    gasPrice: null,
    maxFeePerGas: null,
    maxPriorityFeePerGas: null,
    preDispatchBlockNumber: 100n,
    preDispatchBlockHash: `0x${"aa".repeat(32)}`,
    broadcastAttemptCount: 0,
    returnedTxHash: null,
    receiptStatus: null,
    receiptBlockNumber: null,
    receiptBlockHash: null,
    receiptTransactionIndex: null,
    canonicalTxHash: null,
    eventBlockNumber: null,
    eventBlockHash: null,
    eventLogIndex: null,
    eventRelayer: null,
    eventVerifier: null,
    version: 0,
  };
}

class MemoryRelayRepository implements RelayRepository {
  intent: RelayIntentRecord | undefined;
  failAfterSignedPersistence = false;
  failSubmittedPersistence = false;
  readonly value = artifact();

  async listReadyToRelayArtifacts() {
    return this.intent === undefined ? [this.value] : [];
  }
  async getIntent() {
    return this.intent;
  }
  async listIntents(states: readonly RelayState[]) {
    return this.intent !== undefined && states.includes(this.intent.state)
      ? [this.intent]
      : [];
  }
  async recordTerminalBeforeNonce(input: {
    readonly state: RelayState;
    readonly code: string;
    readonly outcome?: CanonicalRelayOutcome;
  }) {
    this.intent = {
      ...baseIntent(this.value),
      nonce: null,
      preDispatchBlockNumber: null,
      preDispatchBlockHash: null,
      state: input.state,
      code: input.code,
      canonicalTxHash: input.outcome?.canonicalTxHash ?? null,
      eventBlockNumber: input.outcome?.eventBlockNumber ?? null,
      eventBlockHash: input.outcome?.eventBlockHash ?? null,
      eventLogIndex: input.outcome?.eventLogIndex ?? null,
      eventRelayer: input.outcome?.eventRelayer ?? null,
      eventVerifier: input.outcome?.eventVerifier ?? null,
    };
    return this.intent;
  }
  async reserveNonce(): Promise<RelayNonceReservation> {
    this.intent = baseIntent(this.value);
    return { kind: "RESERVED", intent: this.intent };
  }
  async persistSignedTransaction(
    _id: string,
    transaction: PersistedRelayTransaction,
  ) {
    if (this.intent?.state !== "PREPARING") return undefined;
    this.intent = {
      ...this.intent,
      state: "SIGNED",
      calldata: transaction.calldata,
      serializedTransaction: transaction.serializedTransaction,
      expectedTxHash: transaction.expectedTxHash,
      transactionType: transaction.transactionType,
      gasLimit: transaction.gasLimit,
      gasPrice: transaction.gasPrice ?? null,
      maxFeePerGas: transaction.maxFeePerGas ?? null,
      maxPriorityFeePerGas: transaction.maxPriorityFeePerGas ?? null,
      version: this.intent.version + 1,
    };
    if (this.failAfterSignedPersistence)
      throw new Error("simulated crash after signed persistence");
    return this.intent;
  }
  async claimDispatch() {
    if (this.intent?.state !== "SIGNED") return undefined;
    this.intent = {
      ...this.intent,
      state: "DISPATCHING",
      broadcastAttemptCount: 1,
      version: this.intent.version + 1,
    };
    return this.intent;
  }
  async transitionPreDispatch(input: {
    readonly state: RelayState;
    readonly code: string;
    readonly outcome?: CanonicalRelayOutcome;
  }) {
    if (
      this.intent === undefined ||
      (this.intent.state !== "PREPARING" && this.intent.state !== "SIGNED")
    )
      return undefined;
    this.intent = {
      ...this.intent,
      state: input.state,
      code: input.code,
      canonicalTxHash: input.outcome?.canonicalTxHash ?? null,
      eventBlockNumber: input.outcome?.eventBlockNumber ?? null,
      eventBlockHash: input.outcome?.eventBlockHash ?? null,
      eventLogIndex: input.outcome?.eventLogIndex ?? null,
      eventRelayer: input.outcome?.eventRelayer ?? null,
      eventVerifier: input.outcome?.eventVerifier ?? null,
    };
    return this.intent;
  }
  async recordBroadcastResult(input: {
    readonly state: "SUBMITTED" | "BROADCAST_UNKNOWN" | "INTEGRITY_FAILURE";
    readonly code?: string;
    readonly returnedTxHash?: RelayIntentRecord["expectedTxHash"];
  }) {
    if (input.state === "SUBMITTED" && this.failSubmittedPersistence)
      throw new Error("database unavailable");
    if (this.intent?.state !== "DISPATCHING") return undefined;
    this.intent = {
      ...this.intent,
      state: input.state,
      code: input.code ?? null,
      returnedTxHash: input.returnedTxHash ?? null,
      retryable: input.state === "BROADCAST_UNKNOWN",
    };
    return this.intent;
  }
  async transitionOutcome(input: {
    readonly state: RelayState;
    readonly code?: string;
    readonly retryable?: boolean;
    readonly outcome?: CanonicalRelayOutcome;
  }) {
    if (
      this.intent === undefined ||
      (this.intent.state !== "SUBMITTED" &&
        this.intent.state !== "BROADCAST_UNKNOWN")
    )
      return undefined;
    const outcome = input.outcome;
    this.intent = {
      ...this.intent,
      state: input.state,
      code: input.code ?? null,
      retryable: input.retryable ?? false,
      canonicalTxHash: outcome?.canonicalTxHash ?? null,
      receiptStatus: outcome?.receiptStatus ?? null,
      receiptBlockNumber: outcome?.receiptBlockNumber ?? null,
      receiptBlockHash: outcome?.receiptBlockHash ?? null,
      receiptTransactionIndex: outcome?.receiptTransactionIndex ?? null,
      eventBlockNumber: outcome?.eventBlockNumber ?? null,
      eventBlockHash: outcome?.eventBlockHash ?? null,
      eventLogIndex: outcome?.eventLogIndex ?? null,
      eventRelayer: outcome?.eventRelayer ?? null,
      eventVerifier: outcome?.eventVerifier ?? null,
    };
    return this.intent;
  }
  async recoverSuccessReceiptObservationRaces() {
    if (
      this.intent?.state !== "INTEGRITY_FAILURE" ||
      this.intent.code !== "SUCCESS_RECEIPT_WITHOUT_SETTLEMENT"
    )
      return 0;
    this.intent = {
      ...this.intent,
      state: "BROADCAST_UNKNOWN",
      code: "RECONCILIATION_READ_SKEW_RECOVERY",
      retryable: true,
    };
    return 1;
  }
  async recoverDispatching() {
    if (this.intent?.state !== "DISPATCHING") return 0;
    this.intent = {
      ...this.intent,
      state: "BROADCAST_UNKNOWN",
      code: "RECOVERED_DISPATCH_BOUNDARY",
      retryable: true,
    };
    return 1;
  }
  async findArtifactByIntent() {
    return this.intent === undefined ? undefined : this.value;
  }
}

class MemoryChain implements RelayChainClient {
  accepted = false;
  expired = false;
  expireOnSecondPreflight = false;
  simulationReadFailure = false;
  observationReadFailure = false;
  external = false;
  expectedTxHash: `0x${string}` | undefined;
  readonly value: ReadyToRelayArtifact;
  private preflightReads = 0;

  constructor(value: ReadyToRelayArtifact) {
    this.value = value;
  }

  completionEvent(): RelayCompletionEvent {
    if (this.expectedTxHash === undefined)
      throw new Error("expected hash missing");
    return {
      transactionHash: this.external
        ? (`0x${"88".repeat(32)}` as const)
        : this.expectedTxHash,
      blockNumber: 101n,
      blockHash: `0x${"bb".repeat(32)}`,
      logIndex: 1,
      jobKey: this.value.pact.jobKey,
      jobId: this.value.pact.jobId,
      evidenceHash: this.value.attestation.evidenceHash,
      conditionHash: this.value.attestation.conditionHash,
      attestationDigest: this.value.attestation.digest,
      verifier,
      relayer: this.external ? verifier : relay,
    };
  }

  snapshot(): PersistedChainSnapshot {
    return {
      blockNumber: 101n,
      blockHash: `0x${"bb".repeat(32)}`,
      blockTimestamp: this.expired ? 1_800_000_301n : 1_800_000_011n,
      chainId: 5042n,
      pactEvaluator: evaluator,
      commerceContract: commerce,
      jobId: this.value.pact.jobId,
      jobKey: this.value.pact.jobKey,
      bindingExists: true,
      bindingConditionHash: this.value.pact.conditionHash,
      bindingCompletionDeadline: this.value.pact.completionDeadline,
      bindingVerifier: verifier,
      bindingAccepted: this.accepted,
      verifierRevoked: false,
      jobClient: "0x3333333333333333333333333333333333333333" as const,
      jobProvider: "0x4444444444444444444444444444444444444444" as const,
      jobEvaluator: evaluator,
      jobStatus: this.accepted ? 3 : 2,
      jobExpiredAt: 1_800_001_000n,
    };
  }
  async readPreflight() {
    this.preflightReads++;
    if (this.expireOnSecondPreflight && this.preflightReads >= 2)
      this.expired = true;
    return {
      snapshot: this.snapshot(),
      completionEvents:
        this.accepted && this.expectedTxHash !== undefined
          ? [this.completionEvent()]
          : [],
    };
  }
  async simulateAndEstimate() {
    if (this.simulationReadFailure) throw new RelayRpcReadError("RPC_TIMEOUT");
    return {
      sufficientBalance: true as const,
      gas: 250_000n,
      type: "eip1559" as const,
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      requiredBalance: 500_000_000_000_000n,
      actualBalance: 1_000_000_000_000_000n,
    };
  }
  async readNonces() {
    return { latest: 0, pending: 0 };
  }
  async prepareExactRequest(
    input: Parameters<RelayChainClient["prepareExactRequest"]>[0],
  ) {
    return {
      chainId: 5042,
      from: relay,
      to: evaluator,
      value: 0n as const,
      data: input.calldata,
      nonce: input.nonce,
      gas: input.preparation.gas,
      type: "eip1559" as const,
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
    };
  }
  async observe(intent: RelayIntentRecord): Promise<RelayReceiptObservation> {
    if (this.observationReadFailure) throw new RelayRpcReadError("RPC_TIMEOUT");
    this.expectedTxHash = intent.expectedTxHash ?? undefined;
    return {
      transactionFound: this.accepted,
      ...(this.accepted && !this.external
        ? {
            receipt: {
              blockHash: `0x${"bb".repeat(32)}`,
              blockNumber: 101n,
              contractAddress: null,
              cumulativeGasUsed: 200_000n,
              effectiveGasPrice: 1n,
              from: relay,
              gasUsed: 200_000n,
              logs: [],
              logsBloom: `0x${"00".repeat(256)}`,
              status: "success" as const,
              to: evaluator,
              transactionHash: intent.expectedTxHash!,
              transactionIndex: 0,
              type: "eip1559" as const,
            },
          }
        : {}),
      ...(this.accepted && this.external
        ? {
            canonicalEventReceipt: {
              blockHash: `0x${"bb".repeat(32)}`,
              blockNumber: 101n,
              contractAddress: null,
              cumulativeGasUsed: 200_000n,
              effectiveGasPrice: 1n,
              from: verifier,
              gasUsed: 200_000n,
              logs: [],
              logsBloom: `0x${"00".repeat(256)}`,
              status: "success" as const,
              to: evaluator,
              transactionHash: this.completionEvent().transactionHash,
              transactionIndex: 0,
              type: "eip1559" as const,
            },
          }
        : {}),
      completionEvents: this.accepted ? [this.completionEvent()] : [],
      snapshot: this.snapshot(),
      latestNonce: this.accepted && !this.external ? 1 : 0,
      pendingNonce: this.accepted && !this.external ? 1 : 0,
    };
  }
}

function setup(
  mode:
    | "normal"
    | "response-lost"
    | "pre-forward"
    | "hash-mismatch"
    | "db-after-dispatch" = "normal",
) {
  const repository = new MemoryRelayRepository();
  repository.failSubmittedPersistence = mode === "db-after-dispatch";
  const chain = new MemoryChain(repository.value);
  let sends = 0;
  const transport: RelayBroadcastTransport = {
    async sendRawTransaction(serializedTransaction) {
      sends++;
      const hash = (await import("viem")).keccak256(serializedTransaction);
      chain.expectedTxHash = hash;
      if (mode === "pre-forward") throw new Error("connection failed");
      chain.accepted = true;
      if (mode === "response-lost") throw new Error("timeout after accept");
      if (mode === "hash-mismatch") return `0x${"77".repeat(32)}`;
      return hash;
    },
  };
  const service = createPactRelayService({
    repository,
    chain,
    transport,
    signer: createPactRelaySigner({
      privateKey: relayKey,
      verifierAddress: verifier,
    }),
    configuredChainId: 5042n,
    configuredPactEvaluator: evaluator,
    configuredCommerceContract: commerce,
  });
  return { service, repository, chain, sends: () => sends };
}

describe("single-dispatch Pact relay service", () => {
  it("persists SIGNED and DISPATCHING before one normal send, then reconciles", async () => {
    const context = setup();
    await expect(context.service.process()).resolves.toMatchObject({
      state: "SUBMITTED",
    });
    expect(context.sends()).toBe(1);
    expect(context.repository.intent).toMatchObject({
      state: "SUBMITTED",
      broadcastAttemptCount: 1,
    });
    await expect(context.service.reconcile()).resolves.toEqual([
      expect.objectContaining({ state: "SETTLED" }),
    ]);
    expect(context.sends()).toBe(1);
  });

  it("classifies a lost response after acceptance as unknown, then settles by reads", async () => {
    const context = setup("response-lost");
    await expect(context.service.process()).resolves.toMatchObject({
      state: "BROADCAST_UNKNOWN",
    });
    expect(context.sends()).toBe(1);
    await expect(context.service.reconcile()).resolves.toEqual([
      expect.objectContaining({ state: "SETTLED" }),
    ]);
    expect(context.sends()).toBe(1);
  });

  it.each(["timeout", "already known", "nonce too low"])(
    "keeps %s send errors ambiguous and never automatically resends",
    async () => {
      const context = setup("pre-forward");
      await expect(context.service.process()).resolves.toMatchObject({
        state: "BROADCAST_UNKNOWN",
      });
      await expect(context.service.reconcile()).resolves.toEqual([
        expect.objectContaining({ state: "BROADCAST_UNKNOWN" }),
      ]);
      await expect(context.service.process()).resolves.toEqual({
        state: "IDLE",
      });
      expect(context.sends()).toBe(1);
    },
  );

  it("quarantines a returned hash mismatch", async () => {
    const context = setup("hash-mismatch");
    await expect(context.service.process()).resolves.toMatchObject({
      state: "INTEGRITY_FAILURE",
      code: "RPC_RETURNED_HASH_MISMATCH",
    });
    expect(context.sends()).toBe(1);
  });

  it("recovers a DB failure after node acceptance through DISPATCHING ambiguity", async () => {
    const context = setup("db-after-dispatch");
    await expect(context.service.process()).resolves.toMatchObject({
      state: "DISPATCHING",
      code: "POST_DISPATCH_DATABASE_FAILURE",
    });
    expect(context.sends()).toBe(1);
    context.repository.failSubmittedPersistence = false;
    await expect(context.service.reconcile()).resolves.toEqual([
      expect.objectContaining({ state: "SETTLED" }),
    ]);
    expect(context.sends()).toBe(1);
  });

  it("recovers the legacy success-receipt read-skew signature by reads only", async () => {
    const context = setup();
    await expect(context.service.process()).resolves.toMatchObject({
      state: "SUBMITTED",
    });
    const submitted = context.repository.intent!;
    context.repository.intent = {
      ...submitted,
      state: "INTEGRITY_FAILURE",
      code: "SUCCESS_RECEIPT_WITHOUT_SETTLEMENT",
      retryable: false,
      receiptStatus: "success",
      receiptBlockNumber: 101n,
      receiptBlockHash: `0x${"aa".repeat(32)}`,
      receiptTransactionIndex: 0,
      canonicalTxHash: submitted.expectedTxHash,
    };
    await expect(context.service.reconcile()).resolves.toEqual([
      expect.objectContaining({ state: "SETTLED" }),
    ]);
    expect(context.sends()).toBe(1);
  });

  it("resumes a durable PREPARING intent after restart", async () => {
    const context = setup();
    await context.repository.reserveNonce();
    await expect(context.service.process()).resolves.toMatchObject({
      state: "SUBMITTED",
    });
    expect(context.sends()).toBe(1);
  });

  it("resumes a durable SIGNED transaction after restart without re-signing identity", async () => {
    const context = setup();
    context.repository.failAfterSignedPersistence = true;
    await expect(context.service.process()).rejects.toThrow(
      "simulated crash after signed persistence",
    );
    const expectedTxHash = context.repository.intent?.expectedTxHash;
    expect(context.repository.intent?.state).toBe("SIGNED");
    context.repository.failAfterSignedPersistence = false;
    await expect(context.service.process()).resolves.toMatchObject({
      state: "SUBMITTED",
      expectedTxHash,
    });
    expect(context.sends()).toBe(1);
  });

  it("recovers a claimed DISPATCHING intent only to read-only ambiguity", async () => {
    const context = setup();
    context.repository.intent = {
      ...baseIntent(context.repository.value),
      state: "DISPATCHING",
      serializedTransaction: `0x${"01".repeat(32)}`,
      expectedTxHash: `0x${"22".repeat(32)}`,
      calldata: `0x${"33".repeat(32)}`,
      transactionType: "eip1559",
      gasLimit: 250_000n,
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      broadcastAttemptCount: 1,
    };
    await expect(context.service.reconcile()).resolves.toEqual([
      expect.objectContaining({
        state: "BROADCAST_UNKNOWN",
        code: "NO_CANONICAL_RESULT",
      }),
    ]);
    expect(context.sends()).toBe(0);
  });

  it("detects external completion before nonce ownership and sends nothing", async () => {
    const context = setup();
    context.chain.expectedTxHash = `0x${"88".repeat(32)}`;
    context.chain.accepted = true;
    context.chain.external = true;
    await expect(context.service.process()).resolves.toMatchObject({
      state: "SETTLED_EXTERNALLY",
    });
    expect(context.repository.intent?.nonce).toBeNull();
    expect(context.sends()).toBe(0);
  });

  it("expires before signing/broadcast and sends nothing", async () => {
    const context = setup();
    context.chain.expired = true;
    await expect(context.service.process()).resolves.toMatchObject({
      state: "EXPIRED_UNSENT",
    });
    expect(context.sends()).toBe(0);
  });

  it("rechecks expiry after signing and before dispatch", async () => {
    const context = setup();
    context.chain.expireOnSecondPreflight = true;
    await expect(context.service.process()).resolves.toMatchObject({
      state: "EXPIRED_UNSENT",
    });
    expect(context.repository.intent).toMatchObject({
      state: "EXPIRED_UNSENT",
      broadcastAttemptCount: 0,
    });
    expect(context.sends()).toBe(0);
  });

  it("leaves a simulation RPC read failure retryable without reserving a nonce", async () => {
    const context = setup();
    context.chain.simulationReadFailure = true;
    await expect(context.service.process()).resolves.toEqual({
      state: "READ_RETRYABLE",
      code: "RPC_TIMEOUT",
    });
    expect(context.repository.intent).toBeUndefined();
    expect(context.sends()).toBe(0);
  });

  it("keeps reconciliation RPC read failure retryable without changing submitted state", async () => {
    const context = setup();
    await expect(context.service.process()).resolves.toMatchObject({
      state: "SUBMITTED",
    });
    context.chain.observationReadFailure = true;
    await expect(context.service.reconcile()).resolves.toEqual([
      expect.objectContaining({ state: "SUBMITTED", code: "RPC_TIMEOUT" }),
    ]);
    expect(context.repository.intent?.state).toBe("SUBMITTED");
    expect(context.sends()).toBe(1);
  });
});
