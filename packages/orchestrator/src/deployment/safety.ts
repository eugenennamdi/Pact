import { keccak256, stringToHex, type Hex } from "viem";
import { assertMainnetGate, type DeploymentManifest } from "./manifest.js";

export const MAINNET_E2E_MAX_USDC_BASE_UNITS = 100_000n;
export const TESTNET_REHEARSAL_COMPLETION_OFFSET_SECONDS = 2n * 60n * 60n;
export const TESTNET_REHEARSAL_EXPIRY_OFFSET_SECONDS = 6n * 60n * 60n;
export const MAINNET_REHEARSAL_COMPLETION_OFFSET_SECONDS = 6n * 60n * 60n;
export const MAINNET_REHEARSAL_EXPIRY_OFFSET_SECONDS = 24n * 60n * 60n;
export const CONTROLLED_GAS_LIMIT_MARGIN_NUMERATOR = 125n;
export const CONTROLLED_GAS_LIMIT_MARGIN_DENOMINATOR = 100n;
export const CONTROLLED_FEE_PRICE_MARGIN_NUMERATOR = 150n;
export const CONTROLLED_FEE_PRICE_MARGIN_DENOMINATOR = 100n;

export const controlledGasUnits = Object.freeze({
  "deployment-implementation": 4_612_277n,
  "deployment-proxy": 294_566n,
  "deployment-allow-usdc": 52_803n,
  "deployment-evaluator": 1_811_230n,
  "e2e-create-job": 190_065n,
  "e2e-bind-condition": 112_645n,
  "e2e-approve-usdc": 55_426n,
  "e2e-fund": 82_229n,
  "e2e-set-budget": 90_240n,
  "e2e-submit": 51_922n,
  "e2e-settle": 166_071n,
} as const);

export type ControlledFinancialStep = keyof typeof controlledGasUnits;

export interface RemainingRunAffordability {
  readonly senderBalance: bigint;
  readonly observedGasPrice: bigint;
  readonly planningGasPrice: bigint;
  readonly steps: readonly ControlledFinancialStep[];
  readonly gasRequirement: bigint;
  readonly applicationReserveBaseUnits: bigint;
  readonly applicationReserveNative: bigint;
  readonly totalRequirement: bigint;
  readonly surplus: bigint;
}

function ceilDiv(value: bigint, denominator: bigint): bigint {
  if (value < 0n || denominator <= 0n)
    throw new Error("AFFORDABILITY_ARITHMETIC_INVALID");
  return (value + denominator - 1n) / denominator;
}

export function controlledGasLimit(step: ControlledFinancialStep): bigint {
  return ceilDiv(
    controlledGasUnits[step] * CONTROLLED_GAS_LIMIT_MARGIN_NUMERATOR,
    CONTROLLED_GAS_LIMIT_MARGIN_DENOMINATOR,
  );
}

export function controlledPlanningGasPrice(observedGasPrice: bigint): bigint {
  return ceilDiv(
    observedGasPrice * CONTROLLED_FEE_PRICE_MARGIN_NUMERATOR,
    CONTROLLED_FEE_PRICE_MARGIN_DENOMINATOR,
  );
}

export function calculateRemainingRunAffordability(input: {
  readonly senderBalance: bigint;
  readonly observedGasPrice: bigint;
  readonly steps: readonly ControlledFinancialStep[];
  readonly applicationReserveBaseUnits?: bigint;
}): RemainingRunAffordability {
  if (input.senderBalance < 0n || input.observedGasPrice <= 0n)
    throw new Error("AFFORDABILITY_INPUT_INVALID");
  const applicationReserveBaseUnits = input.applicationReserveBaseUnits ?? 0n;
  if (applicationReserveBaseUnits < 0n)
    throw new Error("AFFORDABILITY_INPUT_INVALID");
  const planningGasPrice = controlledPlanningGasPrice(input.observedGasPrice);
  const gasRequirement = input.steps.reduce(
    (total, step) => total + controlledGasLimit(step) * planningGasPrice,
    0n,
  );
  const applicationReserveNative =
    applicationReserveBaseUnits * ARC_NATIVE_TO_ERC20_SCALE;
  const totalRequirement = gasRequirement + applicationReserveNative;
  return Object.freeze({
    senderBalance: input.senderBalance,
    observedGasPrice: input.observedGasPrice,
    planningGasPrice,
    steps: Object.freeze([...input.steps]),
    gasRequirement,
    applicationReserveBaseUnits,
    applicationReserveNative,
    totalRequirement,
    surplus: input.senderBalance - totalRequirement,
  });
}

export function assertRemainingRunAffordability(input: {
  readonly senderBalance: bigint;
  readonly observedGasPrice: bigint;
  readonly steps: readonly ControlledFinancialStep[];
  readonly applicationReserveBaseUnits?: bigint;
}): RemainingRunAffordability {
  const result = calculateRemainingRunAffordability(input);
  if (result.senderBalance < result.totalRequirement)
    throw new Error("FUNDING_INSUFFICIENT_FOR_REMAINING_RUN");
  return result;
}

export function controlledE2EOperationTrigger(input: {
  readonly jobKey: Hex;
  readonly runtimeCommit: string;
  readonly scope: string;
}): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.jobKey))
    throw new Error("E2E_JOB_KEY_INVALID");
  if (!/^[0-9a-f]{40}$/.test(input.runtimeCommit))
    throw new Error("E2E_RUNTIME_COMMIT_INVALID");
  const scope = input.scope.trim();
  if (scope.length === 0 || scope.length > 160)
    throw new Error("E2E_OPERATION_SCOPE_INVALID");
  const digest = keccak256(
    stringToHex(
      JSON.stringify([input.jobKey.toLowerCase(), input.runtimeCommit, scope]),
    ),
  );
  return `phase5:${digest}`;
}

export function controlledE2EWindow(
  network: string,
  now: bigint,
): { readonly completionDeadline: bigint; readonly expiredAt: bigint } {
  if (now < 0n || now > (1n << 48n) - 1n)
    throw new Error("E2E_CHAIN_TIME_INVALID");
  let completionOffset: bigint;
  let expiryOffset: bigint;
  if (network === "arc-testnet") {
    completionOffset = TESTNET_REHEARSAL_COMPLETION_OFFSET_SECONDS;
    expiryOffset = TESTNET_REHEARSAL_EXPIRY_OFFSET_SECONDS;
  } else if (network === "arc-mainnet") {
    completionOffset = MAINNET_REHEARSAL_COMPLETION_OFFSET_SECONDS;
    expiryOffset = MAINNET_REHEARSAL_EXPIRY_OFFSET_SECONDS;
  } else {
    throw new Error("E2E_DEADLINE_NETWORK_UNSUPPORTED");
  }
  const completionDeadline = now + completionOffset;
  const expiredAt = now + expiryOffset;
  if (
    completionDeadline > (1n << 48n) - 1n ||
    expiredAt > (1n << 48n) - 1n ||
    now >= completionDeadline ||
    completionDeadline >= expiredAt
  )
    throw new Error("E2E_DEADLINE_WINDOW_INVALID");
  return Object.freeze({
    completionDeadline,
    expiredAt,
  });
}

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
