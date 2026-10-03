import type { CanonicalGithubPrMergedCondition, Hex32 } from "@pact/protocol";
import type { Address, Hex } from "viem";

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
  readonly network: "arc-testnet";
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
  readonly preparationVersion: number;
  readonly transactionHash: Hex32 | null;
  readonly confirmationStatus: WalletConfirmationStatus;
  readonly idempotencyKey: string;
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
  getPublicProjection(
    slug: string,
  ): Promise<ProductProjectionInput | undefined>;
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
  readonly evidenceHash: Hex32;
  readonly mergeCommitSha: Hex;
  readonly mergedAt: bigint;
  readonly observedAt: bigint;
}

export interface PublicSettlementSummary {
  readonly transactionHash: Hex32;
  readonly state: "SETTLED" | "SETTLED_EXTERNALLY";
  readonly blockNumber: bigint | null;
}

export interface SessionClaims {
  readonly walletAddress: Address;
  readonly chainId: number;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly version: number;
}
