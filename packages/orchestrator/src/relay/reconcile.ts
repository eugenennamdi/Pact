import type {
  CanonicalRelayOutcome,
  ReadyToRelayArtifact,
  RelayIntentRecord,
  RelayState,
} from "@pact/database";
import { getAddress, type Address } from "viem";
import type {
  RelayCompletionEvent,
  RelayPreflight,
  RelayReceiptObservation,
} from "./chain.js";
import { assertRelayArtifactIntegrity } from "./signer.js";

const SUBMITTED = 2;
const COMPLETED = 3;

export type RelayPreflightDecision =
  | { readonly kind: "READY" }
  | {
      readonly kind: "TERMINAL";
      readonly state:
        | "SETTLED_EXTERNALLY"
        | "COMPLETED_BY_DIFFERENT_ATTESTATION"
        | "INTEGRITY_FAILURE"
        | "EXPIRED_UNSENT"
        | "PRECONDITION_FAILED";
      readonly code: string;
      readonly outcome?: CanonicalRelayOutcome;
    };

function eventOutcome(
  event: RelayCompletionEvent,
  receipt?: RelayReceiptObservation["receipt"],
): CanonicalRelayOutcome {
  return Object.freeze({
    canonicalTxHash: event.transactionHash,
    ...(receipt === undefined
      ? {}
      : {
          receiptStatus: receipt.status,
          receiptBlockNumber: receipt.blockNumber,
          receiptBlockHash: receipt.blockHash,
          receiptTransactionIndex: receipt.transactionIndex,
        }),
    eventBlockNumber: event.blockNumber,
    eventBlockHash: event.blockHash,
    eventLogIndex: event.logIndex,
    eventRelayer: event.relayer,
    eventVerifier: event.verifier,
  });
}

function matchesArtifact(
  event: RelayCompletionEvent,
  artifact: ReadyToRelayArtifact,
): boolean {
  return (
    event.jobKey === artifact.pact.jobKey &&
    event.jobId === artifact.pact.jobId &&
    event.evidenceHash === artifact.attestation.evidenceHash &&
    event.conditionHash === artifact.attestation.conditionHash &&
    event.attestationDigest === artifact.attestation.digest &&
    getAddress(event.verifier) === getAddress(artifact.attestation.signer)
  );
}

function canonicalEvent(
  events: readonly RelayCompletionEvent[],
): RelayCompletionEvent | undefined {
  return events.at(-1);
}

export function decideRelayPreflight(input: {
  readonly artifact: ReadyToRelayArtifact;
  readonly preflight: RelayPreflight;
  readonly configuredChainId: bigint;
  readonly configuredPactEvaluator: Address;
  readonly configuredCommerceContract: Address;
}): RelayPreflightDecision {
  try {
    assertRelayArtifactIntegrity(input.artifact);
  } catch {
    return {
      kind: "TERMINAL",
      state: "INTEGRITY_FAILURE",
      code: "READY_TO_RELAY_INTEGRITY_MISMATCH",
    };
  }
  const { artifact, preflight } = input;
  const { pact, attestation } = artifact;
  const snapshot = preflight.snapshot;
  if (
    pact.chainId !== input.configuredChainId ||
    snapshot.chainId !== input.configuredChainId
  )
    return {
      kind: "TERMINAL",
      state: "PRECONDITION_FAILED",
      code: "RPC_CHAIN_ID_MISMATCH",
    };
  if (
    getAddress(pact.pactEvaluator) !==
      getAddress(input.configuredPactEvaluator) ||
    getAddress(snapshot.pactEvaluator) !==
      getAddress(input.configuredPactEvaluator)
  )
    return {
      kind: "TERMINAL",
      state: "PRECONDITION_FAILED",
      code: "PACT_EVALUATOR_MISMATCH",
    };
  if (
    getAddress(pact.commerceContract) !==
      getAddress(input.configuredCommerceContract) ||
    getAddress(snapshot.commerceContract) !==
      getAddress(input.configuredCommerceContract)
  )
    return {
      kind: "TERMINAL",
      state: "PRECONDITION_FAILED",
      code: "COMMERCE_TARGET_MISMATCH",
    };
  if (
    snapshot.jobKey !== pact.jobKey ||
    !snapshot.bindingExists ||
    snapshot.bindingConditionHash !== pact.conditionHash ||
    snapshot.bindingCompletionDeadline !== pact.completionDeadline ||
    getAddress(snapshot.bindingVerifier) !== getAddress(attestation.signer) ||
    snapshot.verifierRevoked ||
    getAddress(snapshot.jobEvaluator) !== getAddress(pact.pactEvaluator)
  )
    return {
      kind: "TERMINAL",
      state: "PRECONDITION_FAILED",
      code: "CHAIN_PRECONDITION_MISMATCH",
    };

  if (snapshot.bindingAccepted) {
    const event = canonicalEvent(preflight.completionEvents);
    if (event === undefined || snapshot.jobStatus !== COMPLETED)
      return {
        kind: "TERMINAL",
        state: "INTEGRITY_FAILURE",
        code: "ACCEPTED_STATE_WITHOUT_CANONICAL_EVENT",
      };
    if (!matchesArtifact(event, artifact))
      return {
        kind: "TERMINAL",
        state: "COMPLETED_BY_DIFFERENT_ATTESTATION",
        code: "DIFFERENT_ATTESTATION_ACCEPTED",
        outcome: eventOutcome(event),
      };
    return {
      kind: "TERMINAL",
      state: "SETTLED_EXTERNALLY",
      code: "EXACT_ATTESTATION_ALREADY_ACCEPTED",
      outcome: eventOutcome(event),
    };
  }
  if (snapshot.jobStatus !== SUBMITTED)
    return {
      kind: "TERMINAL",
      state: "PRECONDITION_FAILED",
      code: "JOB_NOT_SUBMITTED",
    };
  if (
    snapshot.blockTimestamp >= snapshot.jobExpiredAt ||
    snapshot.blockTimestamp > attestation.validUntil
  )
    return {
      kind: "TERMINAL",
      state: "EXPIRED_UNSENT",
      code: "ATTESTATION_OR_JOB_EXPIRED",
    };
  return { kind: "READY" };
}

export interface RelayReconciliationDecision {
  readonly state: Extract<
    RelayState,
    | "SETTLED"
    | "SETTLED_EXTERNALLY"
    | "COMPLETED_BY_DIFFERENT_ATTESTATION"
    | "REVERTED"
    | "INTEGRITY_FAILURE"
    | "BROADCAST_UNKNOWN"
  >;
  readonly code: string;
  readonly retryable: boolean;
  readonly outcome?: CanonicalRelayOutcome;
}

export function reconcileRelayObservation(input: {
  readonly intent: RelayIntentRecord;
  readonly artifact: ReadyToRelayArtifact;
  readonly observation: RelayReceiptObservation;
}): RelayReconciliationDecision {
  const { intent, artifact, observation } = input;
  const event = canonicalEvent(observation.completionEvents);
  const exactEvent =
    event === undefined || !matchesArtifact(event, artifact)
      ? undefined
      : event;
  const accepted = observation.snapshot.bindingAccepted;
  const completed = observation.snapshot.jobStatus === COMPLETED;

  if (accepted || completed) {
    if (event === undefined || !accepted || !completed)
      return {
        state: "INTEGRITY_FAILURE",
        code: "POST_STATE_EVENT_MISMATCH",
        retryable: false,
      };
    if (exactEvent === undefined)
      return {
        state: "COMPLETED_BY_DIFFERENT_ATTESTATION",
        code: "DIFFERENT_ATTESTATION_ACCEPTED",
        retryable: false,
        outcome: eventOutcome(
          event,
          event.transactionHash === intent.expectedTxHash
            ? observation.receipt
            : observation.canonicalEventReceipt,
        ),
      };
    const external = exactEvent.transactionHash !== intent.expectedTxHash;
    const settlementReceipt = external
      ? observation.canonicalEventReceipt
      : observation.receipt;
    if (
      settlementReceipt === undefined ||
      settlementReceipt.status !== "success" ||
      settlementReceipt.transactionHash !== exactEvent.transactionHash
    )
      return {
        state: "INTEGRITY_FAILURE",
        code: "CANONICAL_EVENT_RECEIPT_MISMATCH",
        retryable: false,
      };
    return {
      state: external ? "SETTLED_EXTERNALLY" : "SETTLED",
      code: external
        ? "CANONICAL_EXTERNAL_SETTLEMENT"
        : "CANONICAL_EXPECTED_SETTLEMENT",
      retryable: false,
      outcome: eventOutcome(exactEvent, settlementReceipt),
    };
  }

  const receipt = observation.receipt;
  if (receipt !== undefined) {
    if (receipt.transactionHash !== intent.expectedTxHash)
      return {
        state: "INTEGRITY_FAILURE",
        code: "RECEIPT_HASH_MISMATCH",
        retryable: false,
      };
    const outcome: CanonicalRelayOutcome = Object.freeze({
      canonicalTxHash: receipt.transactionHash,
      receiptStatus: receipt.status,
      receiptBlockNumber: receipt.blockNumber,
      receiptBlockHash: receipt.blockHash,
      receiptTransactionIndex: receipt.transactionIndex,
    });
    if (receipt.status === "reverted")
      return {
        state: "REVERTED",
        code: "EXPECTED_TRANSACTION_REVERTED",
        retryable: false,
        outcome,
      };
    return {
      state: "INTEGRITY_FAILURE",
      code: "SUCCESS_RECEIPT_WITHOUT_SETTLEMENT",
      retryable: false,
      outcome,
    };
  }

  return {
    state: "BROADCAST_UNKNOWN",
    code: observation.transactionFound
      ? "TRANSACTION_PENDING_OR_UNCONFIRMED"
      : observation.latestNonce !== observation.pendingNonce
        ? "NO_CANONICAL_RESULT_UNKNOWN_PENDING_NONCE"
        : observation.latestNonce > (intent.nonce ?? Number.MAX_SAFE_INTEGER)
          ? "NO_CANONICAL_RESULT_NONCE_ADVANCED"
          : "NO_CANONICAL_RESULT",
    retryable: true,
  };
}
