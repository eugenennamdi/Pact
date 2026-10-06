import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import postgres from "postgres";

const migrations = [
  {
    version: 0,
    name: "0000_overrated_baron_zemo",
    url: new URL(
      "../packages/database/drizzle/0000_overrated_baron_zemo.sql",
      import.meta.url,
    ),
    tables: [
      "attestations",
      "chain_reconciliations",
      "evidence_records",
      "github_deliveries",
      "operations",
      "pact_records",
      "verification_attempts",
    ],
    indexes: [
      "attestations_one_active_per_pact_uq",
      "attestations_job_key_idx",
      "chain_reconciliations_sequence_uq",
      "chain_reconciliations_operation_idx",
      "operations_trigger_uq",
      "operations_one_active_per_pact_uq",
      "operations_state_idx",
      "pact_records_chain_job_uq",
      "pact_records_job_key_uq",
      "pact_records_github_lookup_idx",
      "verification_attempts_sequence_uq",
      "verification_attempts_operation_idx",
    ],
  },
  {
    version: 1,
    name: "0001_sour_preak",
    url: new URL(
      "../packages/database/drizzle/0001_sour_preak.sql",
      import.meta.url,
    ),
    tables: ["relay_intents"],
    indexes: [
      "relay_intents_attestation_uq",
      "relay_intents_sender_unresolved_uq",
      "relay_intents_sender_nonce_uq",
      "relay_intents_state_idx",
    ],
    functions: ["pact_guard_relay_intent_identity"],
    triggers: ["relay_intents_identity_guard"],
  },
  {
    version: 2,
    name: "0002_product_foundation",
    url: new URL(
      "../packages/product/drizzle/0002_product_foundation.sql",
      import.meta.url,
    ),
    tables: ["pact_drafts", "wallet_actions", "auth_nonces"],
    indexes: [
      "pact_drafts_public_slug_uq",
      "pact_drafts_creator_idempotency_uq",
      "pact_drafts_linked_pact_idx",
      "wallet_actions_signer_idempotency_uq",
      "wallet_actions_draft_idx",
      "auth_nonces_nonce_uq",
      "auth_nonces_active_wallet_domain_uq",
      "auth_nonces_expiry_idx",
    ],
    functions: ["pact_guard_product_draft_core"],
    triggers: ["pact_drafts_core_guard"],
  },
  {
    version: 3,
    name: "0003_wallet_lifecycle",
    url: new URL(
      "../packages/product/drizzle/0003_wallet_lifecycle.sql",
      import.meta.url,
    ),
    columns: [
      "semantic_hash",
      "prepared_at_block",
      "prepared_at_block_hash",
      "preparation_expires_at",
      "expected_state_transition",
      "completion_deadline",
      "job_expired_at",
      "confirmed_job_id",
      "confirmed_job_key",
      "confirmed_job_status",
      "confirmed_at_block",
      "confirmed_at_block_hash",
      "confirmed_at",
    ],
    indexes: [
      "wallet_actions_draft_action_uq",
      "wallet_actions_transaction_hash_uq",
      "wallet_actions_expiry_idx",
    ],
  },
  {
    version: 4,
    name: "0004_automatic_settlement",
    url: new URL(
      "../packages/product/drizzle/0004_automatic_settlement.sql",
      import.meta.url,
    ),
    tables: ["pact_automation"],
    indexes: [
      "pact_automation_draft_uq",
      "pact_automation_pact_record_uq",
      "pact_automation_due_idx",
      "pact_automation_lease_idx",
    ],
  },
];

function databaseUrl(environment) {
  const value = environment.DATABASE_URL;
  if (typeof value !== "string" || value.length === 0)
    throw new Error("DATABASE_URL is required");
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:")
    throw new Error("DATABASE_URL must use postgres:// or postgresql://");
  return value;
}

async function preparedMigrations() {
  return Promise.all(
    migrations.map(async (migration) => {
      const sql = (await readFile(migration.url, "utf8")).replaceAll(
        "--> statement-breakpoint",
        "",
      );
      return Object.freeze({
        ...migration,
        sql,
        checksum: createHash("sha256").update(sql).digest("hex"),
      });
    }),
  );
}

async function existingArtifacts(transaction, migration) {
  const names = [...(migration.tables ?? []), ...(migration.indexes ?? [])];
  let existing = 0;
  if (names.length > 0) {
    const rows = await transaction`
      SELECT relname FROM pg_class
      WHERE relnamespace = 'public'::regnamespace AND relname = ANY(${names})
    `;
    existing += rows.length;
  }
  if ((migration.functions?.length ?? 0) > 0) {
    const rows = await transaction`
      SELECT proname FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace
        AND proname = ANY(${migration.functions})
    `;
    existing += rows.length;
  }
  if ((migration.triggers?.length ?? 0) > 0) {
    const rows = await transaction`
      SELECT tgname FROM pg_trigger
      WHERE NOT tgisinternal AND tgname = ANY(${migration.triggers})
    `;
    existing += rows.length;
  }
  if ((migration.columns?.length ?? 0) > 0) {
    const rows = await transaction`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'wallet_actions'
        AND column_name = ANY(${migration.columns})
    `;
    existing += rows.length;
  }
  const expected =
    names.length +
    (migration.functions?.length ?? 0) +
    (migration.triggers?.length ?? 0) +
    (migration.columns?.length ?? 0);
  return { existing, expected };
}

export async function runProductMigrations(
  environment = process.env,
  log = (message) => process.stdout.write(`${message}\n`),
) {
  const connection = postgres(databaseUrl(environment), {
    max: 1,
    connect_timeout: 10,
    idle_timeout: 5,
    onnotice: () => undefined,
    prepare: false,
  });
  const prepared = await preparedMigrations();
  try {
    const results = await connection.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(hashtext('pact:product:migrations:v1'))`;
      await transaction`
        CREATE TABLE IF NOT EXISTS pact_runtime_migrations (
          version integer PRIMARY KEY,
          name varchar(128) NOT NULL UNIQUE,
          checksum varchar(64) NOT NULL,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `;
      const applied = await transaction`
        SELECT version, name, checksum
        FROM pact_runtime_migrations
        ORDER BY version
      `;
      for (const [position, record] of applied.entries()) {
        const expected = prepared[position];
        if (
          expected === undefined ||
          record.version !== expected.version ||
          record.name !== expected.name ||
          record.checksum !== expected.checksum
        ) {
          throw new Error("MIGRATION_HISTORY_MISMATCH");
        }
      }
      const outcome = [];
      for (const migration of prepared.slice(applied.length)) {
        const artifacts = await existingArtifacts(transaction, migration);
        if (
          artifacts.existing !== 0 &&
          artifacts.existing !== artifacts.expected
        )
          throw new Error(`MIGRATION_PARTIAL_SCHEMA_${migration.version}`);
        const status =
          artifacts.existing === artifacts.expected ? "adopted" : "applied";
        if (status === "applied") await transaction.unsafe(migration.sql);
        await transaction`
          INSERT INTO pact_runtime_migrations (version, name, checksum)
          VALUES (${migration.version}, ${migration.name}, ${migration.checksum})
        `;
        outcome.push({
          version: migration.version,
          name: migration.name,
          status,
        });
      }
      return outcome;
    });
    if (results.length === 0)
      log("Pact migrations: already current (0000-0004)");
    for (const result of results)
      log(`Pact migration ${result.name}: ${result.status}`);
    return Object.freeze(results);
  } finally {
    await connection.end({ timeout: 5 });
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runProductMigrations().catch((error) => {
    const message = error instanceof Error ? error.message : "";
    const reason =
      /^MIGRATION_[A-Z0-9_]+$/.test(message) ||
      message === "DATABASE_URL is required" ||
      message === "DATABASE_URL must be a valid PostgreSQL URL" ||
      message === "DATABASE_URL must use postgres:// or postgresql://"
        ? message
        : "MIGRATION_FAILED";
    process.stderr.write(`Pact migrations failed: ${reason}\n`);
    process.exitCode = 1;
  });
}
