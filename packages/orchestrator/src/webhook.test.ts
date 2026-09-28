import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  GITHUB_WEBHOOK_BODY_LIMIT_BYTES,
  WebhookRequestError,
  parseAuthenticatedGitHubWebhook,
  readBoundedRequestBody,
} from "./webhook.js";

const secret = "phase-4a-public-test-webhook-secret";
const delivery = "123e4567-e89b-42d3-a456-426614174000";

function fixture(
  payload: string,
  overrides: Record<string, string | undefined> = {},
) {
  const rawBody = new TextEncoder().encode(payload);
  const signature = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const headers = new Headers({
    "content-type": "application/json",
    "x-github-delivery": delivery,
    "x-github-event": "pull_request",
    "x-hub-signature-256": signature,
  });
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) headers.delete(name);
    else headers.set(name, value);
  }
  return { rawBody, headers, secret };
}

function mergedPayload(extra = "") {
  return `{"action":"closed","number":81,"repository":{"full_name":"Pact-Protocol/Demo"}${extra}}`;
}

describe("GitHub webhook authentication and routing", () => {
  it("authenticates exact raw bytes and extracts only routing keys", () => {
    expect(parseAuthenticatedGitHubWebhook(fixture(mergedPayload()))).toEqual({
      deliveryId: delivery,
      event: "pull_request",
      action: "closed",
      relevant: true,
      repository: "pact-protocol/demo",
      pullRequest: 81,
    });
  });

  it("supports authenticated Unicode JSON without reserialization", () => {
    const parsed = parseAuthenticatedGitHubWebhook(
      fixture(mergedPayload(',"label":"✓ 合并"')),
    );
    expect(parsed.relevant).toBe(true);
  });

  it.each([
    ["missing", { "x-hub-signature-256": undefined }, "MISSING_SIGNATURE"],
    [
      "malformed",
      { "x-hub-signature-256": "sha256=nope" },
      "MALFORMED_SIGNATURE",
    ],
    [
      "wrong",
      { "x-hub-signature-256": `sha256=${"00".repeat(32)}` },
      "INVALID_SIGNATURE",
    ],
    [
      "missing delivery",
      { "x-github-delivery": undefined },
      "MISSING_DELIVERY_ID",
    ],
    [
      "bad delivery",
      { "x-github-delivery": "not-a-uuid" },
      "MALFORMED_DELIVERY_ID",
    ],
    ["missing event", { "x-github-event": undefined }, "MISSING_EVENT"],
    [
      "wrong content type",
      { "content-type": "text/plain" },
      "UNSUPPORTED_CONTENT_TYPE",
    ],
  ] as const)("rejects %s headers", (_label, overrides, code) => {
    expect(() =>
      parseAuthenticatedGitHubWebhook(fixture(mergedPayload(), overrides)),
    ).toThrowError(expect.objectContaining({ code }));
  });

  it("rejects a body changed after signing", () => {
    const original = fixture(mergedPayload());
    expect(() =>
      parseAuthenticatedGitHubWebhook({
        ...original,
        rawBody: new TextEncoder().encode(`${mergedPayload()} `),
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_SIGNATURE" }));
  });

  it("rejects use of another secret", () => {
    expect(() =>
      parseAuthenticatedGitHubWebhook({
        ...fixture(mergedPayload()),
        secret: "different-public-test-secret-value",
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_SIGNATURE" }));
  });

  it("rejects malformed JSON only after authentication", () => {
    expect(() => parseAuthenticatedGitHubWebhook(fixture("{"))).toThrowError(
      expect.objectContaining({ code: "MALFORMED_JSON" }),
    );
  });

  it.each([
    ["push", "closed"],
    ["pull_request", "opened"],
    ["pull_request", "synchronize"],
  ])(
    "durably ignorable event/action %s/%s is not a trigger",
    (event, action) => {
      const parsed = parseAuthenticatedGitHubWebhook(
        fixture(JSON.stringify({ action }), { "x-github-event": event }),
      );
      expect(parsed).toMatchObject({ event, action, relevant: false });
      expect(parsed).not.toHaveProperty("repository");
    },
  );

  it("does not inspect or trust a merged claim", () => {
    const parsed = parseAuthenticatedGitHubWebhook(
      fixture(
        '{"action":"closed","number":81,"repository":{"full_name":"pact-protocol/demo"},"pull_request":{"merged":true}}',
      ),
    );
    expect(parsed).not.toHaveProperty("merged");
  });

  it("rejects invalid routing payloads", () => {
    expect(() =>
      parseAuthenticatedGitHubWebhook(
        fixture('{"action":"closed","number":0,"repository":{}}'),
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_PAYLOAD" }));
  });

  it("bounds declared and streamed request bodies", async () => {
    const declared = new Request("https://pact.invalid/webhook", {
      method: "POST",
      headers: {
        "content-length": String(GITHUB_WEBHOOK_BODY_LIMIT_BYTES + 1),
      },
      body: "x",
    });
    await expect(readBoundedRequestBody(declared)).rejects.toMatchObject({
      code: "BODY_TOO_LARGE",
    });

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(6));
        controller.enqueue(new Uint8Array(6));
        controller.close();
      },
    });
    const streamed = new Request("https://pact.invalid/webhook", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    await expect(readBoundedRequestBody(streamed, 10)).rejects.toBeInstanceOf(
      WebhookRequestError,
    );
  });
});
