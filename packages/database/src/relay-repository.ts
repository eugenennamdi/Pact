import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  hashGithubPrMergedCondition,
  hashPactGitHubPrMergedEvidenceV1,
  hashPactJobIdentity,
  normalizeGithubPrMergedCondition,
  normalizePactGitHubPrMergedEvidenceV1,
  normalizePactJobIdentity,
} from "@pact/protocol";
import { getAddress, type Address, type Hex } from "viem";
import type { PactDatabase } from "./client.js";
import {
  attestations,
  chainReconciliations,
  evidenceRecords,
  operations,
  pactRecords,
  relayIntents,
} from "./schema.js";
import type {
  CanonicalRelayOutcome,
  PactRecord,
  PersistedAttestation,
  PersistedRelayTransaction,
  ReadyToRelayArtifact,
  RelayIntentRecord,
  RelayNonceReservation,
  RelayState,
} from "./types.js";

const UNRESOLVED_STATES = [
  "PREPARING",
  "SIGNED",
  "DISPATCHING",
  "SUBMITTED",
  "BROADCAST_UNKNOWN",
] as const satisfies readonly RelayState[];

type PactRow = typeof pactRecords.$inferSelect;
type AttestationRow = typeof attestations.$inferSelect;
type EvidenceRow = typeof evidenceRecords.$inferSelect;
type RelayRow = typeof relayIntents.$inferSelect;

function asPact(row: PactRow): PactRecord {
  if (
    row.conditionProvider !== "github" ||
    row.conditionEvent !== "PR_MERGED"
  ) {
    throw new Error("DATABASE_CONDITION_INTEGRITY_MISMATCH");
  }
  const condition = normalizeGithubPrMergedCondition({
    provider: row.conditionProvider,
    repository: row.conditionRepository,
    pullRequest: row.conditionPullRequest,
    baseBranch: row.conditionBaseBranch,
    event: row.conditionEvent,
  });
  const conditionHash = hashGithubPrMergedCondition(condition);
  if (
    row.conditionSchemaVersion !== condition.schemaVersion ||
    row.conditionHash !== conditionHash
  ) {
    throw new Error("DATABASE_CONDITION_INTEGRITY_MISMATCH");
  }
  const record: PactRecord = Object.freeze({
    id: row.id,
    chainId: BigInt(row.chainId),
    commerceContract: getAddress(row.commerceContract),
    pactEvaluator: getAddress(row.pactEvaluator),
    jobId: BigInt(row.jobId),
    jobKey: row.jobKey as PactRecord["jobKey"],
    condition,
    conditionHash: conditionHash as PactRecord["conditionHash"],
    completionDeadline: BigInt(row.completionDeadline),
  });
  const jobKey = hashPactJobIdentity(
    normalizePactJobIdentity({
      chainId: record.chainId,
      commerceContract: record.commerceContract,
      jobId: record.jobId,
    }),
  );
  if (jobKey !== record.jobKey)
    throw new Error("DATABASE_JOB_KEY_INTEGRITY_MISMATCH");
  return record;
}

function asAttestation(row: AttestationRow): PersistedAttestation {
  return Object.freeze({
    digest: row.digest as PersistedAttestation["digest"],
    signature: row.signature as Hex,
    signer: getAddress(row.signer),
    chainId: BigInt(row.chainId),
    verifyingContract: getAddress(row.verifyingContract),
    commerceContract: getAddress(row.commerceContract),
    jobId: BigInt(row.jobId),
    conditionHash: row.conditionHash as PersistedAttestation["conditionHash"],
    evidenceHash: row.evidenceHash as PersistedAttestation["evidenceHash"],
    satisfiedAt: BigInt(row.satisfiedAt),
    verifiedAt: BigInt(row.verifiedAt),
    validUntil: BigInt(row.validUntil),
    jobKey: row.jobKey as PersistedAttestation["jobKey"],
  });
}

function asEvidence(row: EvidenceRow) {
  const evidence = normalizePactGitHubPrMergedEvidenceV1({
    conditionHash: row.conditionHash,
    repository: row.repository,
    pullRequest: row.pullRequest,
    baseBranch: row.baseBranch,
    mergeCommitSha: row.mergeCommitSha,
    mergedAt: BigInt(row.mergedAt),
    observedAt: BigInt(row.observedAt),
  });
  if (
    row.schemaVersion !== evidence.schemaVersion ||
    hashPactGitHubPrMergedEvidenceV1(evidence) !== row.evidenceHash
  )
    throw new Error("DATABASE_EVIDENCE_INTEGRITY_MISMATCH");
  return evidence;
}

function optionalBigInt(value: string | null): bigint | null {
  return value === null ? null : BigInt(value);
}

function optionalAddress(value: string | null): Address | null {
  return value === null ? null : getAddress(value);
}

function asRelayIntent(row: RelayRow): RelayIntentRecord {
  const nonce = row.nonce === null ? null : Number(row.nonce);
  if (nonce !== null && !Number.isSafeInteger(nonce))
    throw new Error("DATABASE_RELAY_NONCE_INVALID");
  return Object.freeze({
    id: row.id,
    pactRecordId: row.pactRecordId,
    attestationDigest:
      row.attestationDigest as RelayIntentRecord["attestationDigest"],
    state: row.state as RelayState,
    code: row.code,
    retryable: row.retryable,
    chainId: BigInt(row.chainId),
    relayAddress: getAddress(row.relayAddress),
    pactEvaluator: getAddress(row.pactEvaluator),
    commerceContract: getAddress(row.commerceContract),
    nonce,
    calldata: row.calldata as Hex | null,
    serializedTransaction: row.serializedTransaction as Hex | null,
    expectedTxHash: row.expectedTxHash as RelayIntentRecord["expectedTxHash"],
    transactionType:
      row.transactionType as RelayIntentRecord["transactionType"],
    gasLimit: optionalBigInt(row.gasLimit),
    gasPrice: optionalBigInt(row.gasPrice),
    maxFeePerGas: optionalBigInt(row.maxFeePerGas),
    maxPriorityFeePerGas: optionalBigInt(row.maxPriorityFeePerGas),
    preDispatchBlockNumber: optionalBigInt(row.preDispatchBlockNumber),
    preDispatchBlockHash:
      row.preDispatchBlockHash as RelayIntentRecord["preDispatchBlockHash"],
    broadcastAttemptCount: row.broadcastAttemptCount,
    returnedTxHash: row.returnedTxHash as RelayIntentRecord["returnedTxHash"],
    receiptStatus: row.receiptStatus as RelayIntentRecord["receiptStatus"],
    receiptBlockNumber: optionalBigInt(row.receiptBlockNumber),
    receiptBlockHash:
      row.receiptBlockHash as RelayIntentRecord["receiptBlockHash"],
    receiptTransactionIndex: row.receiptTransactionIndex,
    canonicalTxHash:
      row.canonicalTxHash as RelayIntentRecord["canonicalTxHash"],
    eventBlockNumber: optionalBigInt(row.eventBlockNumber),
    eventBlockHash: row.eventBlockHash as RelayIntentRecord["eventBlockHash"],
    eventLogIndex: row.eventLogIndex,
    eventRelayer: optionalAddress(row.eventRelayer),
    eventVerifier: optionalAddress(row.eventVerifier),
    version: row.version,
  });
}

function boundedLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 25)
    throw new Error("relay limit must be between 1 and 25");
  return limit;
}

export interface ReserveRelayNonceInput {
  readonly artifact: ReadyToRelayArtifact;
  readonly relayAddress: Address;
  readonly preDispatchBlockNumber: bigint;
  readonly preDispatchBlockHash: PersistedRelayTransaction["preDispatchBlockHash"];
  readonly readNonces: () => Promise<{
    readonly latest: number;
    readonly pending: number;
  }>;
}

export class PostgresRelayRepository {
  readonly #database: PactDatabase;

  constructor(database: PactDatabase) {
    this.#database = database;
  }

  async listReadyToRelayArtifacts(
    limit: number,
  ): Promise<readonly ReadyToRelayArtifact[]> {
    const rows = await this.#database.db
      .select({
        operation: operations,
        pact: pactRecords,
        attestation: attestations,
        evidence: evidenceRecords,
      })
      .from(operations)
      .innerJoin(pactRecords, eq(operations.pactRecordId, pactRecords.id))
      .innerJoin(attestations, eq(attestations.operationId, operations.id))
      .innerJoin(
        evidenceRecords,
        eq(evidenceRecords.evidenceHash, attestations.evidenceHash),
      )
      .leftJoin(
        relayIntents,
        eq(relayIntents.attestationDigest, attestations.digest),
      )
      .where(
        and(
          eq(operations.state, "READY_TO_RELAY"),
          eq(attestations.active, true),
          isNull(relayIntents.id),
        ),
      )
      .orderBy(operations.updatedAt)
      .limit(boundedLimit(limit));
    const artifacts: ReadyToRelayArtifact[] = [];
    for (const row of rows) {
      const [reconciliation] = await this.#database.db
        .select({ blockNumber: chainReconciliations.blockNumber })
        .from(chainReconciliations)
        .where(eq(chainReconciliations.operationId, row.operation.id))
        .orderBy(desc(chainReconciliations.attemptNumber))
        .limit(1);
      if (reconciliation === undefined)
        throw new Error("READY_TO_RELAY_CHAIN_SNAPSHOT_MISSING");
      artifacts.push(
        Object.freeze({
          operationId: row.operation.id,
          pact: asPact(row.pact),
          evidence: asEvidence(row.evidence),
          attestation: asAttestation(row.attestation),
          readyBlockNumber: BigInt(reconciliation.blockNumber),
        }),
      );
    }
    return artifacts;
  }

  async getIntent(id: string): Promise<RelayIntentRecord | undefined> {
    const [row] = await this.#database.db
      .select()
      .from(relayIntents)
      .where(eq(relayIntents.id, id))
      .limit(1);
    return row === undefined ? undefined : asRelayIntent(row);
  }

  async listIntents(
    states: readonly RelayState[],
    limit: number,
  ): Promise<readonly RelayIntentRecord[]> {
    if (states.length === 0) return [];
    const rows = await this.#database.db
      .select()
      .from(relayIntents)
      .where(inArray(relayIntents.state, [...states]))
      .orderBy(relayIntents.updatedAt)
      .limit(boundedLimit(limit));
    return rows.map(asRelayIntent);
  }

  async recordTerminalBeforeNonce(input: {
    readonly artifact: ReadyToRelayArtifact;
    readonly relayAddress: Address;
    readonly state: Extract<
      RelayState,
      | "SETTLED_EXTERNALLY"
      | "COMPLETED_BY_DIFFERENT_ATTESTATION"
      | "INTEGRITY_FAILURE"
      | "EXPIRED_UNSENT"
      | "PRECONDITION_FAILED"
      | "INSUFFICIENT_RELAY_GAS"
    >;
    readonly code: string;
    readonly outcome?: CanonicalRelayOutcome;
  }): Promise<RelayIntentRecord> {
    const outcome = input.outcome;
    const rows = await this.#database.db
      .insert(relayIntents)
      .values({
        id: crypto.randomUUID(),
        pactRecordId: input.artifact.pact.id,
        attestationDigest: input.artifact.attestation.digest,
        state: input.state,
        code: input.code,
        retryable: false,
        chainId: input.artifact.pact.chainId.toString(),
        relayAddress: getAddress(input.relayAddress),
        pactEvaluator: input.artifact.pact.pactEvaluator,
        commerceContract: input.artifact.pact.commerceContract,
        ...(outcome?.canonicalTxHash === undefined
          ? {}
          : { canonicalTxHash: outcome.canonicalTxHash }),
        ...(outcome?.receiptStatus === undefined
          ? {}
          : { receiptStatus: outcome.receiptStatus }),
        ...(outcome?.receiptBlockNumber === undefined
          ? {}
          : { receiptBlockNumber: outcome.receiptBlockNumber.toString() }),
        ...(outcome?.receiptBlockHash === undefined
          ? {}
          : { receiptBlockHash: outcome.receiptBlockHash }),
        ...(outcome?.receiptTransactionIndex === undefined
          ? {}
          : { receiptTransactionIndex: outcome.receiptTransactionIndex }),
        ...(outcome?.eventBlockNumber === undefined
          ? {}
          : { eventBlockNumber: outcome.eventBlockNumber.toString() }),
        ...(outcome?.eventBlockHash === undefined
          ? {}
          : { eventBlockHash: outcome.eventBlockHash }),
        ...(outcome?.eventLogIndex === undefined
          ? {}
          : { eventLogIndex: outcome.eventLogIndex }),
        ...(outcome?.eventRelayer === undefined
          ? {}
          : { eventRelayer: outcome.eventRelayer }),
        ...(outcome?.eventVerifier === undefined
          ? {}
          : { eventVerifier: outcome.eventVerifier }),
      })
      .onConflictDoNothing()
      .returning();
    if (rows[0] !== undefined) return asRelayIntent(rows[0]);
    const [existing] = await this.#database.db
      .select()
      .from(relayIntents)
      .where(
        eq(relayIntents.attestationDigest, input.artifact.attestation.digest),
      )
      .limit(1);
    if (existing === undefined)
      throw new Error("relay terminal insert conflict");
    return asRelayIntent(existing);
  }

  async reserveNonce(
    input: ReserveRelayNonceInput,
  ): Promise<RelayNonceReservation> {
    return this.#database.db.transaction(async (tx) => {
      const lockKey = `${input.artifact.pact.chainId}:${getAddress(input.relayAddress).toLowerCase()}`;
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
      );
      const [existingArtifact] = await tx
        .select()
        .from(relayIntents)
        .where(
          eq(relayIntents.attestationDigest, input.artifact.attestation.digest),
        )
        .limit(1);
      if (existingArtifact !== undefined)
        return { kind: "EXISTING", intent: asRelayIntent(existingArtifact) };

      const [busy] = await tx
        .select()
        .from(relayIntents)
        .where(
          and(
            eq(relayIntents.chainId, input.artifact.pact.chainId.toString()),
            eq(relayIntents.relayAddress, getAddress(input.relayAddress)),
            inArray(relayIntents.state, [...UNRESOLVED_STATES]),
          ),
        )
        .limit(1);
      if (busy !== undefined)
        return { kind: "SENDER_BUSY", intent: asRelayIntent(busy) };

      const nonces = await input.readNonces();
      if (
        !Number.isSafeInteger(nonces.latest) ||
        !Number.isSafeInteger(nonces.pending) ||
        nonces.latest < 0 ||
        nonces.pending < nonces.latest
      ) {
        throw new Error("RPC_NONCE_RESPONSE_INVALID");
      }
      const [lastBroadcast] = await tx
        .select({ nonce: relayIntents.nonce })
        .from(relayIntents)
        .where(
          and(
            eq(relayIntents.chainId, input.artifact.pact.chainId.toString()),
            eq(relayIntents.relayAddress, getAddress(input.relayAddress)),
            eq(relayIntents.broadcastAttemptCount, 1),
          ),
        )
        .orderBy(desc(sql`${relayIntents.nonce}::numeric`))
        .limit(1);
      const expectedLatest =
        lastBroadcast?.nonce === null || lastBroadcast?.nonce === undefined
          ? nonces.latest
          : Number(lastBroadcast.nonce) + 1;
      const drift =
        nonces.pending !== nonces.latest || nonces.latest !== expectedLatest;
      const [inserted] = await tx
        .insert(relayIntents)
        .values({
          id: crypto.randomUUID(),
          pactRecordId: input.artifact.pact.id,
          attestationDigest: input.artifact.attestation.digest,
          state: drift ? "NONCE_DRIFT" : "PREPARING",
          code: drift
            ? nonces.pending !== nonces.latest
              ? "UNKNOWN_PENDING_TX"
              : "LATEST_NONCE_DRIFT"
            : null,
          retryable: false,
          chainId: input.artifact.pact.chainId.toString(),
          relayAddress: getAddress(input.relayAddress),
          pactEvaluator: input.artifact.pact.pactEvaluator,
          commerceContract: input.artifact.pact.commerceContract,
          ...(drift ? {} : { nonce: nonces.pending.toString() }),
          preDispatchBlockNumber: input.preDispatchBlockNumber.toString(),
          preDispatchBlockHash: input.preDispatchBlockHash,
        })
        .returning();
      if (inserted === undefined) throw new Error("relay reservation failed");
      return {
        kind: drift ? "NONCE_DRIFT" : "RESERVED",
        intent: asRelayIntent(inserted),
      } as RelayNonceReservation;
    });
  }

  async persistSignedTransaction(
    id: string,
    transaction: PersistedRelayTransaction,
  ): Promise<RelayIntentRecord | undefined> {
    const [row] = await this.#database.db
      .update(relayIntents)
      .set({
        state: "SIGNED",
        calldata: transaction.calldata,
        serializedTransaction: transaction.serializedTransaction,
        expectedTxHash: transaction.expectedTxHash,
        transactionType: transaction.transactionType,
        gasLimit: transaction.gasLimit.toString(),
        gasPrice: transaction.gasPrice?.toString() ?? null,
        maxFeePerGas: transaction.maxFeePerGas?.toString() ?? null,
        maxPriorityFeePerGas:
          transaction.maxPriorityFeePerGas?.toString() ?? null,
        preDispatchBlockNumber: transaction.preDispatchBlockNumber.toString(),
        preDispatchBlockHash: transaction.preDispatchBlockHash,
        version: sql`${relayIntents.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(relayIntents.id, id), eq(relayIntents.state, "PREPARING")))
      .returning();
    return row === undefined ? undefined : asRelayIntent(row);
  }

  async claimDispatch(id: string): Promise<RelayIntentRecord | undefined> {
    const [row] = await this.#database.db
      .update(relayIntents)
      .set({
        state: "DISPATCHING",
        broadcastAttemptCount: 1,
        version: sql`${relayIntents.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(relayIntents.id, id),
          eq(relayIntents.state, "SIGNED"),
          eq(relayIntents.broadcastAttemptCount, 0),
        ),
      )
      .returning();
    return row === undefined ? undefined : asRelayIntent(row);
  }

  async transitionPreDispatch(input: {
    readonly id: string;
    readonly expectedStates: readonly ("PREPARING" | "SIGNED")[];
    readonly state: Extract<
      RelayState,
      | "EXPIRED_UNSENT"
      | "PRECONDITION_FAILED"
      | "INTEGRITY_FAILURE"
      | "INSUFFICIENT_RELAY_GAS"
      | "SETTLED_EXTERNALLY"
      | "COMPLETED_BY_DIFFERENT_ATTESTATION"
    >;
    readonly code: string;
    readonly retryable?: boolean;
    readonly outcome?: CanonicalRelayOutcome;
  }): Promise<RelayIntentRecord | undefined> {
    const outcome = input.outcome;
    const [row] = await this.#database.db
      .update(relayIntents)
      .set({
        state: input.state,
        code: input.code,
        retryable: input.retryable ?? false,
        ...(outcome?.canonicalTxHash === undefined
          ? {}
          : { canonicalTxHash: outcome.canonicalTxHash }),
        ...(outcome?.eventBlockNumber === undefined
          ? {}
          : { eventBlockNumber: outcome.eventBlockNumber.toString() }),
        ...(outcome?.eventBlockHash === undefined
          ? {}
          : { eventBlockHash: outcome.eventBlockHash }),
        ...(outcome?.eventLogIndex === undefined
          ? {}
          : { eventLogIndex: outcome.eventLogIndex }),
        ...(outcome?.eventRelayer === undefined
          ? {}
          : { eventRelayer: outcome.eventRelayer }),
        ...(outcome?.eventVerifier === undefined
          ? {}
          : { eventVerifier: outcome.eventVerifier }),
        version: sql`${relayIntents.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(relayIntents.id, input.id),
          inArray(relayIntents.state, [...input.expectedStates]),
        ),
      )
      .returning();
    return row === undefined ? undefined : asRelayIntent(row);
  }

  async recordBroadcastResult(input: {
    readonly id: string;
    readonly state: "SUBMITTED" | "BROADCAST_UNKNOWN" | "INTEGRITY_FAILURE";
    readonly code?: string;
    readonly returnedTxHash?: RelayIntentRecord["expectedTxHash"];
  }): Promise<RelayIntentRecord | undefined> {
    const [row] = await this.#database.db
      .update(relayIntents)
      .set({
        state: input.state,
        code: input.code ?? null,
        retryable: input.state === "BROADCAST_UNKNOWN",
        returnedTxHash: input.returnedTxHash ?? null,
        version: sql`${relayIntents.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(relayIntents.id, input.id),
          eq(relayIntents.state, "DISPATCHING"),
        ),
      )
      .returning();
    return row === undefined ? undefined : asRelayIntent(row);
  }

  async transitionOutcome(input: {
    readonly id: string;
    readonly expectedStates: readonly ("SUBMITTED" | "BROADCAST_UNKNOWN")[];
    readonly state: Extract<
      RelayState,
      | "SETTLED"
      | "SETTLED_EXTERNALLY"
      | "COMPLETED_BY_DIFFERENT_ATTESTATION"
      | "REVERTED"
      | "INTEGRITY_FAILURE"
      | "BROADCAST_UNKNOWN"
    >;
    readonly code?: string;
    readonly retryable?: boolean;
    readonly outcome?: CanonicalRelayOutcome;
  }): Promise<RelayIntentRecord | undefined> {
    const outcome = input.outcome;
    const [row] = await this.#database.db
      .update(relayIntents)
      .set({
        state: input.state,
        code: input.code ?? null,
        retryable: input.retryable ?? input.state === "BROADCAST_UNKNOWN",
        ...(outcome?.canonicalTxHash === undefined
          ? {}
          : { canonicalTxHash: outcome.canonicalTxHash }),
        ...(outcome?.receiptStatus === undefined
          ? {}
          : { receiptStatus: outcome.receiptStatus }),
        ...(outcome?.receiptBlockNumber === undefined
          ? {}
          : { receiptBlockNumber: outcome.receiptBlockNumber.toString() }),
        ...(outcome?.receiptBlockHash === undefined
          ? {}
          : { receiptBlockHash: outcome.receiptBlockHash }),
        ...(outcome?.receiptTransactionIndex === undefined
          ? {}
          : { receiptTransactionIndex: outcome.receiptTransactionIndex }),
        ...(outcome?.eventBlockNumber === undefined
          ? {}
          : { eventBlockNumber: outcome.eventBlockNumber.toString() }),
        ...(outcome?.eventBlockHash === undefined
          ? {}
          : { eventBlockHash: outcome.eventBlockHash }),
        ...(outcome?.eventLogIndex === undefined
          ? {}
          : { eventLogIndex: outcome.eventLogIndex }),
        ...(outcome?.eventRelayer === undefined
          ? {}
          : { eventRelayer: outcome.eventRelayer }),
        ...(outcome?.eventVerifier === undefined
          ? {}
          : { eventVerifier: outcome.eventVerifier }),
        version: sql`${relayIntents.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(relayIntents.id, input.id),
          inArray(relayIntents.state, [...input.expectedStates]),
        ),
      )
      .returning();
    return row === undefined ? undefined : asRelayIntent(row);
  }

  async recoverDispatching(
    relayAddress: Address,
    chainId: bigint,
  ): Promise<number> {
    const rows = await this.#database.db
      .update(relayIntents)
      .set({
        state: "BROADCAST_UNKNOWN",
        code: "RECOVERED_DISPATCH_BOUNDARY",
        retryable: true,
        version: sql`${relayIntents.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(relayIntents.chainId, chainId.toString()),
          eq(relayIntents.relayAddress, getAddress(relayAddress)),
          eq(relayIntents.state, "DISPATCHING"),
        ),
      )
      .returning({ id: relayIntents.id });
    return rows.length;
  }

  async findArtifactByIntent(
    id: string,
  ): Promise<ReadyToRelayArtifact | undefined> {
    const [row] = await this.#database.db
      .select({
        operation: operations,
        pact: pactRecords,
        attestation: attestations,
        evidence: evidenceRecords,
      })
      .from(relayIntents)
      .innerJoin(
        attestations,
        eq(attestations.digest, relayIntents.attestationDigest),
      )
      .innerJoin(
        evidenceRecords,
        eq(evidenceRecords.evidenceHash, attestations.evidenceHash),
      )
      .innerJoin(operations, eq(operations.id, attestations.operationId))
      .innerJoin(pactRecords, eq(pactRecords.id, relayIntents.pactRecordId))
      .where(eq(relayIntents.id, id))
      .limit(1);
    if (row === undefined) return undefined;
    const [reconciliation] = await this.#database.db
      .select({ blockNumber: chainReconciliations.blockNumber })
      .from(chainReconciliations)
      .where(eq(chainReconciliations.operationId, row.operation.id))
      .orderBy(desc(chainReconciliations.attemptNumber))
      .limit(1);
    if (reconciliation === undefined)
      throw new Error("READY_TO_RELAY_CHAIN_SNAPSHOT_MISSING");
    return Object.freeze({
      operationId: row.operation.id,
      pact: asPact(row.pact),
      evidence: asEvidence(row.evidence),
      attestation: asAttestation(row.attestation),
      readyBlockNumber: BigInt(reconciliation.blockNumber),
    });
  }
}

export { UNRESOLVED_STATES };
