import type { Hex } from "viem";
import { assertMainnetGate, type DeploymentManifest } from "./manifest.js";

export const MAINNET_E2E_MAX_USDC_BASE_UNITS = 100_000n;

export function parseUsdcBaseUnits(value: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value))
    throw new Error("USDC_AMOUNT_MUST_BE_BASE_UNITS");
  return BigInt(value);
}

export function assertControlledE2EAmount(
  network: "arc-testnet" | "arc-mainnet",
  amount: bigint,
): void {
  if (amount <= 0n) throw new Error("E2E_AMOUNT_MUST_BE_POSITIVE");
  if (network === "arc-mainnet" && amount > MAINNET_E2E_MAX_USDC_BASE_UNITS)
    throw new Error("MAINNET_E2E_AMOUNT_EXCEEDS_FIXED_CAP");
}

export function authorizeMainnetRun(input: {
  readonly amount: bigint;
  readonly gitCommit: string;
  readonly evaluatorCodeHash: Hex;
  readonly testnetManifest: DeploymentManifest;
}): void {
  assertControlledE2EAmount("arc-mainnet", input.amount);
  assertMainnetGate(
    input.gitCommit,
    input.evaluatorCodeHash,
    input.testnetManifest,
  );
}

export const ARC_NATIVE_TO_ERC20_SCALE = 1_000_000_000_000n;

export interface TransactionGas {
  readonly gasUsed: bigint;
  readonly effectiveGasPrice: bigint;
}

export function calculateGasFee(transaction: TransactionGas): bigint {
  if (transaction.gasUsed < 0n || transaction.effectiveGasPrice < 0n)
    throw new Error("GAS_VALUES_MUST_BE_NONNEGATIVE");
  return transaction.gasUsed * transaction.effectiveGasPrice;
}

export function arcNativeToErc20Truncated(value: bigint): bigint {
  if (value < 0n) throw new Error("ARC_NATIVE_BALANCE_MUST_BE_NONNEGATIVE");
  return value / ARC_NATIVE_TO_ERC20_SCALE;
}

export function reconcileArcNativeBalance(input: {
  readonly nativeBefore: bigint;
  readonly nativeAfter: bigint;
  readonly applicationInflows: bigint;
  readonly applicationOutflows: bigint;
  readonly gasFees: bigint;
}): void {
  const expected =
    input.nativeBefore +
    input.applicationInflows * ARC_NATIVE_TO_ERC20_SCALE -
    input.applicationOutflows * ARC_NATIVE_TO_ERC20_SCALE -
    input.gasFees;
  if (input.nativeAfter !== expected)
    throw new Error("ARC_NATIVE_NET_BALANCE_MISMATCH");
}

export interface GrossZeroFeeSettlement {
  readonly expectedBudget: bigint;
  readonly jobBudget: bigint;
  /** Cumulative claim settlement before complete(); complete pays the remainder. */
  readonly settledAmountBeforeCompletion: bigint;
  /** The pinned ERC-8183 complete() does not mutate settledAmount. */
  readonly settledAmountAfterCompletion: bigint;
  readonly jobStatus: number;
  readonly fundingTransferToEscrow: bigint;
  readonly providerPayoutFromEscrow: bigint;
  readonly treasuryApplicationTransfer: bigint;
  readonly evaluatorApplicationTransfer: bigint;
  readonly escrowBefore: bigint;
  readonly escrowAfter: bigint;
}

export function assertGrossZeroFeeSettlement(
  accounting: GrossZeroFeeSettlement,
): void {
  if (accounting.jobBudget !== accounting.expectedBudget)
    throw new Error("JOB_BUDGET_MISMATCH");
  if (
    accounting.settledAmountBeforeCompletion < 0n ||
    accounting.settledAmountBeforeCompletion > accounting.jobBudget
  )
    throw new Error("SETTLED_AMOUNT_INVALID");
  if (
    accounting.settledAmountAfterCompletion !==
    accounting.settledAmountBeforeCompletion
  )
    throw new Error("PINNED_COMPLETE_SETTLED_AMOUNT_DRIFT");
  if (accounting.jobStatus !== 3) throw new Error("JOB_NOT_COMPLETED");
  if (accounting.fundingTransferToEscrow !== accounting.expectedBudget)
    throw new Error("ESCROW_FUNDING_MISMATCH");
  const expectedPayout =
    accounting.jobBudget - accounting.settledAmountBeforeCompletion;
  if (accounting.providerPayoutFromEscrow !== expectedPayout)
    throw new Error("PROVIDER_GROSS_PAYOUT_MISMATCH");
  if (accounting.treasuryApplicationTransfer !== 0n)
    throw new Error("UNEXPECTED_PLATFORM_FEE");
  if (accounting.evaluatorApplicationTransfer !== 0n)
    throw new Error("UNEXPECTED_EVALUATOR_FEE");
  if (accounting.escrowAfter !== accounting.escrowBefore)
    throw new Error("ESCROW_NOT_CLEARED");
}
