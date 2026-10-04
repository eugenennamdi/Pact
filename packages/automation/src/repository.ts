import type { PactDatabase } from "@pact/database";
import type {
  AutomationLease,
  AutomationRecord,
  AutomationRepository,
  CompleteLeaseInput,
} from "./types.js";

interface AutomationRow {
  readonly id: string;
  readonly draft_id: string;
  readonly pact_record_id: string;
  readonly enabled: boolean;
  readonly next_check_at: Date | string;
  readonly last_check_at: Date | string | null;
  readonly last_result: string | null;
  readonly consecutive_retryable_failures: number;
  readonly lease_owner: string | null;
  readonly lease_token: string | null;
  readonly lease_until: Date | string | null;
  readonly last_operation_id: string | null;
  readonly last_wake_key: string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

function timestamp(value: Date | string): Date {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime()))
    throw new Error("INVALID_DATABASE_TIMESTAMP");
  return parsed;
}

function nullableTimestamp(value: Date | string | null): Date | null {
  return value === null ? null : timestamp(value);
}

function mapRow(row: AutomationRow): AutomationRecord {
  return Object.freeze({
    id: row.id,
    draftId: row.draft_id,
    pactRecordId: row.pact_record_id,
    enabled: row.enabled,
    nextCheckAt: timestamp(row.next_check_at),
    lastCheckAt: nullableTimestamp(row.last_check_at),
    lastResult: row.last_result,
    consecutiveRetryableFailures: row.consecutive_retryable_failures,
    leaseOwner: row.lease_owner,
    leaseToken: row.lease_token,
    leaseUntil: nullableTimestamp(row.lease_until),
    lastOperationId: row.last_operation_id,
    lastWakeKey: row.last_wake_key,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  });
}

function lease(row: AutomationRow): AutomationLease {
  const mapped = mapRow(row);
  if (
    mapped.leaseOwner === null ||
    mapped.leaseToken === null ||
    mapped.leaseUntil === null
  ) {
    throw new Error("AUTOMATION_LEASE_INCOMPLETE");
  }
  return mapped as AutomationLease;
}

function bounded(label: string, value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum)
    throw new Error(`${label} is outside its supported range`);
  return value;
}

export class PostgresAutomationRepository implements AutomationRepository {
  readonly #database: PactDatabase;

  constructor(database: PactDatabase) {
    this.#database = database;
  }

  async ensureScheduled(
    draftId: string,
    pactRecordId: string,
  ): Promise<AutomationRecord> {
    const rows = await this.#database.sql<AutomationRow[]>`
      INSERT INTO pact_automation (
        id, draft_id, pact_record_id, next_check_at, last_result
      ) VALUES (
        ${crypto.randomUUID()}, ${draftId}, ${pactRecordId}, now(),
        'SCHEDULED'
      )
      ON CONFLICT (draft_id) DO UPDATE SET
        enabled = true,
        next_check_at = LEAST(pact_automation.next_check_at, now()),
        updated_at = now()
      WHERE pact_automation.pact_record_id = EXCLUDED.pact_record_id
      RETURNING *
    `;
    const row = rows[0];
    if (row === undefined) throw new Error("AUTOMATION_IDENTITY_CONFLICT");
    return mapRow(row);
  }

  async wake(
    draftId: string,
    pactRecordId: string,
    idempotencyKey: string,
  ): Promise<{
    readonly record: AutomationRecord;
    readonly replayed: boolean;
  }> {
    return this.#database.sql.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(hashtext(${`automation:${draftId}`}))`;
      const existing = await transaction<AutomationRow[]>`
        SELECT * FROM pact_automation WHERE draft_id = ${draftId} FOR UPDATE
      `;
      const row = existing[0];
      if (row !== undefined) {
        if (row.pact_record_id !== pactRecordId)
          throw new Error("AUTOMATION_IDENTITY_CONFLICT");
        if (row.last_wake_key === idempotencyKey)
          return { record: mapRow(row), replayed: true };
        const updated = await transaction<AutomationRow[]>`
          UPDATE pact_automation SET
            enabled = true,
            next_check_at = now(),
            last_result = 'MANUAL_WAKE',
            last_wake_key = ${idempotencyKey},
            updated_at = now()
          WHERE id = ${row.id}
          RETURNING *
        `;
        if (updated[0] === undefined) throw new Error("AUTOMATION_WAKE_FAILED");
        return { record: mapRow(updated[0]), replayed: false };
      }
      const inserted = await transaction<AutomationRow[]>`
        INSERT INTO pact_automation (
          id, draft_id, pact_record_id, next_check_at,
          last_result, last_wake_key
        ) VALUES (
          ${crypto.randomUUID()}, ${draftId}, ${pactRecordId}, now(),
          'MANUAL_WAKE', ${idempotencyKey}
        ) RETURNING *
      `;
      if (inserted[0] === undefined) throw new Error("AUTOMATION_WAKE_FAILED");
      return { record: mapRow(inserted[0]), replayed: false };
    });
  }

  async claimDue(
    owner: string,
    limit: number,
    leaseSeconds: number,
  ): Promise<readonly AutomationLease[]> {
    bounded("automation claim limit", limit, 25);
    bounded("automation lease seconds", leaseSeconds, 300);
    const rows = await this.#database.sql<AutomationRow[]>`
      WITH due AS (
        SELECT id FROM pact_automation
        WHERE enabled = true
          AND next_check_at <= now()
          AND (lease_until IS NULL OR lease_until <= now())
        ORDER BY next_check_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      UPDATE pact_automation pa SET
        lease_owner = ${owner},
        lease_token = gen_random_uuid(),
        lease_until = now() + (${leaseSeconds} * interval '1 second'),
        updated_at = now()
      FROM due
      WHERE pa.id = due.id
      RETURNING pa.*
    `;
    return rows.map(lease);
  }

  async renewLease(
    id: string,
    owner: string,
    token: string,
    leaseSeconds: number,
  ): Promise<boolean> {
    bounded("automation lease seconds", leaseSeconds, 300);
    const rows = await this.#database.sql<{ readonly id: string }[]>`
      UPDATE pact_automation SET
        lease_until = now() + (${leaseSeconds} * interval '1 second'),
        updated_at = now()
      WHERE id = ${id}
        AND lease_owner = ${owner}
        AND lease_token = ${token}
        AND lease_until > now()
      RETURNING id
    `;
    return rows.length === 1;
  }

  async completeLease(input: CompleteLeaseInput): Promise<boolean> {
    if (!Number.isSafeInteger(input.delaySeconds) || input.delaySeconds < 0)
      throw new Error("automation delay is invalid");
    const rows = await this.#database.sql<{ readonly id: string }[]>`
      UPDATE pact_automation SET
        enabled = ${input.enabled},
        next_check_at = now() + (${input.delaySeconds} * interval '1 second'),
        last_check_at = now(),
        last_result = ${input.result},
        consecutive_retryable_failures = CASE
          WHEN ${input.retryableFailure} THEN consecutive_retryable_failures + 1
          ELSE 0
        END,
        last_operation_id = ${input.operationId ?? null},
        lease_owner = NULL,
        lease_token = NULL,
        lease_until = NULL,
        updated_at = now()
      WHERE id = ${input.id}
        AND lease_owner = ${input.owner}
        AND lease_token = ${input.token}
        AND lease_until > now()
      RETURNING id
    `;
    return rows.length === 1;
  }

  async get(id: string): Promise<AutomationRecord | undefined> {
    const rows = await this.#database.sql<AutomationRow[]>`
      SELECT * FROM pact_automation WHERE id = ${id} LIMIT 1
    `;
    return rows[0] === undefined ? undefined : mapRow(rows[0]);
  }
}
