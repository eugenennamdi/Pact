import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { validateDatabaseUrl } from "./client.js";
import { validatePactRecordIntegrity } from "./repository.js";
import {
  attestations,
  chainReconciliations,
  evidenceRecords,
  githubDeliveries,
  operations,
  pactRecords,
  relayIntents,
  verificationAttempts,
} from "./schema.js";
import { operationStates, relayStates } from "./types.js";

describe("Phase 4A database contract", () => {
  it("pins the eight durable domain tables", () => {
    expect(
      [
        pactRecords,
        githubDeliveries,
        operations,
        verificationAttempts,
        evidenceRecords,
        chainReconciliations,
        attestations,
        relayIntents,
      ].map((table) => getTableConfig(table).name),
    ).toEqual([
      "pact_records",
      "github_deliveries",
      "operations",
      "verification_attempts",
      "evidence_records",
      "chain_reconciliations",
      "attestations",
      "relay_intents",
    ]);
  });

  it("pins semantic uniqueness and active-artifact constraints", () => {
    const pactIndexes = getTableConfig(pactRecords).indexes.map(
      ({ config }) => config.name,
    );
    const operationIndexes = getTableConfig(operations).indexes.map(
      ({ config }) => config.name,
    );
    const attestationIndexes = getTableConfig(attestations).indexes.map(
      ({ config }) => config.name,
    );
    const relayIndexes = getTableConfig(relayIntents).indexes.map(
      ({ config }) => config.name,
    );
    expect(pactIndexes).toEqual(
      expect.arrayContaining([
        "pact_records_chain_job_uq",
        "pact_records_job_key_uq",
      ]),
    );
    expect(operationIndexes).toEqual(
      expect.arrayContaining([
        "operations_trigger_uq",
        "operations_one_active_per_pact_uq",
      ]),
    );
    expect(attestationIndexes).toContain("attestations_one_active_per_pact_uq");
    expect(relayIndexes).toEqual(
      expect.arrayContaining([
        "relay_intents_attestation_uq",
        "relay_intents_sender_unresolved_uq",
        "relay_intents_sender_nonce_uq",
      ]),
    );
    expect(githubDeliveries.deliveryId.primary).toBe(true);
  });

  it("pins explicit relay states without a generic FAILED bucket", () => {
    expect(relayStates).toEqual([
      "PREPARING",
      "SIGNED",
      "DISPATCHING",
      "SUBMITTED",
      "BROADCAST_UNKNOWN",
      "SETTLED",
      "SETTLED_EXTERNALLY",
      "COMPLETED_BY_DIFFERENT_ATTESTATION",
      "REVERTED",
      "INTEGRITY_FAILURE",
      "EXPIRED_UNSENT",
      "PRECONDITION_FAILED",
      "NONCE_DRIFT",
      "INSUFFICIENT_RELAY_GAS",
    ]);
    expect(relayStates).not.toContain("FAILED" as never);
  });

  it("pins explicit operation states", () => {
    expect(operationStates).toEqual([
      "PENDING",
      "VERIFYING_GITHUB",
      "NOT_SATISFIED_RETRYABLE",
      "NOT_SATISFIED_TERMINAL",
      "INDETERMINATE",
      "VERIFIED",
      "RECONCILING_CHAIN",
      "CHAIN_RETRYABLE",
      "CHAIN_INVALID",
      "READY_TO_SIGN",
      "SIGNING",
      "READY_TO_RELAY",
      "ALREADY_ACCEPTED",
      "EXPIRED",
      "FAILED_DEFINITE",
    ]);
  });

  it("accepts only PostgreSQL database URLs", () => {
    expect(
      validateDatabaseUrl("postgresql://user:pass@localhost:5432/pact"),
    ).toContain("postgresql:");
    expect(() => validateDatabaseUrl("https://database.example")).toThrow(
      "DATABASE_URL must use postgres:// or postgresql://",
    );
    expect(() => validateDatabaseUrl("not a url")).toThrow(
      "DATABASE_URL must be a valid PostgreSQL URL",
    );
  });

  it("treats stored condition/hash and job-key disagreement as integrity failures", () => {
    const condition = {
      schemaVersion: 1,
      provider: "github",
      repository: "pact-protocol/demo",
      pullRequest: 81,
      baseBranch: "main",
      event: "PR_MERGED",
    } as const;
    const base = {
      id: "123e4567-e89b-42d3-a456-426614174000",
      chainId: 5042n,
      commerceContract: "0x1111111111111111111111111111111111111111",
      pactEvaluator: "0x2222222222222222222222222222222222222222",
      jobId: 81n,
      jobKey:
        "0x3fc68520644941b41fc25c71eda15a50c082760a14b99b90f39864ded7975ea7",
      condition,
      conditionHash:
        "0x3da848928dfb0c9f0e98058ec9dc003e1a73952469488ce90fcab1699ccb18b4",
      completionDeadline: 1_900_000_000n,
    } as const;
    expect(() => validatePactRecordIntegrity(base)).not.toThrow();
    expect(() =>
      validatePactRecordIntegrity({
        ...base,
        conditionHash: `0x${"aa".repeat(32)}`,
      }),
    ).toThrow("conditionHash does not match");
    expect(() =>
      validatePactRecordIntegrity({ ...base, jobKey: `0x${"bb".repeat(32)}` }),
    ).toThrow("jobKey does not match");
  });
});
