import type { OperationState } from "@pact/database";

export interface AutomationRecord {
  readonly id: string;
  readonly draftId: string;
  readonly pactRecordId: string;
  readonly enabled: boolean;
  readonly nextCheckAt: Date;
  readonly lastCheckAt: Date | null;
  readonly lastResult: string | null;
  readonly consecutiveRetryableFailures: number;
  readonly leaseOwner: string | null;
  readonly leaseToken: string | null;
  readonly leaseUntil: Date | null;
  readonly lastOperationId: string | null;
  readonly lastWakeKey: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface AutomationLease extends AutomationRecord {
  readonly leaseOwner: string;
  readonly leaseToken: string;
  readonly leaseUntil: Date;
}

export interface CompleteLeaseInput {
  readonly id: string;
  readonly owner: string;
  readonly token: string;
  readonly result: string;
  readonly delaySeconds: number;
  readonly retryableFailure: boolean;
  readonly enabled: boolean;
  readonly operationId?: string;
}

export interface AutomationRepository {
  ensureScheduled(
    draftId: string,
    pactRecordId: string,
  ): Promise<AutomationRecord>;
  wake(
    draftId: string,
    pactRecordId: string,
    idempotencyKey: string,
  ): Promise<{ readonly record: AutomationRecord; readonly replayed: boolean }>;
  claimDue(
    owner: string,
    limit: number,
    leaseSeconds: number,
  ): Promise<readonly AutomationLease[]>;
  renewLease(
    id: string,
    owner: string,
    token: string,
    leaseSeconds: number,
  ): Promise<boolean>;
  completeLease(input: CompleteLeaseInput): Promise<boolean>;
  get(id: string): Promise<AutomationRecord | undefined>;
}

export interface WorkerLogEvent {
  readonly role: "verifier" | "relay";
  readonly event: string;
  readonly pactSlug?: string;
  readonly pactRecordId?: string;
  readonly operationId?: string;
  readonly jobKey?: string;
  readonly chainId?: string;
  readonly jobId?: string;
  readonly verificationResult?: OperationState | string;
  readonly reason?: string;
  readonly evidenceHash?: string;
  readonly attestationDigest?: string;
  readonly relayIntentId?: string;
  readonly expectedTxHash?: string;
  readonly canonicalTxHash?: string;
  readonly broadcastCount?: number;
  readonly terminalResult?: string;
  readonly retryCount?: number;
  readonly latencyMs?: number;
}

export type WorkerLogger = (event: WorkerLogEvent) => void;

export interface WorkerHealthSnapshot {
  readonly role: "verifier" | "relay";
  readonly ready: boolean;
  readonly configuration: "READY" | "FAILED";
  readonly database: "UNKNOWN" | "READY" | "FAILED";
  readonly arcRpc: "UNKNOWN" | "READY" | "FAILED";
  readonly github?: "UNKNOWN" | "READY" | "FAILED";
  readonly signerIdentity: "READY" | "FAILED";
  readonly relayBalance?: "UNKNOWN" | "READY" | "FAILED";
  readonly relayBalanceWei?: bigint;
  readonly relayRequiredWei?: bigint;
  readonly unresolvedBroadcastUnknown?: number;
  readonly lastSuccessfulLoop: string | null;
  readonly lastLoopResult: string | null;
  readonly stale: boolean;
  readonly lastFailure: string | null;
}
