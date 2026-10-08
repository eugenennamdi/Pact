import { describe, expect, it } from "vitest";
import {
  ARC_MAINNET_PRODUCT_NETWORK,
  ARC_TESTNET_PRODUCT_NETWORK,
  DEFAULT_PRODUCT_NETWORK,
  MAINNET_SELF_SERVICE_ENABLED,
  getProductNetwork,
  isProductSelfServiceEnabled,
} from "./network";

describe("product network configuration", () => {
  it("defaults production to the exact Arc Mainnet identity", () => {
    expect(DEFAULT_PRODUCT_NETWORK).toBe(ARC_MAINNET_PRODUCT_NETWORK);
    expect(DEFAULT_PRODUCT_NETWORK).toMatchObject({
      id: "arc-mainnet",
      displayName: "Arc Mainnet",
      chainId: 5_042n,
      chainIdNumber: 5_042,
      hexChainId: "0x13b2",
      rpcEnvironmentKey: "PACT_PRODUCT_ARC_RPC_URL",
      usdcAddress: "0x3600000000000000000000000000000000000000",
    });
  });

  it("preserves explicit Arc Testnet configuration", () => {
    expect(getProductNetwork("arc-testnet")).toBe(ARC_TESTNET_PRODUCT_NETWORK);
    expect(ARC_TESTNET_PRODUCT_NETWORK).toMatchObject({
      chainId: 5_042_002n,
      chainIdNumber: 5_042_002,
      hexChainId: "0x4cef52",
    });
  });

  it("keeps Mainnet self-service disabled without an environment bypass", () => {
    expect(MAINNET_SELF_SERVICE_ENABLED).toBe(false);
    expect(isProductSelfServiceEnabled(ARC_MAINNET_PRODUCT_NETWORK)).toBe(
      false,
    );
    expect(isProductSelfServiceEnabled(ARC_TESTNET_PRODUCT_NETWORK)).toBe(true);
  });
});
