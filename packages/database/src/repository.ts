import {
  hashGithubPrMergedCondition,
  hashPactGitHubPrMergedEvidenceV1,
  hashPactJobIdentity,
  normalizeGithubPrMergedCondition,
  normalizePactGitHubPrMergedEvidenceV1,
  normalizePactJobIdentity,
} from "@pact/protocol";
import { and, count, eq, inArray, lt, sql } from "drizzle-orm";
import { getAddress } from "viem";
import type { PactDatabase } from "./client.js";
import {
  attestations,
  chainReconciliations,
  evidenceRecords,
  githubDeliveries,
  operations,
  pactRecords,
  verificationAttempts,
} from "./schema.js";
import type {
  GitHubDeliveryIngestResult,
  GitHubDeliveryInput,
  OperationRecord,
  OperationState,
  OperationWithPact,
  PactRecord,
  PactRepository,
  PersistedAttestation,
  PersistedChainSnapshot,
  PersistedVerificationResult,
  TriggerKind,
} from "./types.js";

const ACTIVE_STATES: readonly OperationState[] = [
  "PENDING",
  "VERIFYING_GITHUB",
  "VERIFIED",
  "RECONCILING_CHAIN",
  "READY_TO_SIGN",
  "SIGNING",
  "READY_TO_RELAY",
];
const TRANSITIONAL_STATES: readonly OperationState[] = [
  "VERIFYING_GITHUB",
  "VERIFIED",
  "RECONCILING_CHAIN",
  "READY_TO_SIGN",
  "SIGNING",
];
type PactRow = typeof pactRecords.$inferSelect;
type OperationRow = typeof operations.$inferSelect;
type EvidenceRow = typeof evidenceRecords.$inferSelect;

function asPactRecord(row: PactRow): PactRecord {
  const condition = normalizeGithubPrMergedCondition({
    provider: "github",
    repository: row.conditionRepository,
    pullRequest: row.conditionPullRequest,
    baseBranch: row.conditionBaseBranch,
    event: "PR_MERGED",
  });
  const conditionHash = hashGithubPrMergedCondition(condition);
  if (
    row.conditionSchemaVersion !== condition.schemaVersion ||
    row.conditionProvider !== condition.provider ||
    row.conditionEvent !== condition.event ||
    row.conditionHash !== conditionHash
  )
    throw new Error("DATABASE_CONDITION_INTEGRITY_MISMATCH");
  const record: PactRecord = {
    id: row.id,
    chainId: BigInt(row.chainId),
    commerceContract: getAddress(row.commerceContract),
    pactEvaluator: getAddress(row.pactEvaluator),
    jobId: BigInt(row.jobId),
    jobKey: row.jobKey as PactRecord["jobKey"],
    condition,
    conditionHash: conditionHash as PactRecord["conditionHash"],
    completionDeadline: BigInt(row.completionDeadline),
  };
  if (
    hashPactJobIdentity(
      normalizePactJobIdentity({
        chainId: record.chainId,
        commerceContract: record.commerceContract,
        jobId: record.jobId,
      }),
    ) !== record.jobKey
  )
    throw new Error("DATABASE_JOB_KEY_INTEGRITY_MISMATCH");
  return Object.freeze(record);
}

function asOperation(row: OperationRow): OperationRecord {
  return Object.freeze({
    id: row.id,
    pactRecordId: row.pactRecordId,
    triggerKind: row.triggerKind as TriggerKind,
    triggerKey: row.triggerKey,
    state: row.state as OperationState,
    code: row.code,
    retryable: row.retryable,
    version: row.version,
  });
}

function pactValues(record: PactRecord): typeof pactRecords.$inferInsert {
  validatePactRecordIntegrity(record);
  const condition = normalizeGithubPrMergedCondition(record.condition);
  return {
    id: record.id,
    chainId: record.chainId.toString(),
    commerceContract: getAddress(record.commerceContract),
    pactEvaluator: getAddress(record.pactEvaluator),
    jobId: record.jobId.toString(),
    jobKey: record.jobKey,
    conditionSchemaVersion: condition.schemaVersion,
    conditionProvider: condition.provider,
    conditionRepository: condition.repository,
    conditionPullRequest: condition.pullRequest,
    conditionBaseBranch: condition.baseBranch,
    conditionEvent: condition.event,
    conditionHash: record.conditionHash,
    completionDeadline: record.completionDeadline.toString(),
  };
}

export function validatePactRecordIntegrity(record: PactRecord): void {
  const condition = normalizeGithubPrMergedCondition(record.condition);
  if (hashGithubPrMergedCondition(condition) !== record.conditionHash) {
    throw new Error("conditionHash does not match the canonical condition");
  }
  const expectedJobKey = hashPactJobIdentity(
    normalizePactJobIdentity({
      chainId: record.chainId,
      commerceContract: record.commerceContract,
      jobId: record.jobId,
    }),
  );
  if (expectedJobKey !== record.jobKey) {
    throw new Error("jobKey does not match the canonical job identity");
  }
}

function evidenceValues(
  evidence: PersistedVerificationResult["evidence"],
  evidenceHash: PersistedVerificationResult["evidenceHash"],
): typeof evidenceRecords.$inferInsert | undefined {
  if (evidence === undefined || evidenceHash === undefined) return undefined;
  const canonical = normalizePactGitHubPrMergedEvidenceV1(evidence);
  if (hashPactGitHubPrMergedEvidenceV1(canonical) !== evidenceHash)
    throw new Error("evidenceHash does not match canonical evidence");
  return {
    evidenceHash,
    schemaVersion: canonical.schemaVersion,
    conditionHash: canonical.conditionHash,
    repository: canonical.repository,
    pullRequest: Number(canonical.pullRequest),
    baseBranch: canonical.baseBranch,
    mergeCommitSha: canonical.mergeCommitSha,
    mergedAt: canonical.mergedAt.toString(),
    observedAt: canonical.observedAt.toString(),
  };
}

function validateEvidenceRowIntegrity(
  row: EvidenceRow,
  expectedHash: string,
): void {
  const canonical = normalizePactGitHubPrMergedEvidenceV1({
    conditionHash: row.conditionHash,
    repository: row.repository,
    pullRequest: row.pullRequest,
    baseBranch: row.baseBranch,
    mergeCommitSha: row.mergeCommitSha,
    mergedAt: BigInt(row.mergedAt),
    observedAt: BigInt(row.observedAt),
  });
  if (
    row.schemaVersion !== canonical.schemaVersion ||
    hashPactGitHubPrMergedEvidenceV1(canonical) !== expectedHash ||
    row.evidenceHash !== expectedHash
  ) {
    throw new Error("DATABASE_EVIDENCE_INTEGRITY_MISMATCH");
  }
}

export class PostgresPactRepository implements PactRepository {
  readonly #database: PactDatabase;
  constructor(database: PactDatabase) {
    this.#database = database;
  }

  async createPact(record: PactRecord): Promise<PactRecord> {
    const [row] = await this.#database.db
      .insert(pactRecords)
      .values(pactValues(record))
      .returning();
    if (row === undefined) throw new Error("failed to create Pact record");
    return asPactRecord(row);
  }

  async getPact(id: string): Promise<PactRecord | undefined> {
    const [row] = await this.#database.db
      .select()
      .from(pactRecords)
      .where(eq(pactRecords.id, id))
      .limit(1);
    return row === undefined ? undefined : asPactRecord(row);
  }

  async ingestGitHubDelivery(
    input: GitHubDeliveryInput,
  ): Promise<GitHubDeliveryIngestResult> {
    return this.#database.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(githubDeliveries)
        .values({
          deliveryId: input.deliveryId,
          event: input.event,
          action: input.action,
          ...(input.repository === undefined
            ? {}
            : { repository: input.repository }),
          ...(input.pullRequest === undefined
            ? {}
            : { pullRequest: input.pullRequest }),
          signatureValid: true,
          processingState: input.relevant ? "RECEIVED" : "IGNORED",
          receivedAt: input.receivedAt,
          ...(input.relevant ? {} : { processedAt: input.receivedAt }),
        })
        .onConflictDoNothing()
        .returning({ deliveryId: githubDeliveries.deliveryId });
      if (inserted.length === 0)
        return { duplicate: true, operationIds: [], matchedPacts: 0 };
      if (
        !input.relevant ||
        input.repository === undefined ||
        input.pullRequest === undefined
      )
        return { duplicate: false, operationIds: [], matchedPacts: 0 };
      const matches = await tx
        .select({ id: pactRecords.id })
        .from(pactRecords)
        .where(
          and(
            eq(pactRecords.conditionRepository, input.repository),
            eq(pactRecords.conditionPullRequest, input.pullRequest),
          ),
        );
      const operationIds: string[] = [];
      for (const match of matches) {
        const rows = await tx
          .insert(operations)
          .values({
            id: crypto.randomUUID(),
            pactRecordId: match.id,
            triggerKind: "GITHUB_WEBHOOK",
            triggerKey: input.deliveryId,
            state: "PENDING",
          })
          .onConflictDoNothing()
          .returning({ id: operations.id });
        if (rows[0] !== undefined) operationIds.push(rows[0].id);
      }
      await tx
        .update(githubDeliveries)
        .set({
          matchedPacts: matches.length,
          processingState:
            operationIds.length > 0 ? "ENQUEUED" : "NO_NEW_OPERATION",
          processedAt: input.receivedAt,
        })
        .where(eq(githubDeliveries.deliveryId, input.deliveryId));
      return { duplicate: false, operationIds, matchedPacts: matches.length };
    });
  }

  async enqueueManualOperation(
    pactRecordId: string,
    triggerKey: string,
  ): Promise<OperationRecord> {
    return this.#database.db.transaction(async (tx) => {
      const rows = await tx
        .insert(operations)
        .values({
          id: crypto.randomUUID(),
          pactRecordId,
          triggerKind: "MANUAL",
          triggerKey,
          state: "PENDING",
        })
        .onConflictDoNothing()
        .returning();
      if (rows[0] !== undefined) return asOperation(rows[0]);
      const [existing] = await tx
        .select()
        .from(operations)
        .where(
          and(
            eq(operations.pactRecordId, pactRecordId),
            eq(operations.triggerKind, "MANUAL"),
            eq(operations.triggerKey, triggerKey),
          ),
        )
        .limit(1);
      if (existing !== undefined) return asOperation(existing);
      const [active] = await tx
        .select()
        .from(operations)
        .where(
          and(
            eq(operations.pactRecordId, pactRecordId),
            inArray(operations.state, [...ACTIVE_STATES]),
          ),
        )
        .limit(1);
      if (active === undefined) throw new Error("operation enqueue conflict");
      return asOperation(active);
    });
  }

  async getOperation(id: string): Promise<OperationWithPact | undefined> {
    const [row] = await this.#database.db
      .select({ operation: operations, pact: pactRecords })
      .from(operations)
      .innerJoin(pactRecords, eq(operations.pactRecordId, pactRecords.id))
      .where(eq(operations.id, id))
      .limit(1);
    return row === undefined
      ? undefined
      : Object.freeze({
          operation: asOperation(row.operation),
          pact: asPactRecord(row.pact),
        });
  }

  async listPendingOperationIds(limit: number): Promise<readonly string[]> {
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 25) {
      throw new Error("pending operation limit must be between 1 and 25");
    }
    const rows = await this.#database.db
      .select({ id: operations.id })
      .from(operations)
      .where(eq(operations.state, "PENDING"))
      .orderBy(operations.createdAt)
      .limit(limit);
    return rows.map(({ id }) => id);
  }

  async transitionOperation(
    id: string,
    expectedStates: readonly OperationState[],
    nextState: OperationState,
    options: { readonly code?: string; readonly retryable?: boolean } = {},
  ): Promise<OperationRecord | undefined> {
    const rows = await this.#database.db
      .update(operations)
      .set({
        state: nextState,
        code: options.code ?? null,
        retryable: options.retryable ?? false,
        version: sql`${operations.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(operations.id, id),
          inArray(operations.state, [...expectedStates]),
        ),
      )
      .returning();
    return rows[0] === undefined ? undefined : asOperation(rows[0]);
  }

  async persistVerification(
    operationId: string,
    result: PersistedVerificationResult,
    nextState: OperationState,
  ): Promise<number> {
    return this.#database.db.transaction(async (tx) => {
      const [operation] = await tx
        .select()
        .from(operations)
        .where(eq(operations.id, operationId))
        .limit(1);
      if (operation === undefined || operation.state !== "VERIFYING_GITHUB")
        throw new Error("verification operation lost CAS ownership");
      const [aggregate] = await tx
        .select({ value: count() })
        .from(verificationAttempts)
        .where(eq(verificationAttempts.operationId, operationId));
      const attemptNumber = (aggregate?.value ?? 0) + 1;
      const evidence = evidenceValues(result.evidence, result.evidenceHash);
      if (result.status === "SATISFIED" && evidence === undefined)
        throw new Error("SATISFIED verification requires canonical evidence");
      if (evidence !== undefined) {
        await tx.insert(evidenceRecords).values(evidence).onConflictDoNothing();
        const [storedEvidence] = await tx
          .select()
          .from(evidenceRecords)
          .where(eq(evidenceRecords.evidenceHash, evidence.evidenceHash))
          .limit(1);
        if (storedEvidence === undefined)
          throw new Error("persisted evidence could not be read back");
        validateEvidenceRowIntegrity(storedEvidence, evidence.evidenceHash);
      }
      await tx.insert(verificationAttempts).values({
        id: crypto.randomUUID(),
        operationId,
        attemptNumber,
        observedAt: result.observedAt.toString(),
        resultStatus: result.status,
        ...(result.reason === undefined ? {} : { reason: result.reason }),
        retryable: result.retryable,
        ...(result.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: result.retryAfterSeconds }),
        ...(result.rateLimitRemaining === undefined
          ? {}
          : { rateLimitRemaining: result.rateLimitRemaining }),
        ...(result.rateLimitResetAt === undefined
          ? {}
          : { rateLimitResetAt: result.rateLimitResetAt.toString() }),
        ...(result.evidenceHash === undefined
          ? {}
          : { evidenceHash: result.evidenceHash }),
      });
      const transitioned = await tx
        .update(operations)
        .set({
          state: nextState,
          code: result.reason ?? null,
          retryable: result.retryable,
          version: sql`${operations.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(operations.id, operationId),
            eq(operations.state, "VERIFYING_GITHUB"),
          ),
        )
        .returning({ id: operations.id });
      if (transitioned.length !== 1)
        throw new Error("verification persistence CAS failed");
      return attemptNumber;
    });
  }

  async persistChainReconciliation(
    operationId: string,
    snapshot: PersistedChainSnapshot,
    outcome: "READY" | "RETRYABLE" | "INVALID",
    code: string | undefined,
    nextState: OperationState,
  ): Promise<number> {
    return this.#database.db.transaction(async (tx) => {
      const [aggregate] = await tx
        .select({ value: count() })
        .from(chainReconciliations)
        .where(eq(chainReconciliations.operationId, operationId));
      const attemptNumber = (aggregate?.value ?? 0) + 1;
      await tx.insert(chainReconciliations).values({
        id: crypto.randomUUID(),
        operationId,
        attemptNumber,
        outcome,
        ...(code === undefined ? {} : { code }),
        blockNumber: snapshot.blockNumber.toString(),
        blockHash: snapshot.blockHash,
        blockTimestamp: snapshot.blockTimestamp.toString(),
        chainId: snapshot.chainId.toString(),
        pactEvaluator: snapshot.pactEvaluator,
        commerceContract: snapshot.commerceContract,
        jobId: snapshot.jobId.toString(),
        jobKey: snapshot.jobKey,
        bindingExists: snapshot.bindingExists,
        bindingConditionHash: snapshot.bindingConditionHash,
        bindingCompletionDeadline:
          snapshot.bindingCompletionDeadline.toString(),
        bindingVerifier: snapshot.bindingVerifier,
        bindingAccepted: snapshot.bindingAccepted,
        verifierRevoked: snapshot.verifierRevoked,
        jobClient: snapshot.jobClient,
        jobProvider: snapshot.jobProvider,
        jobEvaluator: snapshot.jobEvaluator,
        jobStatus: snapshot.jobStatus,
        jobExpiredAt: snapshot.jobExpiredAt.toString(),
      });
      const transitioned = await tx
        .update(operations)
        .set({
          state: nextState,
          code: code ?? null,
          retryable: outcome === "RETRYABLE",
          version: sql`${operations.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(operations.id, operationId),
            eq(operations.state, "RECONCILING_CHAIN"),
          ),
        )
        .returning({ id: operations.id });
      if (transitioned.length !== 1)
        throw new Error("chain reconciliation persistence CAS failed");
      return attemptNumber;
    });
  }

  async persistReadyToRelay(
    operationId: string,
    pactRecordId: string,
    evidence: NonNullable<PersistedVerificationResult["evidence"]>,
    evidenceHash: NonNullable<PersistedVerificationResult["evidenceHash"]>,
    attestation: PersistedAttestation,
  ): Promise<void> {
    await this.#database.db.transaction(async (tx) => {
      const canonical = evidenceValues(evidence, evidenceHash);
      if (canonical === undefined)
        throw new Error("canonical evidence is required");
      await tx.insert(evidenceRecords).values(canonical).onConflictDoNothing();
      const [storedEvidence] = await tx
        .select()
        .from(evidenceRecords)
        .where(eq(evidenceRecords.evidenceHash, evidenceHash))
        .limit(1);
      if (storedEvidence === undefined)
        throw new Error("persisted evidence could not be read back");
      validateEvidenceRowIntegrity(storedEvidence, evidenceHash);
      await tx.insert(attestations).values({
        digest: attestation.digest,
        operationId,
        pactRecordId,
        jobKey: attestation.jobKey,
        evidenceHash: attestation.evidenceHash,
        signer: attestation.signer,
        chainId: attestation.chainId.toString(),
        verifyingContract: attestation.verifyingContract,
        commerceContract: attestation.commerceContract,
        jobId: attestation.jobId.toString(),
        conditionHash: attestation.conditionHash,
        satisfiedAt: attestation.satisfiedAt.toString(),
        verifiedAt: attestation.verifiedAt.toString(),
        validUntil: attestation.validUntil.toString(),
        signature: attestation.signature,
        active: true,
      });
      const transitioned = await tx
        .update(operations)
        .set({
          state: "READY_TO_RELAY",
          code: null,
          retryable: false,
          version: sql`${operations.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(eq(operations.id, operationId), eq(operations.state, "SIGNING")),
        )
        .returning({ id: operations.id });
      if (transitioned.length !== 1)
        throw new Error("READY_TO_RELAY persistence CAS failed");
    });
  }

  async recoverTransitionalOperations(staleBefore: Date): Promise<number> {
    const rows = await this.#database.db
      .update(operations)
      .set({
        state: "PENDING",
        code: "RECOVERED_AFTER_RESTART",
        retryable: true,
        version: sql`${operations.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          inArray(operations.state, [...TRANSITIONAL_STATES]),
          lt(operations.updatedAt, staleBefore),
        ),
      )
      .returning({ id: operations.id });
    return rows.length;
  }
}
