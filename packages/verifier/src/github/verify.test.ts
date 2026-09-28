import { describe, expect, it } from "vitest";

import type {
  GitHubClientFailureKind,
  GitHubPullRequestClient,
  GitHubPullRequestMetadata,
} from "./client.js";
import { verifyGitHubPrMerged } from "./verify.js";

const condition = {
  provider: "github",
  repository: "Pact-Protocol/Demo",
  pullRequest: 81,
  baseBranch: "main",
  event: "PR_MERGED",
} as const;
const mergedAt = 1_800_000_000n;
const observedAt = mergedAt + 60n;
const deadline = mergedAt + 120n;

const metadata: GitHubPullRequestMetadata = {
  number: 81,
  state: "closed",
  merged: true,
  mergedAt: "2027-01-15T08:00:00Z",
  mergeCommitSha: "0123456789abcdef0123456789abcdef01234567",
  baseRepository: "Pact-Protocol/Demo",
  baseBranch: "main",
  privateRepository: false,
};

function client(
  pull: GitHubPullRequestMetadata = metadata,
  merged = true,
): GitHubPullRequestClient {
  return {
    getPullRequest: async () => ({ ok: true, value: pull }),
    checkPullRequestMerged: async () => ({ ok: true, value: { merged } }),
  };
}

function verify(
  verifierClient: GitHubPullRequestClient,
  overrides: Partial<{
    completionDeadline: bigint;
    observedAt: bigint;
  }> = {},
) {
  return verifyGitHubPrMerged({
    condition,
    completionDeadline: overrides.completionDeadline ?? deadline,
    observedAt: overrides.observedAt ?? observedAt,
    client: verifierClient,
  });
}

describe("GitHub PR_MERGED verification", () => {
  it("constructs deterministic evidence only after both observations agree", async () => {
    const first = await verify(client());
    const second = await verify(client());
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      status: "SATISFIED",
      conditionHash:
        "0x3da848928dfb0c9f0e98058ec9dc003e1a73952469488ce90fcab1699ccb18b4",
      evidenceHash:
        "0x0a1ed8785c5d5548b1d6472aa40a10b7c297485d8f244dc216fced19544a4eea",
      satisfiedAt: mergedAt,
      observedAt,
    });
  });

  it("treats open and closed-unmerged PRs as retryable only before deadline", async () => {
    for (const state of ["open", "closed"] as const) {
      const result = await verify(
        client({ ...metadata, state, merged: false, mergedAt: null }, false),
      );
      expect(result).toEqual({
        status: "NOT_SATISFIED",
        reason: "PULL_REQUEST_NOT_MERGED",
        retryable: true,
      });
    }
    await expect(
      verify(client({ ...metadata, merged: false, mergedAt: null }, false), {
        observedAt: deadline,
      }),
    ).resolves.toMatchObject({ retryable: false });
  });

  it("rejects a late merge and accepts a merge exactly at the deadline", async () => {
    await expect(
      verify(client(), { completionDeadline: mergedAt - 1n }),
    ).resolves.toEqual({
      status: "NOT_SATISFIED",
      reason: "MERGED_AFTER_DEADLINE",
      retryable: false,
    });
    await expect(
      verify(client(), { completionDeadline: mergedAt }),
    ).resolves.toMatchObject({ status: "SATISFIED" });
  });

  it.each([
    ["wrong number", { number: 82 }, "PULL_REQUEST_IDENTITY_MISMATCH"],
    [
      "wrong repository",
      { baseRepository: "other/demo" },
      "PULL_REQUEST_IDENTITY_MISMATCH",
    ],
    [
      "private repository",
      { privateRepository: true },
      "PRIVATE_REPOSITORY_UNSUPPORTED",
    ],
  ] as const)("rejects %s", async (_label, mutation, reason) => {
    await expect(
      verify(client({ ...metadata, ...mutation })),
    ).resolves.toMatchObject({
      status: "INDETERMINATE",
      reason,
    });
  });

  it("treats the base branch as a case-sensitive condition", async () => {
    await expect(
      verify(client({ ...metadata, baseBranch: "Main" })),
    ).resolves.toEqual({
      status: "NOT_SATISFIED",
      reason: "BASE_BRANCH_MISMATCH",
      retryable: false,
    });
    await expect(
      verify(
        client({
          ...metadata,
          state: "open",
          merged: false,
          mergedAt: null,
          baseBranch: "Main",
        }),
      ),
    ).resolves.toMatchObject({ retryable: true });
  });

  it.each([
    [
      "merge endpoint false while metadata says merged",
      metadata,
      false,
      "GITHUB_MERGE_STATE_INCONSISTENT",
    ],
    [
      "merge endpoint true while metadata says unmerged",
      { ...metadata, merged: false },
      true,
      "GITHUB_MERGE_STATE_INCONSISTENT",
    ],
    [
      "open metadata while merge endpoint is true",
      { ...metadata, state: "open" },
      true,
      "GITHUB_MERGE_STATE_INCONSISTENT",
    ],
    [
      "missing timestamp",
      { ...metadata, mergedAt: null },
      true,
      "GITHUB_MERGE_METADATA_MISSING",
    ],
    [
      "missing SHA",
      { ...metadata, mergeCommitSha: null },
      true,
      "GITHUB_MERGE_METADATA_MISSING",
    ],
    [
      "malformed timestamp",
      { ...metadata, mergedAt: "2027-01-15T08:00:00.000Z" },
      true,
      "GITHUB_MERGE_TIMESTAMP_INVALID",
    ],
    [
      "malformed SHA",
      { ...metadata, mergeCommitSha: "deadbeef" },
      true,
      "GITHUB_INVALID_RESPONSE",
    ],
  ] as const)(
    "returns indeterminate for %s",
    async (_label, pull, merged, reason) => {
      await expect(verify(client(pull, merged))).resolves.toMatchObject({
        status: "INDETERMINATE",
        reason,
      });
    },
  );

  it("rejects source timestamps later than the observation clock", async () => {
    await expect(
      verify(client(), { observedAt: mergedAt - 1n }),
    ).resolves.toMatchObject({
      status: "INDETERMINATE",
      reason: "GITHUB_CLOCK_INCONSISTENT",
    });
  });

  it.each([
    ["timeout", "GITHUB_TIMEOUT", true],
    ["network", "GITHUB_NETWORK_ERROR", true],
    ["redirect", "GITHUB_REDIRECT_REJECTED", false],
    ["response_too_large", "GITHUB_RESPONSE_TOO_LARGE", false],
    ["rate_limited", "GITHUB_RATE_LIMITED", true],
    ["server_error", "GITHUB_SERVER_ERROR", true],
  ] as const)("maps %s client failures", async (kind, reason, retryable) => {
    const failedClient: GitHubPullRequestClient = {
      getPullRequest: async () => ({
        ok: false,
        failure: {
          kind: kind as GitHubClientFailureKind,
          retryable,
          rateLimit: {},
        },
      }),
      checkPullRequestMerged: async () => ({
        ok: true,
        value: { merged: true },
      }),
    };
    await expect(verify(failedClient)).resolves.toEqual({
      status: "INDETERMINATE",
      reason,
      retryable,
    });
  });
});
