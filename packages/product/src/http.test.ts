import type { GitHubPullRequestClient } from "@pact/verifier/github";
import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import type { ProductConfig } from "./config";
import {
  handleAuthChallenge,
  handleAuthLogout,
  handleAuthSession,
  handleCreateDraft,
  handleReadEvidence,
  handleReadPact,
  handleReadSettlement,
  type ProductRuntime,
} from "./http";
import { InMemoryRateLimiter } from "./rate-limit";
import { InMemoryProductRepository } from "./repository";
import { createSessionToken, serializeSessionCookie } from "./session";

const WALLET = getAddress("0x1111111111111111111111111111111111111111");
const PROVIDER = getAddress("0x2222222222222222222222222222222222222222");
const TEST_KEY = "h".repeat(64);
const SIGNATURE = `0x${"33".repeat(65)}`;
const ORIGIN = "https://pact.example";

const config: ProductConfig = {
  publicOrigin: new URL(ORIGIN),
  sessionSecret: TEST_KEY,
  secureCookie: true,
  sessionTtlSeconds: 900,
  chainId: 5_042_002,
  databaseUrl: "postgresql://local.invalid/pact",
};

const github: GitHubPullRequestClient = {
  async getPullRequest(repository, pullRequest) {
    return {
      ok: true,
      value: {
        number: pullRequest,
        state: "open",
        merged: false,
        mergedAt: null,
        mergeCommitSha: null,
        baseRepository: repository,
        baseBranch: "main",
        privateRepository: false,
      },
    };
  },
  async checkPullRequestMerged() {
    return { ok: true, value: { merged: false } };
  },
};

function runtime(repository = new InMemoryProductRepository()): ProductRuntime {
  return {
    config,
    repository,
    github,
    rateLimiter: new InMemoryRateLimiter(),
    recoverAddress: async () => Promise.resolve(WALLET),
  };
}

function jsonRequest(
  path: string,
  body: unknown,
  options: { origin?: string | null; cookie?: string; raw?: string } = {},
): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (options.origin !== null) headers.set("origin", options.origin ?? ORIGIN);
  if (options.cookie !== undefined) headers.set("cookie", options.cookie);
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers,
    body: options.raw ?? JSON.stringify(body),
  });
}

function sessionCookie(): string {
  return serializeSessionCookie(
    createSessionToken({
      walletAddress: WALLET,
      secret: TEST_KEY,
    }),
    true,
  );
}

describe("product HTTP safety and auth", () => {
  it("issues a bounded wallet challenge", async () => {
    const response = await handleAuthChallenge(
      jsonRequest("/api/v1/auth/challenge", { walletAddress: WALLET }),
      runtime(),
    );
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      walletAddress: WALLET,
      domain: "pact.example",
      uri: ORIGIN,
      chainId: 5_042_002,
    });
  });

  it("rejects an invalid wallet at the HTTP boundary", async () => {
    const response = await handleAuthChallenge(
      jsonRequest("/api/v1/auth/challenge", { walletAddress: "invalid" }),
      runtime(),
    );
    expect(response.status).toBe(400);
  });

  it("verifies a challenge and issues an HttpOnly session", async () => {
    const productRuntime = runtime();
    const challengeResponse = await handleAuthChallenge(
      jsonRequest("/api/v1/auth/challenge", { walletAddress: WALLET }),
      productRuntime,
    );
    const challenge = (await challengeResponse.json()) as { message: string };
    const response = await handleAuthSession(
      jsonRequest("/api/v1/auth/session", {
        message: challenge.message,
        signature: SIGNATURE,
      }),
      productRuntime,
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("Secure");
  });

  it.each([
    ["wrong Origin", { origin: "https://evil.example" }, 403],
    ["missing Origin", { origin: null }, 403],
    ["malformed JSON", { raw: "{" }, 400],
  ])("rejects %s", async (_label, options, status) => {
    const response = await handleAuthChallenge(
      jsonRequest("/api/v1/auth/challenge", { walletAddress: WALLET }, options),
      runtime(),
    );
    expect(response.status).toBe(status);
  });

  it("rejects an oversized request", async () => {
    const response = await handleAuthChallenge(
      jsonRequest("/api/v1/auth/challenge", {
        walletAddress: `${WALLET}${"x".repeat(4_096)}`,
      }),
      runtime(),
    );
    expect(response.status).toBe(413);
  });

  it("rejects unknown fields", async () => {
    const response = await handleAuthChallenge(
      jsonRequest("/api/v1/auth/challenge", {
        walletAddress: WALLET,
        event: "PR_MERGED",
      }),
      runtime(),
    );
    expect(response.status).toBe(400);
  });

  it("clears the wallet session on logout", () => {
    const response = handleAuthLogout(
      new Request(`${ORIGIN}/api/v1/auth/session`, {
        method: "DELETE",
        headers: { origin: ORIGIN },
      }),
      runtime(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});

describe("product draft and public read HTTP", () => {
  it("requires an authenticated wallet session", async () => {
    const response = await handleCreateDraft(
      jsonRequest("/api/v1/pacts", {
        repository: "example/repo",
        pullRequest: 7,
        provider: PROVIDER,
        amount: "0.10",
      }),
      runtime(),
    );
    expect(response.status).toBe(401);
  });

  it("rejects arbitrary event and chain fields", async () => {
    for (const unexpected of [
      { event: "OTHER" },
      { chainId: 1 },
      { deadline: 1 },
    ]) {
      const request = jsonRequest(
        "/api/v1/pacts",
        {
          repository: "example/repo",
          pullRequest: 7,
          provider: PROVIDER,
          amount: "0.10",
          ...unexpected,
        },
        { cookie: sessionCookie() },
      );
      request.headers.set("idempotency-key", "http-key-0001");
      const response = await handleCreateDraft(request, runtime());
      expect(response.status).toBe(400);
    }
  });

  it("creates and publicly reads a sanitized draft", async () => {
    const repository = new InMemoryProductRepository();
    const productRuntime = runtime(repository);
    const request = jsonRequest(
      "/api/v1/pacts",
      {
        repository: "Example/Repo",
        pullRequest: 7,
        provider: PROVIDER,
        amount: "0.10",
      },
      { cookie: sessionCookie() },
    );
    request.headers.set("idempotency-key", "http-key-0002");
    const created = await handleCreateDraft(request, productRuntime);
    expect(created.status).toBe(201);
    const body = (await created.json()) as { publicSlug: string };
    const read = await handleReadPact(
      new Request(`${ORIGIN}/api/v1/pacts/${body.publicSlug}`),
      productRuntime,
      body.publicSlug,
    );
    expect(read.status).toBe(200);
    const serialized = JSON.stringify(await read.json());
    expect(serialized).not.toContain("idempotency");
    expect(serialized).not.toContain("session");
    expect(serialized).not.toContain("serializedTransaction");
    expect(
      await handleReadEvidence(
        new Request(`${ORIGIN}/evidence`),
        productRuntime,
        body.publicSlug,
      ),
    ).toMatchObject({ status: 404 });
    expect(
      await handleReadSettlement(
        new Request(`${ORIGIN}/settlement`),
        productRuntime,
        body.publicSlug,
      ),
    ).toMatchObject({ status: 404 });
  });
});
