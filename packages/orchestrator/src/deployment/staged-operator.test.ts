import { describe, expect, it } from "vitest";
import {
  advanceControlledOperatorState,
  assertControlledOperatorIdentity,
  assertControlledResumeCanonicalStatus,
  assertControlledOperatorState,
  FileControlledOperatorState,
  parseControlledOperatorAction,
  type ControlledOperatorState,
} from "./staged-operator.js";

const identity = {
  manifestIdentity: `0x${"11".repeat(32)}` as const,
  network: "arc-mainnet" as const,
  chainId: "5042",
  operationScope: "arc-mainnet-job-1",
  commerceContract: "0x1111111111111111111111111111111111111111" as const,
  pactEvaluator: "0x2222222222222222222222222222222222222222" as const,
  client: "0x3333333333333333333333333333333333333333" as const,
  provider: "0x4444444444444444444444444444444444444444" as const,
  verifier: "0x5555555555555555555555555555555555555555" as const,
  relay: "0x6666666666666666666666666666666666666666" as const,
  repository: "pact/example",
  pullRequest: 3,
  baseBranch: "main",
  conditionHash: `0x${"22".repeat(32)}` as const,
  amount: "100000",
};

const deployed: ControlledOperatorState = {
  schemaVersion: 2,
  stage: "DEPLOYED",
  ...identity,
  pactId: "11111111-1111-5111-a111-111111111111",
  clientBefore: "500000",
  providerBefore: "10000",
  escrowBefore: "0",
  treasuryBefore: "0",
  evaluatorBefore: "0",
  relayGasBefore: "10000",
  completionDeadline: "1800021600",
  expiredAt: "1800086400",
  transactions: {},
  affordabilityChecks: [],
};

describe("staged controlled operator state", () => {
  it("accepts only explicit prepare and resume commands", () => {
    expect(parseControlledOperatorAction("prepare")).toBe("prepare");
    expect(parseControlledOperatorAction("resume")).toBe("resume");
    expect(() => parseControlledOperatorAction("run")).toThrow();
  });

  it("persists ordered checkpoints and rejects skipped or backward stages", () => {
    const created = advanceControlledOperatorState(deployed, "JOB_CREATED", {
      jobId: "1",
      jobKey: `0x${"33".repeat(32)}`,
      transactions: { createJob: `0x${"44".repeat(32)}` },
    });
    expect(created.stage).toBe("JOB_CREATED");
    expect(() =>
      advanceControlledOperatorState(deployed, "CONDITION_BOUND"),
    ).toThrow("OPERATOR_STAGE_TRANSITION_INVALID");
    expect(() => advanceControlledOperatorState(created, "DEPLOYED")).toThrow(
      "OPERATOR_STAGE_TRANSITION_INVALID",
    );
  });

  it("fails closed on incomplete or corrupted state", () => {
    expect(() =>
      assertControlledOperatorState({ ...deployed, conditionHash: "0x12" }),
    ).toThrow("OPERATOR_STATE_INVALID:conditionHash");
    expect(() =>
      assertControlledOperatorState({
        ...deployed,
        stage: "JOB_CREATED",
      }),
    ).toThrow("OPERATOR_STATE_INVALID:jobId");
  });

  it("requires exact resume identity without scope mutation", () => {
    expect(() =>
      assertControlledOperatorIdentity(deployed, identity),
    ).not.toThrow();
    expect(() =>
      assertControlledOperatorIdentity(deployed, {
        ...identity,
        operationScope: "arc-mainnet-job-1-retry",
      }),
    ).toThrow("OPERATOR_RESUME_IDENTITY_MISMATCH");
  });

  it("allows READY_TO_RELAY to reconcile a completion observed after broadcast", () => {
    expect(() =>
      assertControlledResumeCanonicalStatus(
        "READY_TO_RELAY",
        {
          jobStatus: 3,
          bindingAccepted: true,
          verifierRevoked: false,
          blockTimestamp: 200n,
        },
        100n,
      ),
    ).not.toThrow();
    expect(() =>
      assertControlledResumeCanonicalStatus(
        "AWAITING_CONDITION",
        {
          jobStatus: 3,
          bindingAccepted: true,
          verifierRevoked: false,
          blockTimestamp: 200n,
        },
        100n,
      ),
    ).toThrow("OPERATOR_RESUME_NOT_SUBMITTED");
  });

  it("fails closed when a concurrent operator owns the external state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pact-operator-lock-"));
    const path = join(directory, "state.json");
    try {
      const release = await FileControlledOperatorState.acquireExclusive(path);
      await expect(
        FileControlledOperatorState.acquireExclusive(path),
      ).rejects.toThrow("OPERATOR_RUN_ALREADY_ACTIVE");
      await release();
      const releaseAgain =
        await FileControlledOperatorState.acquireExclusive(path);
      await releaseAgain();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
