import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import {
  authorizeDraftClient,
  authorizeDraftProvider,
  loadProductConfig,
  validateSessionSecret,
} from "./config";
import {
  ARC_MAINNET_PRODUCT_NETWORK,
  ARC_TESTNET_PRODUCT_NETWORK,
} from "./network";

const CLIENT = getAddress("0x1111111111111111111111111111111111111111");
const PROVIDER = getAddress("0x2222222222222222222222222222222222222222");

describe("product configuration and authorization", () => {
  it("loads only server-side session configuration", () => {
    const config = loadProductConfig({
      PACT_PUBLIC_ORIGIN: "https://pact.example",
      PACT_SESSION_SECRET: "k".repeat(64),
      DATABASE_URL: "postgresql://local.invalid/pact",
      PACT_PRODUCT_ARC_RPC_URL: "https://rpc.mainnet.arc.io",
      NODE_ENV: "production",
    });
    expect(config.publicOrigin.origin).toBe("https://pact.example");
    expect(config.secureCookie).toBe(true);
    expect(config.network).toBe(ARC_MAINNET_PRODUCT_NETWORK);
    expect(config.chainId).toBe(5_042);
    expect(config.selfServiceEnabled).toBe(false);
  });

  it("allows tests to select Arc Testnet explicitly", () => {
    const config = loadProductConfig(
      {
        PACT_PUBLIC_ORIGIN: "https://pact.example",
        PACT_SESSION_SECRET: "k".repeat(64),
        DATABASE_URL: "postgresql://local.invalid/pact",
        PACT_PRODUCT_ARC_RPC_URL: "https://rpc.testnet.arc.io",
      },
      ARC_TESTNET_PRODUCT_NETWORK,
    );
    expect(config.chainId).toBe(5_042_002);
    expect(config.selfServiceEnabled).toBe(true);
  });

  it("enforces session-key entropy and rejects placeholders", () => {
    expect(() => validateSessionSecret("short")).toThrow();
    expect(() =>
      validateSessionSecret(`change-me-${"x".repeat(40)}`),
    ).toThrow();
    expect(validateSessionSecret("k".repeat(64))).toHaveLength(64);
  });

  it("requires HTTPS except for localhost", () => {
    expect(() =>
      loadProductConfig({
        PACT_PUBLIC_ORIGIN: "http://pact.example",
        PACT_SESSION_SECRET: "k".repeat(64),
        DATABASE_URL: "postgresql://local.invalid/pact",
        PACT_PRODUCT_ARC_RPC_URL: "https://rpc.testnet.arc.io",
      }),
    ).toThrow("HTTPS");
  });

  it("normalizes client and provider authorization comparisons", () => {
    expect(authorizeDraftClient(CLIENT.toLowerCase(), CLIENT)).toBe(true);
    expect(authorizeDraftClient(PROVIDER, CLIENT)).toBe(false);
    expect(authorizeDraftProvider(PROVIDER.toLowerCase(), PROVIDER)).toBe(true);
    expect(authorizeDraftProvider(CLIENT, PROVIDER)).toBe(false);
  });
});
