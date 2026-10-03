import {
  hashGithubPrMergedCondition,
  normalizeGithubPrMergedCondition,
} from "@pact/protocol";
import type {
  GitHubClientFailureKind,
  GitHubPullRequestClient,
} from "@pact/verifier/github";
import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { InMemoryProductRepository } from "./repository";
import { ProductError, createDraft, parseUsdcAmount } from "./service";

const CLIENT = getAddress("0x1111111111111111111111111111111111111111");
const PROVIDER = getAddress("0x2222222222222222222222222222222222222222");
const NOW = new Date("2026-10-03T12:00:00.000Z");
const REQUEST = {
  repository: "Example/Repo",
  pullRequest: 7,
  provider: PROVIDER,
  amount: "0.10",
} as const;

function githubClient(input?: {
  readonly merged?: boolean;
  readonly baseBranch?: string;
  readonly failure?: GitHubClientFailureKind;
  readonly calls?: { count: number };
}): GitHubPullRequestClient {
  return {
    async getPullRequest(repository, pullRequest) {
      if (input?.calls !== undefined) input.calls.count += 1;
      if (input?.failure !== undefined) {
        return {
          ok: false,
          failure: {
            kind: input.failure,
            retryable: input.failure === "network",
            rateLimit: {},
          },
        };
      }
      const merged = input?.merged ?? false;
      return {
        ok: true,
        value: {
          number: pullRequest,
          state: merged ? "closed" : "open",
          merged,
          mergedAt: merged ? "2026-10-03T11:00:00Z" : null,
          mergeCommitSha: merged
            ? "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
            : null,
          baseRepository: repository,
          baseBranch: input?.baseBranch ?? "main",
          privateRepository: false,
        },
      };
    },
    async checkPullRequestMerged() {
      return { ok: true, value: { merged: input?.merged ?? false } };
    },
  };
}

async function create(
  repository = new InMemoryProductRepository(),
  overrides: Partial<typeof REQUEST> = {},
  github = githubClient(),
  key = "draft-key-0001",
) {
  return createDraft({
    repository,
    github,
    sessionWallet: CLIENT,
    idempotencyKey: key,
    request: { ...REQUEST, ...overrides },
    now: NOW,
  });
}

describe("create draft", () => {
  it("creates an Arc Testnet draft only for an open public PR", async () => {
    const result = await create();
    expect(result).toMatchObject({
      replayed: false,
      network: "arc-testnet",
      chainId: 5_042_002,
      repository: "example/repo",
      baseBranch: "main",
      event: "PR_MERGED",
      client: CLIENT,
      provider: PROVIDER,
      amountBaseUnits: "100000",
      draftStatus: "ACTION_REQUIRED",
      next: { actor: "CLIENT", action: "CREATE_JOB" },
    });
  });

  it("uses the certified protocol condition implementation", async () => {
    const result = await create();
    const expected = normalizeGithubPrMergedCondition({
      provider: "github",
      repository: "example/repo",
      pullRequest: 7,
      baseBranch: "main",
      event: "PR_MERGED",
    });
    expect(result.condition).toEqual(expected);
    expect(result.conditionHash).toBe(hashGithubPrMergedCondition(expected));
  });

  it("rejects an already merged PR", async () => {
    await expect(
      create(undefined, {}, githubClient({ merged: true })),
    ).rejects.toMatchObject({ code: "PULL_REQUEST_ALREADY_MERGED" });
  });

  it("rejects a nonexistent PR", async () => {
    await expect(
      create(undefined, {}, githubClient({ failure: "not_found" })),
    ).rejects.toMatchObject({ code: "PULL_REQUEST_NOT_ELIGIBLE" });
  });

  it("rejects an indeterminate GitHub response", async () => {
    await expect(
      create(undefined, {}, githubClient({ failure: "network" })),
    ).rejects.toMatchObject({ code: "PULL_REQUEST_NOT_ELIGIBLE" });
  });

  it("rejects a repository/base mismatch", async () => {
    await expect(
      create(undefined, {}, githubClient({ baseBranch: "develop" })),
    ).rejects.toMatchObject({ code: "PULL_REQUEST_BASE_MISMATCH" });
  });

  it.each([
    [
      "invalid repository",
      { repository: "bad repository" },
      "INVALID_REPOSITORY",
    ],
    ["invalid PR", { pullRequest: 0 }, "INVALID_PULL_REQUEST"],
    ["invalid provider", { provider: "bad" }, "INVALID_PROVIDER"],
    ["zero amount", { amount: "0" }, "INVALID_AMOUNT"],
    ["excess precision", { amount: "0.0000001" }, "INVALID_AMOUNT"],
    ["floating syntax", { amount: "1e2" }, "INVALID_AMOUNT"],
  ])("rejects %s", async (_label, override, code) => {
    await expect(create(undefined, override)).rejects.toMatchObject({ code });
  });

  it("replays the same wallet-scoped idempotent request without rechecking GitHub", async () => {
    const repository = new InMemoryProductRepository();
    const calls = { count: 0 };
    const github = githubClient({ calls });
    const first = await create(repository, {}, github);
    const second = await create(repository, {}, github);
    expect(second.publicSlug).toBe(first.publicSlug);
    expect(second.replayed).toBe(true);
    expect(calls.count).toBe(1);
  });

  it("rejects an idempotency key reused with a different canonical request", async () => {
    const repository = new InMemoryProductRepository();
    await create(repository);
    await expect(create(repository, { amount: "0.11" })).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
  });

  it("collapses concurrent duplicate creation", async () => {
    const repository = new InMemoryProductRepository();
    const results = await Promise.all([
      create(repository, {}, githubClient()),
      create(repository, {}, githubClient()),
    ]);
    expect(new Set(results.map((item) => item.publicSlug)).size).toBe(1);
  });

  it("creates no evidence, attestation, or operation", async () => {
    const repository = new InMemoryProductRepository();
    const created = await create(repository);
    const projection = await repository.getPublicProjection(created.publicSlug);
    expect(projection).toMatchObject({
      evidence: null,
      settlement: null,
      operationState: null,
      relayState: null,
    });
  });
});

describe("USDC amount parser", () => {
  it.each([
    ["1", 1_000_000n],
    ["0.1", 100_000n],
    ["0.000001", 1n],
    ["12.3456", 12_345_600n],
  ])("parses %s losslessly", (input, expected) => {
    expect(parseUsdcAmount(input)).toBe(expected);
  });

  it("rejects uint256 overflow", () => {
    const amount = ((1n << 256n) / 1_000_000n + 1n).toString();
    expect(() => parseUsdcAmount(amount)).toThrow(ProductError);
  });
});
