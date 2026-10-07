import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ExpiredAttestationRecoveryIdentity } from "../recovery.js";
import { createExpiredRecoveryCoordinator } from "./recovery-state.js";
import type { ControlledOperatorState } from "./staged-operator.js";

const manifestIdentity = `0x${"11".repeat(32)}` as const;
const conditionHash = `0x${"22".repeat(32)}` as const;
const jobKey = `0x${"33".repeat(32)}` as const;
const oldDigest = `0x${"44".repeat(32)}` as const;
const historicalOperation = "11111111-1111-4111-a111-111111111111";
const recoveryOperation = "22222222-2222-4222-a222-222222222222";
const submitted: ControlledOperatorState = {
  schemaVersion: 2,
  stage: "SUBMITTED",
  manifestIdentity,
  network: "arc-mainnet",
  chainId: "5042",
  operationScope: "arc-mainnet-job-2",
  pactId: "33333333-3333-4333-a333-333333333333",
  commerceContract: "0x1111111111111111111111111111111111111111",
  pactEvaluator: "0x2222222222222222222222222222222222222222",
  client: "0x3333333333333333333333333333333333333333",
  provider: "0x4444444444444444444444444444444444444444",
  verifier: "0x5555555555555555555555555555555555555555",
  relay: "0x6666666666666666666666666666666666666666",
  repository: "pact/recovery",
  pullRequest: 7,
  baseBranch: "main",
  conditionHash,
  amount: "10000",
  clientBefore: "10000",
  providerBefore: "10000",
  escrowBefore: "0",
  treasuryBefore: "0",
  evaluatorBefore: "0",
  relayGasBefore: "10000",
  completionDeadline: "1800000500",
  expiredAt: "1800001000",
  jobId: "2",
  jobKey,
  transactions: {
    createJob: `0x${"01".repeat(32)}`,
    bindCondition: `0x${"02".repeat(32)}`,
    setBudget: `0x${"03".repeat(32)}`,
    approveUsdc: `0x${"04".repeat(32)}`,
    fund: `0x${"05".repeat(32)}`,
    submit: `0x${"06".repeat(32)}`,
  },
  affordabilityChecks: [],
  initialConditionResult: "NOT_SATISFIED_RETRYABLE",
};
const identity: ExpiredAttestationRecoveryIdentity = {
  pactRecordId: submitted.pactId,
  operationId: historicalOperation,
  attestationDigest: oldDigest,
  expectedChainId: 5042n,
  expectedCommerceContract: submitted.commerceContract,
  expectedPactEvaluator: submitted.pactEvaluator,
  expectedJobId: 2n,
  expectedJobKey: jobKey,
  expectedConditionHash: conditionHash,
  expectedCompletionDeadline: BigInt(submitted.completionDeadline),
  expectedVerifier: submitted.verifier,
  expectedClient: submitted.client,
  expectedProvider: submitted.provider,
  relayAddress: submitted.relay,
};

function fixture(
  initial: ControlledOperatorState,
  options?: {
    readonly conditionResult?:
      | "SATISFIED"
      | { status: "NOT_SATISFIED"; reason: string }
      | { status: "INDETERMINATE"; reason: string };
    readonly historicalShape?: "SHAPE_A" | "SHAPE_B";
  },
) {
  let state = initial;
  const saved: string[] = [];
  const calls: string[] = [];
  const observedTimestamps: bigint[] = [];
  const shape =
    options?.historicalShape ??
    (initial.stage === "PHASE4A_ENQUEUED" || initial.stage === "READY_TO_RELAY"
      ? "SHAPE_B"
      : "SHAPE_A");
  const coordinator = createExpiredRecoveryCoordinator({
    expectedManifestIdentity: manifestIdentity,
    expectedRepository: submitted.repository,
    expectedPullRequest: submitted.pullRequest,
    expectedBaseBranch: submitted.baseBranch,
    stateStore: {
      load: async () => state,
      save: async (next) => {
        state = next;
        saved.push(next.stage);
      },
    },
    observeCondition: async (observedAt) => {
      calls.push("github");
      observedTimestamps.push(observedAt);
      if (
        options?.conditionResult === undefined ||
        options.conditionResult === "SATISFIED"
      ) {
        return { status: "SATISFIED" };
      }
      return options.conditionResult;
    },
    service: {
      preflight: async () => {
        calls.push("historical-preflight");
        return {
          historical:
            shape === "SHAPE_A"
              ? { shape: "SHAPE_A", artifact: {} as never }
              : {
                  shape: "SHAPE_B",
                  artifact: {} as never,
                  recoveryOperationId: recoveryOperation,
                  relayIntentId: "44444444-4444-4444-a444-444444444444",
                },
          artifact: {} as never,
          snapshot: { blockTimestamp: 1_800_000_123n } as never,
          recoveryTriggerKey: "key",
        };
      },
      retireAndEnqueue: async () => {
        calls.push("atomic-retirement");
        return {
          recoveryOperationId: recoveryOperation,
          relayIntentId: "44444444-4444-4444-a444-444444444444",
          reused: shape === "SHAPE_B",
        };
      },
      completePhase4A: async (_identity, retirement) => {
        calls.push("phase4a");
        return {
          operationId: recoveryOperation,
          evidenceHash: `0x${"77".repeat(32)}`,
          attestationDigest: `0x${"88".repeat(32)}`,
          verifiedAt: 1_800_000_400n,
          validUntil: 1_800_000_700n,
          retirement,
        };
      },
    },
  });
  return { coordinator, calls, saved, observedTimestamps, state: () => state };
}

describe("expired recovery operator-state reconciliation", () => {
  it("validates history and advances every legal checkpoint without SETTLED", async () => {
    const context = fixture(submitted);
    await context.coordinator.run(identity);
    expect(context.calls).toEqual([
      "historical-preflight",
      "github",
      "atomic-retirement",
      "phase4a",
    ]);
    expect(context.saved).toEqual([
      "AWAITING_CONDITION",
      "CONDITION_SATISFIED",
      "PHASE4A_ENQUEUED",
      "READY_TO_RELAY",
    ]);
    expect(context.state()).toMatchObject({
      stage: "READY_TO_RELAY",
      operationId: recoveryOperation,
    });
    expect(context.observedTimestamps).toEqual([1_800_000_123n]);
  });

  it("halts without retiring or advancing when condition is NOT_SATISFIED", async () => {
    const context = fixture(submitted, {
      conditionResult: {
        status: "NOT_SATISFIED",
        reason: "PR_NOT_MERGED",
      },
    });
    await expect(context.coordinator.run(identity)).rejects.toThrow(
      "RECOVERY_CONDITION_NOT_SATISFIED:PR_NOT_MERGED",
    );
    expect(context.calls).toEqual(["historical-preflight", "github"]);
    expect(context.saved).toEqual(["AWAITING_CONDITION"]);
    expect(context.state().stage).toBe("AWAITING_CONDITION");
  });

  it("halts without retiring or advancing when condition is INDETERMINATE", async () => {
    const context = fixture(submitted, {
      conditionResult: {
        status: "INDETERMINATE",
        reason: "RATE_LIMITED",
      },
    });
    await expect(context.coordinator.run(identity)).rejects.toThrow(
      "RECOVERY_CONDITION_INDETERMINATE:RATE_LIMITED",
    );
    expect(context.calls).toEqual(["historical-preflight", "github"]);
    expect(context.saved).toEqual(["AWAITING_CONDITION"]);
    expect(context.state().stage).toBe("AWAITING_CONDITION");
  });

  it("rejects post-retirement stages when database is still Shape A", async () => {
    const initial: ControlledOperatorState = {
      ...submitted,
      stage: "PHASE4A_ENQUEUED",
      operationId: recoveryOperation,
    };
    const context = fixture(initial, { historicalShape: "SHAPE_A" });
    await expect(context.coordinator.run(identity)).rejects.toThrow(
      "RECOVERY_OPERATOR_STAGE_INVALID: stage requires post-retirement Shape B",
    );
    expect(context.calls).toEqual(["historical-preflight"]);
  });

  it("rejects pre-retirement stages when database is already Shape B", async () => {
    const context = fixture(submitted, { historicalShape: "SHAPE_B" });
    await expect(context.coordinator.run(identity)).rejects.toThrow(
      "RECOVERY_OPERATOR_STAGE_INVALID: post-retirement DB requires stage CONDITION_SATISFIED or later",
    );
    expect(context.calls).toEqual(["historical-preflight"]);
  });

  it.each([
    "CONDITION_SATISFIED",
    "PHASE4A_ENQUEUED",
    "READY_TO_RELAY",
  ] as const)("is restart-safe from %s", async (stage) => {
    const initial: ControlledOperatorState = {
      ...submitted,
      stage,
      ...(stage === "CONDITION_SATISFIED"
        ? {}
        : { operationId: recoveryOperation }),
    };
    const context = fixture(initial);
    await context.coordinator.run(identity);
    expect(context.state().stage).toBe("READY_TO_RELAY");
    expect(context.calls[0]).toBe("historical-preflight");
  });

  it("rejects operator identity drift before retirement", async () => {
    const context = fixture({
      ...submitted,
      conditionHash: `0x${"00".repeat(32)}`,
    });
    await expect(context.coordinator.run(identity)).rejects.toThrow(
      "RECOVERY_OPERATOR_STATE_IDENTITY_MISMATCH",
    );
    expect(context.calls).toEqual([]);
  });

  it("keeps the command statically isolated from Phase 4B", () => {
    const source = readFileSync(
      new URL("./recover-expired-attestation.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("RECOVERY_RELAY_PRIVATE_KEY_FORBIDDEN");
    expect(source).toContain("FileControlledOperatorState.acquireExclusive");
    expect(source).toContain("createPhase4AOrchestrator");
    expect(source).not.toContain("createPactRelayService");
    expect(source).not.toContain("createPactRelaySigner");
    expect(source).not.toContain("reserveNonce");
    expect(source).not.toContain("eth_sendRawTransaction");
  });
});
