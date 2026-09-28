import type { PactRecord, PersistedChainSnapshot } from "@pact/database";
import {
  hashGithubPrMergedCondition,
  hashPactGitHubPrMergedEvidenceV1,
  hashPactJobIdentity,
  normalizePactJobIdentity,
} from "@pact/protocol";
import type { VerifiedGitHubCompletion } from "@pact/verifier/github";
import { getAddress, type Address } from "viem";

export const ERC8183_JOB_STATUS = Object.freeze({
  OPEN: 0,
  FUNDED: 1,
  SUBMITTED: 2,
  COMPLETED: 3,
  REJECTED: 4,
  EXPIRED: 5,
});

export type ChainReconciliationCode =
  | "RPC_CHAIN_ID_MISMATCH"
  | "DATABASE_EVALUATOR_MISMATCH"
  | "DATABASE_COMMERCE_MISMATCH"
  | "COMMERCE_TARGET_MISMATCH"
  | "JOB_KEY_MISMATCH"
  | "BINDING_MISSING"
  | "CONDITION_MISMATCH"
  | "COMPLETION_DEADLINE_MISMATCH"
  | "VERIFIER_KEY_MISMATCH"
  | "VERIFIER_REVOKED"
  | "BINDING_ALREADY_ACCEPTED"
  | "JOB_MISSING"
  | "JOB_NOT_SUBMITTED"
  | "JOB_TERMINAL"
  | "WRONG_JOB_EVALUATOR"
  | "JOB_EXPIRED"
  | "CHAIN_CLOCK_BEHIND_VERIFICATION"
  | "EMPTY_VALIDITY_WINDOW"
  | "VERIFICATION_INTEGRITY_MISMATCH";

export type ChainReconciliationResult =
  | {
      readonly ok: true;
      readonly context: {
        readonly chainId: bigint;
        readonly verifyingContract: Address;
        readonly commerceContract: Address;
        readonly jobId: bigint;
        readonly erc8183ExpiredAt: bigint;
      };
    }
  | {
      readonly ok: false;
      readonly code: ChainReconciliationCode;
      readonly retryable: boolean;
      readonly state:
        "CHAIN_RETRYABLE" | "CHAIN_INVALID" | "ALREADY_ACCEPTED" | "EXPIRED";
    };

function fail(
  code: ChainReconciliationCode,
  state: Exclude<
    ChainReconciliationResult,
    { ok: true }
  >["state"] = "CHAIN_INVALID",
  retryable = false,
): ChainReconciliationResult {
  return { ok: false, code, state, retryable };
}

export function reconcileForSigning(input: {
  readonly pact: PactRecord;
  readonly verification: VerifiedGitHubCompletion;
  readonly snapshot: PersistedChainSnapshot;
  readonly configuredChainId: bigint;
  readonly configuredPactEvaluator: Address;
  readonly configuredCommerceContract: Address;
  readonly signerAddress: Address;
  readonly attestationTtlSeconds: bigint;
}): ChainReconciliationResult {
  const { pact, verification, snapshot } = input;
  if (
    hashGithubPrMergedCondition(pact.condition) !== pact.conditionHash ||
    hashPactGitHubPrMergedEvidenceV1(verification.evidence) !==
      verification.evidenceHash ||
    verification.conditionHash !== pact.conditionHash ||
    verification.evidence.conditionHash !== pact.conditionHash ||
    verification.satisfiedAt !== verification.evidence.mergedAt ||
    verification.observedAt !== verification.evidence.observedAt
  )
    return fail("VERIFICATION_INTEGRITY_MISMATCH");
  if (
    snapshot.chainId !== input.configuredChainId ||
    snapshot.chainId !== pact.chainId
  )
    return fail("RPC_CHAIN_ID_MISMATCH");
  if (
    getAddress(pact.pactEvaluator) !== getAddress(input.configuredPactEvaluator)
  )
    return fail("DATABASE_EVALUATOR_MISMATCH");
  if (
    getAddress(pact.commerceContract) !==
    getAddress(input.configuredCommerceContract)
  )
    return fail("DATABASE_COMMERCE_MISMATCH");
  if (
    getAddress(snapshot.commerceContract) !==
    getAddress(input.configuredCommerceContract)
  )
    return fail("COMMERCE_TARGET_MISMATCH");
  const expectedJobKey = hashPactJobIdentity(
    normalizePactJobIdentity({
      chainId: snapshot.chainId,
      commerceContract: snapshot.commerceContract,
      jobId: pact.jobId,
    }),
  );
  if (snapshot.jobKey !== expectedJobKey || snapshot.jobKey !== pact.jobKey)
    return fail("JOB_KEY_MISMATCH");
  if (!snapshot.bindingExists) return fail("BINDING_MISSING");
  if (snapshot.bindingConditionHash !== pact.conditionHash)
    return fail("CONDITION_MISMATCH");
  if (snapshot.bindingCompletionDeadline !== pact.completionDeadline)
    return fail("COMPLETION_DEADLINE_MISMATCH");
  if (getAddress(snapshot.bindingVerifier) !== getAddress(input.signerAddress))
    return fail("VERIFIER_KEY_MISMATCH");
  if (snapshot.verifierRevoked) return fail("VERIFIER_REVOKED");
  if (snapshot.bindingAccepted)
    return fail("BINDING_ALREADY_ACCEPTED", "ALREADY_ACCEPTED");
  if (/^0x0{40}$/i.test(snapshot.jobClient)) return fail("JOB_MISSING");
  if (
    getAddress(snapshot.jobEvaluator) !==
    getAddress(input.configuredPactEvaluator)
  )
    return fail("WRONG_JOB_EVALUATOR");
  if (
    snapshot.jobStatus === ERC8183_JOB_STATUS.OPEN ||
    snapshot.jobStatus === ERC8183_JOB_STATUS.FUNDED
  )
    return fail("JOB_NOT_SUBMITTED", "CHAIN_RETRYABLE", true);
  if (snapshot.jobStatus !== ERC8183_JOB_STATUS.SUBMITTED)
    return fail("JOB_TERMINAL");
  if (verification.satisfiedAt > pact.completionDeadline)
    return fail("VERIFICATION_INTEGRITY_MISMATCH");
  if (snapshot.blockTimestamp < verification.observedAt)
    return fail("CHAIN_CLOCK_BEHIND_VERIFICATION", "CHAIN_RETRYABLE", true);
  if (snapshot.blockTimestamp >= snapshot.jobExpiredAt)
    return fail("JOB_EXPIRED", "EXPIRED");
  const validUntil =
    verification.observedAt + input.attestationTtlSeconds <
    snapshot.jobExpiredAt
      ? verification.observedAt + input.attestationTtlSeconds
      : snapshot.jobExpiredAt - 1n;
  if (
    validUntil < snapshot.blockTimestamp ||
    validUntil < verification.observedAt
  )
    return fail("EMPTY_VALIDITY_WINDOW", "EXPIRED");
  return {
    ok: true,
    context: {
      chainId: snapshot.chainId,
      verifyingContract: getAddress(input.configuredPactEvaluator),
      commerceContract: getAddress(snapshot.commerceContract),
      jobId: pact.jobId,
      erc8183ExpiredAt: snapshot.jobExpiredAt,
    },
  };
}
