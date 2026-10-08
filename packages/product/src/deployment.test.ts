import { describe, expect, it } from "vitest";
import { loadCertifiedProductDeployment } from "./deployment";
import {
  ARC_MAINNET_PRODUCT_NETWORK,
  ARC_TESTNET_PRODUCT_NETWORK,
} from "./network";

describe("certified product deployment resolution", () => {
  it("resolves the reviewed Arc Mainnet deployment by default", () => {
    expect(loadCertifiedProductDeployment()).toMatchObject({
      network: "arc-mainnet",
      chainId: 5_042n,
      commerce: "0x9Da745D2A6e03b049bdAE5aE7a193f1B00E520d6",
      evaluator: "0x3fd3AC5bE6eE41DcD11233833DCD96c21F3b1129",
      usdc: "0x3600000000000000000000000000000000000000",
      verifier: "0x8660A25bf52D24EbD1C4DFcF602840114b92c48d",
    });
  });

  it("resolves the existing Arc Testnet deployment explicitly", () => {
    expect(
      loadCertifiedProductDeployment(ARC_TESTNET_PRODUCT_NETWORK),
    ).toMatchObject({
      network: "arc-testnet",
      chainId: 5_042_002n,
      commerce: "0x803c90536c0258f4882f62B7e672223331423Dae",
      evaluator: "0xEbF707589fa4dC68A2D5fFCf61D6362382853916",
      usdc: "0x3600000000000000000000000000000000000000",
      verifier: "0x72DA36d41D7C81785aD026F724FD93Db65f830A9",
    });
  });

  it("fails closed for a mismatched network identity", () => {
    expect(() =>
      loadCertifiedProductDeployment({
        ...ARC_MAINNET_PRODUCT_NETWORK,
        chainId: ARC_TESTNET_PRODUCT_NETWORK.chainId,
      }),
    ).toThrow("PRODUCT_DEPLOYMENT_IDENTITY_MISMATCH");
  });
});
