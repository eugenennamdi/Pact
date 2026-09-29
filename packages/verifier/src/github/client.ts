export const GITHUB_API_BASE_URL = "https://api.github.com" as const;
/**
 * Evidence V1 commits to GitHub's canonical mergeCommitSha. GitHub REST
 * 2026-03-10 removed merge_commit_sha from pull-request response objects, so
 * Pact intentionally pins the still-supported 2022-11-28 contract. A future
 * reviewed evidence migration is required before this version sunsets.
 */
export const PACT_GITHUB_REST_API_VERSION = "2022-11-28" as const;
export const GITHUB_API_VERSION = PACT_GITHUB_REST_API_VERSION;
export const GITHUB_ACCEPT = "application/vnd.github+json" as const;
export const GITHUB_USER_AGENT = "Pact-Verifier/0.0.0" as const;
export const DEFAULT_GITHUB_TIMEOUT_MS = 5_000;
export const DEFAULT_GITHUB_MAX_RESPONSE_BYTES = 256 * 1024;

export interface GitHubRateLimitMetadata {
  readonly retryAfterSeconds?: number;
  readonly remaining?: number;
  readonly resetAt?: number;
}

export type GitHubClientFailureKind =
  | "timeout"
  | "network"
  | "redirect"
  | "response_too_large"
  | "invalid_json"
  | "invalid_response"
  | "not_found"
  | "unauthorized"
  | "forbidden"
  | "rate_limited"
  | "server_error"
  | "unexpected_status";

export interface GitHubClientFailure {
  readonly kind: GitHubClientFailureKind;
  readonly status?: number;
  readonly retryable: boolean;
  readonly rateLimit: GitHubRateLimitMetadata;
}

export type GitHubClientResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: GitHubClientFailure };

export interface GitHubPullRequestMetadata {
  readonly number: number;
  readonly state: "open" | "closed";
  readonly merged: boolean;
  readonly mergedAt: string | null;
  readonly mergeCommitSha: string | null;
  readonly baseRepository: string;
  readonly baseBranch: string;
  readonly privateRepository: boolean;
}

export interface GitHubPullRequestClient {
  getPullRequest(
    repository: string,
    pullRequest: number,
  ): Promise<GitHubClientResult<GitHubPullRequestMetadata>>;
  checkPullRequestMerged(
    repository: string,
    pullRequest: number,
  ): Promise<GitHubClientResult<{ readonly merged: boolean }>>;
}

export interface GitHubPullRequestClientOptions {
  readonly fetch?: typeof fetch;
  readonly token?: string;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly userAgent?: string;
}

class ResponseTooLargeError extends Error {}

function parseNonnegativeInteger(value: string | null): number | undefined {
  if (value === null || !/^[0-9]+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function getRateLimitMetadata(headers: Headers): GitHubRateLimitMetadata {
  const retryAfterSeconds = parseNonnegativeInteger(headers.get("retry-after"));
  const remaining = parseNonnegativeInteger(
    headers.get("x-ratelimit-remaining"),
  );
  const resetAt = parseNonnegativeInteger(headers.get("x-ratelimit-reset"));
  return {
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    ...(remaining === undefined ? {} : { remaining }),
    ...(resetAt === undefined ? {} : { resetAt }),
  };
}

function classifyStatus(response: Response): GitHubClientFailure {
  const status = response.status;
  const rateLimit = getRateLimitMetadata(response.headers);
  if (status === 401) {
    return { kind: "unauthorized", status, retryable: false, rateLimit };
  }
  if (status === 403 || status === 429) {
    const rateLimited =
      status === 429 ||
      rateLimit.remaining === 0 ||
      rateLimit.retryAfterSeconds !== undefined;
    return {
      kind: rateLimited ? "rate_limited" : "forbidden",
      status,
      retryable: rateLimited,
      rateLimit,
    };
  }
  if (status === 404) {
    return { kind: "not_found", status, retryable: false, rateLimit };
  }
  if (status >= 500 && status <= 599) {
    return { kind: "server_error", status, retryable: true, rateLimit };
  }
  return { kind: "unexpected_status", status, retryable: false, rateLimit };
}

async function readBoundedBody(
  response: Response,
  maxResponseBytes: number,
): Promise<Uint8Array> {
  const declaredLength = parseNonnegativeInteger(
    response.headers.get("content-length"),
  );
  if (declaredLength !== undefined && declaredLength > maxResponseBytes) {
    throw new ResponseTooLargeError();
  }

  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxResponseBytes) {
      await reader.cancel();
      throw new ResponseTooLargeError();
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePullRequestMetadata(value: unknown): GitHubPullRequestMetadata {
  if (!isRecord(value) || !isRecord(value.base) || !isRecord(value.base.repo)) {
    throw new TypeError("invalid GitHub pull request response");
  }

  const number = value.number;
  const state = value.state;
  const merged = value.merged;
  const mergedAt = value.merged_at;
  const mergeCommitSha = value.merge_commit_sha;
  const baseBranch = value.base.ref;
  const baseRepository = value.base.repo.full_name;
  const privateRepository = value.base.repo.private;
  if (
    typeof number !== "number" ||
    !Number.isSafeInteger(number) ||
    number <= 0 ||
    (state !== "open" && state !== "closed") ||
    typeof merged !== "boolean" ||
    (mergedAt !== null && typeof mergedAt !== "string") ||
    (mergeCommitSha !== null && typeof mergeCommitSha !== "string") ||
    typeof baseBranch !== "string" ||
    typeof baseRepository !== "string" ||
    typeof privateRepository !== "boolean"
  ) {
    throw new TypeError("invalid GitHub pull request response");
  }

  return {
    number,
    state,
    merged,
    mergedAt,
    mergeCommitSha,
    baseRepository,
    baseBranch,
    privateRepository,
  };
}

export function createGitHubPullRequestClient(
  options: GitHubPullRequestClientOptions = {},
): GitHubPullRequestClient {
  const requestFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_GITHUB_TIMEOUT_MS;
  const maxResponseBytes =
    options.maxResponseBytes ?? DEFAULT_GITHUB_MAX_RESPONSE_BYTES;
  const userAgent = options.userAgent ?? GITHUB_USER_AGENT;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > 30_000
  ) {
    throw new Error("GitHub timeout must be between 1 and 30000 milliseconds");
  }
  if (
    !Number.isSafeInteger(maxResponseBytes) ||
    maxResponseBytes <= 0 ||
    maxResponseBytes > 1024 * 1024
  ) {
    throw new Error("GitHub response bound must be between 1 byte and 1 MiB");
  }
  if (/[\r\n]/.test(userAgent) || userAgent.length === 0) {
    throw new Error("GitHub User-Agent is invalid");
  }
  if (options.token !== undefined && options.token.trim() !== options.token) {
    throw new Error("GitHub token must not contain surrounding whitespace");
  }

  const headers: Record<string, string> = {
    Accept: GITHUB_ACCEPT,
    "User-Agent": userAgent,
    "X-GitHub-Api-Version": PACT_GITHUB_REST_API_VERSION,
  };
  if (options.token !== undefined && options.token.length > 0) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  async function request(path: string): Promise<GitHubClientResult<Response>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await requestFetch(`${GITHUB_API_BASE_URL}${path}`, {
        method: "GET",
        headers,
        redirect: "manual",
        signal: controller.signal,
      });
      if (
        response.redirected ||
        (response.status >= 300 && response.status <= 399)
      ) {
        return {
          ok: false,
          failure: {
            kind: "redirect",
            status: response.status,
            retryable: false,
            rateLimit: getRateLimitMetadata(response.headers),
          },
        };
      }
      return { ok: true, value: response };
    } catch (error) {
      const timedOut =
        controller.signal.aborted ||
        (error instanceof Error && error.name === "AbortError");
      return {
        ok: false,
        failure: {
          kind: timedOut ? "timeout" : "network",
          retryable: true,
          rateLimit: {},
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function getPullRequest(
    repository: string,
    pullRequest: number,
  ): Promise<GitHubClientResult<GitHubPullRequestMetadata>> {
    const responseResult = await request(
      `/repos/${repository}/pulls/${pullRequest}`,
    );
    if (!responseResult.ok) return responseResult;
    const response = responseResult.value;
    if (response.status !== 200) {
      return { ok: false, failure: classifyStatus(response) };
    }

    try {
      const bytes = await readBoundedBody(response, maxResponseBytes);
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        return {
          ok: false,
          failure: {
            kind: "invalid_json",
            status: response.status,
            retryable: false,
            rateLimit: getRateLimitMetadata(response.headers),
          },
        };
      }
      return { ok: true, value: parsePullRequestMetadata(parsed) };
    } catch (error) {
      return {
        ok: false,
        failure: {
          kind:
            error instanceof ResponseTooLargeError
              ? "response_too_large"
              : "invalid_response",
          status: response.status,
          retryable: false,
          rateLimit: getRateLimitMetadata(response.headers),
        },
      };
    }
  }

  async function checkPullRequestMerged(
    repository: string,
    pullRequest: number,
  ): Promise<GitHubClientResult<{ readonly merged: boolean }>> {
    const responseResult = await request(
      `/repos/${repository}/pulls/${pullRequest}/merge`,
    );
    if (!responseResult.ok) return responseResult;
    const response = responseResult.value;
    if (response.status === 204) return { ok: true, value: { merged: true } };
    if (response.status === 404) return { ok: true, value: { merged: false } };
    return { ok: false, failure: classifyStatus(response) };
  }

  return Object.freeze({ getPullRequest, checkPullRequestMerged });
}

export function createGitHubPullRequestClientFromEnv(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): GitHubPullRequestClient {
  const token = environment.GITHUB_TOKEN;
  return createGitHubPullRequestClient(token === undefined ? {} : { token });
}
