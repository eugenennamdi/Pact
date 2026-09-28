import type {
  CanonicalGithubPrMergedCondition,
  Hex32,
  PactGitHubPrMergedEvidenceV1,
} from "@pact/protocol";
import type { Address, Hex } from "viem";

export const operationStates = [
  "PENDING",
  "VERIFYING_GITHUB",
  "NOT_SATISFIED_RETRYABLE",
  "NOT_SATISFIED_TERMINAL",
  "INDETERMINATE",
  "VERIFIED",
  "RECONCILING_CHAIN",
  "CHAIN_RETRYABLE",
  "CHAIN_INVALID",
  "READY_TO_SIGN",
  "SIGNING",
  "READY_TO_RELAY",
  "ALREADY_ACCEPTED",
  "EXPIRED",
  "FAILED_DEFINITE",
] as const;
export type OperationState = (typeof operationStates)[number];
export type TriggerKind = "GITHUB_WEBHOOK" | "MANUAL" | "RECOVERY";

export interface PactRecord {
  readonly id: string;
  readonly chainId: bigint;
  readonly commerceContract: Address;
  readonly pactEvaluator: Address;
  readonly jobId: bigint;
  readonly jobKey: Hex32;
  readonly condition: CanonicalGithubPrMergedCondition;
  readonly conditionHash: Hex32;
  readonly completionDeadline: bigint;
}
export interface OperationRecord {
  readonly id: string;
  readonly pactRecordId: string;
  readonly triggerKind: TriggerKind;
  readonly triggerKey: string;
  readonly state: OperationState;
  readonly code: string | null;
  readonly retryable: boolean;
  readonly version: number;
}
export interface OperationWithPact {
  readonly operation: OperationRecord;
  readonly pact: PactRecord;
}
export interface GitHubDeliveryInput {
  readonly deliveryId: string;
  readonly event: string;
  readonly action: string;
  readonly repository?: string;
  readonly pullRequest?: number;
  readonly relevant: boolean;
  readonly receivedAt: Date;
}
export interface GitHubDeliveryIngestResult {
  readonly duplicate: boolean;
  readonly operationIds: readonly string[];
  readonly matchedPacts: number;
}
export interface PersistedVerificationResult {
  readonly observedAt: bigint;
  readonly status: "SATISFIED" | "NOT_SATISFIED" | "INDETERMINATE";
  readonly reason?: string;
  readonly retryable: boolean;
  readonly retryAfterSeconds?: number;
  readonly rateLimitRemaining?: number;
  readonly rateLimitResetAt?: number;
  readonly evidence?: PactGitHubPrMergedEvidenceV1;
  readonly evidenceHash?: Hex32;
}
export interface PersistedChainSnapshot {
  readonly blockNumber: bigint;
  readonly blockHash: Hex32;
  readonly blockTimestamp: bigint;
  readonly chainId: bigint;
  readonly pactEvaluator: Address;
  readonly commerceContract: Address;
  readonly jobId: bigint;
  readonly jobKey: Hex32;
  readonly bindingExists: boolean;
  readonly bindingConditionHash: Hex32;
  readonly bindingCompletionDeadline: bigint;
  readonly bindingVerifier: Address;
  readonly bindingAccepted: boolean;
  readonly verifierRevoked: boolean;
  readonly jobClient: Address;
  readonly jobProvider: Address;
  readonly jobEvaluator: Address;
  readonly jobStatus: number;
  readonly jobExpiredAt: bigint;
}
export interface PersistedAttestation {
  readonly digest: Hex32;
  readonly signature: Hex;
  readonly signer: Address;
  readonly chainId: bigint;
  readonly verifyingContract: Address;
  readonly commerceContract: Address;
  readonly jobId: bigint;
  readonly conditionHash: Hex32;
  readonly evidenceHash: Hex32;
  readonly satisfiedAt: bigint;
  readonly verifiedAt: bigint;
  readonly validUntil: bigint;
  readonly jobKey: Hex32;
}
export interface PactRepository {
  createPact(record: PactRecord): Promise<PactRecord>;
  getPact(id: string): Promise<PactRecord | undefined>;
  ingestGitHubDelivery(
    input: GitHubDeliveryInput,
  ): Promise<GitHubDeliveryIngestResult>;
  enqueueManualOperation(
    pactRecordId: string,
    triggerKey: string,
  ): Promise<OperationRecord>;
  getOperation(id: string): Promise<OperationWithPact | undefined>;
  listPendingOperationIds(limit: number): Promise<readonly string[]>;
  transitionOperation(
    id: string,
    expectedStates: readonly OperationState[],
    nextState: OperationState,
    options?: { readonly code?: string; readonly retryable?: boolean },
  ): Promise<OperationRecord | undefined>;
  persistVerification(
    operationId: string,
    result: PersistedVerificationResult,
    nextState: OperationState,
  ): Promise<number>;
  persistChainReconciliation(
    operationId: string,
    snapshot: PersistedChainSnapshot,
    outcome: "READY" | "RETRYABLE" | "INVALID",
    code: string | undefined,
    nextState: OperationState,
  ): Promise<number>;
  persistReadyToRelay(
    operationId: string,
    pactRecordId: string,
    evidence: PactGitHubPrMergedEvidenceV1,
    evidenceHash: Hex32,
    attestation: PersistedAttestation,
  ): Promise<void>;
  recoverTransitionalOperations(staleBefore: Date): Promise<number>;
}
