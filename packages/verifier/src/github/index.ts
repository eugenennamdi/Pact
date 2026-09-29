export {
  DEFAULT_GITHUB_MAX_RESPONSE_BYTES,
  DEFAULT_GITHUB_TIMEOUT_MS,
  GITHUB_ACCEPT,
  GITHUB_API_BASE_URL,
  GITHUB_API_VERSION,
  GITHUB_USER_AGENT,
  PACT_GITHUB_REST_API_VERSION,
  createGitHubPullRequestClient,
  createGitHubPullRequestClientFromEnv,
  type GitHubClientFailure,
  type GitHubClientFailureKind,
  type GitHubClientResult,
  type GitHubPullRequestClient,
  type GitHubPullRequestClientOptions,
  type GitHubPullRequestMetadata,
  type GitHubRateLimitMetadata,
} from "./client.js";

export {
  verifyGitHubPrMerged,
  type GitHubIndeterminateResult,
  type GitHubNotSatisfiedResult,
  type GitHubVerificationReason,
  type GitHubVerificationResult,
  type VerifyGitHubPrMergedInput,
} from "./verify.js";

export type { VerifiedGitHubCompletion } from "../internal/verified.js";
