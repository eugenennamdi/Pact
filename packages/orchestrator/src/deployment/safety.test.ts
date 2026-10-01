import { describe, expect, it } from "vitest";
import {
  ARC_NATIVE_TO_ERC20_SCALE,
  MAINNET_REHEARSAL_COMPLETION_OFFSET_SECONDS,
  MAINNET_REHEARSAL_EXPIRY_OFFSET_SECONDS,
  MAINNET_E2E_MAX_USDC_BASE_UNITS,
  TESTNET_REHEARSAL_COMPLETION_OFFSET_SECONDS,
  TESTNET_REHEARSAL_EXPIRY_OFFSET_SECONDS,
  assertControlledE2EAmount,
  assertGrossZeroFeeSettlement,
  assertRemainingRunAffordability,
  arcNativeToErc20Truncated,
  calculateGasFee,
  calculateRemainingRunAffordability,
  controlledE2EWindow,
  controlledE2EOperationTrigger,
  controlledGasLimit,
  controlledPlanningGasPrice,
  parseUsdcBaseUnits,
  reconcileArcNativeBalance,
} from "./safety.js";

describe("controlled deployment safety", () => {
  it("uses an explicit bounded scope for semantically distinct durable operations", () => {
    const input = {
      jobKey: `0x${"12".repeat(32)}` as const,
      runtimeCommit: "ab".repeat(20),
    };
    const beforeMerge = controlledE2EOperationTrigger({
      ...input,
      scope: "github-pr-open",
    });
    expect(beforeMerge).toHaveLength(73);
    expect(
      controlledE2EOperationTrigger({ ...input, scope: "github-pr-open" }),
    ).toBe(beforeMerge);
    expect(
      controlledE2EOperationTrigger({
        ...input,
        scope: `github-merge:${"cd".repeat(20)}`,
      }),
    ).not.toBe(beforeMerge);
    expect(() =>
      controlledE2EOperationTrigger({ ...input, scope: " " }),
    ).toThrow("E2E_OPERATION_SCOPE_INVALID");
  });

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

  it("gives the controlled Testnet rehearsal a two-hour condition and four-hour relay margin", () => {
    const now = 1_800_000_000n;
    const window = controlledE2EWindow("arc-testnet", now);
    expect(TESTNET_REHEARSAL_COMPLETION_OFFSET_SECONDS).toBe(7_200n);
    expect(TESTNET_REHEARSAL_EXPIRY_OFFSET_SECONDS).toBe(21_600n);
    expect(window.completionDeadline).toBe(now + 7_200n);
    expect(window.expiredAt).toBe(window.completionDeadline + 14_400n);
    expect(window.expiredAt - now).toBeLessThanOrEqual(24n * 60n * 60n);
  });

  it("selects the reviewed six-hour/24-hour Mainnet window", () => {
    const now = 1_800_000_000n;
    const window = controlledE2EWindow("arc-mainnet", now);
    expect(MAINNET_REHEARSAL_COMPLETION_OFFSET_SECONDS).toBe(21_600n);
    expect(MAINNET_REHEARSAL_EXPIRY_OFFSET_SECONDS).toBe(86_400n);
    expect(window.completionDeadline).toBe(now + 21_600n);
    expect(window.expiredAt).toBe(now + 86_400n);
    expect(window.completionDeadline).toBeLessThan(window.expiredAt);
  });

  it("fails closed for unknown networks and uint48 boundary overflow", () => {
    expect(() => controlledE2EWindow("unknown", 1_800_000_000n)).toThrow(
      "E2E_DEADLINE_NETWORK_UNSUPPORTED",
    );
    expect(() => controlledE2EWindow("arc-mainnet", (1n << 48n) - 1n)).toThrow(
      "E2E_DEADLINE_WINDOW_INVALID",
    );
  });

  it("does not expose a caller-controlled deadline override", () => {
    expect(controlledE2EWindow.length).toBe(2);
    const now = 1_800_000_000n;
    expect(controlledE2EWindow("arc-testnet", now)).toEqual({
      completionDeadline: now + 7_200n,
      expiredAt: now + 21_600n,
    });
  });

  it("derives binding-safe deadlines only from the supplied chain time", () => {
    const firstBlockTime = 1_800_000_000n;
    const laterBlockTime = firstBlockTime + 37n;
    const first = controlledE2EWindow("arc-testnet", firstBlockTime);
    const later = controlledE2EWindow("arc-testnet", laterBlockTime);
    expect(first.completionDeadline).toBeGreaterThan(firstBlockTime);
    expect(first.completionDeadline).toBeLessThan(first.expiredAt);
    expect(later.completionDeadline - first.completionDeadline).toBe(37n);
    expect(later.expiredAt - first.expiredAt).toBe(37n);
  });

  it("enforces remaining-run affordability at and below the exact boundary", () => {
    const plan = calculateRemainingRunAffordability({
      senderBalance: 1_000_000_000_000_000_000n,
      observedGasPrice: 20_000_000_000n,
      steps: ["e2e-create-job", "e2e-fund"],
      applicationReserveBaseUnits: 100_000n,
    });
    expect(() =>
      assertRemainingRunAffordability({
        senderBalance: plan.totalRequirement,
        observedGasPrice: 20_000_000_000n,
        steps: ["e2e-create-job", "e2e-fund"],
        applicationReserveBaseUnits: 100_000n,
      }),
    ).not.toThrow();
    expect(() =>
      assertRemainingRunAffordability({
        senderBalance: plan.totalRequirement - 1n,
        observedGasPrice: 20_000_000_000n,
        steps: ["e2e-create-job", "e2e-fund"],
        applicationReserveBaseUnits: 100_000n,
      }),
    ).toThrow("FUNDING_INSUFFICIENT_FOR_REMAINING_RUN");
  });

  it("recomputes reserves after gas consumption and fee spikes", () => {
    const steps = ["e2e-approve-usdc", "e2e-fund"] as const;
    const initial = calculateRemainingRunAffordability({
      senderBalance: 500_000n * ARC_NATIVE_TO_ERC20_SCALE,
      observedGasPrice: 20_000_000_000n,
      steps,
      applicationReserveBaseUnits: 100_000n,
    });
    const laterBalance = initial.totalRequirement;
    expect(() =>
      assertRemainingRunAffordability({
        senderBalance: laterBalance,
        observedGasPrice: 40_000_000_000n,
        steps,
        applicationReserveBaseUnits: 100_000n,
      }),
    ).toThrow("FUNDING_INSUFFICIENT_FOR_REMAINING_RUN");
  });

  it("reduces the available reserve after earlier gas is consumed", () => {
    const gasPrice = 20_000_000_000n;
    const before = calculateRemainingRunAffordability({
      senderBalance: 1_000_000_000_000_000_000n,
      observedGasPrice: gasPrice,
      steps: ["e2e-approve-usdc", "e2e-fund"],
      applicationReserveBaseUnits: 1_000n,
    });
    const earlierGas =
      controlledGasLimit("e2e-approve-usdc") *
      controlledPlanningGasPrice(gasPrice);
    const laterBalance = before.totalRequirement - earlierGas;
    expect(() =>
      assertRemainingRunAffordability({
        senderBalance: laterBalance,
        observedGasPrice: gasPrice,
        steps: ["e2e-fund"],
        applicationReserveBaseUnits: 1_000n,
      }),
    ).not.toThrow();
  });

  it("reserves application value only until funding and keeps senders separate", () => {
    const beforeFunding = calculateRemainingRunAffordability({
      senderBalance: 1_000_000_000_000_000_000n,
      observedGasPrice: 20_000_000_000n,
      steps: ["e2e-fund"],
      applicationReserveBaseUnits: 1_000n,
    });
    const afterFunding = calculateRemainingRunAffordability({
      senderBalance: 1_000_000_000_000_000_000n,
      observedGasPrice: 20_000_000_000n,
      steps: [],
    });
    const provider = calculateRemainingRunAffordability({
      senderBalance: 1_000_000_000_000_000_000n,
      observedGasPrice: 20_000_000_000n,
      steps: ["e2e-set-budget", "e2e-submit"],
    });
    const relay = calculateRemainingRunAffordability({
      senderBalance: 1_000_000_000_000_000_000n,
      observedGasPrice: 20_000_000_000n,
      steps: ["e2e-settle"],
    });
    expect(beforeFunding.applicationReserveNative).toBe(
      1_000n * ARC_NATIVE_TO_ERC20_SCALE,
    );
    expect(afterFunding.applicationReserveNative).toBe(0n);
    expect(provider.steps).toEqual(["e2e-set-budget", "e2e-submit"]);
    expect(relay.steps).toEqual(["e2e-settle"]);
    for (const passiveRole of ["treasury", "verifier"]) {
      const passive = calculateRemainingRunAffordability({
        senderBalance: 0n,
        observedGasPrice: 20_000_000_000n,
        steps: [],
      });
      expect(passive.totalRequirement, passiveRole).toBe(0n);
    }
  });

  it("stops before a signing callback after an affordability failure", () => {
    let signed = false;
    expect(() => {
      assertRemainingRunAffordability({
        senderBalance: 0n,
        observedGasPrice: 20_000_000_000n,
        steps: ["e2e-settle"],
      });
      signed = true;
    }).toThrow("FUNDING_INSUFFICIENT_FOR_REMAINING_RUN");
    expect(signed).toBe(false);
  });

  it("converts the application reserve once without double-counting its six-decimal view", () => {
    const plan = calculateRemainingRunAffordability({
      senderBalance: 1_000_000_000_000_000_000n,
      observedGasPrice: 1n,
      steps: [],
      applicationReserveBaseUnits: 100_000n,
    });
    expect(plan.applicationReserveNative).toBe(
      100_000n * ARC_NATIVE_TO_ERC20_SCALE,
    );
    expect(plan.totalRequirement).toBe(plan.applicationReserveNative);
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
