import { describe, expect, it, vi } from "vitest";
import { webHealthResponse } from "../app/api/health/route";
import { checkWebReadiness } from "./deployment-health";

const validEnvironment = Object.freeze({
  PACT_PUBLIC_ORIGIN: "https://pact.example",
  PACT_SESSION_SECRET: "a-valid-production-session-secret-with-32-bytes",
  DATABASE_URL: "postgresql://pact:secret@database.internal:5432/pact",
  PACT_PRODUCT_ARC_RPC_URL: "https://rpc.testnet.arc.network",
});

describe("web deployment readiness", () => {
  it("reports ready when configuration and database are ready", async () => {
    await expect(
      checkWebReadiness({
        environment: validEnvironment,
        databaseProbe: vi.fn(async () => undefined),
      }),
    ).resolves.toEqual({ ready: true });
  });

  it("reports database unavailable without returning credentials", async () => {
    const result = await checkWebReadiness({
      environment: validEnvironment,
      databaseProbe: vi.fn(async () => {
        throw new Error(`cannot connect to ${validEnvironment.DATABASE_URL}`);
      }),
    });
    expect(result).toEqual({ ready: false, reason: "DATABASE_UNAVAILABLE" });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("reports invalid configuration without returning secret values", async () => {
    const result = await checkWebReadiness({
      environment: { ...validEnvironment, PACT_SESSION_SECRET: "short" },
    });
    expect(result).toEqual({ ready: false, reason: "CONFIG_INVALID" });
    expect(JSON.stringify(result).length).toBeLessThan(80);
  });

  it("returns bounded public JSON without dependency details", async () => {
    const response = webHealthResponse({
      ready: false,
      reason: "DATABASE_UNAVAILABLE",
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "not_ready" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
