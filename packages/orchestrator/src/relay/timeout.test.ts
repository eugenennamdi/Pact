import { describe, expect, it } from "vitest";
import {
  DEFAULT_ARC_RPC_TIMEOUT_MS,
  MAX_ARC_RPC_TIMEOUT_MS,
  createArcReadClient,
} from "../chain.js";
import {
  DEFAULT_RELAY_READ_TIMEOUT_MS,
  MAX_RELAY_READ_TIMEOUT_MS,
  RELAY_BROADCAST_TIMEOUT_MS,
  createRelayChainClient,
} from "./chain.js";

describe("bounded Arc read timeout policy", () => {
  it("uses a ten-second production default rather than five seconds", () => {
    expect(DEFAULT_ARC_RPC_TIMEOUT_MS).toBe(10_000);
    expect(DEFAULT_RELAY_READ_TIMEOUT_MS).toBe(10_000);
    expect(
      createArcReadClient({ rpcUrl: "http://127.0.0.1" }).readTimeoutMs,
    ).toBe(10_000);
    expect(
      createRelayChainClient({ rpcUrl: "http://127.0.0.1" }).readTimeoutMs,
    ).toBe(10_000);
  });

  it("honors the controlled fifteen-second read bound", () => {
    expect(
      createArcReadClient({
        rpcUrl: "http://127.0.0.1",
        timeoutMs: 15_000,
      }).readTimeoutMs,
    ).toBe(15_000);
    expect(
      createRelayChainClient({
        rpcUrl: "http://127.0.0.1",
        readTimeoutMs: 15_000,
      }).readTimeoutMs,
    ).toBe(15_000);
  });

  it("rejects read bounds above the hard thirty-second maximum", () => {
    expect(MAX_ARC_RPC_TIMEOUT_MS).toBe(30_000);
    expect(MAX_RELAY_READ_TIMEOUT_MS).toBe(30_000);
    expect(() =>
      createArcReadClient({
        rpcUrl: "http://127.0.0.1",
        timeoutMs: 30_001,
      }),
    ).toThrow("between 1 and 30000");
    expect(() =>
      createRelayChainClient({
        rpcUrl: "http://127.0.0.1",
        readTimeoutMs: 30_001,
      }),
    ).toThrow("between 1 and 30000");
  });

  it("keeps the one-shot broadcast timeout independent and unchanged", () => {
    expect(RELAY_BROADCAST_TIMEOUT_MS).toBe(5_000);
  });
});
