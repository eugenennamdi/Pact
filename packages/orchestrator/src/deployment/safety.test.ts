import { describe, expect, it } from "vitest";
import {
  MAINNET_E2E_MAX_USDC_BASE_UNITS,
  assertControlledE2EAmount,
  assertZeroFeeEconomicAccounting,
  parseUsdcBaseUnits,
} from "./safety.js";

describe("controlled deployment safety", () => {
  it("uses integer six-decimal USDC base units only", () => {
    expect(parseUsdcBaseUnits("100000")).toBe(100_000n);
    expect(() => parseUsdcBaseUnits("0.1")).toThrow(
      "USDC_AMOUNT_MUST_BE_BASE_UNITS",
    );
    expect(() => parseUsdcBaseUnits("01")).toThrow(
      "USDC_AMOUNT_MUST_BE_BASE_UNITS",
    );
  });

  it("enforces the hard 0.10 USDC mainnet ceiling", () => {
    expect(() =>
      assertControlledE2EAmount("arc-mainnet", MAINNET_E2E_MAX_USDC_BASE_UNITS),
    ).not.toThrow();
    expect(() =>
      assertControlledE2EAmount(
        "arc-mainnet",
        MAINNET_E2E_MAX_USDC_BASE_UNITS + 1n,
      ),
    ).toThrow("MAINNET_E2E_AMOUNT_EXCEEDS_FIXED_CAP");
  });

  it("proves exact zero-fee settlement accounting", () => {
    expect(() =>
      assertZeroFeeEconomicAccounting(100_000n, {
        clientBefore: 500_000n,
        clientAfter: 400_000n,
        providerBefore: 2n,
        providerAfter: 100_002n,
        escrowBefore: 0n,
        escrowAfter: 0n,
        treasuryBefore: 7n,
        treasuryAfter: 7n,
        evaluatorBefore: 9n,
        evaluatorAfter: 9n,
      }),
    ).not.toThrow();
  });
});
