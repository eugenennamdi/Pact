import { once } from "node:events";
import type { Address } from "viem";
import { describe, expect, it } from "vitest";
import {
  createWorkerHealth,
  loadWorkerHealthPort,
  startWorkerHealthServer,
} from "./health";
import {
  PROVEN_SETTLEMENT_GAS_UNITS,
  RELAY_GAS_MARGIN_DENOMINATOR,
  RELAY_GAS_MARGIN_NUMERATOR,
} from "./readiness";

const SIGNER = "0x1111111111111111111111111111111111111111" as Address;
const OTHER = "0x2222222222222222222222222222222222222222" as Address;
let currentTime = new Date("2026-10-06T12:00:00.000Z");

function verifier(expectedSignerAddress: Address = SIGNER) {
  const health = createWorkerHealth({
    role: "verifier",
    signerAddress: SIGNER,
    expectedSignerAddress,
    includesGithub: true,
    staleAfterMs: 60_000,
    now: () => currentTime,
  });
  health.database(true);
  health.arcRpc(true);
  health.github(true);
  health.loopSucceeded("IDLE");
  return health;
}

function relay(expectedSignerAddress: Address = SIGNER) {
  const health = createWorkerHealth({
    role: "relay",
    signerAddress: SIGNER,
    expectedSignerAddress,
    includesGithub: false,
    staleAfterMs: 30_000,
    now: () => currentTime,
  });
  health.database(true);
  health.arcRpc(true);
  health.relayBalance({
    balance: 10_000n,
    required: 9_000n,
    unresolvedBroadcastUnknown: 0,
  });
  health.loopSucceeded("IDLE");
  return health;
}

describe("verifier readiness", () => {
  it("is ready only after a healthy loop", () => {
    expect(verifier().read().ready).toBe(true);
  });

  it("rejects a signer mismatch", () => {
    expect(verifier(OTHER).read()).toMatchObject({
      ready: false,
      signerIdentity: "FAILED",
    });
  });

  it("degrades when the database is unavailable", () => {
    const health = verifier();
    health.database(false);
    expect(health.read().ready).toBe(false);
  });

  it("degrades when Arc RPC is unavailable", () => {
    const health = verifier();
    health.arcRpc(false);
    expect(health.read().ready).toBe(false);
  });

  it("degrades when GitHub is unavailable", () => {
    const health = verifier();
    health.github(false);
    expect(health.read().ready).toBe(false);
  });

  it("degrades when the successful loop is stale", () => {
    const health = verifier();
    currentTime = new Date("2026-10-06T12:02:00.000Z");
    expect(health.read()).toMatchObject({ ready: false, stale: true });
    currentTime = new Date("2026-10-06T12:00:00.000Z");
  });
});

describe("relay readiness", () => {
  it("is ready with exact signer, dependencies, and sufficient gas", () => {
    expect(relay().read().ready).toBe(true);
  });

  it("rejects a signer mismatch", () => {
    expect(relay(OTHER).read().ready).toBe(false);
  });

  it("degrades when the database is unavailable", () => {
    const health = relay();
    health.database(false);
    expect(health.read().ready).toBe(false);
  });

  it("degrades when Arc RPC is unavailable", () => {
    const health = relay();
    health.arcRpc(false);
    expect(health.read().ready).toBe(false);
  });

  it("degrades below the conservative relay balance", () => {
    const health = relay();
    health.relayBalance({
      balance: 8_999n,
      required: 9_000n,
      unresolvedBroadcastUnknown: 1,
    });
    expect(health.read()).toMatchObject({
      ready: false,
      relayBalance: "FAILED",
      unresolvedBroadcastUnknown: 1,
    });
  });

  it("degrades when its successful loop is stale", () => {
    const health = relay();
    currentTime = new Date("2026-10-06T12:00:31.000Z");
    expect(health.read()).toMatchObject({ ready: false, stale: true });
    currentTime = new Date("2026-10-06T12:00:00.000Z");
  });
});

describe("health endpoint security and Railway binding", () => {
  it("returns a bounded response without operational details", async () => {
    const server = await startWorkerHealthServer(relay(), 0, "127.0.0.1");
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("health server did not bind TCP");
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toBe('{"status":"ready","role":"relay"}');
    expect(body.length).toBeLessThan(80);
    server.close();
    await once(server, "close");
  });

  it("accepts Railway PORT and rejects unsafe values", () => {
    expect(loadWorkerHealthPort({ PORT: "4317" })).toBe(4317);
    expect(() => loadWorkerHealthPort({ PORT: "0" })).toThrow(
      "PORT is invalid",
    );
    expect(() => loadWorkerHealthPort({ PORT: "secret" })).toThrow(
      "PORT is invalid",
    );
  });

  it("uses the proven settlement gas with the existing safe margin", () => {
    const gas =
      (PROVEN_SETTLEMENT_GAS_UNITS * RELAY_GAS_MARGIN_NUMERATOR +
        RELAY_GAS_MARGIN_DENOMINATOR -
        1n) /
      RELAY_GAS_MARGIN_DENOMINATOR;
    expect(gas).toBe(182_679n);
  });
});
