import type { CanonicalGithubPrMergedCondition, Hex32 } from "@pact/protocol";
import type { Address, Hex } from "viem";
import type { ProductNetworkId } from "./network";

export const draftLifecycles = ["DRAFT", "ACTION_REQUIRED", "LINKED"] as const;
export type DraftLifecycle = (typeof draftLifecycles)[number];

export const walletActionKinds = [
  "CREATE_JOB",
  "BIND_CONDITION",
  "SET_BUDGET",
  "APPROVE_USDC",
  "FUND",
  "SUBMIT",
] as const;
export type WalletActionKind = (typeof walletActionKinds)[number];

export const walletConfirmationStatuses = [
  "PENDING",
  "SUBMITTED",
  "CONFIRMED",
  "FAILED",
] as const;
export type WalletConfirmationStatus =
  (typeof walletConfirmationStatuses)[number];

export const publicPactStatuses = [
  "DRAFT",
  "ACTION_REQUIRED",
  "FUNDED",
  "AWAITING_PROVIDER",
  "AWAITING_CONDITION",
  "VERIFYING",
  "SETTLING",
  "COMPLETED",
  "EXPIRED",
  "NEEDS_ATTENTION",
] as const;
export type PublicPactStatus = (typeof publicPactStatuses)[number];

export interface PactDraft {
  readonly id: string;
  readonly publicSlug: string;
  readonly creatingWallet: Address;
  readonly providerAddress: Address;
  readonly githubRepository: string;
  readonly githubPullRequest: number;
  readonly baseBranch: string;
  readonly event: "PR_MERGED";
  readonly amountBaseUnits: bigint;
  readonly network: ProductNetworkId;
  readonly chainId: bigint;
  readonly condition: CanonicalGithubPrMergedCondition;
  readonly conditionHash: Hex32;
  readonly completionPolicyVersion: number;
  readonly completionOffsetSeconds: number;
  readonly expiryPolicyVersion: number;
  readonly expiryOffsetSeconds: number;
  readonly idempotencyKey: string;
  readonly canonicalRequestHash: Hex32;
  readonly linkedPactRecordId: string | null;
  readonly lifecycle: DraftLifecycle;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface WalletAction {
  readonly id: string;
  readonly draftId: string;
  readonly pactRecordId: string | null;
  readonly action: WalletActionKind;
  readonly requiredSigner: Address;
  readonly chainId: bigint;
  readonly expectedTarget: Address;
  readonly value: bigint;
  readonly calldataHash: Hex32;
  readonly semanticHash: Hex32;
  readonly preparationVersion: number;
  readonly preparedAtBlock: bigint;
  readonly preparedAtBlockHash: Hex32 | null;
  readonly preparationExpiresAt: Date;
  readonly expectedStateTransition: string;
  readonly completionDeadline: bigint | null;
  readonly jobExpiredAt: bigint | null;
  readonly transactionHash: Hex32 | null;
  readonly confirmationStatus: WalletConfirmationStatus;
  readonly idempotencyKey: string;
  readonly confirmedJobId: bigint | null;
  readonly confirmedJobKey: Hex32 | null;
  readonly confirmedJobStatus: number | null;
  readonly confirmedAtBlock: bigint | null;
  readonly confirmedAtBlockHash: Hex32 | null;
  readonly confirmedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface AuthNonce {
  readonly id: string;
  readonly walletAddress: Address;
  readonly domain: string;
  readonly uri: string;
  readonly nonce: string;
  readonly chainId: bigint;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
}

export interface CreateDraftInput {
  readonly network: ProductNetworkId;
  readonly chainId: bigint;
  readonly creatingWallet: Address;
  readonly providerAddress: Address;
  readonly githubRepository: string;
  readonly githubPullRequest: number;
  readonly amountBaseUnits: bigint;
  readonly condition: CanonicalGithubPrMergedCondition;
  readonly conditionHash: Hex32;
  readonly idempotencyKey: string;
  readonly canonicalRequestHash: Hex32;
}

export type CreateDraftResult =
  | { readonly kind: "CREATED"; readonly draft: PactDraft }
  | { readonly kind: "REPLAY"; readonly draft: PactDraft }
  | { readonly kind: "CONFLICT" };

export interface ProductRepository {
  issueNonce(input: Omit<AuthNonce, "id" | "consumedAt">): Promise<AuthNonce>;
  getNonce(nonce: string): Promise<AuthNonce | undefined>;
  consumeNonce(id: string, consumedAt: Date): Promise<boolean>;
  getDraftByIdempotency(
    walletAddress: Address,
    idempotencyKey: string,
  ): Promise<PactDraft | undefined>;
  createDraft(input: CreateDraftInput): Promise<CreateDraftResult>;
  getDraftBySlug(slug: string): Promise<PactDraft | undefined>;
  getWalletAction(
    draftId: string,
    action: WalletActionKind,
  ): Promise<WalletAction | undefined>;
  savePreparedAction(
    input: PreparedWalletActionInput,
  ): Promise<SavePreparedActionResult>;
  confirmWalletAction(input: ConfirmWalletActionInput): Promise<WalletAction>;
  getPublicProjection(
    slug: string,
  ): Promise<ProductProjectionInput | undefined>;
}

export interface ProductAutomationRepository {
  ensureScheduled(draftId: string, pactRecordId: string): Promise<unknown>;
  wake(
    draftId: string,
    pactRecordId: string,
    idempotencyKey: string,
  ): Promise<{ readonly replayed: boolean }>;
}

export interface PreparedWalletActionInput {
  readonly draftId: string;
  readonly pactRecordId: string | null;
  readonly action: WalletActionKind;
  readonly requiredSigner: Address;
  readonly chainId: bigint;
  readonly expectedTarget: Address;
  readonly value: bigint;
  readonly calldataHash: Hex32;
  readonly semanticHash: Hex32;
  readonly preparationVersion: number;
  readonly preparedAtBlock: bigint;
  readonly preparedAtBlockHash: Hex32 | null;
  readonly preparationExpiresAt: Date;
  readonly expectedStateTransition: string;
  readonly completionDeadline: bigint | null;
  readonly jobExpiredAt: bigint | null;
  readonly idempotencyKey: string;
}

export type SavePreparedActionResult =
  | {
      readonly kind: "CREATED" | "REPLAY" | "REFRESHED";
      readonly action: WalletAction;
    }
  | {
      readonly kind: "CONFLICT" | "ALREADY_CONFIRMED";
      readonly action: WalletAction;
    };

export interface ConfirmWalletActionInput {
  readonly actionId: string;
  readonly transactionHash: Hex32 | null;
  readonly confirmedJobId: bigint | null;
  readonly confirmedJobKey: Hex32 | null;
  readonly confirmedJobStatus: number | null;
  readonly confirmedAtBlock: bigint;
  readonly confirmedAtBlockHash: Hex32;
  readonly confirmedAt: Date;
  readonly linkedPactRecordId?: string;
}

export interface ProductProjectionInput {
  readonly draft: PactDraft;
  readonly walletActions: readonly WalletAction[];
  readonly operationState: string | null;
  readonly relayState: string | null;
  readonly chainJobStatus: number | null;
  readonly chainExpiredAt: bigint | null;
  readonly now: bigint;
  readonly jobId: bigint | null;
  readonly jobKey: Hex32 | null;
  readonly completionDeadline: bigint | null;
  readonly evidence: PublicEvidenceSummary | null;
  readonly settlement: PublicSettlementSummary | null;
}

export interface PublicEvidenceSummary {
  readonly conditionHash: Hex32;
  readonly evidenceHash: Hex32;
  readonly repository: string;
  readonly pullRequest: number;
  readonly baseBranch: string;
  readonly mergeCommitSha: Hex;
  readonly mergedAt: bigint;
  readonly observedAt: bigint;
  readonly attestationDigest: Hex32;
  readonly verifier: Address;
  readonly satisfiedAt: bigint;
  readonly verifiedAt: bigint;
  readonly validUntil: bigint;
}

export interface PublicSettlementSummary {
  readonly jobId: bigint;
  readonly jobKey: Hex32;
  readonly chainId: bigint;
  readonly commerce: Address;
  readonly evaluator: Address;
  readonly transactionHash: Hex32;
  readonly state: "SETTLED" | "SETTLED_EXTERNALLY";
  readonly receiptBlockNumber: bigint;
  readonly receiptBlockHash: Hex32;
  readonly receiptTransactionIndex: number;
  readonly eventBlockNumber: bigint;
  readonly eventBlockHash: Hex32;
  readonly eventLogIndex: number;
  readonly finalJobStatus: number;
  readonly bindingAccepted: boolean;
  readonly broadcastAttemptCount: number;
  readonly grossBudget: bigint;
  readonly grossProviderPayout: bigint;
  readonly treasuryApplicationPayout: bigint;
  readonly evaluatorApplicationPayout: bigint;
  readonly evidenceHash: Hex32;
  readonly completionReason: Hex32;
}

export interface SessionClaims {
  readonly walletAddress: Address;
  readonly chainId: number;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly version: number;
}
