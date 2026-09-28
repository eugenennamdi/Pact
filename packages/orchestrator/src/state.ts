import type { OperationState } from "@pact/database";

export const operationTransitions: Readonly<
  Record<OperationState, readonly OperationState[]>
> = Object.freeze({
  PENDING: ["VERIFYING_GITHUB"],
  VERIFYING_GITHUB: [
    "NOT_SATISFIED_RETRYABLE",
    "NOT_SATISFIED_TERMINAL",
    "INDETERMINATE",
    "VERIFIED",
  ],
  NOT_SATISFIED_RETRYABLE: [],
  NOT_SATISFIED_TERMINAL: [],
  INDETERMINATE: [],
  VERIFIED: ["RECONCILING_CHAIN"],
  RECONCILING_CHAIN: [
    "CHAIN_RETRYABLE",
    "CHAIN_INVALID",
    "READY_TO_SIGN",
    "ALREADY_ACCEPTED",
    "EXPIRED",
  ],
  CHAIN_RETRYABLE: [],
  CHAIN_INVALID: [],
  READY_TO_SIGN: ["SIGNING"],
  SIGNING: ["READY_TO_RELAY", "FAILED_DEFINITE"],
  READY_TO_RELAY: [],
  ALREADY_ACCEPTED: [],
  EXPIRED: [],
  FAILED_DEFINITE: [],
});

export function assertAllowedTransition(
  from: OperationState,
  to: OperationState,
): void {
  if (!operationTransitions[from].includes(to)) {
    throw new Error(`invalid operation transition: ${from} -> ${to}`);
  }
}
