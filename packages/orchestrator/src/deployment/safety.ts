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

export interface EconomicBalances {
  readonly clientBefore: bigint;
  readonly clientAfter: bigint;
  readonly providerBefore: bigint;
  readonly providerAfter: bigint;
  readonly escrowBefore: bigint;
  readonly escrowAfter: bigint;
  readonly treasuryBefore: bigint;
  readonly treasuryAfter: bigint;
  readonly evaluatorBefore: bigint;
  readonly evaluatorAfter: bigint;
}

export function assertZeroFeeEconomicAccounting(
  budget: bigint,
  b: EconomicBalances,
): void {
  if (b.clientBefore - b.clientAfter !== budget)
    throw new Error("CLIENT_DELTA_MISMATCH");
  if (b.providerAfter - b.providerBefore !== budget)
    throw new Error("PROVIDER_DELTA_MISMATCH");
  if (b.escrowAfter !== b.escrowBefore) throw new Error("ESCROW_NOT_CLEARED");
  if (b.treasuryAfter !== b.treasuryBefore)
    throw new Error("UNEXPECTED_PLATFORM_FEE");
  if (b.evaluatorAfter !== b.evaluatorBefore)
    throw new Error("UNEXPECTED_EVALUATOR_FEE");
}
