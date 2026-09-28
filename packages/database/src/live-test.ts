import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  hashGithubPrMergedCondition,
  hashPactGitHubPrMergedEvidenceV1,
  hashPactJobIdentity,
  normalizeGithubPrMergedCondition,
  normalizePactGitHubPrMergedEvidenceV1,
  normalizePactJobIdentity,
  type Hex32,
  type PactGitHubPrMergedEvidenceV1,
} from "@pact/protocol";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { keccak256, stringToHex, type Hex } from "viem";
import { createPactDatabase, type PactDatabase } from "./client.js";
import { PostgresPactRepository } from "./repository.js";
import {
  attestations,
  evidenceRecords,
  operations,
  pactRecords,
} from "./schema.js";
import * as schema from "./schema.js";
import type {
  OperationState,
  PactRecord,
  PersistedAttestation,
} from "./types.js";

const CAS_ITERATIONS = 100;
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));
const EXPECTED_TABLES = [
  "attestations",
  "chain_reconciliations",
  "evidence_records",
  "github_deliveries",
  "operations",
  "pact_records",
  "verification_attempts",
] as const;
const EXPECTED_INDEXES = [
  "attestations_one_active_per_pact_uq",
  "operations_one_active_per_pact_uq",
  "operations_trigger_uq",
  "pact_records_chain_job_uq",
  "pact_records_job_key_uq",
] as const;
const EXPECTED_CONSTRAINTS = [
  "attestations_evidence_hash_evidence_records_evidence_hash_fk",
  "attestations_operation_id_unique",
  "attestations_pkey",
  "github_deliveries_pkey",
  "operations_state_valid",
  "pact_records_pkey",
  "verification_attempts_evidence_hash_evidence_records_evidence_hash_fk",
] as const;

if (process.env.PACT_DATABASE_LIVE_TEST !== "1") {
  process.stdout.write(
    "SKIP: set PACT_DATABASE_LIVE_TEST=1 and DATABASE_URL for the live PostgreSQL test\n",
  );
  process.exit(0);
}

const configuredDatabaseUrl = process.env.DATABASE_URL;
if (configuredDatabaseUrl === undefined || configuredDatabaseUrl.length === 0) {
  throw new Error("DATABASE_URL is required for the live PostgreSQL test");
}
const databaseUrl: string = configuredDatabaseUrl;

const runId = `${Date.now().toString(36)}_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
const databasePrefix = `pact_live_${runId}`;
const createdDatabases = new Set<string>();
const admin = postgres(databaseUrl, {
  max: 5,
  connect_timeout: 5,
  prepare: false,
  onnotice: () => undefined,
  connection: { application_name: "pact-live-test-admin" },
});
let workingDatabase: PactDatabase | undefined;
let workerDatabaseA: PactDatabase | undefined;
let workerDatabaseB: PactDatabase | undefined;
let workingDatabaseUrl: string | undefined;
let fixtureNumber = 0;
let checkCount = 0;

function pass(message: string): void {
  checkCount++;
  process.stdout.write(`PASS ${checkCount}: ${message}\n`);
}

function isolatedDatabaseName(suffix: string): string {
  const value = `${databasePrefix}_${suffix}`;
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) {
    throw new Error("generated live-test database name is invalid");
  }
  return value;
}

function databaseUrlForName(value: string, databaseName: string): string {
  const parsed = new URL(value);
  parsed.pathname = `/${databaseName}`;
  parsed.searchParams.delete("options");
  return parsed.toString();
}

function createTestDatabase(value: string, max = 5): PactDatabase {
  const sqlClient = postgres(value, {
    max,
    connect_timeout: 5,
    idle_timeout: 20,
    max_lifetime: 1800,
    prepare: false,
    onnotice: () => undefined,
    connection: { application_name: "pact-live-test-worker" },
  });
  return Object.freeze({
    db: drizzle(sqlClient, { schema }),
    sql: sqlClient,
    close: async () => sqlClient.end({ timeout: 5 }),
  });
}

async function createIsolatedDatabase(name: string): Promise<string> {
  await admin`create database ${admin(name)}`;
  createdDatabases.add(name);
  return databaseUrlForName(databaseUrl, name);
}

async function dropIsolatedDatabase(name: string): Promise<void> {
  if (!createdDatabases.has(name)) return;
  await admin`drop database ${admin(name)} with (force)`;
  createdDatabases.delete(name);
}

async function migrateDatabase(value: string): Promise<PactDatabase> {
  const database = createTestDatabase(value);
  await migrate(database.db, { migrationsFolder: MIGRATIONS_FOLDER });
  return database;
}

async function validateMigratedDatabase(value: string): Promise<void> {
  const validation = postgres(value, {
    max: 1,
    prepare: false,
    onnotice: () => undefined,
    connection: { application_name: "pact-live-test-validation" },
  });
  const tableRows = await validation<
    { table_name: string }[]
  >`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`;
  const tableNames = tableRows.map(({ table_name: tableName }) => tableName);
  assert.deepEqual(tableNames, [...EXPECTED_TABLES]);

  const indexRows = await validation<
    { indexname: string }[]
  >`select indexname from pg_indexes where schemaname = 'public'`;
  const indexNames = new Set(indexRows.map(({ indexname }) => indexname));
  for (const indexName of EXPECTED_INDEXES) {
    assert(indexNames.has(indexName), `missing index ${indexName}`);
  }

  const constraintRows = await validation<
    { conname: string }[]
  >`select c.conname from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = 'public'`;
  const constraintNames = new Set(constraintRows.map(({ conname }) => conname));
  for (const constraintName of EXPECTED_CONSTRAINTS) {
    const expected = constraintName.slice(0, 63);
    assert(
      constraintNames.has(expected),
      `missing constraint ${constraintName}`,
    );
  }
  await validation.end({ timeout: 5 });
}

function hex32(label: string): Hex32 {
  return keccak256(stringToHex(`${runId}:${label}`));
}

function pactFixture(_label: string): PactRecord {
  fixtureNumber++;
  const ordinal = fixtureNumber;
  const condition = normalizeGithubPrMergedCondition({
    provider: "github",
    repository: `pact-live-test/repository-${ordinal}`,
    pullRequest: 10_000 + ordinal,
    baseBranch: "main",
    event: "PR_MERGED",
  });
  const commerceContract =
    "0x1111111111111111111111111111111111111111" as const;
  const pactEvaluator = "0x2222222222222222222222222222222222222222" as const;
  const jobId = BigInt(Date.now()) * 10_000n + BigInt(ordinal);
  return Object.freeze({
    id: crypto.randomUUID(),
    chainId: 5042n,
    commerceContract,
    pactEvaluator,
    jobId,
    jobKey: hashPactJobIdentity(
      normalizePactJobIdentity({
        chainId: 5042n,
        commerceContract,
        jobId,
      }),
    ),
    condition,
    conditionHash: hashGithubPrMergedCondition(condition),
    completionDeadline: 1_900_000_000n,
  });
}

function pactInsertValues(record: PactRecord) {
  return {
    id: record.id,
    chainId: record.chainId.toString(),
    commerceContract: record.commerceContract,
    pactEvaluator: record.pactEvaluator,
    jobId: record.jobId.toString(),
    jobKey: record.jobKey,
    conditionSchemaVersion: record.condition.schemaVersion,
    conditionProvider: record.condition.provider,
    conditionRepository: record.condition.repository,
    conditionPullRequest: record.condition.pullRequest,
    conditionBaseBranch: record.condition.baseBranch,
    conditionEvent: record.condition.event,
    conditionHash: record.conditionHash,
    completionDeadline: record.completionDeadline.toString(),
  };
}

function evidenceFixture(
  pact: PactRecord,
  label: string,
): {
  readonly evidence: PactGitHubPrMergedEvidenceV1;
  readonly evidenceHash: Hex32;
} {
  const observedAt = 1_800_000_000n + BigInt(++fixtureNumber);
  const commit = hex32(`commit:${label}`).slice(0, 42);
  const evidence = normalizePactGitHubPrMergedEvidenceV1({
    conditionHash: pact.conditionHash,
    repository: pact.condition.repository,
    pullRequest: pact.condition.pullRequest,
    baseBranch: pact.condition.baseBranch,
    mergeCommitSha: commit,
    mergedAt: observedAt - 1n,
    observedAt,
  });
  return {
    evidence,
    evidenceHash: hashPactGitHubPrMergedEvidenceV1(evidence),
  };
}

function evidenceInsertValues(
  evidence: PactGitHubPrMergedEvidenceV1,
  evidenceHash: Hex32,
) {
  return {
    evidenceHash,
    schemaVersion: evidence.schemaVersion,
    conditionHash: evidence.conditionHash,
    repository: evidence.repository,
    pullRequest: Number(evidence.pullRequest),
    baseBranch: evidence.baseBranch,
    mergeCommitSha: evidence.mergeCommitSha,
    mergedAt: evidence.mergedAt.toString(),
    observedAt: evidence.observedAt.toString(),
  };
}

function attestationFixture(input: {
  readonly pact: PactRecord;
  readonly evidence: PactGitHubPrMergedEvidenceV1;
  readonly evidenceHash: Hex32;
  readonly label: string;
}): PersistedAttestation {
  return Object.freeze({
    digest: hex32(`digest:${input.label}`),
    signature: `0x${"11".repeat(65)}` as Hex,
    signer: "0x3333333333333333333333333333333333333333",
    chainId: input.pact.chainId,
    verifyingContract: input.pact.pactEvaluator,
    commerceContract: input.pact.commerceContract,
    jobId: input.pact.jobId,
    conditionHash: input.pact.conditionHash,
    evidenceHash: input.evidenceHash,
    satisfiedAt: input.evidence.mergedAt,
    verifiedAt: input.evidence.observedAt,
    validUntil: input.evidence.observedAt + 300n,
    jobKey: input.pact.jobKey,
  });
}

function attestationInsertValues(input: {
  readonly operationId: string;
  readonly pact: PactRecord;
  readonly attestation: PersistedAttestation;
}) {
  const { attestation } = input;
  return {
    digest: attestation.digest,
    operationId: input.operationId,
    pactRecordId: input.pact.id,
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
  };
}

async function insertOperation(
  database: PactDatabase,
  pactRecordId: string,
  state: OperationState,
  label: string,
  updatedAt?: Date,
): Promise<string> {
  const id = crypto.randomUUID();
  await database.db.insert(operations).values({
    id,
    pactRecordId,
    triggerKind: "MANUAL",
    triggerKey: `${label}:${crypto.randomUUID()}`,
    state,
    ...(updatedAt === undefined ? {} : { updatedAt }),
  });
  return id;
}

function postgresErrorMetadata(error: unknown): {
  readonly code?: string;
  readonly constraint?: string;
  readonly message?: string;
} {
  let current = error;
  for (let depth = 0; depth < 5; depth++) {
    if (current === null || typeof current !== "object") break;
    const candidate = current as {
      code?: string;
      cause?: unknown;
      constraint_name?: string;
    };
    if (candidate.code !== undefined) break;
    current = candidate.cause;
  }
  if (current === null || typeof current !== "object") return {};
  const sqlError = current as {
    code?: string;
    constraint_name?: string;
    message?: string;
  };
  return {
    ...(sqlError.code === undefined ? {} : { code: sqlError.code }),
    ...(sqlError.constraint_name === undefined
      ? {}
      : { constraint: sqlError.constraint_name }),
    ...(sqlError.message === undefined ? {} : { message: sqlError.message }),
  };
}

function assertPostgresError(
  error: unknown,
  expectedCode: string,
  expectedConstraint?: string,
): void {
  const sqlError = postgresErrorMetadata(error);
  assert.equal(sqlError.code, expectedCode);
  if (expectedConstraint !== undefined) {
    assert.equal(sqlError.constraint, expectedConstraint.slice(0, 63));
  }
}

async function expectRejected(
  action: Promise<unknown>,
  code?: string,
  constraint?: string,
): Promise<unknown> {
  try {
    await action;
  } catch (error) {
    if (code !== undefined) assertPostgresError(error, code, constraint);
    return error;
  }
  assert.fail("expected operation to reject");
}

async function countRows(table: string): Promise<number> {
  assert(workingDatabase !== undefined);
  assert(/^[a-z_]+$/.test(table));
  const [row] = await workingDatabase.sql.unsafe<{ value: number }[]>(
    `select count(*)::int as value from ${table}`,
  );
  assert(row !== undefined);
  return row.value;
}

async function run(): Promise<void> {
  process.stdout.write(
    "LIVE POSTGRESQL GATE: creates/drops only uniquely prefixed test databases; it never truncates existing data.\n",
  );
  const [server] = await admin<
    { version: string; version_num: string; database_name: string }[]
  >`select current_setting('server_version') as version, current_setting('server_version_num') as version_num, current_database() as database_name`;
  assert(server !== undefined);
  assert(
    Number(server.version_num) >= 120_000,
    "live target is not a supported PostgreSQL server",
  );
  assert(
    /test/i.test(server.database_name),
    "refusing live test: target database name must contain 'test'",
  );
  process.stdout.write(
    `PostgreSQL ${server.version}; isolated target database ${server.database_name}.\n`,
  );
  pass("target is real PostgreSQL and explicitly test-named");

  for (const suffix of ["migration_one", "migration_two"] as const) {
    const name = isolatedDatabaseName(suffix);
    const value = await createIsolatedDatabase(name);
    const database = await migrateDatabase(value);
    await validateMigratedDatabase(value);
    await database.close();
    await dropIsolatedDatabase(name);
    pass(
      `${suffix.replaceAll("_", " ")} applied from zero and schema validated`,
    );
  }

  const startupDatabaseName = isolatedDatabaseName("startup_empty");
  const startupUrl = await createIsolatedDatabase(startupDatabaseName);
  const startupA = createPactDatabase(startupUrl);
  const startupB = createPactDatabase(startupUrl);
  await Promise.all([startupA.sql`select 1`, startupB.sql`select 1`]);
  const startupTables = await startupA.sql<
    { value: number }[]
  >`select count(*)::int as value from information_schema.tables where table_schema = 'public'`;
  assert.equal(startupTables[0]?.value, 0);
  await Promise.all([startupA.close(), startupB.close()]);
  await dropIsolatedDatabase(startupDatabaseName);
  pass(
    "two application clients started against an empty schema without auto-migrating",
  );

  const workDatabaseName = isolatedDatabaseName("work");
  workingDatabaseUrl = await createIsolatedDatabase(workDatabaseName);
  workingDatabase = await migrateDatabase(workingDatabaseUrl);
  workerDatabaseA = createTestDatabase(workingDatabaseUrl, 1);
  workerDatabaseB = createTestDatabase(workingDatabaseUrl, 1);
  const repository = new PostgresPactRepository(workingDatabase);
  const repositoryA = new PostgresPactRepository(workerDatabaseA);
  const repositoryB = new PostgresPactRepository(workerDatabaseB);

  const catalogBefore = await workingDatabase.sql<
    { value: number }[]
  >`select count(*)::int as value from information_schema.tables where table_schema in ('public', 'drizzle')`;
  const appA = createPactDatabase(workingDatabaseUrl);
  const appB = createPactDatabase(workingDatabaseUrl);
  const appRepositoryA = new PostgresPactRepository(appA);
  const appRepositoryB = new PostgresPactRepository(appB);
  await Promise.all([
    appRepositoryA.getPact(crypto.randomUUID()),
    appRepositoryB.getPact(crypto.randomUUID()),
  ]);
  await Promise.all([appA.close(), appB.close()]);
  const catalogAfter = await workingDatabase.sql<
    { value: number }[]
  >`select count(*)::int as value from information_schema.tables where table_schema in ('public', 'drizzle')`;
  assert.equal(catalogAfter[0]?.value, catalogBefore[0]?.value);
  pass(
    "two application instances initialized against migrated schema without mutation",
  );

  const identityPact = pactFixture("semantic-identity");
  await repository.createPact(identityPact);
  await expectRejected(
    workerDatabaseA.db.insert(pactRecords).values({
      ...pactInsertValues(identityPact),
      id: crypto.randomUUID(),
      jobKey: hex32("different-job-key"),
    }),
    "23505",
    "pact_records_chain_job_uq",
  );
  pass("duplicate semantic Pact identity rejected by database constraint");

  await expectRejected(
    workerDatabaseA.db.insert(pactRecords).values({
      ...pactInsertValues(identityPact),
      id: crypto.randomUUID(),
      jobId: (identityPact.jobId + 1n).toString(),
    }),
    "23505",
    "pact_records_job_key_uq",
  );
  pass("duplicate jobKey rejected by database constraint");

  const activePact = pactFixture("active-operation");
  await repository.createPact(activePact);
  const activeInsertResults = await Promise.allSettled([
    workerDatabaseA.db.insert(operations).values({
      id: crypto.randomUUID(),
      pactRecordId: activePact.id,
      triggerKind: "MANUAL",
      triggerKey: "active-a",
      state: "PENDING",
    }),
    workerDatabaseB.db.insert(operations).values({
      id: crypto.randomUUID(),
      pactRecordId: activePact.id,
      triggerKind: "MANUAL",
      triggerKey: "active-b",
      state: "PENDING",
    }),
  ]);
  if (
    activeInsertResults.filter(({ status }) => status === "fulfilled")
      .length !== 1
  ) {
    process.stdout.write(
      `Active-operation diagnostics: ${JSON.stringify(
        activeInsertResults.map((result) =>
          result.status === "fulfilled"
            ? { status: result.status }
            : {
                status: result.status,
                ...postgresErrorMetadata(result.reason),
              },
        ),
      )}\n`,
    );
  }
  assert.equal(
    activeInsertResults.filter(({ status }) => status === "fulfilled").length,
    1,
  );
  const activeConflict = activeInsertResults.find(
    ({ status }) => status === "rejected",
  );
  assert(activeConflict?.status === "rejected");
  assertPostgresError(
    activeConflict.reason,
    "23505",
    "operations_one_active_per_pact_uq",
  );
  pass("partial unique index permits one active operation per Pact");

  const duplicateDeliveryPact = pactFixture("duplicate-delivery");
  await repository.createPact(duplicateDeliveryPact);
  const duplicateDelivery = {
    deliveryId: crypto.randomUUID(),
    event: "pull_request",
    action: "closed",
    repository: duplicateDeliveryPact.condition.repository,
    pullRequest: duplicateDeliveryPact.condition.pullRequest,
    relevant: true,
    receivedAt: new Date(),
  } as const;
  const duplicateDeliveryResults = await Promise.all([
    repositoryA.ingestGitHubDelivery(duplicateDelivery),
    repositoryB.ingestGitHubDelivery(duplicateDelivery),
  ]);
  assert.equal(
    duplicateDeliveryResults.filter(({ duplicate }) => duplicate).length,
    1,
  );
  const deliveryCount = await workingDatabase.sql<
    { value: number }[]
  >`select count(*)::int as value from github_deliveries where delivery_id = ${duplicateDelivery.deliveryId}`;
  assert.equal(deliveryCount[0]?.value, 1);
  pass(
    "two concurrent identical webhook deliveries create one durable identity",
  );

  const triggerPact = pactFixture("concurrent-trigger");
  await repository.createPact(triggerPact);
  const triggerDelivery = {
    deliveryId: crypto.randomUUID(),
    event: "pull_request",
    action: "closed",
    repository: triggerPact.condition.repository,
    pullRequest: triggerPact.condition.pullRequest,
    relevant: true,
    receivedAt: new Date(),
  } as const;
  await Promise.all([
    repositoryA.ingestGitHubDelivery(triggerDelivery),
    repositoryB.enqueueManualOperation(triggerPact.id, crypto.randomUUID()),
  ]);
  const activeTriggerOperations = await workingDatabase.sql<
    { value: number }[]
  >`select count(*)::int as value from operations where pact_record_id = ${triggerPact.id}::uuid and state in ('PENDING','VERIFYING_GITHUB','VERIFIED','RECONCILING_CHAIN','READY_TO_SIGN','SIGNING','READY_TO_RELAY')`;
  assert.equal(activeTriggerOperations[0]?.value, 1);
  pass("concurrent webhook/manual trigger produces one active workflow");

  const casPact = pactFixture("cas-races");
  await repository.createPact(casPact);
  const casOperationId = await insertOperation(
    workingDatabase,
    casPact.id,
    "PENDING",
    "cas",
  );
  let pendingWinsA = 0;
  let pendingWinsB = 0;
  for (let iteration = 0; iteration < CAS_ITERATIONS; iteration++) {
    await workingDatabase.sql`update operations set state = 'PENDING', updated_at = now() where id = ${casOperationId}::uuid`;
    const [claimA, claimB] = await Promise.all([
      repositoryA.transitionOperation(
        casOperationId,
        ["PENDING"],
        "VERIFYING_GITHUB",
      ),
      repositoryB.transitionOperation(
        casOperationId,
        ["PENDING"],
        "VERIFYING_GITHUB",
      ),
    ]);
    assert.equal([claimA, claimB].filter(Boolean).length, 1);
    if (claimA === undefined) pendingWinsB++;
    else pendingWinsA++;
  }
  assert.equal(pendingWinsA + pendingWinsB, CAS_ITERATIONS);
  pass(
    `PENDING CAS: ${CAS_ITERATIONS} races, ${CAS_ITERATIONS} winners, ${CAS_ITERATIONS} losers, zero anomalies`,
  );

  let signingWinsA = 0;
  let signingWinsB = 0;
  for (let iteration = 0; iteration < CAS_ITERATIONS; iteration++) {
    await workingDatabase.sql`update operations set state = 'READY_TO_SIGN', updated_at = now() where id = ${casOperationId}::uuid`;
    const [claimA, claimB] = await Promise.all([
      repositoryA.transitionOperation(
        casOperationId,
        ["READY_TO_SIGN"],
        "SIGNING",
      ),
      repositoryB.transitionOperation(
        casOperationId,
        ["READY_TO_SIGN"],
        "SIGNING",
      ),
    ]);
    assert.equal([claimA, claimB].filter(Boolean).length, 1);
    if (claimA === undefined) signingWinsB++;
    else signingWinsA++;
  }
  assert.equal(signingWinsA + signingWinsB, CAS_ITERATIONS);
  pass(
    `READY_TO_SIGN CAS: ${CAS_ITERATIONS} races, ${CAS_ITERATIONS} winners, ${CAS_ITERATIONS} losers, zero anomalies`,
  );

  const repositoryArtifactPact = pactFixture("repository-artifact-race");
  await repository.createPact(repositoryArtifactPact);
  const repositoryArtifactOperation = await insertOperation(
    workingDatabase,
    repositoryArtifactPact.id,
    "SIGNING",
    "repository-artifact",
  );
  const repositoryEvidence = evidenceFixture(
    repositoryArtifactPact,
    "repository-artifact",
  );
  const repositoryArtifactA = attestationFixture({
    pact: repositoryArtifactPact,
    ...repositoryEvidence,
    label: "repository-artifact-a",
  });
  const repositoryArtifactB = attestationFixture({
    pact: repositoryArtifactPact,
    ...repositoryEvidence,
    label: "repository-artifact-b",
  });
  const repositoryArtifactResults = await Promise.allSettled([
    repositoryA.persistReadyToRelay(
      repositoryArtifactOperation,
      repositoryArtifactPact.id,
      repositoryEvidence.evidence,
      repositoryEvidence.evidenceHash,
      repositoryArtifactA,
    ),
    repositoryB.persistReadyToRelay(
      repositoryArtifactOperation,
      repositoryArtifactPact.id,
      repositoryEvidence.evidence,
      repositoryEvidence.evidenceHash,
      repositoryArtifactB,
    ),
  ]);
  assert.equal(
    repositoryArtifactResults.filter(({ status }) => status === "fulfilled")
      .length,
    1,
  );
  assert.equal(
    repositoryArtifactResults.filter(({ status }) => status === "rejected")
      .length,
    1,
  );
  const repositoryArtifactCount = await workingDatabase.sql<
    { value: number }[]
  >`select count(*)::int as value from attestations where pact_record_id = ${repositoryArtifactPact.id}::uuid and active = true`;
  assert.equal(repositoryArtifactCount[0]?.value, 1);
  assert.equal(
    (await repository.getOperation(repositoryArtifactOperation))?.operation
      .state,
    "READY_TO_RELAY",
  );
  pass(
    "repository artifact race commits one READY_TO_RELAY artifact and rejects one worker",
  );

  const directArtifactPact = pactFixture("direct-artifact-race");
  await repository.createPact(directArtifactPact);
  const directOperationA = await insertOperation(
    workingDatabase,
    directArtifactPact.id,
    "FAILED_DEFINITE",
    "direct-artifact-a",
  );
  const directOperationB = await insertOperation(
    workingDatabase,
    directArtifactPact.id,
    "FAILED_DEFINITE",
    "direct-artifact-b",
  );
  const directEvidence = evidenceFixture(directArtifactPact, "direct-artifact");
  await workingDatabase.db
    .insert(evidenceRecords)
    .values(
      evidenceInsertValues(
        directEvidence.evidence,
        directEvidence.evidenceHash,
      ),
    );
  const directArtifactA = attestationFixture({
    pact: directArtifactPact,
    ...directEvidence,
    label: "direct-artifact-a",
  });
  const directArtifactB = attestationFixture({
    pact: directArtifactPact,
    ...directEvidence,
    label: "direct-artifact-b",
  });
  const directArtifactResults = await Promise.allSettled([
    workerDatabaseA.db.insert(attestations).values(
      attestationInsertValues({
        operationId: directOperationA,
        pact: directArtifactPact,
        attestation: directArtifactA,
      }),
    ),
    workerDatabaseB.db.insert(attestations).values(
      attestationInsertValues({
        operationId: directOperationB,
        pact: directArtifactPact,
        attestation: directArtifactB,
      }),
    ),
  ]);
  assert.equal(
    directArtifactResults.filter(({ status }) => status === "fulfilled").length,
    1,
  );
  const directArtifactConflict = directArtifactResults.find(
    ({ status }) => status === "rejected",
  );
  assert(directArtifactConflict?.status === "rejected");
  assertPostgresError(
    directArtifactConflict.reason,
    "23505",
    "attestations_one_active_per_pact_uq",
  );
  pass("database constraint permits one active prepared artifact per Pact");

  const digestPactA = pactFixture("digest-a");
  const digestPactB = pactFixture("digest-b");
  await repository.createPact(digestPactA);
  await repository.createPact(digestPactB);
  const digestOperationA = await insertOperation(
    workingDatabase,
    digestPactA.id,
    "FAILED_DEFINITE",
    "digest-a",
  );
  const digestOperationB = await insertOperation(
    workingDatabase,
    digestPactB.id,
    "FAILED_DEFINITE",
    "digest-b",
  );
  const digestEvidenceA = evidenceFixture(digestPactA, "digest-a");
  const digestEvidenceB = evidenceFixture(digestPactB, "digest-b");
  await workingDatabase.db
    .insert(evidenceRecords)
    .values([
      evidenceInsertValues(
        digestEvidenceA.evidence,
        digestEvidenceA.evidenceHash,
      ),
      evidenceInsertValues(
        digestEvidenceB.evidence,
        digestEvidenceB.evidenceHash,
      ),
    ]);
  const duplicateDigest = hex32("duplicate-attestation-digest");
  const digestArtifactA = {
    ...attestationFixture({
      pact: digestPactA,
      ...digestEvidenceA,
      label: "digest-a",
    }),
    digest: duplicateDigest,
  };
  const digestArtifactB = {
    ...attestationFixture({
      pact: digestPactB,
      ...digestEvidenceB,
      label: "digest-b",
    }),
    digest: duplicateDigest,
  };
  await workingDatabase.db.insert(attestations).values(
    attestationInsertValues({
      operationId: digestOperationA,
      pact: digestPactA,
      attestation: digestArtifactA,
    }),
  );
  await expectRejected(
    workerDatabaseA.db.insert(attestations).values(
      attestationInsertValues({
        operationId: digestOperationB,
        pact: digestPactB,
        attestation: digestArtifactB,
      }),
    ),
    "23505",
    "attestations_pkey",
  );
  pass("duplicate attestation digest rejected across distinct Pacts");

  const verificationRollbackPact = pactFixture("verification-rollback");
  await repository.createPact(verificationRollbackPact);
  const verificationRollbackOperation = await insertOperation(
    workingDatabase,
    verificationRollbackPact.id,
    "VERIFYING_GITHUB",
    "verification-rollback",
  );
  const verificationRollbackEvidence = evidenceFixture(
    verificationRollbackPact,
    "verification-rollback",
  );
  await expectRejected(
    repository.persistVerification(
      verificationRollbackOperation,
      {
        observedAt: verificationRollbackEvidence.evidence.observedAt,
        status: "SATISFIED",
        retryable: false,
        evidence: verificationRollbackEvidence.evidence,
        evidenceHash: verificationRollbackEvidence.evidenceHash,
      },
      "INVALID_STATE" as OperationState,
    ),
    "23514",
    "operations_state_valid",
  );
  const rolledBackEvidence = await workingDatabase.sql<
    { value: number }[]
  >`select count(*)::int as value from evidence_records where evidence_hash = ${verificationRollbackEvidence.evidenceHash}`;
  const rolledBackAttempts = await workingDatabase.sql<
    { value: number }[]
  >`select count(*)::int as value from verification_attempts where operation_id = ${verificationRollbackOperation}::uuid`;
  assert.equal(rolledBackEvidence[0]?.value, 0);
  assert.equal(rolledBackAttempts[0]?.value, 0);
  assert.equal(
    (await repository.getOperation(verificationRollbackOperation))?.operation
      .state,
    "VERIFYING_GITHUB",
  );
  pass("verification evidence/attempt/state transaction rolls back atomically");

  const artifactRollbackPact = pactFixture("artifact-rollback");
  await repository.createPact(artifactRollbackPact);
  const artifactRollbackOperation = await insertOperation(
    workingDatabase,
    artifactRollbackPact.id,
    "READY_TO_SIGN",
    "artifact-rollback",
  );
  const artifactRollbackEvidence = evidenceFixture(
    artifactRollbackPact,
    "artifact-rollback",
  );
  const artifactRollbackAttestation = attestationFixture({
    pact: artifactRollbackPact,
    ...artifactRollbackEvidence,
    label: "artifact-rollback",
  });
  await expectRejected(
    repository.persistReadyToRelay(
      artifactRollbackOperation,
      artifactRollbackPact.id,
      artifactRollbackEvidence.evidence,
      artifactRollbackEvidence.evidenceHash,
      artifactRollbackAttestation,
    ),
  );
  const rolledBackArtifact = await workingDatabase.sql<
    { value: number }[]
  >`select count(*)::int as value from attestations where digest = ${artifactRollbackAttestation.digest}`;
  const rolledBackArtifactEvidence = await workingDatabase.sql<
    { value: number }[]
  >`select count(*)::int as value from evidence_records where evidence_hash = ${artifactRollbackEvidence.evidenceHash}`;
  assert.equal(rolledBackArtifact[0]?.value, 0);
  assert.equal(rolledBackArtifactEvidence[0]?.value, 0);
  assert.equal(
    (await repository.getOperation(artifactRollbackOperation))?.operation.state,
    "READY_TO_SIGN",
  );
  pass("attestation/READY_TO_RELAY transaction rolls back atomically");

  const immutableEvidenceBefore = await countRows("evidence_records");
  const immutableArtifactsBefore = await countRows("attestations");
  const recoveryThreshold = new Date();
  const staleAt = new Date(recoveryThreshold.getTime() - 10 * 60 * 1_000);
  const freshAt = new Date(recoveryThreshold.getTime() - 60 * 1_000);
  const recoveryCases: {
    readonly operationId: string;
    readonly initialState: OperationState;
    readonly stale: boolean;
  }[] = [];
  for (const state of [
    "VERIFYING_GITHUB",
    "RECONCILING_CHAIN",
    "SIGNING",
  ] as const) {
    for (const stale of [true, false]) {
      const recoveryPact = pactFixture(`recovery-${state}-${stale}`);
      await repository.createPact(recoveryPact);
      recoveryCases.push({
        operationId: await insertOperation(
          workingDatabase,
          recoveryPact.id,
          state,
          `recovery-${state}-${stale}`,
          stale ? staleAt : freshAt,
        ),
        initialState: state,
        stale,
      });
    }
  }
  const recovered = await repository.recoverTransitionalOperations(
    new Date(recoveryThreshold.getTime() - 5 * 60 * 1_000),
  );
  assert.equal(recovered, 3);
  for (const recoveryCase of recoveryCases) {
    const current = await repository.getOperation(recoveryCase.operationId);
    assert.equal(
      current?.operation.state,
      recoveryCase.stale ? "PENDING" : recoveryCase.initialState,
    );
  }
  assert.equal(await countRows("evidence_records"), immutableEvidenceBefore);
  assert.equal(await countRows("attestations"), immutableArtifactsBefore);
  pass(
    "stale transitional states recover; fresh states and immutable records remain",
  );

  const crashPact = pactFixture("signing-crash");
  await repository.createPact(crashPact);
  const crashOperation = await insertOperation(
    workingDatabase,
    crashPact.id,
    "READY_TO_SIGN",
    "signing-crash",
  );
  const signingClaim = await repository.transitionOperation(
    crashOperation,
    ["READY_TO_SIGN"],
    "SIGNING",
  );
  assert.equal(signingClaim?.state, "SIGNING");
  await workingDatabase.sql`update operations set updated_at = ${staleAt.toISOString()}::timestamptz where id = ${crashOperation}::uuid`;
  assert.equal(
    (
      await workingDatabase.sql<
        { value: number }[]
      >`select count(*)::int as value from attestations where operation_id = ${crashOperation}::uuid`
    )[0]?.value,
    0,
  );
  assert.equal(
    await repository.recoverTransitionalOperations(
      new Date(recoveryThreshold.getTime() - 5 * 60 * 1_000),
    ),
    1,
  );
  assert.equal(
    (await repository.getOperation(crashOperation))?.operation.state,
    "PENDING",
  );
  assert.equal(
    (
      await repository.transitionOperation(
        crashOperation,
        ["PENDING"],
        "VERIFYING_GITHUB",
      )
    )?.state,
    "VERIFYING_GITHUB",
  );
  assert.equal(
    (
      await workingDatabase.sql<
        { value: number }[]
      >`select count(*)::int as value from attestations where operation_id = ${crashOperation}::uuid`
    )[0]?.value,
    0,
  );
  pass("crash-before-artifact recovers and re-enters GitHub verification");

  const semanticOperationsBefore = await countRows("operations");
  const semanticArtifactsBefore = await countRows("attestations");
  const unavailableUrl = new URL(databaseUrl);
  unavailableUrl.hostname = "127.0.0.1";
  unavailableUrl.port = "1";
  const unavailableDatabase = createPactDatabase(unavailableUrl.toString());
  const unavailableRepository = new PostgresPactRepository(unavailableDatabase);
  await expectRejected(unavailableRepository.getPact(crypto.randomUUID()));
  await unavailableDatabase.close();
  pass("unavailable PostgreSQL propagates an operational connection failure");

  assert(workingDatabaseUrl !== undefined);
  const terminatedClient = postgres(workingDatabaseUrl, {
    max: 1,
    prepare: false,
    onnotice: () => undefined,
    connection: { application_name: "pact-live-test-terminated" },
  });
  const [backend] = await terminatedClient<
    { pid: number }[]
  >`select pg_backend_pid() as pid`;
  assert(backend !== undefined);
  const sleepingQuery = terminatedClient`select pg_sleep(10)`;
  await delay(50);
  await admin`select pg_terminate_backend(${backend.pid})`;
  await expectRejected(sleepingQuery);
  await terminatedClient.end({ timeout: 1 });
  pass(
    "terminated in-flight PostgreSQL connection rejects without semantic result",
  );

  const abortedDeliveryId = crypto.randomUUID();
  await expectRejected(
    workingDatabase.sql.begin(async (transaction) => {
      await transaction`insert into github_deliveries (delivery_id, event, action, signature_valid, processing_state) values (${abortedDeliveryId}, 'pull_request', 'closed', true, 'RECEIVED')`;
      await transaction.unsafe("select * from pact_live_missing_table");
    }),
    "42P01",
  );
  const abortedRows = await workingDatabase.sql<
    { value: number }[]
  >`select count(*)::int as value from github_deliveries where delivery_id = ${abortedDeliveryId}`;
  assert.equal(abortedRows[0]?.value, 0);
  pass("aborted transaction propagates and rolls back its prior write");

  const timeoutClient = postgres(workingDatabaseUrl, {
    max: 1,
    prepare: false,
    onnotice: () => undefined,
    connection: {
      application_name: "pact-live-test-timeout",
      statement_timeout: 50,
    },
  });
  await expectRejected(timeoutClient`select pg_sleep(0.25)`, "57014");
  await timeoutClient.end({ timeout: 1 });
  assert.equal(await countRows("operations"), semanticOperationsBefore);
  assert.equal(await countRows("attestations"), semanticArtifactsBefore);
  pass("statement timeout creates no protocol conclusion");

  process.stdout.write(
    `LIVE DATABASE PASS: ${checkCount} invariant groups; ${CAS_ITERATIONS} PENDING races and ${CAS_ITERATIONS} READY_TO_SIGN races.\n`,
  );
}

try {
  await run();
} finally {
  await Promise.allSettled([
    workerDatabaseA?.close(),
    workerDatabaseB?.close(),
    workingDatabase?.close(),
  ]);
  for (const name of [...createdDatabases].reverse()) {
    await dropIsolatedDatabase(name);
  }
  await admin.end({ timeout: 5 });
}
