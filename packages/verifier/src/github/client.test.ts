import { describe, expect, it, vi } from "vitest";

import {
  GITHUB_ACCEPT,
  GITHUB_API_BASE_URL,
  GITHUB_API_VERSION,
  GITHUB_USER_AGENT,
  createGitHubPullRequestClient,
} from "./client.js";

const pull = {
  number: 81,
  state: "closed",
  merged: true,
  merged_at: "2027-01-15T08:00:00Z",
  merge_commit_sha: "0123456789abcdef0123456789abcdef01234567",
  base: {
    ref: "main",
    repo: { full_name: "pact-protocol/demo", private: false },
  },
};

describe("GitHub pull request client", () => {
  it("pins the endpoint, version, headers, credentials, and redirect policy", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(pull), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = createGitHubPullRequestClient({
      fetch: request,
      token: "github-token",
    });

    await expect(
      client.getPullRequest("pact-protocol/demo", 81),
    ).resolves.toMatchObject({ ok: true, value: { number: 81 } });
    expect(request).toHaveBeenCalledOnce();
    const [url, init] = request.mock.calls[0] ?? [];
    expect(url).toBe(
      `${GITHUB_API_BASE_URL}/repos/pact-protocol/demo/pulls/81`,
    );
    expect(init).toMatchObject({ method: "GET", redirect: "manual" });
    expect(init?.headers).toEqual({
      Accept: GITHUB_ACCEPT,
      Authorization: "Bearer github-token",
      "User-Agent": GITHUB_USER_AGENT,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
    });
  });

  it("interprets only 204 and 404 from the independent merge endpoint", async () => {
    const merged = createGitHubPullRequestClient({
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 204 })),
    });
    await expect(
      merged.checkPullRequestMerged("pact-protocol/demo", 81),
    ).resolves.toEqual({ ok: true, value: { merged: true } });

    const unmerged = createGitHubPullRequestClient({
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 404 })),
    });
    await expect(
      unmerged.checkPullRequestMerged("pact-protocol/demo", 81),
    ).resolves.toEqual({ ok: true, value: { merged: false } });
  });

  it.each([
    [401, "unauthorized", false],
    [403, "forbidden", false],
    [404, "not_found", false],
    [429, "rate_limited", true],
    [500, "server_error", true],
    [503, "server_error", true],
  ] as const)(
    "classifies HTTP %i without retrying",
    async (status, kind, retryable) => {
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status }));
      const client = createGitHubPullRequestClient({ fetch: request });
      await expect(
        client.getPullRequest("pact-protocol/demo", 81),
      ).resolves.toMatchObject({
        ok: false,
        failure: { kind, retryable },
      });
      expect(request).toHaveBeenCalledOnce();
    },
  );

  it("preserves rate-limit metadata", async () => {
    const client = createGitHubPullRequestClient({
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(null, {
          status: 403,
          headers: {
            "retry-after": "7",
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": "1800000000",
          },
        }),
      ),
    });
    await expect(
      client.getPullRequest("pact-protocol/demo", 81),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: "rate_limited",
        rateLimit: {
          retryAfterSeconds: 7,
          remaining: 0,
          resetAt: 1_800_000_000,
        },
      },
    });
  });

  it.each([
    ["invalid JSON", new Response("{", { status: 200 }), "invalid_json"],
    [
      "invalid shape",
      new Response(JSON.stringify({ number: 81 }), { status: 200 }),
      "invalid_response",
    ],
    [
      "declared oversized body",
      new Response("small", {
        status: 200,
        headers: { "content-length": "1000" },
      }),
      "response_too_large",
    ],
    [
      "redirect",
      new Response(null, {
        status: 301,
        headers: { location: "https://example.com" },
      }),
      "redirect",
    ],
  ] as const)("rejects %s", async (_label, response, kind) => {
    const client = createGitHubPullRequestClient({
      fetch: vi.fn<typeof fetch>().mockResolvedValue(response),
      maxResponseBytes: 32,
    });
    await expect(
      client.getPullRequest("pact-protocol/demo", 81),
    ).resolves.toMatchObject({ ok: false, failure: { kind } });
  });

  it("bounds a streamed response even without Content-Length", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(20));
        controller.enqueue(new Uint8Array(20));
        controller.close();
      },
    });
    const client = createGitHubPullRequestClient({
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(body, { status: 200 })),
      maxResponseBytes: 32,
    });
    await expect(
      client.getPullRequest("pact-protocol/demo", 81),
    ).resolves.toMatchObject({
      ok: false,
      failure: { kind: "response_too_large" },
    });
  });

  it("classifies network errors and abort-driven timeouts", async () => {
    const network = createGitHubPullRequestClient({
      fetch: vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")),
    });
    await expect(
      network.getPullRequest("pact-protocol/demo", 81),
    ).resolves.toMatchObject({ ok: false, failure: { kind: "network" } });

    const timeoutFetch = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const timeout = createGitHubPullRequestClient({
      fetch: timeoutFetch,
      timeoutMs: 1,
    });
    await expect(
      timeout.getPullRequest("pact-protocol/demo", 81),
    ).resolves.toMatchObject({ ok: false, failure: { kind: "timeout" } });
  });
});
