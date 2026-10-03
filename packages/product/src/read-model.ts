import type { Address } from "viem";
import {
  PRODUCT_COMMERCE_ADDRESS,
  PRODUCT_EVALUATOR_ADDRESS,
} from "./constants";
import type {
  ProductProjectionInput,
  PublicPactStatus,
  WalletActionKind,
} from "./types";

export interface NextAction {
  readonly actor: "CLIENT" | "PROVIDER" | "PACT" | "NONE";
  readonly action: WalletActionKind | "VERIFY" | "SETTLE" | "NONE";
}

export interface PublicPactDto {
  readonly slug: string;
  readonly network: "arc-testnet";
  readonly chainId: number;
  readonly client: Address;
  readonly provider: Address;
  readonly repository: string;
  readonly pullRequest: number;
  readonly baseBranch: string;
  readonly event: "PR_MERGED";
  readonly amountBaseUnits: string;
  readonly conditionHash: string;
  readonly jobId: string | null;
  readonly jobKey: string | null;
  readonly commerceAddress: string;
  readonly evaluatorAddress: string;
  readonly completionDeadline: string | null;
  readonly expiry: string | null;
  readonly status: PublicPactStatus;
  readonly next: NextAction;
  readonly walletActions: readonly {
    readonly action: WalletActionKind;
    readonly requiredSigner: Address;
    readonly confirmationStatus: string;
    readonly transactionHash: string | null;
  }[];
  readonly evidence: {
    readonly evidenceHash: string;
    readonly mergeCommitSha: string;
    readonly mergedAt: string;
    readonly observedAt: string;
  } | null;
  readonly settlement: {
    readonly transactionHash: string;
    readonly state: "SETTLED" | "SETTLED_EXTERNALLY";
    readonly blockNumber: string | null;
  } | null;
}

const VERIFYING_STATES = new Set([
  "PENDING",
  "VERIFYING_GITHUB",
  "VERIFIED",
  "RECONCILING_CHAIN",
  "READY_TO_SIGN",
  "SIGNING",
]);
const ATTENTION_STATES = new Set([
  "INDETERMINATE",
  "CHAIN_INVALID",
  "FAILED_DEFINITE",
]);
const SETTLING_RELAY_STATES = new Set([
  "PREPARING",
  "SIGNED",
  "DISPATCHING",
  "SUBMITTED",
  "BROADCAST_UNKNOWN",
]);
const ATTENTION_RELAY_STATES = new Set([
  "REVERTED",
  "INTEGRITY_FAILURE",
  "PRECONDITION_FAILED",
  "NONCE_DRIFT",
  "INSUFFICIENT_RELAY_GAS",
]);

export function projectPublicStatus(
  input: ProductProjectionInput,
): PublicPactStatus {
  if (
    input.walletActions.some((action) => action.confirmationStatus === "FAILED")
  ) {
    return "NEEDS_ATTENTION";
  }
  if (
    (input.operationState !== null &&
      ATTENTION_STATES.has(input.operationState)) ||
    (input.relayState !== null && ATTENTION_RELAY_STATES.has(input.relayState))
  ) {
    return "NEEDS_ATTENTION";
  }
  if (input.settlement !== null || input.chainJobStatus === 3)
    return "COMPLETED";
  if (
    input.chainJobStatus === 5 ||
    (input.chainExpiredAt !== null && input.chainExpiredAt <= input.now)
  ) {
    return "EXPIRED";
  }
  if (input.chainJobStatus === 4) return "NEEDS_ATTENTION";
  if (
    input.relayState !== null &&
    SETTLING_RELAY_STATES.has(input.relayState)
  ) {
    return "SETTLING";
  }
  if (
    input.operationState !== null &&
    VERIFYING_STATES.has(input.operationState)
  ) {
    return "VERIFYING";
  }
  if (input.chainJobStatus === 2) return "AWAITING_CONDITION";
  if (input.chainJobStatus === 1) return "AWAITING_PROVIDER";
  if (input.chainJobStatus === 0) {
    return input.walletActions.some(
      (action) =>
        action.action === "FUND" && action.confirmationStatus === "CONFIRMED",
    )
      ? "NEEDS_ATTENTION"
      : "ACTION_REQUIRED";
  }
  if (
    input.chainJobStatus === null &&
    input.walletActions.some(
      (action) =>
        action.action === "FUND" && action.confirmationStatus === "CONFIRMED",
    )
  ) {
    return "FUNDED";
  }
  if (
    input.draft.linkedPactRecordId !== null ||
    input.operationState !== null ||
    input.relayState !== null
  ) {
    return "NEEDS_ATTENTION";
  }
  return input.draft.lifecycle === "DRAFT" ? "DRAFT" : "ACTION_REQUIRED";
}

export function nextAction(status: PublicPactStatus): NextAction {
  switch (status) {
    case "DRAFT":
    case "ACTION_REQUIRED":
      return { actor: "CLIENT", action: "CREATE_JOB" };
    case "FUNDED":
    case "AWAITING_PROVIDER":
      return { actor: "PROVIDER", action: "SUBMIT" };
    case "AWAITING_CONDITION":
    case "VERIFYING":
      return { actor: "PACT", action: "VERIFY" };
    case "SETTLING":
      return { actor: "PACT", action: "SETTLE" };
    case "COMPLETED":
    case "EXPIRED":
    case "NEEDS_ATTENTION":
      return { actor: "NONE", action: "NONE" };
  }
}

export function toPublicPactDto(input: ProductProjectionInput): PublicPactDto {
  const status = projectPublicStatus(input);
  return Object.freeze({
    slug: input.draft.publicSlug,
    network: input.draft.network,
    chainId: Number(input.draft.chainId),
    client: input.draft.creatingWallet,
    provider: input.draft.providerAddress,
    repository: input.draft.githubRepository,
    pullRequest: input.draft.githubPullRequest,
    baseBranch: input.draft.baseBranch,
    event: input.draft.event,
    amountBaseUnits: input.draft.amountBaseUnits.toString(),
    conditionHash: input.draft.conditionHash,
    jobId: input.jobId?.toString() ?? null,
    jobKey: input.jobKey,
    commerceAddress: PRODUCT_COMMERCE_ADDRESS,
    evaluatorAddress: PRODUCT_EVALUATOR_ADDRESS,
    completionDeadline: input.completionDeadline?.toString() ?? null,
    expiry: input.chainExpiredAt?.toString() ?? null,
    status,
    next: nextAction(status),
    walletActions: input.walletActions.map((action) => ({
      action: action.action,
      requiredSigner: action.requiredSigner,
      confirmationStatus: action.confirmationStatus,
      transactionHash: action.transactionHash,
    })),
    evidence:
      input.evidence === null
        ? null
        : {
            evidenceHash: input.evidence.evidenceHash,
            mergeCommitSha: input.evidence.mergeCommitSha,
            mergedAt: input.evidence.mergedAt.toString(),
            observedAt: input.evidence.observedAt.toString(),
          },
    settlement:
      input.settlement === null
        ? null
        : {
            transactionHash: input.settlement.transactionHash,
            state: input.settlement.state,
            blockNumber: input.settlement.blockNumber?.toString() ?? null,
          },
  });
}
