import {
  PostgresPactRepository,
  PostgresRelayRepository,
  createPactDatabase,
  type PersistedChainSnapshot,
  type ReadyToRelayArtifact,
  type RelayIntentRecord,
} from "@pact/database";
import {
  createPhase4AOrchestrator,
  createPactRelayService,
  createPactRelaySigner,
  type RelayChainClient,
  type RelayCompletionEvent,
} from "@pact/orchestrator";
import {
  hashGithubPrMergedCondition,
  hashPactJobIdentity,
  normalizeGithubPrMergedCondition,
  normalizePactJobIdentity,
  type Hex32,
} from "@pact/protocol";
import type { GitHubPullRequestClient } from "@pact/verifier/github";
import { createPactCompletionSigner } from "@pact/verifier/signer";
import { readFile } from "node:fs/promises";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getAddress, keccak256, type Hex, type TransactionReceipt } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createRelayWorker } from "./relay-worker";
import { PostgresAutomationRepository } from "./repository";
import { createVerifierScheduler } from "./verifier-worker";

const configuredUrl = process.env.PRODUCT_DATABASE_TEST_URL;
const describeLocal = configuredUrl === undefined ? describe.skip : describe;
const databaseName = `pact_automation_e2e_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
const verifierKey = generatePrivateKey();
const relayKey = generatePrivateKey();
const verifier = privateKeyToAccount(verifierKey).address;
const relayAddress = privateKeyToAccount(relayKey).address;
const evaluator = getAddress("0x1111111111111111111111111111111111111111");
const commerce = getAddress("0x2222222222222222222222222222222222222222");
const client = getAddress("0x3333333333333333333333333333333333333333");
const provider = getAddress("0x4444444444444444444444444444444444444444");
const blockHash = `0x${"aa".repeat(32)}` as Hex32;
const receiptBlockHash = `0x${"bb".repeat(32)}` as Hex32;

let administrator: Sql | undefined;

function databaseUrl(name: string): string {
  if (configuredUrl === undefined) throw new Error("database URL missing");
  const url = new URL(configuredUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

async function sqlFile(path: URL): Promise<string> {
  return (await readFile(path, "utf8")).replaceAll(
    "--> statement-breakpoint",
    "",
  );
}

describeLocal("Phase 6E automatic settlement local E2E", () => {
  beforeAll(async () => {
    if (configuredUrl === undefined) return;
    administrator = postgres(configuredUrl, { max: 1, prepare: false });
    await administrator.unsafe(`CREATE DATABASE "${databaseName}"`);
    const setup = postgres(databaseUrl(databaseName), {
      max: 1,
      prepare: false,
    });
    try {
      for (const path of [
        new URL(
          "../../database/drizzle/0000_overrated_baron_zemo.sql",
          import.meta.url,
        ),
        new URL("../../database/drizzle/0001_sour_preak.sql", import.meta.url),
        new URL(
          "../../product/drizzle/0002_product_foundation.sql",
          import.meta.url,
        ),
        new URL(
          "../../product/drizzle/0003_wallet_lifecycle.sql",
          import.meta.url,
        ),
        new URL(
          "../../product/drizzle/0004_automatic_settlement.sql",
          import.meta.url,
        ),
      ]) {
        await setup.unsafe(await sqlFile(path));
      }
    } finally {
      await setup.end({ timeout: 5 });
    }
  }, 60_000);

  afterAll(async () => {
    if (administrator !== undefined) {
      await administrator.unsafe(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await administrator.end({ timeout: 5 });
    }
  }, 60_000);

  it("automatically verifies, signs, broadcasts once, reconciles, and settles", async () => {
    const database = createPactDatabase(databaseUrl(databaseName));
    try {
      const condition = normalizeGithubPrMergedCondition({
        provider: "github",
        repository: "pact-protocol/demo",
        pullRequest: 81,
        baseBranch: "main",
        event: "PR_MERGED",
      });
      const conditionHash = hashGithubPrMergedCondition(condition) as Hex32;
      const jobKey = hashPactJobIdentity(
        normalizePactJobIdentity({
          chainId: 5_042_002n,
          commerceContract: commerce,
          jobId: 81n,
        }),
      ) as Hex32;
      const pactId = "11111111-1111-4111-8111-111111111111";
      const draftId = "22222222-2222-4222-8222-222222222222";
      const slug = `pact_${"a".repeat(32)}`;
      const completionDeadline = 1_800_000_120n;
      const pactRepository = new PostgresPactRepository(database);
      await pactRepository.createPact({
        id: pactId,
        chainId: 5_042_002n,
        commerceContract: commerce,
        pactEvaluator: evaluator,
        jobId: 81n,
        jobKey,
        condition,
        conditionHash,
        completionDeadline,
      });
      await database.sql`
        INSERT INTO pact_drafts (
          id, public_slug, creating_wallet, provider_address,
          github_repository, github_pull_request, base_branch, event,
          amount_base_units, network, chain_id, condition_hash,
          completion_policy_version, completion_offset_seconds,
          expiry_policy_version, expiry_offset_seconds, idempotency_key,
          canonical_request_hash, linked_pact_record_id, lifecycle
        ) VALUES (
          ${draftId}, ${slug}, ${client}, ${provider}, ${condition.repository},
          ${condition.pullRequest}, 'main', 'PR_MERGED', '1000',
          'arc-testnet', '5042002', ${conditionHash}, 1, 7200, 1, 21600,
          'local-e2e-draft-key', ${conditionHash}, ${pactId}, 'LINKED'
        )
      `;
      const baseSnapshot: PersistedChainSnapshot = {
        blockNumber: 100n,
        blockHash,
        blockTimestamp: 1_800_000_010n,
        chainId: 5_042_002n,
        pactEvaluator: evaluator,
        commerceContract: commerce,
        jobId: 81n,
        jobKey,
        bindingExists: true,
        bindingConditionHash: conditionHash,
        bindingCompletionDeadline: completionDeadline,
        bindingVerifier: verifier,
        bindingAccepted: false,
        verifierRevoked: false,
        jobClient: client,
        jobProvider: provider,
        jobEvaluator: evaluator,
        jobStatus: 2,
        jobExpiredAt: 1_800_001_000n,
      };
      const github: GitHubPullRequestClient = {
        getPullRequest: async () => ({
          ok: true,
          value: {
            number: 81,
            state: "closed",
            merged: true,
            mergedAt: "2027-01-15T08:00:00Z",
            mergeCommitSha: "0123456789abcdef0123456789abcdef01234567",
            baseRepository: condition.repository,
            baseBranch: "main",
            privateRepository: false,
          },
        }),
        checkPullRequestMerged: async () => ({
          ok: true,
          value: { merged: true },
        }),
      };
      const arc = { readSnapshot: async () => baseSnapshot };
      const signer = createPactCompletionSigner({ privateKey: verifierKey });
      const orchestrator = createPhase4AOrchestrator({
        repository: pactRepository,
        github,
        arc,
        signer,
        configuredChainId: 5_042_002n,
        configuredPactEvaluator: evaluator,
        configuredCommerceContract: commerce,
        nowSeconds: () => 1_800_000_010n,
      });
      const automation = new PostgresAutomationRepository(database);
      await automation.ensureScheduled(draftId, pactId);
      const scheduler = createVerifierScheduler({
        automation,
        certifiedRepository: pactRepository,
        arc,
        orchestrator,
        workerId: "local-verifier",
        leaseSeconds: 120,
        batchSize: 1,
        configuredPactEvaluator: evaluator,
        configuredCommerceContract: commerce,
        configuredVerifier: verifier,
      });
      await expect(scheduler.runOnce()).resolves.toMatchObject([
        { result: "READY_TO_RELAY" },
      ]);

      let broadcastCount = 0;
      const relaySigner = createPactRelaySigner({
        privateKey: relayKey,
        verifierAddress: verifier,
      });
      const chain: RelayChainClient = {
        readPreflight: async () => ({
          snapshot: baseSnapshot,
          completionEvents: [],
        }),
        simulateAndEstimate: async () => ({
          sufficientBalance: true,
          gas: 300_000n,
          type: "legacy",
          gasPrice: 1n,
          requiredBalance: 300_000n,
          actualBalance: 1_000_000n,
        }),
        readNonces: async () => ({ latest: 0, pending: 0 }),
        prepareExactRequest: async (input) => ({
          chainId: Number(input.chainId),
          from: input.relayAddress,
          to: input.pactEvaluator,
          value: 0n,
          data: input.calldata,
          nonce: input.nonce,
          gas: input.preparation.gas,
          type: "legacy",
          gasPrice: 1n,
        }),
        observe: async (
          intent: RelayIntentRecord,
          artifact: ReadyToRelayArtifact,
        ) => {
          if (intent.expectedTxHash === null)
            throw new Error("expected transaction hash missing");
          const event: RelayCompletionEvent = {
            transactionHash: intent.expectedTxHash,
            blockNumber: 102n,
            blockHash: receiptBlockHash,
            logIndex: 7,
            jobKey: artifact.pact.jobKey,
            jobId: artifact.pact.jobId,
            evidenceHash: artifact.attestation.evidenceHash,
            conditionHash: artifact.attestation.conditionHash,
            attestationDigest: artifact.attestation.digest,
            verifier: artifact.attestation.signer,
            relayer: relayAddress,
          };
          const receipt = {
            status: "success",
            transactionHash: intent.expectedTxHash,
            blockNumber: 102n,
            blockHash: receiptBlockHash,
            transactionIndex: 1,
          } as TransactionReceipt;
          return {
            transactionFound: true,
            receipt,
            completionEvents: [event],
            snapshot: {
              ...baseSnapshot,
              blockNumber: 102n,
              blockHash: receiptBlockHash,
              blockTimestamp: 1_800_000_020n,
              bindingAccepted: true,
              jobStatus: 3,
            },
            latestNonce: 1,
            pendingNonce: 1,
          };
        },
      };
      const relayRepository = new PostgresRelayRepository(database);
      const relay = createPactRelayService({
        repository: relayRepository,
        chain,
        transport: {
          sendRawTransaction: async (serialized: Hex) => {
            broadcastCount++;
            return keccak256(serialized);
          },
        },
        signer: relaySigner,
        configuredChainId: 5_042_002n,
        configuredPactEvaluator: evaluator,
        configuredCommerceContract: commerce,
      });
      const worker = createRelayWorker({ relay });
      const first = await worker.runOnce();
      expect(first.processed.state).toBe("SUBMITTED");
      const second = await worker.runOnce();
      expect(second.reconciled[0]?.state).toBe("SETTLED");
      expect(broadcastCount).toBe(1);

      const rows = await database.sql<
        {
          readonly operation_state: string;
          readonly relay_state: string;
          readonly broadcast_attempt_count: number;
          readonly evidence_count: number;
          readonly attestation_count: number;
        }[]
      >`
        SELECT op.state AS operation_state, ri.state AS relay_state,
          ri.broadcast_attempt_count,
          (SELECT count(*)::int FROM evidence_records) AS evidence_count,
          (SELECT count(*)::int FROM attestations) AS attestation_count
        FROM operations op
        JOIN relay_intents ri ON ri.pact_record_id = op.pact_record_id
        WHERE op.pact_record_id = ${pactId}
        ORDER BY op.updated_at DESC LIMIT 1
      `;
      expect(rows[0]).toMatchObject({
        operation_state: "READY_TO_RELAY",
        relay_state: "SETTLED",
        broadcast_attempt_count: 1,
        evidence_count: 1,
        attestation_count: 1,
      });
    } finally {
      await database.close();
    }
  }, 60_000);
});
