import { readFile } from "node:fs/promises";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const configuredUrl =
  process.env.CI === "true"
    ? process.env.DATABASE_URL
    : process.env.PRODUCT_DATABASE_TEST_URL;
const describeMigration =
  configuredUrl === undefined ? describe.skip : describe;
const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
const emptyDatabaseName = `pact_product_empty_${suffix}`;
const existingDatabaseName = `pact_product_existing_${suffix}`;
let administrator: Sql | undefined;
let emptyDatabase: Sql | undefined;
let existingDatabase: Sql | undefined;

function databaseUrl(name: string): string {
  if (configuredUrl === undefined)
    throw new Error("PRODUCT_DATABASE_TEST_URL missing");
  const url = new URL(configuredUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

async function migration(path: URL): Promise<string> {
  return (await readFile(path, "utf8")).replaceAll(
    "--> statement-breakpoint",
    "",
  );
}

async function applyCertifiedSchema(database: Sql): Promise<void> {
  await database.unsafe(
    await migration(
      new URL(
        "../../database/drizzle/0000_overrated_baron_zemo.sql",
        import.meta.url,
      ),
    ),
  );
  await database.unsafe(
    await migration(
      new URL("../../database/drizzle/0001_sour_preak.sql", import.meta.url),
    ),
  );
}

async function applyProductMigration(database: Sql): Promise<void> {
  await database.unsafe(
    await migration(
      new URL("../drizzle/0002_product_foundation.sql", import.meta.url),
    ),
  );
  await database.unsafe(
    await migration(
      new URL("../drizzle/0003_wallet_lifecycle.sql", import.meta.url),
    ),
  );
}

describeMigration("product forward migration", () => {
  beforeAll(async () => {
    if (configuredUrl === undefined) return;
    administrator = postgres(configuredUrl, { max: 1, prepare: false });
    await administrator.unsafe(`CREATE DATABASE "${emptyDatabaseName}"`);
    await administrator.unsafe(`CREATE DATABASE "${existingDatabaseName}"`);
    emptyDatabase = postgres(databaseUrl(emptyDatabaseName), {
      max: 1,
      prepare: false,
    });
    existingDatabase = postgres(databaseUrl(existingDatabaseName), {
      max: 1,
      prepare: false,
    });
    await applyCertifiedSchema(emptyDatabase);
    await applyCertifiedSchema(existingDatabase);
  }, 60_000);

  afterAll(async () => {
    await emptyDatabase?.end({ timeout: 5 });
    await existingDatabase?.end({ timeout: 5 });
    if (administrator !== undefined) {
      await administrator.unsafe(
        `DROP DATABASE IF EXISTS "${emptyDatabaseName}"`,
      );
      await administrator.unsafe(
        `DROP DATABASE IF EXISTS "${existingDatabaseName}"`,
      );
      await administrator.end({ timeout: 5 });
    }
  }, 60_000);

  it("migrates an empty certified schema", async () => {
    if (emptyDatabase === undefined)
      throw new Error("test database unavailable");
    await applyProductMigration(emptyDatabase);
    const rows = await emptyDatabase<{ readonly table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('pact_drafts', 'wallet_actions', 'auth_nonces')
      ORDER BY table_name
    `;
    expect(rows.map((row) => row.table_name)).toEqual([
      "auth_nonces",
      "pact_drafts",
      "wallet_actions",
    ]);
  });

  it("preserves existing Pact records and permits product linkage", async () => {
    if (existingDatabase === undefined)
      throw new Error("test database unavailable");
    const pactId = "11111111-1111-4111-8111-111111111111";
    const client = "0x1111111111111111111111111111111111111111";
    const provider = "0x2222222222222222222222222222222222222222";
    const target = "0x3333333333333333333333333333333333333333";
    const hash = `0x${"ab".repeat(32)}`;
    await existingDatabase`
      INSERT INTO pact_records (
        id, chain_id, commerce_contract, pact_evaluator, job_id, job_key,
        condition_schema_version, condition_provider, condition_repository,
        condition_pull_request, condition_base_branch, condition_event,
        condition_hash, completion_deadline
      ) VALUES (
        ${pactId}, '5042002', ${target}, ${target}, '1', ${hash},
        1, 'github', 'example/repo', 7, 'main', 'PR_MERGED',
        ${hash}, '2000000000'
      )
    `;
    await applyProductMigration(existingDatabase);
    const before = await existingDatabase<{ readonly count: string }[]>`
      SELECT count(*)::text AS count FROM pact_records
    `;
    expect(before[0]?.count).toBe("1");
    const draftId = "22222222-2222-4222-8222-222222222222";
    await existingDatabase`
      INSERT INTO pact_drafts (
        id, public_slug, creating_wallet, provider_address,
        github_repository, github_pull_request, base_branch, event,
        amount_base_units, network, chain_id, condition_hash,
        completion_policy_version, completion_offset_seconds,
        expiry_policy_version, expiry_offset_seconds, idempotency_key,
        canonical_request_hash, linked_pact_record_id, lifecycle
      ) VALUES (
        ${draftId}, ${`pact_${"a".repeat(32)}`}, ${client}, ${provider},
        'example/repo', 7, 'main', 'PR_MERGED', '100000',
        'arc-testnet', '5042002', ${hash}, 1, 7200, 1, 21600,
        'migration-key-0001', ${hash}, ${pactId}, 'LINKED'
      )
    `;
    const linked = await existingDatabase<
      { readonly linked_pact_record_id: string }[]
    >`
      SELECT linked_pact_record_id FROM pact_drafts WHERE id = ${draftId}
    `;
    expect(linked[0]?.linked_pact_record_id).toBe(pactId);
  });

  it("enforces one active nonce and confirmed-action core immutability", async () => {
    if (existingDatabase === undefined)
      throw new Error("test database unavailable");
    const wallet = "0x1111111111111111111111111111111111111111";
    const provider = "0x2222222222222222222222222222222222222222";
    const target = "0x3333333333333333333333333333333333333333";
    const hash = `0x${"cd".repeat(32)}`;
    await existingDatabase`
      INSERT INTO auth_nonces (
        id, wallet_address, domain, uri, nonce, chain_id, issued_at, expires_at
      ) VALUES (
        ${crypto.randomUUID()}, ${wallet}, 'pact.example', 'https://pact.example',
        'abcdefghijklmnopqrstuvwx', '5042002', now(), now() + interval '5 minutes'
      )
    `;
    await expect(
      existingDatabase`
        INSERT INTO auth_nonces (
          id, wallet_address, domain, uri, nonce, chain_id, issued_at, expires_at
        ) VALUES (
          ${crypto.randomUUID()}, ${wallet}, 'pact.example', 'https://pact.example',
          'zyxwvutsrqponmlkjihgfedc', '5042002', now(), now() + interval '5 minutes'
        )
      `,
    ).rejects.toMatchObject({ code: "23505" });

    const draftId = "33333333-3333-4333-8333-333333333333";
    await existingDatabase`
      INSERT INTO pact_drafts (
        id, public_slug, creating_wallet, provider_address,
        github_repository, github_pull_request, base_branch, event,
        amount_base_units, network, chain_id, condition_hash,
        completion_policy_version, completion_offset_seconds,
        expiry_policy_version, expiry_offset_seconds, idempotency_key,
        canonical_request_hash, lifecycle
      ) VALUES (
        ${draftId}, ${`pact_${"b".repeat(32)}`}, ${wallet}, ${provider},
        'example/repo', 8, 'main', 'PR_MERGED', '100000',
        'arc-testnet', '5042002', ${hash}, 1, 7200, 1, 21600,
        'migration-key-0002', ${hash}, 'ACTION_REQUIRED'
      )
    `;
    await existingDatabase`
      INSERT INTO wallet_actions (
        id, draft_id, action, required_signer, chain_id, expected_target,
        value, calldata_hash, semantic_hash, preparation_version,
        prepared_at_block, prepared_at_block_hash, preparation_expires_at,
        expected_state_transition, confirmation_status, idempotency_key,
        confirmed_at
      ) VALUES (
        ${crypto.randomUUID()}, ${draftId}, 'CREATE_JOB', ${wallet}, '5042002',
        ${target}, '0', ${hash}, ${hash}, 1, '1', ${hash},
        now() + interval '5 minutes', 'DRAFT_TO_OPEN_JOB', 'CONFIRMED',
        'action-key-0001', now()
      )
    `;
    await expect(
      existingDatabase`
        UPDATE pact_drafts SET amount_base_units = '200000' WHERE id = ${draftId}
      `,
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("enforces one prepared action per draft and globally unique transaction claims", async () => {
    if (existingDatabase === undefined)
      throw new Error("test database unavailable");
    const wallet = "0x1111111111111111111111111111111111111111";
    const provider = "0x2222222222222222222222222222222222222222";
    const target = "0x3333333333333333333333333333333333333333";
    const hash = `0x${"ef".repeat(32)}`;
    const txHash = `0x${"12".repeat(32)}`;
    const draftId = crypto.randomUUID();
    await existingDatabase`
      INSERT INTO pact_drafts (
        id, public_slug, creating_wallet, provider_address,
        github_repository, github_pull_request, base_branch, event,
        amount_base_units, network, chain_id, condition_hash,
        completion_policy_version, completion_offset_seconds,
        expiry_policy_version, expiry_offset_seconds, idempotency_key,
        canonical_request_hash, lifecycle
      ) VALUES (
        ${draftId}, ${`pact_${"c".repeat(32)}`}, ${wallet}, ${provider},
        'example/repo', 8, 'main', 'PR_MERGED', '1000',
        'arc-testnet', '5042002', ${hash}, 1, 7200, 1, 21600,
        'migration-key-0003', ${hash}, 'ACTION_REQUIRED'
      )
    `;
    const insert = (
      id: string,
      idempotencyKey: string,
      transactionHash: string | null,
    ) =>
      existingDatabase`
        INSERT INTO wallet_actions (
          id, draft_id, action, required_signer, chain_id, expected_target,
          value, calldata_hash, semantic_hash, preparation_version,
          prepared_at_block, prepared_at_block_hash, preparation_expires_at,
          expected_state_transition, transaction_hash, confirmation_status,
          idempotency_key, confirmed_at
        ) VALUES (
          ${id}, ${draftId}, 'CREATE_JOB', ${wallet}, '5042002', ${target},
          '0', ${hash}, ${hash}, 1, '1', ${hash}, now() + interval '5 minutes',
          'DRAFT_TO_OPEN_JOB', ${transactionHash},
          ${transactionHash === null ? "PENDING" : "CONFIRMED"},
          ${idempotencyKey}, ${transactionHash === null ? null : new Date()}
        )
      `;
    await insert(crypto.randomUUID(), "wallet-action-key-01", txHash);
    await expect(
      insert(crypto.randomUUID(), "wallet-action-key-02", null),
    ).rejects.toMatchObject({ code: "23505" });
  });
});
