import {
  GITHUB_PROVIDER,
  PR_MERGED_EVENT,
  hashGithubPrMergedCondition,
  hashPactGitHubPrMergedEvidenceV1,
  normalizeGithubPrMergedCondition,
  normalizePactGitHubPrMergedEvidenceV1,
  type GithubPrMergedConditionInput,
} from "@pact/protocol";

import {
  createVerifiedGitHubCompletion,
  type VerifiedGitHubCompletion,
} from "../internal/verified.js";
import type {
  GitHubClientFailure,
  GitHubPullRequestClient,
  GitHubPullRequestMetadata,
  GitHubRateLimitMetadata,
} from "./client.js";

const UINT64_MAX = (1n << 64n) - 1n;
const GITHUB_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

export type GitHubVerificationReason =
  | "PULL_REQUEST_NOT_MERGED"
  | "BASE_BRANCH_MISMATCH"
  | "MERGED_AFTER_DEADLINE"
  | "GITHUB_TIMEOUT"
  | "GITHUB_NETWORK_ERROR"
  | "GITHUB_REDIRECT_REJECTED"
  | "GITHUB_RESPONSE_TOO_LARGE"
  | "GITHUB_INVALID_RESPONSE"
  | "GITHUB_NOT_FOUND"
  | "GITHUB_UNAUTHORIZED"
  | "GITHUB_FORBIDDEN"
  | "GITHUB_RATE_LIMITED"
  | "GITHUB_SERVER_ERROR"
  | "GITHUB_UNEXPECTED_STATUS"
  | "PULL_REQUEST_IDENTITY_MISMATCH"
  | "PRIVATE_REPOSITORY_UNSUPPORTED"
  | "GITHUB_MERGE_STATE_INCONSISTENT"
  | "GITHUB_MERGE_METADATA_MISSING"
  | "GITHUB_MERGE_TIMESTAMP_INVALID"
  | "GITHUB_CLOCK_INCONSISTENT";

export interface GitHubNotSatisfiedResult {
  readonly status: "NOT_SATISFIED";
  readonly reason:
    | "PULL_REQUEST_NOT_MERGED"
    | "BASE_BRANCH_MISMATCH"
    | "MERGED_AFTER_DEADLINE";
  readonly retryable: boolean;
}

export interface GitHubIndeterminateResult {
  readonly status: "INDETERMINATE";
  readonly reason: Exclude<
    GitHubVerificationReason,
    GitHubNotSatisfiedResult["reason"]
  >;
  readonly retryable: boolean;
  readonly rateLimit?: GitHubRateLimitMetadata;
}

export type GitHubVerificationResult =
  | VerifiedGitHubCompletion
  | GitHubNotSatisfiedResult
  | GitHubIndeterminateResult;

export interface VerifyGitHubPrMergedInput {
  readonly condition: GithubPrMergedConditionInput;
  readonly completionDeadline: number | bigint;
  readonly observedAt: number | bigint;
  readonly client: GitHubPullRequestClient;
}

function normalizeUint64(label: string, value: number | bigint): bigint {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer or bigint`);
  }
  const normalized = BigInt(value);
  if (normalized <= 0n || normalized > UINT64_MAX) {
    throw new Error(`${label} must be a positive uint64`);
  }
  return normalized;
}

function parseGitHubTimestamp(value: string): bigint | undefined {
  if (!GITHUB_TIMESTAMP.test(value)) return undefined;
  const milliseconds = Date.parse(value);
  if (!Number.isSafeInteger(milliseconds)) return undefined;
  const canonical = new Date(milliseconds).toISOString();
  if (canonical !== value.replace("Z", ".000Z")) return undefined;
  return BigInt(milliseconds / 1_000);
}

function fromClientFailure(
  failure: GitHubClientFailure,
): GitHubIndeterminateResult {
  const reasonByKind = {
    timeout: "GITHUB_TIMEOUT",
    network: "GITHUB_NETWORK_ERROR",
    redirect: "GITHUB_REDIRECT_REJECTED",
    response_too_large: "GITHUB_RESPONSE_TOO_LARGE",
    invalid_json: "GITHUB_INVALID_RESPONSE",
    invalid_response: "GITHUB_INVALID_RESPONSE",
    not_found: "GITHUB_NOT_FOUND",
    unauthorized: "GITHUB_UNAUTHORIZED",
    forbidden: "GITHUB_FORBIDDEN",
    rate_limited: "GITHUB_RATE_LIMITED",
    server_error: "GITHUB_SERVER_ERROR",
    unexpected_status: "GITHUB_UNEXPECTED_STATUS",
  } as const;
  return {
    status: "INDETERMINATE",
    reason: reasonByKind[failure.kind],
    retryable: failure.retryable,
    ...(Object.keys(failure.rateLimit).length === 0
      ? {}
      : { rateLimit: failure.rateLimit }),
  };
}

function indeterminate(
  reason: GitHubIndeterminateResult["reason"],
  retryable = false,
): GitHubIndeterminateResult {
  return { status: "INDETERMINATE", reason, retryable };
}

function validateIdentity(
  metadata: GitHubPullRequestMetadata,
  condition: ReturnType<typeof normalizeGithubPrMergedCondition>,
  observedAt: bigint,
  completionDeadline: bigint,
): GitHubVerificationResult | undefined {
  if (metadata.number !== condition.pullRequest) {
    return indeterminate("PULL_REQUEST_IDENTITY_MISMATCH");
  }
  if (metadata.privateRepository) {
    return indeterminate("PRIVATE_REPOSITORY_UNSUPPORTED");
  }

  let returnedIdentity;
  try {
    returnedIdentity = normalizeGithubPrMergedCondition({
      provider: GITHUB_PROVIDER,
      repository: metadata.baseRepository,
      pullRequest: metadata.number,
      baseBranch: metadata.baseBranch,
      event: PR_MERGED_EVENT,
    });
  } catch {
    return indeterminate("GITHUB_INVALID_RESPONSE");
  }
  if (returnedIdentity.repository !== condition.repository) {
    return indeterminate("PULL_REQUEST_IDENTITY_MISMATCH");
  }
  if (returnedIdentity.baseBranch !== condition.baseBranch) {
    return {
      status: "NOT_SATISFIED",
      reason: "BASE_BRANCH_MISMATCH",
      retryable: !metadata.merged && observedAt < completionDeadline,
    };
  }
  return undefined;
}

export async function verifyGitHubPrMerged(
  input: VerifyGitHubPrMergedInput,
): Promise<GitHubVerificationResult> {
  const condition = normalizeGithubPrMergedCondition(input.condition);
  const conditionHash = hashGithubPrMergedCondition(condition);
  const completionDeadline = normalizeUint64(
    "completionDeadline",
    input.completionDeadline,
  );
  const observedAt = normalizeUint64("observedAt", input.observedAt);

  const metadataResult = await input.client.getPullRequest(
    condition.repository,
    condition.pullRequest,
  );
  if (!metadataResult.ok) return fromClientFailure(metadataResult.failure);

  const identityFailure = validateIdentity(
    metadataResult.value,
    condition,
    observedAt,
    completionDeadline,
  );
  if (identityFailure !== undefined) return identityFailure;

  const mergeResult = await input.client.checkPullRequestMerged(
    condition.repository,
    condition.pullRequest,
  );
  if (!mergeResult.ok) return fromClientFailure(mergeResult.failure);

  const metadata = metadataResult.value;
  if (!mergeResult.value.merged) {
    if (metadata.merged || metadata.mergedAt !== null) {
      return indeterminate("GITHUB_MERGE_STATE_INCONSISTENT");
    }
    return {
      status: "NOT_SATISFIED",
      reason: "PULL_REQUEST_NOT_MERGED",
      retryable: observedAt < completionDeadline,
    };
  }

  if (!metadata.merged || metadata.state !== "closed") {
    return indeterminate("GITHUB_MERGE_STATE_INCONSISTENT");
  }
  if (metadata.mergedAt === null || metadata.mergeCommitSha === null) {
    return indeterminate("GITHUB_MERGE_METADATA_MISSING");
  }
  const mergedAt = parseGitHubTimestamp(metadata.mergedAt);
  if (mergedAt === undefined) {
    return indeterminate("GITHUB_MERGE_TIMESTAMP_INVALID");
  }
  if (mergedAt > observedAt) {
    return indeterminate("GITHUB_CLOCK_INCONSISTENT");
  }
  if (mergedAt > completionDeadline) {
    return {
      status: "NOT_SATISFIED",
      reason: "MERGED_AFTER_DEADLINE",
      retryable: false,
    };
  }

  let evidence;
  try {
    evidence = normalizePactGitHubPrMergedEvidenceV1({
      conditionHash,
      repository: condition.repository,
      pullRequest: condition.pullRequest,
      baseBranch: condition.baseBranch,
      mergeCommitSha: metadata.mergeCommitSha,
      mergedAt,
      observedAt,
    });
  } catch {
    return indeterminate("GITHUB_INVALID_RESPONSE");
  }

  return createVerifiedGitHubCompletion({
    status: "SATISFIED",
    condition,
    conditionHash,
    evidence,
    evidenceHash: hashPactGitHubPrMergedEvidenceV1(evidence),
    satisfiedAt: mergedAt,
    observedAt,
  });
}
