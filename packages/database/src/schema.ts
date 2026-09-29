import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const pactRecords = pgTable(
  "pact_records",
  {
    id: uuid("id").primaryKey(),
    chainId: varchar("chain_id", { length: 78 }).notNull(),
    commerceContract: varchar("commerce_contract", { length: 42 }).notNull(),
    pactEvaluator: varchar("pact_evaluator", { length: 42 }).notNull(),
    jobId: varchar("job_id", { length: 78 }).notNull(),
    jobKey: varchar("job_key", { length: 66 }).notNull(),
    conditionSchemaVersion: integer("condition_schema_version").notNull(),
    conditionProvider: varchar("condition_provider", { length: 16 }).notNull(),
    conditionRepository: varchar("condition_repository", {
      length: 140,
    }).notNull(),
    conditionPullRequest: bigint("condition_pull_request", {
      mode: "number",
    }).notNull(),
    conditionBaseBranch: varchar("condition_base_branch", {
      length: 255,
    }).notNull(),
    conditionEvent: varchar("condition_event", { length: 32 }).notNull(),
    conditionHash: varchar("condition_hash", { length: 66 }).notNull(),
    completionDeadline: varchar("completion_deadline", {
      length: 20,
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("pact_records_chain_job_uq").on(
      table.chainId,
      table.pactEvaluator,
      table.commerceContract,
      table.jobId,
    ),
    uniqueIndex("pact_records_job_key_uq").on(table.jobKey),
    index("pact_records_github_lookup_idx").on(
      table.conditionRepository,
      table.conditionPullRequest,
    ),
    check("pact_records_pr_positive", sql`${table.conditionPullRequest} > 0`),
  ],
);

export const githubDeliveries = pgTable(
  "github_deliveries",
  {
    deliveryId: varchar("delivery_id", { length: 36 }).primaryKey(),
    event: varchar("event", { length: 64 }).notNull(),
    action: varchar("action", { length: 64 }).notNull(),
    repository: varchar("repository", { length: 140 }),
    pullRequest: bigint("pull_request", { mode: "number" }),
    signatureValid: boolean("signature_valid").notNull(),
    processingState: varchar("processing_state", { length: 32 }).notNull(),
    matchedPacts: integer("matched_pacts").default(0).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "github_deliveries_signature_valid",
      sql`${table.signatureValid} = true`,
    ),
    check(
      "github_deliveries_processing_state_valid",
      sql`${table.processingState} in ('RECEIVED','IGNORED','ENQUEUED','NO_NEW_OPERATION')`,
    ),
  ],
);

export const operations = pgTable(
  "operations",
  {
    id: uuid("id").primaryKey(),
    pactRecordId: uuid("pact_record_id")
      .notNull()
      .references(() => pactRecords.id, { onDelete: "restrict" }),
    triggerKind: varchar("trigger_kind", { length: 24 }).notNull(),
    triggerKey: varchar("trigger_key", { length: 128 }).notNull(),
    state: varchar("state", { length: 40 }).notNull(),
    code: varchar("code", { length: 80 }),
    retryable: boolean("retryable").default(false).notNull(),
    retryAfterAt: timestamp("retry_after_at", { withTimezone: true }),
    version: integer("version").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("operations_trigger_uq").on(
      table.pactRecordId,
      table.triggerKind,
      table.triggerKey,
    ),
    uniqueIndex("operations_one_active_per_pact_uq")
      .on(table.pactRecordId)
      .where(
        sql`${table.state} in ('PENDING','VERIFYING_GITHUB','VERIFIED','RECONCILING_CHAIN','READY_TO_SIGN','SIGNING','READY_TO_RELAY')`,
      ),
    index("operations_state_idx").on(table.state, table.updatedAt),
    check("operations_version_nonnegative", sql`${table.version} >= 0`),
    check(
      "operations_trigger_kind_valid",
      sql`${table.triggerKind} in ('GITHUB_WEBHOOK','MANUAL','RECOVERY')`,
    ),
    check(
      "operations_state_valid",
      sql`${table.state} in ('PENDING','VERIFYING_GITHUB','NOT_SATISFIED_RETRYABLE','NOT_SATISFIED_TERMINAL','INDETERMINATE','VERIFIED','RECONCILING_CHAIN','CHAIN_RETRYABLE','CHAIN_INVALID','READY_TO_SIGN','SIGNING','READY_TO_RELAY','ALREADY_ACCEPTED','EXPIRED','FAILED_DEFINITE')`,
    ),
  ],
);

export const evidenceRecords = pgTable(
  "evidence_records",
  {
    evidenceHash: varchar("evidence_hash", { length: 66 }).primaryKey(),
    schemaVersion: integer("schema_version").notNull(),
    conditionHash: varchar("condition_hash", { length: 66 }).notNull(),
    repository: varchar("repository", { length: 140 }).notNull(),
    pullRequest: bigint("pull_request", { mode: "number" }).notNull(),
    baseBranch: varchar("base_branch", { length: 255 }).notNull(),
    mergeCommitSha: varchar("merge_commit_sha", { length: 42 }).notNull(),
    mergedAt: varchar("merged_at", { length: 20 }).notNull(),
    observedAt: varchar("observed_at", { length: 20 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("evidence_records_pr_positive", sql`${table.pullRequest} > 0`),
  ],
);

export const verificationAttempts = pgTable(
  "verification_attempts",
  {
    id: uuid("id").primaryKey(),
    operationId: uuid("operation_id")
      .notNull()
      .references(() => operations.id, { onDelete: "restrict" }),
    attemptNumber: integer("attempt_number").notNull(),
    observedAt: varchar("observed_at", { length: 20 }).notNull(),
    resultStatus: varchar("result_status", { length: 24 }).notNull(),
    reason: varchar("reason", { length: 80 }),
    retryable: boolean("retryable").notNull(),
    retryAfterSeconds: integer("retry_after_seconds"),
    rateLimitRemaining: integer("rate_limit_remaining"),
    rateLimitResetAt: varchar("rate_limit_reset_at", { length: 20 }),
    evidenceHash: varchar("evidence_hash", { length: 66 }).references(
      () => evidenceRecords.evidenceHash,
      { onDelete: "restrict" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("verification_attempts_sequence_uq").on(
      table.operationId,
      table.attemptNumber,
    ),
    index("verification_attempts_operation_idx").on(
      table.operationId,
      table.createdAt,
    ),
    check(
      "verification_attempt_number_positive",
      sql`${table.attemptNumber} > 0`,
    ),
    check(
      "verification_result_status_valid",
      sql`${table.resultStatus} in ('SATISFIED','NOT_SATISFIED','INDETERMINATE')`,
    ),
  ],
);

export const chainReconciliations = pgTable(
  "chain_reconciliations",
  {
    id: uuid("id").primaryKey(),
    operationId: uuid("operation_id")
      .notNull()
      .references(() => operations.id, { onDelete: "restrict" }),
    attemptNumber: integer("attempt_number").notNull(),
    outcome: varchar("outcome", { length: 24 }).notNull(),
    code: varchar("code", { length: 80 }),
    blockNumber: varchar("block_number", { length: 78 }).notNull(),
    blockHash: varchar("block_hash", { length: 66 }).notNull(),
    blockTimestamp: varchar("block_timestamp", { length: 20 }).notNull(),
    chainId: varchar("chain_id", { length: 78 }).notNull(),
    pactEvaluator: varchar("pact_evaluator", { length: 42 }).notNull(),
    commerceContract: varchar("commerce_contract", { length: 42 }).notNull(),
    jobId: varchar("job_id", { length: 78 }).notNull(),
    jobKey: varchar("job_key", { length: 66 }).notNull(),
    bindingExists: boolean("binding_exists").notNull(),
    bindingConditionHash: varchar("binding_condition_hash", {
      length: 66,
    }).notNull(),
    bindingCompletionDeadline: varchar("binding_completion_deadline", {
      length: 20,
    }).notNull(),
    bindingVerifier: varchar("binding_verifier", { length: 42 }).notNull(),
    bindingAccepted: boolean("binding_accepted").notNull(),
    verifierRevoked: boolean("verifier_revoked").notNull(),
    jobClient: varchar("job_client", { length: 42 }).notNull(),
    jobProvider: varchar("job_provider", { length: 42 }).notNull(),
    jobEvaluator: varchar("job_evaluator", { length: 42 }).notNull(),
    jobStatus: integer("job_status").notNull(),
    jobExpiredAt: varchar("job_expired_at", { length: 20 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("chain_reconciliations_sequence_uq").on(
      table.operationId,
      table.attemptNumber,
    ),
    index("chain_reconciliations_operation_idx").on(
      table.operationId,
      table.createdAt,
    ),
    check(
      "chain_reconciliation_outcome_valid",
      sql`${table.outcome} in ('READY','RETRYABLE','INVALID')`,
    ),
    check(
      "chain_reconciliation_job_status_valid",
      sql`${table.jobStatus} between 0 and 5`,
    ),
  ],
);

export const attestations = pgTable(
  "attestations",
  {
    digest: varchar("digest", { length: 66 }).primaryKey(),
    operationId: uuid("operation_id")
      .notNull()
      .unique()
      .references(() => operations.id, { onDelete: "restrict" }),
    pactRecordId: uuid("pact_record_id")
      .notNull()
      .references(() => pactRecords.id, { onDelete: "restrict" }),
    jobKey: varchar("job_key", { length: 66 }).notNull(),
    evidenceHash: varchar("evidence_hash", { length: 66 })
      .notNull()
      .references(() => evidenceRecords.evidenceHash, { onDelete: "restrict" }),
    signer: varchar("signer", { length: 42 }).notNull(),
    chainId: varchar("chain_id", { length: 78 }).notNull(),
    verifyingContract: varchar("verifying_contract", { length: 42 }).notNull(),
    commerceContract: varchar("commerce_contract", { length: 42 }).notNull(),
    jobId: varchar("job_id", { length: 78 }).notNull(),
    conditionHash: varchar("condition_hash", { length: 66 }).notNull(),
    satisfiedAt: varchar("satisfied_at", { length: 20 }).notNull(),
    verifiedAt: varchar("verified_at", { length: 20 }).notNull(),
    validUntil: varchar("valid_until", { length: 20 }).notNull(),
    signature: varchar("signature", { length: 132 }).notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("attestations_one_active_per_pact_uq")
      .on(table.pactRecordId)
      .where(sql`${table.active} = true`),
    index("attestations_job_key_idx").on(table.jobKey),
    check(
      "attestations_time_order_valid",
      sql`${table.satisfiedAt}::numeric <= ${table.verifiedAt}::numeric and ${table.verifiedAt}::numeric <= ${table.validUntil}::numeric`,
    ),
  ],
);

export const relayIntents = pgTable(
  "relay_intents",
  {
    id: uuid("id").primaryKey(),
    pactRecordId: uuid("pact_record_id")
      .notNull()
      .references(() => pactRecords.id, { onDelete: "restrict" }),
    attestationDigest: varchar("attestation_digest", { length: 66 })
      .notNull()
      .references(() => attestations.digest, { onDelete: "restrict" }),
    state: varchar("state", { length: 48 }).notNull(),
    code: varchar("code", { length: 80 }),
    retryable: boolean("retryable").default(false).notNull(),
    chainId: varchar("chain_id", { length: 78 }).notNull(),
    relayAddress: varchar("relay_address", { length: 42 }).notNull(),
    pactEvaluator: varchar("pact_evaluator", { length: 42 }).notNull(),
    commerceContract: varchar("commerce_contract", { length: 42 }).notNull(),
    nonce: varchar("nonce", { length: 20 }),
    calldata: text("calldata"),
    serializedTransaction: text("serialized_transaction"),
    expectedTxHash: varchar("expected_tx_hash", { length: 66 }),
    transactionType: varchar("transaction_type", { length: 16 }),
    gasLimit: varchar("gas_limit", { length: 78 }),
    gasPrice: varchar("gas_price", { length: 78 }),
    maxFeePerGas: varchar("max_fee_per_gas", { length: 78 }),
    maxPriorityFeePerGas: varchar("max_priority_fee_per_gas", { length: 78 }),
    preDispatchBlockNumber: varchar("pre_dispatch_block_number", {
      length: 78,
    }),
    preDispatchBlockHash: varchar("pre_dispatch_block_hash", { length: 66 }),
    broadcastAttemptCount: integer("broadcast_attempt_count")
      .default(0)
      .notNull(),
    returnedTxHash: varchar("returned_tx_hash", { length: 66 }),
    receiptStatus: varchar("receipt_status", { length: 12 }),
    receiptBlockNumber: varchar("receipt_block_number", { length: 78 }),
    receiptBlockHash: varchar("receipt_block_hash", { length: 66 }),
    receiptTransactionIndex: integer("receipt_transaction_index"),
    canonicalTxHash: varchar("canonical_tx_hash", { length: 66 }),
    eventBlockNumber: varchar("event_block_number", { length: 78 }),
    eventBlockHash: varchar("event_block_hash", { length: 66 }),
    eventLogIndex: integer("event_log_index"),
    eventRelayer: varchar("event_relayer", { length: 42 }),
    eventVerifier: varchar("event_verifier", { length: 42 }),
    version: integer("version").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("relay_intents_attestation_uq").on(table.attestationDigest),
    uniqueIndex("relay_intents_sender_unresolved_uq")
      .on(table.chainId, table.relayAddress)
      .where(
        sql`${table.state} in ('PREPARING','SIGNED','DISPATCHING','SUBMITTED','BROADCAST_UNKNOWN')`,
      ),
    uniqueIndex("relay_intents_sender_nonce_uq")
      .on(table.chainId, table.relayAddress, table.nonce)
      .where(
        sql`${table.nonce} is not null and ${table.state} in ('PREPARING','SIGNED','DISPATCHING','SUBMITTED','BROADCAST_UNKNOWN')`,
      ),
    index("relay_intents_state_idx").on(table.state, table.updatedAt),
    check("relay_intents_version_nonnegative", sql`${table.version} >= 0`),
    check(
      "relay_intents_broadcast_count_valid",
      sql`${table.broadcastAttemptCount} between 0 and 1`,
    ),
    check(
      "relay_intents_state_valid",
      sql`${table.state} in ('PREPARING','SIGNED','DISPATCHING','SUBMITTED','BROADCAST_UNKNOWN','SETTLED','SETTLED_EXTERNALLY','COMPLETED_BY_DIFFERENT_ATTESTATION','REVERTED','INTEGRITY_FAILURE','EXPIRED_UNSENT','PRECONDITION_FAILED','NONCE_DRIFT','INSUFFICIENT_RELAY_GAS')`,
    ),
    check(
      "relay_intents_dispatch_identity_valid",
      sql`${table.state} not in ('SIGNED','DISPATCHING','SUBMITTED','BROADCAST_UNKNOWN','SETTLED','REVERTED') or (${table.nonce} is not null and ${table.calldata} is not null and ${table.serializedTransaction} is not null and ${table.expectedTxHash} is not null and ${table.gasLimit} is not null and ${table.transactionType} is not null and ${table.preDispatchBlockNumber} is not null and ${table.preDispatchBlockHash} is not null)`,
    ),
  ],
);
