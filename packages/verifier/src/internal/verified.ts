import {
  hashGithubPrMergedCondition,
  hashPactGitHubPrMergedEvidenceV1,
  type CanonicalGithubPrMergedCondition,
  type Hex32,
  type PactGitHubPrMergedEvidenceV1,
} from "@pact/protocol";

declare const verifiedGitHubCompletionBrand: unique symbol;

export interface VerifiedGitHubCompletion {
  readonly status: "SATISFIED";
  readonly condition: CanonicalGithubPrMergedCondition;
  readonly conditionHash: Hex32;
  readonly evidence: PactGitHubPrMergedEvidenceV1;
  readonly evidenceHash: Hex32;
  readonly satisfiedAt: bigint;
  readonly observedAt: bigint;
  readonly [verifiedGitHubCompletionBrand]: true;
}

type VerifiedGitHubCompletionFields = Omit<
  VerifiedGitHubCompletion,
  typeof verifiedGitHubCompletionBrand
>;

const verifiedCompletions = new WeakSet<object>();

export function createVerifiedGitHubCompletion(
  fields: VerifiedGitHubCompletionFields,
): VerifiedGitHubCompletion {
  const completion = Object.freeze(fields) as VerifiedGitHubCompletion;
  verifiedCompletions.add(completion);
  return completion;
}

export function assertVerifiedGitHubCompletion(
  value: VerifiedGitHubCompletion,
): void {
  if (!verifiedCompletions.has(value)) {
    throw new Error("completion was not produced by the Pact GitHub verifier");
  }
  if (
    value.status !== "SATISFIED" ||
    hashGithubPrMergedCondition(value.condition) !== value.conditionHash ||
    hashPactGitHubPrMergedEvidenceV1(value.evidence) !== value.evidenceHash ||
    value.evidence.conditionHash !== value.conditionHash ||
    value.evidence.mergedAt !== value.satisfiedAt ||
    value.evidence.observedAt !== value.observedAt
  ) {
    throw new Error("verified completion integrity check failed");
  }
}
