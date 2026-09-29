import { describe, expect, it } from "vitest";
import {
  ARC_NATIVE_TO_ERC20_SCALE,
  MAINNET_E2E_MAX_USDC_BASE_UNITS,
  assertControlledE2EAmount,
  assertGrossZeroFeeSettlement,
  arcNativeToErc20Truncated,
  calculateGasFee,
  parseUsdcBaseUnits,
  reconcileArcNativeBalance,
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

  const exactSettlement = {
    expectedBudget: 100_000n,
    jobBudget: 100_000n,
    settledAmountBeforeCompletion: 0n,
    settledAmountAfterCompletion: 0n,
    jobStatus: 3,
    fundingTransferToEscrow: 100_000n,
    providerPayoutFromEscrow: 100_000n,
    treasuryApplicationTransfer: 0n,
    evaluatorApplicationTransfer: 0n,
    escrowBefore: 0n,
    escrowAfter: 0n,
  } as const;

  it("proves exact gross payout and escrow conservation", () => {
    expect(() => assertGrossZeroFeeSettlement(exactSettlement)).not.toThrow();
  });

  it("rejects gross payout drift even when a wallet delta could look plausible", () => {
    expect(() =>
      assertGrossZeroFeeSettlement({
        ...exactSettlement,
        providerPayoutFromEscrow: 99_999n,
      }),
    ).toThrow("PROVIDER_GROSS_PAYOUT_MISMATCH");
  });

  it("requires the exact canonical funding transfer", () => {
    expect(() =>
      assertGrossZeroFeeSettlement({
        ...exactSettlement,
        fundingTransferToEscrow: 99_999n,
      }),
    ).toThrow("ESCROW_FUNDING_MISMATCH");
  });

  it("keeps passive treasury and zero-fee evaluator transfers at zero", () => {
    expect(() =>
      assertGrossZeroFeeSettlement({
        ...exactSettlement,
        treasuryApplicationTransfer: 1n,
      }),
    ).toThrow("UNEXPECTED_PLATFORM_FEE");
    expect(() =>
      assertGrossZeroFeeSettlement({
        ...exactSettlement,
        evaluatorApplicationTransfer: 1n,
      }),
    ).toThrow("UNEXPECTED_EVALUATOR_FEE");
  });

  it("models pinned complete() settledAmount semantics explicitly", () => {
    expect(() =>
      assertGrossZeroFeeSettlement({
        ...exactSettlement,
        settledAmountAfterCompletion: 100_000n,
      }),
    ).toThrow("PINNED_COMPLETE_SETTLED_AMOUNT_DRIFT");
  });

  it("calculates exact 18-decimal native gas fees", () => {
    expect(calculateGasFee({ gasUsed: 21_000n, effectiveGasPrice: 7n })).toBe(
      147_000n,
    );
  });

  it("reconciles a provider gross inflow separately from gas", () => {
    expect(() =>
      reconcileArcNativeBalance({
        nativeBefore: 3_000_000n * ARC_NATIVE_TO_ERC20_SCALE,
        nativeAfter: 3_100_000n * ARC_NATIVE_TO_ERC20_SCALE - 147_000_000_000n,
        applicationInflows: 100_000n,
        applicationOutflows: 0n,
        gasFees: 147_000_000_000n,
      }),
    ).not.toThrow();
  });

  it("reconciles client funding plus gas and relay-only gas", () => {
    expect(() =>
      reconcileArcNativeBalance({
        nativeBefore: 500_000n * ARC_NATIVE_TO_ERC20_SCALE,
        nativeAfter: 400_000n * ARC_NATIVE_TO_ERC20_SCALE - 25_000_000_000n,
        applicationInflows: 0n,
        applicationOutflows: 100_000n,
        gasFees: 25_000_000_000n,
      }),
    ).not.toThrow();
    expect(() =>
      reconcileArcNativeBalance({
        nativeBefore: 1_000_000n,
        nativeAfter: 900_000n,
        applicationInflows: 0n,
        applicationOutflows: 0n,
        gasFees: 100_000n,
      }),
    ).not.toThrow();
  });

  it("does not count gas as an application transfer", () => {
    expect(() =>
      assertGrossZeroFeeSettlement({
        ...exactSettlement,
        providerPayoutFromEscrow: exactSettlement.providerPayoutFromEscrow - 1n,
      }),
    ).toThrow("PROVIDER_GROSS_PAYOUT_MISMATCH");
  });

  it("converts the shared balance view by truncating 18 to 6 decimals", () => {
    expect(arcNativeToErc20Truncated(9n * ARC_NATIVE_TO_ERC20_SCALE)).toBe(9n);
    expect(
      arcNativeToErc20Truncated(9n * ARC_NATIVE_TO_ERC20_SCALE + 999_999n),
    ).toBe(9n);
  });

  it("preserves sub-micro gas in native accounting without double-counting it", () => {
    const gas = ARC_NATIVE_TO_ERC20_SCALE - 1n;
    expect(arcNativeToErc20Truncated(gas)).toBe(0n);
    expect(() =>
      reconcileArcNativeBalance({
        nativeBefore: 2n * ARC_NATIVE_TO_ERC20_SCALE,
        nativeAfter: 2n * ARC_NATIVE_TO_ERC20_SCALE - gas,
        applicationInflows: 0n,
        applicationOutflows: 0n,
        gasFees: gas,
      }),
    ).not.toThrow();
  });
});
