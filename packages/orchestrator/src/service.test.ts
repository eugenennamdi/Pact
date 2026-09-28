import type {
  GitHubDeliveryIngestResult,
  GitHubDeliveryInput,
  OperationRecord,
  OperationState,
  OperationWithPact,
  PactRecord,
  PactRepository,
  PersistedAttestation,
  PersistedChainSnapshot,
  PersistedVerificationResult,
} from "@pact/database";
import {
  hashGithubPrMergedCondition,
  hashPactJobIdentity,
  normalizeGithubPrMergedCondition,
  normalizePactJobIdentity,
  type Hex32,
  type PactGitHubPrMergedEvidenceV1,
} from "@pact/protocol";
import type { GitHubPullRequestClient } from "@pact/verifier/github";
import { createPactCompletionSigner } from "@pact/verifier/signer";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { ArcReadError, type ArcReadClient } from "./chain.js";
import { ERC8183_JOB_STATUS } from "./reconcile.js";
import { createPhase4AOrchestrator } from "./service.js";

const privateKey =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8413f4603b6b78690d";
const signerAddress = privateKeyToAccount(privateKey).address;
const evaluator = "0x2222222222222222222222222222222222222222" as const;
const commerce = "0x1111111111111111111111111111111111111111" as const;
const pactId = "123e4567-e89b-42d3-a456-426614174000";
const operationId = "223e4567-e89b-42d3-a456-426614174000";
const condition = normalizeGithubPrMergedCondition({
  provider: "github",
  repository: "pact-protocol/demo",
  pullRequest: 81,
  baseBranch: "main",
  event: "PR_MERGED",
});
const conditionHash = hashGithubPrMergedCondition(condition) as Hex32;
const jobKey = hashPactJobIdentity(
  normalizePactJobIdentity({
    chainId: 5042n,
    commerceContract: commerce,
    jobId: 81n,
  }),
) as Hex32;
const pact: PactRecord = {
  id: pactId,
  chainId: 5042n,
  commerceContract: commerce,
  pactEvaluator: evaluator,
  jobId: 81n,
  jobKey,
  condition,
  conditionHash,
  completionDeadline: 1_800_000_120n,
};
const snapshot: PersistedChainSnapshot = {
  blockNumber: 100n,
  blockHash: `0x${"aa".repeat(32)}`,
  blockTimestamp: 1_800_000_061n,
  chainId: 5042n,
  pactEvaluator: evaluator,
  commerceContract: commerce,
  jobId: 81n,
  jobKey,
  bindingExists: true,
  bindingConditionHash: conditionHash,
  bindingCompletionDeadline: pact.completionDeadline,
  bindingVerifier: signerAddress,
  bindingAccepted: false,
  verifierRevoked: false,
  jobClient: "0x3333333333333333333333333333333333333333",
  jobProvider: "0x4444444444444444444444444444444444444444",
  jobEvaluator: evaluator,
  jobStatus: ERC8183_JOB_STATUS.SUBMITTED,
  jobExpiredAt: 1_800_001_000n,
};

class MemoryRepository implements PactRepository {
  operation: OperationRecord = {
    id: operationId,
    pactRecordId: pactId,
    triggerKind: "MANUAL",
    triggerKey: "test",
    state: "PENDING",
    code: null,
    retryable: false,
    version: 0,
  };
  readonly verificationHistory: PersistedVerificationResult[] = [];
  readonly chainHistory: PersistedChainSnapshot[] = [];
  readonly artifacts: PersistedAttestation[] = [];
  readonly attemptedDigests: Hex32[] = [];
  failReadyPersistence = false;
  readonly deliveries = new Set<string>();

  async createPact(record: PactRecord) {
    return record;
  }
  async getPact(id: string) {
    return id === pactId ? pact : undefined;
  }
  async ingestGitHubDelivery(
    input: GitHubDeliveryInput,
  ): Promise<GitHubDeliveryIngestResult> {
    if (this.deliveries.has(input.deliveryId))
      return { duplicate: true, operationIds: [], matchedPacts: 0 };
    this.deliveries.add(input.deliveryId);
    return { duplicate: false, operationIds: [operationId], matchedPacts: 1 };
  }
  async enqueueManualOperation(_pactRecordId: string, _triggerKey: string) {
    return this.operation;
  }
  async getOperation(id: string): Promise<OperationWithPact | undefined> {
    return id === operationId ? { operation: this.operation, pact } : undefined;
  }
  async listPendingOperationIds(_limit: number) {
    return this.operation.state === "PENDING" ? [operationId] : [];
  }
  async transitionOperation(
    id: string,
    expected: readonly OperationState[],
    next: OperationState,
    options: { readonly code?: string; readonly retryable?: boolean } = {},
  ) {
    if (id !== operationId || !expected.includes(this.operation.state))
      return undefined;
    this.operation = {
      ...this.operation,
      state: next,
      code: options.code ?? null,
      retryable: options.retryable ?? false,
      version: this.operation.version + 1,
    };
    return this.operation;
  }
  async persistVerification(
    _id: string,
    result: PersistedVerificationResult,
    next: OperationState,
  ) {
    this.verificationHistory.push(result);
    this.operation = {
      ...this.operation,
      state: next,
      code: result.reason ?? null,
      retryable: result.retryable,
      version: this.operation.version + 1,
    };
    return this.verificationHistory.length;
  }
  async persistChainReconciliation(
    _id: string,
    chain: PersistedChainSnapshot,
    _outcome: "READY" | "RETRYABLE" | "INVALID",
    code: string | undefined,
    next: OperationState,
  ) {
    this.chainHistory.push(chain);
    this.operation = {
      ...this.operation,
      state: next,
      code: code ?? null,
      retryable: next === "CHAIN_RETRYABLE",
      version: this.operation.version + 1,
    };
    return this.chainHistory.length;
  }
  async persistReadyToRelay(
    _id: string,
    _pactId: string,
    _evidence: PactGitHubPrMergedEvidenceV1,
    _evidenceHash: Hex32,
    artifact: PersistedAttestation,
  ) {
    this.attemptedDigests.push(artifact.digest);
    if (this.failReadyPersistence) throw new Error("database unavailable");
    this.artifacts.push(artifact);
    this.operation = {
      ...this.operation,
      state: "READY_TO_RELAY",
      code: null,
      retryable: false,
      version: this.operation.version + 1,
    };
  }
  async recoverTransitionalOperations(_before: Date) {
    if (
      [
        "VERIFYING_GITHUB",
        "VERIFIED",
        "RECONCILING_CHAIN",
        "READY_TO_SIGN",
        "SIGNING",
      ].includes(this.operation.state)
    ) {
      this.operation = {
        ...this.operation,
        state: "PENDING",
        code: "RECOVERED_AFTER_RESTART",
        retryable: true,
        version: this.operation.version + 1,
      };
      return 1;
    }
    return 0;
  }
}

function github(merged = true, delay = false): GitHubPullRequestClient {
  return {
    getPullRequest: async () => {
      if (delay) await Promise.resolve();
      return {
        ok: true,
        value: {
          number: 81,
          state: merged ? "closed" : "open",
          merged,
          mergedAt: merged ? "2027-01-15T08:00:00Z" : null,
          mergeCommitSha: "0123456789abcdef0123456789abcdef01234567",
          baseRepository: "pact-protocol/demo",
          baseBranch: "main",
          privateRepository: false,
        },
      };
    },
    checkPullRequestMerged: async () => ({ ok: true, value: { merged } }),
  };
}

function setup(
  input: {
    merged?: boolean;
    chain?: PersistedChainSnapshot;
    rpcError?: boolean;
    delay?: boolean;
  } = {},
) {
  const repository = new MemoryRepository();
  let chainReads = 0;
  let signatures = 0;
  const baseSigner = createPactCompletionSigner({ privateKey });
  const signer = {
    ...baseSigner,
    async signVerifiedCompletion(
      ...args: Parameters<typeof baseSigner.signVerifiedCompletion>
    ) {
      signatures++;
      return baseSigner.signVerifiedCompletion(...args);
    },
  };
  const arc: ArcReadClient = {
    readSnapshot: async () => {
      chainReads++;
      if (input.rpcError) throw new ArcReadError("RPC_TIMEOUT");
      return input.chain ?? snapshot;
    },
  };
  const orchestrator = createPhase4AOrchestrator({
    repository,
    github: github(input.merged ?? true, input.delay),
    arc,
    signer,
    configuredChainId: 5042n,
    configuredPactEvaluator: evaluator,
    configuredCommerceContract: commerce,
    nowSeconds: () => 1_800_000_060n,
  });
  return {
    repository,
    orchestrator,
    get chainReads() {
      return chainReads;
    },
    get signatures() {
      return signatures;
    },
  };
}

describe("Phase 4A orchestration", () => {
  it("deduplicates concurrent delivery ingestion and reuses one active operation", async () => {
    const repository = new MemoryRepository();
    const delivery = {
      deliveryId: "123e4567-e89b-42d3-a456-426614174000",
      event: "pull_request",
      action: "closed",
      repository: condition.repository,
      pullRequest: condition.pullRequest,
      relevant: true,
      receivedAt: new Date(),
    } as const;
    const [first, second, manual] = await Promise.all([
      repository.ingestGitHubDelivery(delivery),
      repository.ingestGitHubDelivery(delivery),
      repository.enqueueManualOperation(pactId, "manual-concurrent"),
    ]);
    expect([first, second].filter(({ duplicate }) => duplicate)).toHaveLength(
      1,
    );
    expect(manual.id).toBe(operationId);
  });
  it("durably reaches READY_TO_RELAY only after GitHub and chain reconciliation", async () => {
    const context = setup();
    await expect(
      context.orchestrator.processOperation(operationId),
    ).resolves.toMatchObject({
      state: "READY_TO_RELAY",
      attestationDigest: expect.stringMatching(/^0x[0-9a-f]{64}$/),
    });
    expect(context.repository.verificationHistory).toHaveLength(1);
    expect(context.repository.chainHistory).toHaveLength(1);
    expect(context.repository.artifacts).toHaveLength(1);
    expect(context.chainReads).toBe(1);
    expect(context.signatures).toBe(1);
  });

  it("does not read chain or sign when independent GitHub reads say unmerged", async () => {
    const context = setup({ merged: false });
    await expect(
      context.orchestrator.processOperation(operationId),
    ).resolves.toMatchObject({ state: "NOT_SATISFIED_RETRYABLE" });
    expect(context.chainReads).toBe(0);
    expect(context.signatures).toBe(0);
  });

  it.each([
    [
      "condition",
      { bindingConditionHash: `0x${"bb".repeat(32)}` },
      "CHAIN_INVALID",
    ],
    [
      "deadline",
      { bindingCompletionDeadline: pact.completionDeadline + 1n },
      "CHAIN_INVALID",
    ],
    [
      "commerce",
      { commerceContract: "0x5555555555555555555555555555555555555555" },
      "CHAIN_INVALID",
    ],
    [
      "verifier",
      { bindingVerifier: "0x5555555555555555555555555555555555555555" },
      "CHAIN_INVALID",
    ],
    ["revoked verifier", { verifierRevoked: true }, "CHAIN_INVALID"],
    ["accepted binding", { bindingAccepted: true }, "ALREADY_ACCEPTED"],
    [
      "terminal job",
      { jobStatus: ERC8183_JOB_STATUS.COMPLETED },
      "CHAIN_INVALID",
    ],
    [
      "wrong evaluator",
      { jobEvaluator: "0x5555555555555555555555555555555555555555" },
      "CHAIN_INVALID",
    ],
    ["expired job", { blockTimestamp: snapshot.jobExpiredAt }, "EXPIRED"],
  ] as const)("never signs on %s", async (_label, mutation, state) => {
    const context = setup({
      chain: { ...snapshot, ...mutation } as PersistedChainSnapshot,
    });
    await expect(
      context.orchestrator.processOperation(operationId),
    ).resolves.toMatchObject({ state });
    expect(context.signatures).toBe(0);
    expect(context.repository.artifacts).toHaveLength(0);
  });

  it("classifies an RPC timeout as retryable and never signs", async () => {
    const context = setup({ rpcError: true });
    await expect(
      context.orchestrator.processOperation(operationId),
    ).resolves.toEqual({
      operationId,
      state: "CHAIN_RETRYABLE",
      code: "RPC_TIMEOUT",
    });
    expect(context.signatures).toBe(0);
  });

  it("leaves SIGNING recoverable when durable artifact persistence fails", async () => {
    const context = setup();
    context.repository.failReadyPersistence = true;
    await expect(
      context.orchestrator.processOperation(operationId),
    ).rejects.toThrow("database unavailable");
    expect(context.repository.operation.state).toBe("SIGNING");
    expect(context.repository.artifacts).toHaveLength(0);
    const firstDigest = context.repository.attemptedDigests[0];
    await context.repository.recoverTransitionalOperations(new Date());
    context.repository.failReadyPersistence = false;
    await expect(
      context.orchestrator.processOperation(operationId),
    ).resolves.toMatchObject({ state: "READY_TO_RELAY" });
    expect(context.repository.attemptedDigests[1]).toBe(firstDigest);
    expect(context.repository.artifacts).toHaveLength(1);
  });

  it("allows only one concurrent worker to claim and sign", async () => {
    const context = setup({ delay: true });
    const results = await Promise.all([
      context.orchestrator.processOperation(operationId),
      context.orchestrator.processOperation(operationId),
    ]);
    expect(results.some((result) => result.state === "READY_TO_RELAY")).toBe(
      true,
    );
    expect(context.signatures).toBe(1);
    expect(context.repository.artifacts).toHaveLength(1);
  });
});
