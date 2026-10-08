import type { Address } from "viem";
import { loadCertifiedProductDeployment } from "./deployment";
import { PERSISTED_PRODUCT_NETWORK, type ProductNetworkId } from "./network";
import type {
  ProductProjectionInput,
  PublicPactStatus,
  WalletActionKind,
} from "./types";

const PERSISTED_PRODUCT_DEPLOYMENT = loadCertifiedProductDeployment(
  PERSISTED_PRODUCT_NETWORK,
);

export interface NextAction {
  readonly actor: "CLIENT" | "PROVIDER" | "PACT" | "NONE";
  readonly action: WalletActionKind | "VERIFY" | "SETTLE" | "NONE";
}

export interface PublicPactDto {
  readonly slug: string;
  readonly network: ProductNetworkId;
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
  readonly nextRequiredActor: NextAction["actor"];
  readonly nextRequiredAction: NextAction["action"];
  readonly canonicalJobStatus: number | null;
  readonly walletActions: readonly {
    readonly action: WalletActionKind;
    readonly requiredSigner: Address;
    readonly confirmationStatus: string;
    readonly transactionHash: string | null;
    readonly preparedAtBlock: string;
    readonly preparationExpiresAt: string;
  }[];
  readonly evidence: {
    readonly conditionHash: string;
    readonly evidenceHash: string;
    readonly repository: string;
    readonly pullRequest: number;
    readonly baseBranch: string;
    readonly mergeCommitSha: string;
    readonly mergedAt: string;
    readonly observedAt: string;
    readonly attestationDigest: string;
    readonly verifier: Address;
    readonly satisfiedAt: string;
    readonly verifiedAt: string;
    readonly validUntil: string;
  } | null;
  readonly settlement: {
    readonly jobId: string;
    readonly jobKey: string;
    readonly chainId: number;
    readonly commerce: Address;
    readonly evaluator: Address;
    readonly transactionHash: string;
    readonly state: "SETTLED" | "SETTLED_EXTERNALLY";
    readonly receiptBlockNumber: string;
    readonly receiptBlockHash: string;
    readonly receiptTransactionIndex: number;
    readonly eventBlockNumber: string;
    readonly eventBlockHash: string;
    readonly eventLogIndex: number;
    readonly finalJobStatus: number;
    readonly bindingAccepted: boolean;
    readonly broadcastAttemptCount: number;
    readonly grossBudget: string;
    readonly grossProviderPayout: string;
    readonly treasuryApplicationPayout: string;
    readonly evaluatorApplicationPayout: string;
    readonly evidenceHash: string;
    readonly completionReason: string;
  } | null;
}

const VERIFYING_STATES = new Set([
  "PENDING",
  "VERIFYING_GITHUB",
  "VERIFIED",
  "RECONCILING_CHAIN",
  "READY_TO_SIGN",
  "SIGNING",
  "INDETERMINATE",
  "CHAIN_RETRYABLE",
]);
const ATTENTION_STATES = new Set([
  "NOT_SATISFIED_TERMINAL",
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
    input.operationState === "READY_TO_RELAY" ||
    (input.relayState !== null && SETTLING_RELAY_STATES.has(input.relayState))
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

function projectedNextAction(
  input: ProductProjectionInput,
  status: PublicPactStatus,
): NextAction {
  if (status === "ACTION_REQUIRED" || status === "DRAFT") {
    const confirmed = new Set(
      input.walletActions
        .filter((action) => action.confirmationStatus === "CONFIRMED")
        .map((action) => action.action),
    );
    const sequence: readonly NextAction[] = [
      { actor: "CLIENT", action: "CREATE_JOB" },
      { actor: "CLIENT", action: "BIND_CONDITION" },
      { actor: "PROVIDER", action: "SET_BUDGET" },
      { actor: "CLIENT", action: "APPROVE_USDC" },
      { actor: "CLIENT", action: "FUND" },
    ];
    return (
      sequence.find(
        (candidate) =>
          candidate.action !== "NONE" &&
          candidate.action !== "VERIFY" &&
          candidate.action !== "SETTLE" &&
          !confirmed.has(candidate.action),
      ) ?? { actor: "PROVIDER", action: "SUBMIT" }
    );
  }
  return nextAction(status);
}

export function toPublicPactDto(input: ProductProjectionInput): PublicPactDto {
  const status = projectPublicStatus(input);
  const next = projectedNextAction(input, status);
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
    commerceAddress: PERSISTED_PRODUCT_DEPLOYMENT.commerce,
    evaluatorAddress: PERSISTED_PRODUCT_DEPLOYMENT.evaluator,
    completionDeadline: input.completionDeadline?.toString() ?? null,
    expiry: input.chainExpiredAt?.toString() ?? null,
    status,
    next,
    nextRequiredActor: next.actor,
    nextRequiredAction: next.action,
    canonicalJobStatus: input.chainJobStatus,
    walletActions: input.walletActions.map((action) => ({
      action: action.action,
      requiredSigner: action.requiredSigner,
      confirmationStatus: action.confirmationStatus,
      transactionHash: action.transactionHash,
      preparedAtBlock: action.preparedAtBlock.toString(),
      preparationExpiresAt: action.preparationExpiresAt.toISOString(),
    })),
    evidence:
      input.evidence === null
        ? null
        : {
            conditionHash: input.evidence.conditionHash,
            evidenceHash: input.evidence.evidenceHash,
            repository: input.evidence.repository,
            pullRequest: input.evidence.pullRequest,
            baseBranch: input.evidence.baseBranch,
            mergeCommitSha: input.evidence.mergeCommitSha,
            mergedAt: input.evidence.mergedAt.toString(),
            observedAt: input.evidence.observedAt.toString(),
            attestationDigest: input.evidence.attestationDigest,
            verifier: input.evidence.verifier,
            satisfiedAt: input.evidence.satisfiedAt.toString(),
            verifiedAt: input.evidence.verifiedAt.toString(),
            validUntil: input.evidence.validUntil.toString(),
          },
    settlement:
      input.settlement === null
        ? null
        : {
            jobId: input.settlement.jobId.toString(),
            jobKey: input.settlement.jobKey,
            chainId: Number(input.settlement.chainId),
            commerce: input.settlement.commerce,
            evaluator: input.settlement.evaluator,
            transactionHash: input.settlement.transactionHash,
            state: input.settlement.state,
            receiptBlockNumber: input.settlement.receiptBlockNumber.toString(),
            receiptBlockHash: input.settlement.receiptBlockHash,
            receiptTransactionIndex: input.settlement.receiptTransactionIndex,
            eventBlockNumber: input.settlement.eventBlockNumber.toString(),
            eventBlockHash: input.settlement.eventBlockHash,
            eventLogIndex: input.settlement.eventLogIndex,
            finalJobStatus: input.settlement.finalJobStatus,
            bindingAccepted: input.settlement.bindingAccepted,
            broadcastAttemptCount: input.settlement.broadcastAttemptCount,
            grossBudget: input.settlement.grossBudget.toString(),
            grossProviderPayout:
              input.settlement.grossProviderPayout.toString(),
            treasuryApplicationPayout:
              input.settlement.treasuryApplicationPayout.toString(),
            evaluatorApplicationPayout:
              input.settlement.evaluatorApplicationPayout.toString(),
            evidenceHash: input.settlement.evidenceHash,
            completionReason: input.settlement.completionReason,
          },
  });
}
