import { readFile } from "node:fs/promises";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runProductMigrations } from "../../../scripts/product-migrate.mjs";

const configuredUrl =
  process.env.CI === "true"
    ? process.env.DATABASE_URL
    : process.env.PRODUCT_DATABASE_TEST_URL;
const describeMigration =
  configuredUrl === undefined ? describe.skip : describe;
const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
const names = {
  empty: `pact_migrate_empty_${suffix}`,
  none: `pact_migrate_none_${suffix}`,
  certified: `pact_migrate_cert_${suffix}`,
  full: `pact_migrate_full_${suffix}`,
  records: `pact_migrate_records_${suffix}`,
} as const;
let administrator: Sql | undefined;
const databases = new Map<string, Sql>();

function url(name: string): string {
  if (configuredUrl === undefined)
    throw new Error("migration database missing");
  const parsed = new URL(configuredUrl);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

async function migration(relativePath: string): Promise<string> {
  return (
    await readFile(new URL(relativePath, import.meta.url), "utf8")
  ).replaceAll("--> statement-breakpoint", "");
}

async function run(name: string) {
  return runProductMigrations({ DATABASE_URL: url(name) }, () => undefined);
}

describeMigration("production migration runner", () => {
  beforeAll(async () => {
    if (configuredUrl === undefined) return;
    administrator = postgres(configuredUrl, { max: 1, prepare: false });
    for (const name of Object.values(names)) {
      await administrator.unsafe(`CREATE DATABASE "${name}"`);
      databases.set(name, postgres(url(name), { max: 1, prepare: false }));
    }
    await databases.get(names.none)?.unsafe(`
      CREATE TABLE pact_runtime_migrations (
        version integer PRIMARY KEY,
        name varchar(128) NOT NULL UNIQUE,
        checksum varchar(64) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const certified = databases.get(names.certified);
    if (certified === undefined) throw new Error("certified database missing");
    await certified.unsafe(
      await migration("../../database/drizzle/0000_overrated_baron_zemo.sql"),
    );
    await certified.unsafe(
      await migration("../../database/drizzle/0001_sour_preak.sql"),
    );
    await run(names.full);
    await run(names.records);
    const records = databases.get(names.records);
    if (records === undefined) throw new Error("records database missing");
    await records`
      INSERT INTO auth_nonces (
        id, wallet_address, domain, uri, nonce, chain_id, issued_at, expires_at
      ) VALUES (
        ${crypto.randomUUID()},
        '0x1111111111111111111111111111111111111111',
        'pact.example',
        'https://pact.example',
        'abcdefghijklmnopqrstuvwx',
        '5042002',
        now(),
        now() + interval '10 minutes'
      )
    `;
  }, 60_000);

  afterAll(async () => {
    for (const database of databases.values())
      await database.end({ timeout: 5 });
    if (administrator !== undefined) {
      for (const name of Object.values(names))
        await administrator.unsafe(`DROP DATABASE IF EXISTS "${name}"`);
      await administrator.end({ timeout: 5 });
    }
  }, 60_000);

  it("migrates an empty PostgreSQL database through 0004", async () => {
    const result = await run(names.empty);
    expect(result).toHaveLength(5);
    expect(result.every((entry) => entry.status === "applied")).toBe(true);
  });

  it("migrates a database with tracking but no migrations", async () => {
    const result = await run(names.none);
    expect(result.map((entry) => entry.version)).toEqual([0, 1, 2, 3, 4]);
  });

  it("adopts certified 0000-0001 and applies product 0002-0004", async () => {
    const result = await run(names.certified);
    expect(result.map((entry) => entry.status)).toEqual([
      "adopted",
      "adopted",
      "applied",
      "applied",
      "applied",
    ]);
  });

  it("is a safe no-op at full 0000-0004 state", async () => {
    await expect(run(names.full)).resolves.toEqual([]);
  });

  it("preserves legitimate product records on a repeat run", async () => {
    await expect(run(names.records)).resolves.toEqual([]);
    const records = databases.get(names.records);
    if (records === undefined) throw new Error("records database missing");
    const rows = await records<{ readonly count: number }[]>`
      SELECT count(*)::int AS count FROM auth_nonces
    `;
    expect(rows[0]?.count).toBe(1);
  });
});
