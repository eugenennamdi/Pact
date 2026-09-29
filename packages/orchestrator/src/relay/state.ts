import type { RelayState } from "@pact/database";

export const relayTransitions: Readonly<
  Record<RelayState, readonly RelayState[]>
> = Object.freeze({
  PREPARING: [
    "SIGNED",
    "EXPIRED_UNSENT",
    "PRECONDITION_FAILED",
    "INTEGRITY_FAILURE",
    "INSUFFICIENT_RELAY_GAS",
    "SETTLED_EXTERNALLY",
    "COMPLETED_BY_DIFFERENT_ATTESTATION",
  ],
  SIGNED: [
    "DISPATCHING",
    "EXPIRED_UNSENT",
    "PRECONDITION_FAILED",
    "INTEGRITY_FAILURE",
    "SETTLED_EXTERNALLY",
    "COMPLETED_BY_DIFFERENT_ATTESTATION",
  ],
  DISPATCHING: ["SUBMITTED", "BROADCAST_UNKNOWN", "INTEGRITY_FAILURE"],
  SUBMITTED: [
    "SETTLED",
    "SETTLED_EXTERNALLY",
    "COMPLETED_BY_DIFFERENT_ATTESTATION",
    "REVERTED",
    "INTEGRITY_FAILURE",
  ],
  BROADCAST_UNKNOWN: [
    "SETTLED",
    "SETTLED_EXTERNALLY",
    "COMPLETED_BY_DIFFERENT_ATTESTATION",
    "REVERTED",
    "INTEGRITY_FAILURE",
    "BROADCAST_UNKNOWN",
  ],
  SETTLED: [],
  SETTLED_EXTERNALLY: [],
  COMPLETED_BY_DIFFERENT_ATTESTATION: [],
  REVERTED: [],
  INTEGRITY_FAILURE: [],
  EXPIRED_UNSENT: [],
  PRECONDITION_FAILED: [],
  NONCE_DRIFT: [],
  INSUFFICIENT_RELAY_GAS: [],
});

export function assertRelayTransition(from: RelayState, to: RelayState): void {
  if (!relayTransitions[from].includes(to))
    throw new Error(`invalid relay transition: ${from} -> ${to}`);
}
