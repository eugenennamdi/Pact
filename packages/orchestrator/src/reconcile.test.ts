import {
  hashGithubPrMergedCondition,
  hashPactGitHubPrMergedEvidenceV1,
  hashPactJobIdentity,
  normalizeGithubPrMergedCondition,
  normalizePactGitHubPrMergedEvidenceV1,
  normalizePactJobIdentity,
} from "@pact/protocol";
import { verifyGitHubPrMerged } from "@pact/verifier/github";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { ERC8183_JOB_STATUS, reconcileForSigning } from "./reconcile.js";

const privateKey =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8413f4603b6b78690d";
const signer = privateKeyToAccount(privateKey).address;
const evaluator = "0x2222222222222222222222222222222222222222" as const;
const commerce = "0x1111111111111111111111111111111111111111" as const;
const condition = normalizeGithubPrMergedCondition({
  provider: "github",
  repository: "pact-protocol/demo",
  pullRequest: 81,
  baseBranch: "main",
  event: "PR_MERGED",
});
const conditionHash = hashGithubPrMergedCondition(condition);
const jobKey = hashPactJobIdentity(
  normalizePactJobIdentity({
    chainId: 5042n,
    commerceContract: commerce,
    jobId: 81n,
  }),
);
const pact = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  chainId: 5042n,
  commerceContract: commerce,
  pactEvaluator: evaluator,
  jobId: 81n,
  jobKey,
  condition,
  conditionHash,
  completionDeadline: 1_800_000_120n,
} as const;

async function completion() {
  const result = await verifyGitHubPrMerged({
    condition,
    completionDeadline: pact.completionDeadline,
    observedAt: 1_800_000_060n,
    client: {
      getPullRequest: async () => ({
        ok: true,
        value: {
          number: 81,
          state: "closed",
          merged: true,
          mergedAt: "2027-01-15T08:00:00Z",
          mergeCommitSha: "0123456789abcdef0123456789abcdef01234567",
          baseRepository: "pact-protocol/demo",
          baseBranch: "main",
          privateRepository: false,
        },
      }),
      checkPullRequestMerged: async () => ({
        ok: true,
        value: { merged: true },
      }),
    },
  });
  if (result.status !== "SATISFIED") throw new Error("fixture failed");
  return result;
}

const snapshot = {
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
  bindingVerifier: signer,
  bindingAccepted: false,
  verifierRevoked: false,
  jobClient: "0x3333333333333333333333333333333333333333",
  jobProvider: "0x4444444444444444444444444444444444444444",
  jobEvaluator: evaluator,
  jobStatus: ERC8183_JOB_STATUS.SUBMITTED,
  jobExpiredAt: 1_800_001_000n,
} as const;

function reconcile(
  verification: Awaited<ReturnType<typeof completion>>,
  mutation = {},
) {
  return reconcileForSigning({
    pact,
    verification,
    snapshot: { ...snapshot, ...mutation },
    configuredChainId: 5042n,
    configuredPactEvaluator: evaluator,
    configuredCommerceContract: commerce,
    signerAddress: signer,
    attestationTtlSeconds: 300n,
  });
}

describe("authoritative pre-sign reconciliation", () => {
  it("accepts one coherent same-block snapshot", async () => {
    expect(reconcile(await completion())).toEqual({
      ok: true,
      context: {
        chainId: 5042n,
        verifyingContract: evaluator,
        commerceContract: commerce,
        jobId: 81n,
        erc8183ExpiredAt: 1_800_001_000n,
      },
    });
  });

  it.each([
    ["chain", { chainId: 5043n }, "RPC_CHAIN_ID_MISMATCH"],
    [
      "commerce",
      { commerceContract: "0x5555555555555555555555555555555555555555" },
      "COMMERCE_TARGET_MISMATCH",
    ],
    ["job key", { jobKey: `0x${"bb".repeat(32)}` }, "JOB_KEY_MISMATCH"],
    ["binding missing", { bindingExists: false }, "BINDING_MISSING"],
    [
      "condition",
      { bindingConditionHash: `0x${"bb".repeat(32)}` },
      "CONDITION_MISMATCH",
    ],
    [
      "deadline",
      { bindingCompletionDeadline: pact.completionDeadline + 1n },
      "COMPLETION_DEADLINE_MISMATCH",
    ],
    [
      "verifier",
      { bindingVerifier: "0x5555555555555555555555555555555555555555" },
      "VERIFIER_KEY_MISMATCH",
    ],
    ["revoked", { verifierRevoked: true }, "VERIFIER_REVOKED"],
    ["accepted", { bindingAccepted: true }, "BINDING_ALREADY_ACCEPTED"],
    [
      "evaluator",
      { jobEvaluator: "0x5555555555555555555555555555555555555555" },
      "WRONG_JOB_EVALUATOR",
    ],
  ] as const)("rejects %s mismatch", async (_label, mutation, code) => {
    expect(reconcile(await completion(), mutation)).toMatchObject({
      ok: false,
      code,
    });
  });

  it.each([
    [ERC8183_JOB_STATUS.OPEN, "CHAIN_RETRYABLE", true],
    [ERC8183_JOB_STATUS.FUNDED, "CHAIN_RETRYABLE", true],
    [ERC8183_JOB_STATUS.COMPLETED, "CHAIN_INVALID", false],
    [ERC8183_JOB_STATUS.REJECTED, "CHAIN_INVALID", false],
    [ERC8183_JOB_STATUS.EXPIRED, "CHAIN_INVALID", false],
  ])("classifies job status %i", async (jobStatus, state, retryable) => {
    expect(reconcile(await completion(), { jobStatus })).toMatchObject({
      ok: false,
      state,
      retryable,
    });
  });

  it("rejects expired and empty validity windows", async () => {
    expect(
      reconcile(await completion(), { blockTimestamp: snapshot.jobExpiredAt }),
    ).toMatchObject({ code: "JOB_EXPIRED", state: "EXPIRED" });
    expect(
      reconcile(await completion(), { blockTimestamp: 1_800_000_400n }),
    ).toMatchObject({ code: "EMPTY_VALIDITY_WINDOW", state: "EXPIRED" });
  });

  it("recomputes persisted evidence and condition commitments", async () => {
    const verified = await completion();
    const forged = {
      ...verified,
      evidence: normalizePactGitHubPrMergedEvidenceV1({
        ...verified.evidence,
        observedAt: verified.observedAt + 1n,
      }),
    };
    expect(hashPactGitHubPrMergedEvidenceV1(forged.evidence)).not.toBe(
      verified.evidenceHash,
    );
    expect(reconcile(forged as typeof verified)).toMatchObject({
      code: "VERIFICATION_INTEGRITY_MISMATCH",
    });
  });
});
