import { describe, expect, it } from "vitest";
import type { Phase4AConfig } from "@pact/orchestrator";
import {
  MANUAL_BODY_LIMIT_BYTES,
  requireEmptyJsonBody,
  requireInternalAuthorization,
} from "./http";

const config = {
  internalApiToken: "x".repeat(32),
  appOrigin: "https://pact.example",
} as Phase4AConfig;

describe("internal mutation route controls", () => {
  it("requires both bearer authorization and the trusted origin for manual actions", () => {
    const authorized = new Request("https://pact.example/api", {
      headers: {
        authorization: `Bearer ${config.internalApiToken}`,
        origin: config.appOrigin,
      },
    });
    expect(
      requireInternalAuthorization(authorized, config, true),
    ).toBeUndefined();
    expect(
      requireInternalAuthorization(
        new Request("https://pact.example/api", {
          headers: {
            authorization: `Bearer ${config.internalApiToken}`,
            origin: "https://attacker.example",
          },
        }),
        config,
        true,
      )?.status,
    ).toBe(401);
  });

  it("does not allow request bodies to inject condition, evidence, or chain context", async () => {
    await expect(
      requireEmptyJsonBody(
        new Request("https://pact.example/api", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chainId: 1, evidenceHash: "forged" }),
        }),
      ),
    ).rejects.toThrow("BODY_MUST_BE_EMPTY_OBJECT");
    await expect(
      requireEmptyJsonBody(
        new Request("https://pact.example/api", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it("bounds manual request bodies", async () => {
    await expect(
      requireEmptyJsonBody(
        new Request("https://pact.example/api", {
          method: "POST",
          body: "x".repeat(MANUAL_BODY_LIMIT_BYTES + 1),
        }),
      ),
    ).rejects.toThrow("BODY_TOO_LARGE");
  });
});
