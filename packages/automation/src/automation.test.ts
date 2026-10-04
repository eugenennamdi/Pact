import type {
  OperationRecord,
  PactRecord,
  PersistedChainSnapshot,
} from "@pact/database";
import { describe, expect, it, vi } from "vitest";
import { getAddress } from "viem";
import {
  assertSignerIdentity,
  loadRelayWorkerConfig,
  loadVerifierWorkerConfig,
} from "./config";
import { createRelayWorker } from "./relay-worker";
import type {
  AutomationLease,
  AutomationRecord,
  AutomationRepository,
  CompleteLeaseInput,
} from "./types";
import { createVerifierScheduler } from "./verifier-worker";

const EVALUATOR = getAddress("0x1111111111111111111111111111111111111111");
const COMMERCE = getAddress("0x2222222222222222222222222222222222222222");
const VERIFIER = getAddress("0x3333333333333333333333333333333333333333");
const CLIENT = getAddress("0x4444444444444444444444444444444444444444");
const PROVIDER = getAddress("0x5555555555555555555555555555555555555555");
const HASH = `0x${"ab".repeat(32)}` as const;
const NOW = new Date("2026-10-03T12:00:00.000Z");

const pact: PactRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  chainId: 5_042_002n,
  commerceContract: COMMERCE,
  pactEvaluator: EVALUATOR,
  jobId: 4n,
  jobKey: HASH,
  condition: {
    schemaVersion: 1,
    provider: "github",
    repository: "example/repo",
    pullRequest: 5,
    baseBranch: "main",
    event: "PR_MERGED",
  },
  conditionHash: HASH,
  completionDeadline: 2_000n,
};

const snapshot: PersistedChainSnapshot = {
  blockNumber: 100n,
  blockHash: HASH,
  blockTimestamp: 1_000n,
  chainId: 5_042_002n,
  pactEvaluator: EVALUATOR,
  commerceContract: COMMERCE,
  jobId: 4n,
  jobKey: HASH,
  bindingExists: true,
  bindingConditionHash: HASH,
  bindingCompletionDeadline: 2_000n,
  bindingVerifier: VERIFIER,
  bindingAccepted: false,
  verifierRevoked: false,
  jobClient: CLIENT,
  jobProvider: PROVIDER,
  jobEvaluator: EVALUATOR,
  jobStatus: 2,
  jobExpiredAt: 3_000n,
};

function operation(
  state: OperationRecord["state"] = "PENDING",
): OperationRecord {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    pactRecordId: pact.id,
    triggerKind: "MANUAL",
    triggerKey: "automatic:test",
    state,
    code: null,
    retryable: false,
    version: 0,
  };
}

class MemoryAutomation implements AutomationRepository {
  record: AutomationRecord = {
    id: "33333333-3333-4333-8333-333333333333",
    draftId: "44444444-4444-4444-8444-444444444444",
    pactRecordId: pact.id,
    enabled: true,
    nextCheckAt: NOW,
    lastCheckAt: null,
    lastResult: null,
    consecutiveRetryableFailures: 0,
    leaseOwner: null,
    leaseToken: null,
    leaseUntil: null,
    lastOperationId: null,
    lastWakeKey: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
  claimed = false;
  completions: CompleteLeaseInput[] = [];

  async ensureScheduled(): Promise<AutomationRecord> {
    return this.record;
  }
  async wake(): Promise<{ record: AutomationRecord; replayed: boolean }> {
    return { record: this.record, replayed: false };
  }
  async claimDue(
    owner: string,
    _limit: number,
    leaseSeconds: number,
  ): Promise<readonly AutomationLease[]> {
    if (this.claimed) return [];
    this.claimed = true;
    return [
      {
        ...this.record,
        leaseOwner: owner,
        leaseToken: "55555555-5555-4555-8555-555555555555",
        leaseUntil: new Date(NOW.getTime() + leaseSeconds * 1_000),
      },
    ];
  }
  async renewLease(): Promise<boolean> {
    return true;
  }
  async completeLease(input: CompleteLeaseInput): Promise<boolean> {
    this.completions.push(input);
    return true;
  }
  async get(): Promise<AutomationRecord> {
    return this.record;
  }
}

function scheduler(input: {
  readonly automation?: MemoryAutomation;
  readonly current?: PersistedChainSnapshot;
  readonly processState?: OperationRecord["state"];
  readonly arcFailure?: boolean;
}) {
  const automation = input.automation ?? new MemoryAutomation();
  const enqueue = vi.fn(async () => operation());
  const processOperation = vi.fn(async () => ({
    operationId: operation().id,
    state: input.processState ?? "NOT_SATISFIED_RETRYABLE",
  }));
  return {
    automation,
    enqueue,
    processOperation,
    worker: createVerifierScheduler({
      automation,
      certifiedRepository: {
        getPact: async () => pact,
        enqueueManualOperation: enqueue,
      },
      arc: {
        readSnapshot: async () => {
          if (input.arcFailure) throw new Error("RPC_FAILURE");
          return input.current ?? snapshot;
        },
      },
      orchestrator: { processOperation },
      workerId: "worker-a",
      leaseSeconds: 120,
      batchSize: 10,
      configuredPactEvaluator: EVALUATOR,
      configuredCommerceContract: COMMERCE,
      configuredVerifier: VERIFIER,
    }),
  };
}

describe("automatic verification scheduler", () => {
  it("keeps a false GitHub condition retryable without relay readiness", async () => {
    const context = scheduler({ processState: "NOT_SATISFIED_RETRYABLE" });
    await expect(context.worker.runOnce()).resolves.toMatchObject([
      { result: "NOT_SATISFIED_RETRYABLE" },
    ]);
    expect(context.automation.completions[0]).toMatchObject({
      enabled: true,
      retryableFailure: false,
      delaySeconds: 30,
    });
  });

  it("stops scheduler polling once certified Phase 4A is READY_TO_RELAY", async () => {
    const context = scheduler({ processState: "READY_TO_RELAY" });
    await context.worker.runOnce();
    expect(context.automation.completions[0]).toMatchObject({ enabled: false });
  });

  it.each([
    ["GitHub unavailable", "INDETERMINATE"],
    ["GitHub rate limited", "INDETERMINATE"],
    ["RPC unavailable during certified reconciliation", "CHAIN_RETRYABLE"],
  ] as const)("backs off when %s", async (_label, processState) => {
    const context = scheduler({ processState });
    await context.worker.runOnce();
    expect(context.automation.completions[0]).toMatchObject({
      result: processState,
      retryableFailure: true,
      enabled: true,
      delaySeconds: 30,
    });
  });

  it.each([
    ["not Submitted", { jobStatus: 1 }, "JOB_NOT_SUBMITTED", true],
    ["binding accepted", { bindingAccepted: true }, "ALREADY_COMPLETED", false],
    ["expired", { blockTimestamp: 2_000n }, "AUTOMATION_EXPIRED", false],
    [
      "wrong evaluator",
      { jobEvaluator: CLIENT },
      "AUTOMATION_INTEGRITY_MISMATCH",
      false,
    ],
    [
      "condition mismatch",
      { bindingConditionHash: `0x${"cd".repeat(32)}` },
      "AUTOMATION_INTEGRITY_MISMATCH",
      false,
    ],
    [
      "deployment drift",
      { pactEvaluator: CLIENT },
      "AUTOMATION_INTEGRITY_MISMATCH",
      false,
    ],
  ] as const)(
    "fails closed for %s",
    async (_label, change, result, enabled) => {
      const context = scheduler({ current: { ...snapshot, ...change } });
      await context.worker.runOnce();
      expect(context.processOperation).not.toHaveBeenCalled();
      expect(context.automation.completions[0]).toMatchObject({
        result,
        enabled,
      });
    },
  );

  it("backs off temporary Arc failures", async () => {
    const context = scheduler({ arcFailure: true });
    await context.worker.runOnce();
    expect(context.automation.completions[0]).toMatchObject({
      result: "ARC_READ_RETRYABLE",
      retryableFailure: true,
      enabled: true,
    });
  });

  it("allows only one scheduler instance to claim the lease", async () => {
    const automation = new MemoryAutomation();
    const first = scheduler({ automation });
    const second = scheduler({ automation });
    const [a, b] = await Promise.all([
      first.worker.runOnce(),
      second.worker.runOnce(),
    ]);
    expect(a.length + b.length).toBe(1);
    expect(
      first.enqueue.mock.calls.length + second.enqueue.mock.calls.length,
    ).toBe(1);
  });

  it("resumes through certified active-operation dedupe after restart", async () => {
    const context = scheduler({ processState: "READY_TO_RELAY" });
    await context.worker.runOnce();
    expect(context.enqueue).toHaveBeenCalledOnce();
    expect(context.processOperation).toHaveBeenCalledWith(operation().id);
  });
});

describe("worker role isolation", () => {
  const common = {
    DATABASE_URL: "postgresql://localhost/pact",
    ARC_RPC_URL: "http://127.0.0.1:8545",
  };
  it("rejects a relay key in the verifier process", () => {
    expect(() =>
      loadVerifierWorkerConfig({
        ...common,
        PACT_WORKER_ROLE: "verifier",
        PACT_VERIFIER_PRIVATE_KEY: `0x${"11".repeat(32)}`,
        PACT_RELAY_PRIVATE_KEY: `0x${"22".repeat(32)}`,
      }),
    ).toThrow("PACT_RELAY_PRIVATE_KEY is forbidden");
  });

  it.each([
    "PACT_VERIFIER_PRIVATE_KEY",
    "GITHUB_TOKEN",
    "GITHUB_WEBHOOK_SECRET",
  ])("rejects %s in the relay process", (name) => {
    expect(() =>
      loadRelayWorkerConfig({
        ...common,
        PACT_WORKER_ROLE: "relay",
        PACT_RELAY_PRIVATE_KEY: `0x${"22".repeat(32)}`,
        PACT_RELAY_ADDRESS: COMMERCE,
        [name]: "forbidden",
      }),
    ).toThrow(`${name} is forbidden`);
  });

  it.each(["verifier", "relay"] as const)(
    "rejects a %s signer identity mismatch",
    (role) => {
      expect(() => assertSignerIdentity(role, EVALUATOR, COMMERCE)).toThrow(
        `${role.toUpperCase()}_SIGNER_IDENTITY_MISMATCH`,
      );
    },
  );
});

describe("relay worker adapter", () => {
  it("reconciles ambiguity before discovering new READY_TO_RELAY work", async () => {
    const calls: string[] = [];
    const worker = createRelayWorker({
      relay: {
        reconcile: async () => {
          calls.push("reconcile");
          return [{ state: "BROADCAST_UNKNOWN", code: "RPC_TIMEOUT" }];
        },
        process: async () => {
          calls.push("process");
          return { state: "IDLE" };
        },
      },
    });
    const result = await worker.runOnce();
    expect(calls).toEqual(["reconcile", "process"]);
    expect(result.reconciled[0]?.state).toBe("BROADCAST_UNKNOWN");
  });

  it.each([
    "SETTLED",
    "SETTLED_EXTERNALLY",
    "COMPLETED_BY_DIFFERENT_ATTESTATION",
    "INTEGRITY_FAILURE",
    "INSUFFICIENT_RELAY_GAS",
  ] as const)("preserves certified relay result %s", async (state) => {
    const worker = createRelayWorker({
      relay: {
        reconcile: async () => [],
        process: async () => ({ state }),
      },
    });
    await expect(worker.runOnce()).resolves.toMatchObject({
      processed: { state },
    });
  });
});
