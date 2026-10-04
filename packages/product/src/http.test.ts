import type { GitHubPullRequestClient } from "@pact/verifier/github";
import { describe, expect, it, vi } from "vitest";
import { getAddress } from "viem";
import type { ProductConfig } from "./config";
import {
  handleAuthChallenge,
  handleAuthLogout,
  handleAuthSession,
  handleCreateDraft,
  handlePrepareWalletAction,
  handleReadEvidence,
  handleReadPact,
  handleReadSettlement,
  handleRetryPact,
  type ProductRuntime,
} from "./http";
import { InMemoryRateLimiter } from "./rate-limit";
import { InMemoryProductRepository } from "./repository";
import { createSessionToken, serializeSessionCookie } from "./session";
import type { ProductRepository } from "./types";

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
  arcRpcUrl: "https://rpc.testnet.arc.io",
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

function runtime(
  repository: ProductRepository = new InMemoryProductRepository(),
): ProductRuntime {
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

  it.each([
    ["to", "0x3333333333333333333333333333333333333333"],
    ["data", "0x1234"],
    ["value", "1"],
    ["budget", "999999"],
    ["amount", ((1n << 256n) - 1n).toString()],
  ])(
    "rejects caller-controlled wallet transaction field %s",
    async (key, value) => {
      const repository = new InMemoryProductRepository();
      const productRuntime = runtime(repository);
      const created = await handleCreateDraft(
        new Request(`${ORIGIN}/api/v1/pacts`, {
          method: "POST",
          headers: {
            origin: ORIGIN,
            "content-type": "application/json",
            cookie: sessionCookie(),
            "idempotency-key": "http-draft-key-01",
          },
          body: JSON.stringify({
            repository: "eugenennamdi/pact-arc-demo",
            pullRequest: 9,
            provider: PROVIDER,
            amount: "0.001",
          }),
        }),
        productRuntime,
      );
      const body = (await created.json()) as { publicSlug: string };
      const response = await handlePrepareWalletAction(
        jsonRequest(
          `/api/v1/pacts/${body.publicSlug}/actions/create-job/prepare`,
          { [key]: value },
          { cookie: sessionCookie() },
        ),
        productRuntime,
        body.publicSlug,
        "create-job",
      );
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "INVALID_REQUEST",
      });
    },
  );

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

describe("public manual retry wake-up", () => {
  async function linkedRuntime() {
    const base = new InMemoryProductRepository();
    const automation = {
      ensureScheduled: async () => undefined,
      wake: vi.fn(async () => ({ replayed: false })),
    };
    const repository = new Proxy(base, {
      get(target, property, receiver) {
        if (property === "getDraftBySlug") {
          return async (slug: string) => {
            const draft = await target.getDraftBySlug(slug);
            return draft === undefined
              ? undefined
              : {
                  ...draft,
                  linkedPactRecordId: "11111111-1111-4111-8111-111111111111",
                  lifecycle: "LINKED" as const,
                };
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as ProductRepository;
    const productRuntime = { ...runtime(repository), automation };
    const create = jsonRequest(
      "/api/v1/pacts",
      {
        repository: "example/repo",
        pullRequest: 7,
        provider: PROVIDER,
        amount: "0.10",
      },
      { cookie: sessionCookie() },
    );
    create.headers.set("idempotency-key", "retry-draft-key-01");
    const created = await handleCreateDraft(create, productRuntime);
    const body = (await created.json()) as { publicSlug: string };
    return { productRuntime, automation, slug: body.publicSlug };
  }

  it("allows the client to enqueue only a scheduler wake-up", async () => {
    const { productRuntime, automation, slug } = await linkedRuntime();
    const request = jsonRequest(
      `/api/v1/pacts/${slug}/retry`,
      {},
      { cookie: sessionCookie() },
    );
    request.headers.set("idempotency-key", "retry-wake-key-0001");
    const response = await handleRetryPact(request, productRuntime, slug);
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      status: "QUEUED",
      replayed: false,
    });
    expect(automation.wake).toHaveBeenCalledWith(
      expect.any(String),
      "11111111-1111-4111-8111-111111111111",
      "retry-wake-key-0001",
    );
  });

  it("returns the durable idempotent replay result without running a worker", async () => {
    const { productRuntime, automation, slug } = await linkedRuntime();
    automation.wake.mockResolvedValueOnce({ replayed: true });
    const request = jsonRequest(
      `/api/v1/pacts/${slug}/retry`,
      {},
      { cookie: sessionCookie() },
    );
    request.headers.set("idempotency-key", "retry-wake-replay-0001");
    const response = await handleRetryPact(request, productRuntime, slug);
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      status: "QUEUED",
      replayed: true,
    });
    expect(automation.wake).toHaveBeenCalledOnce();
  });

  it.each([
    ["target", "0x3333333333333333333333333333333333333333"],
    ["calldata", "0x1234"],
    ["nonce", 1],
    ["signature", `0x${"11".repeat(65)}`],
    ["attestation", {}],
  ])("rejects retry field %s", async (key, value) => {
    const { productRuntime, automation, slug } = await linkedRuntime();
    const request = jsonRequest(
      `/api/v1/pacts/${slug}/retry`,
      { [key]: value },
      { cookie: sessionCookie() },
    );
    request.headers.set("idempotency-key", "retry-wake-key-0002");
    const response = await handleRetryPact(request, productRuntime, slug);
    expect(response.status).toBe(400);
    expect(automation.wake).not.toHaveBeenCalled();
  });
});
