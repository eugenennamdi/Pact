import { sql } from "drizzle-orm";
import {
  bigint,
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

export const pactDrafts = pgTable(
  "pact_drafts",
  {
    id: uuid("id").primaryKey(),
    publicSlug: varchar("public_slug", { length: 64 }).notNull(),
    creatingWallet: varchar("creating_wallet", { length: 42 }).notNull(),
    providerAddress: varchar("provider_address", { length: 42 }).notNull(),
    githubRepository: varchar("github_repository", { length: 140 }).notNull(),
    githubPullRequest: bigint("github_pull_request", {
      mode: "number",
    }).notNull(),
    baseBranch: varchar("base_branch", { length: 255 }).notNull(),
    event: varchar("event", { length: 32 }).notNull(),
    amountBaseUnits: varchar("amount_base_units", { length: 78 }).notNull(),
    network: varchar("network", { length: 32 }).notNull(),
    chainId: varchar("chain_id", { length: 78 }).notNull(),
    conditionHash: varchar("condition_hash", { length: 66 }).notNull(),
    completionPolicyVersion: integer("completion_policy_version").notNull(),
    completionOffsetSeconds: integer("completion_offset_seconds").notNull(),
    expiryPolicyVersion: integer("expiry_policy_version").notNull(),
    expiryOffsetSeconds: integer("expiry_offset_seconds").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    canonicalRequestHash: varchar("canonical_request_hash", {
      length: 66,
    }).notNull(),
    linkedPactRecordId: uuid("linked_pact_record_id"),
    lifecycle: varchar("lifecycle", { length: 32 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("pact_drafts_public_slug_uq").on(table.publicSlug),
    uniqueIndex("pact_drafts_creator_idempotency_uq").on(
      table.creatingWallet,
      table.idempotencyKey,
    ),
    index("pact_drafts_linked_pact_idx").on(table.linkedPactRecordId),
    check("pact_drafts_pr_positive", sql`${table.githubPullRequest} > 0`),
    check(
      "pact_drafts_amount_positive",
      sql`${table.amountBaseUnits} ~ '^[1-9][0-9]*$'`,
    ),
    check("pact_drafts_event_valid", sql`${table.event} = 'PR_MERGED'`),
    check("pact_drafts_network_valid", sql`${table.network} = 'arc-testnet'`),
  ],
);

export const walletActions = pgTable(
  "wallet_actions",
  {
    id: uuid("id").primaryKey(),
    draftId: uuid("draft_id").notNull(),
    pactRecordId: uuid("pact_record_id"),
    action: varchar("action", { length: 32 }).notNull(),
    requiredSigner: varchar("required_signer", { length: 42 }).notNull(),
    chainId: varchar("chain_id", { length: 78 }).notNull(),
    expectedTarget: varchar("expected_target", { length: 42 }).notNull(),
    value: varchar("value", { length: 78 }).notNull(),
    calldataHash: varchar("calldata_hash", { length: 66 }).notNull(),
    preparationVersion: integer("preparation_version").notNull(),
    transactionHash: varchar("transaction_hash", { length: 66 }),
    confirmationStatus: varchar("confirmation_status", {
      length: 24,
    }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("wallet_actions_signer_idempotency_uq").on(
      table.requiredSigner,
      table.idempotencyKey,
    ),
    index("wallet_actions_draft_idx").on(table.draftId, table.createdAt),
    check(
      "wallet_actions_kind_valid",
      sql`${table.action} in ('CREATE_JOB','BIND_CONDITION','SET_BUDGET','APPROVE_USDC','FUND','SUBMIT')`,
    ),
    check(
      "wallet_actions_confirmation_valid",
      sql`${table.confirmationStatus} in ('PENDING','SUBMITTED','CONFIRMED','FAILED')`,
    ),
  ],
);

export const authNonces = pgTable(
  "auth_nonces",
  {
    id: uuid("id").primaryKey(),
    walletAddress: varchar("wallet_address", { length: 42 }).notNull(),
    domain: varchar("domain", { length: 255 }).notNull(),
    uri: text("uri").notNull(),
    nonce: varchar("nonce", { length: 64 }).notNull(),
    chainId: varchar("chain_id", { length: 78 }).notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("auth_nonces_nonce_uq").on(table.nonce),
    uniqueIndex("auth_nonces_active_wallet_domain_uq")
      .on(table.walletAddress, table.domain)
      .where(sql`${table.consumedAt} is null`),
    index("auth_nonces_expiry_idx").on(table.expiresAt),
    check(
      "auth_nonces_expiry_valid",
      sql`${table.expiresAt} > ${table.issuedAt}`,
    ),
  ],
);
