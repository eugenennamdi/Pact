import {
  PostgresPactRepository,
  PostgresRelayRepository,
  createPactDatabase,
} from "@pact/database";
import {
  createArcReadClient,
  createPactRelayService,
  createPactRelaySigner,
  createPhase4AOrchestrator,
  createRelayChainClient,
  loadDeploymentManifest,
} from "@pact/orchestrator";
import { createGitHubPullRequestClient } from "@pact/verifier/github";
import { createPactCompletionSigner } from "@pact/verifier/signer";
import { describe, expect, it } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  parseEventLogs,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ProductCanonicalPactRegistrar } from "../../product/src/canonical-link";
import {
  PRODUCT_CHAIN_ID,
  PRODUCT_COMMERCE_ADDRESS,
  PRODUCT_USDC_ADDRESS,
} from "../../product/src/constants";
import {
  handleReadEvidence,
  handleReadPact,
  handleReadSettlement,
  type ProductRuntime,
} from "../../product/src/http";
import { InMemoryRateLimiter } from "../../product/src/rate-limit";
import { PostgresProductRepository } from "../../product/src/repository";
import { createDraft } from "../../product/src/service";
import { createProductChainClient } from "../../product/src/wallet-chain";
import {
  confirmWalletAction,
  prepareWalletAction,
  type WalletLifecycleRuntime,
} from "../../product/src/wallet-lifecycle";
import { assertTestnetManifest } from "./config";
import { createRelayWorker } from "./relay-worker";
import { PostgresAutomationRepository } from "./repository";
import { createVerifierScheduler } from "./verifier-worker";

const stage = process.env.PACT_PHASE6E_TESTNET_STAGE;
const describeTestnet = stage === undefined ? describe.skip : describe;
const repositoryName = "eugenennamdi/pact-arc-demo";
const pullRequest = 6;
const draftKey = `phase6e-draft-pr-${pullRequest}`;
const MAINNET_ADDRESSES = new Set(
  [
    "0x1f320aF0E8F11b89eD88ddD8C549B39F6081954b",
    "0xd857612A587DF68b0C2627208Bdd9F934695A231",
    "0x49a5F99Cdf8b9683459A467e9b71a554495Ecc52",
  ].map((value) => value.toLowerCase()),
);

const transferEvent = {
  type: "event",
  name: "Transfer",
  anonymous: false,
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "value", type: "uint256", indexed: false },
  ],
} as const;

const jobCompletedEvent = {
  type: "event",
  name: "JobCompleted",
  anonymous: false,
  inputs: [
    { name: "jobId", type: "uint256", indexed: true },
    { name: "evaluator", type: "address", indexed: true },
    { name: "reason", type: "bytes32", indexed: false },
  ],
} as const;

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0)
    throw new Error(`${name} is required`);
  return value;
}

function privateKey(name: string): Hex {
  const value = required(name);
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${name} is invalid`);
  return value as Hex;
}

function checkedDatabaseUrl(): string {
  const value = required("DATABASE_URL");
  const parsed = new URL(value);
  if (
    parsed.hostname !== "127.0.0.1" ||
    !parsed.pathname.includes("phase6e_testnet")
  ) {
    throw new Error("PHASE6E_ISOLATED_LOCAL_DATABASE_REQUIRED");
  }
  return value;
}

function checkedRpcUrl(): string {
  const value = required("PACT_PRODUCT_TESTNET_RPC_URL");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.hostname !== "rpc.testnet.arc.io")
    throw new Error("TESTNET_RPC_NOT_ALLOWLISTED");
  return parsed.toString();
}

function assertTestnetAccount(address: Address): void {
  if (MAINNET_ADDRESSES.has(address.toLowerCase()))
    throw new Error("MAINNET_IDENTITY_FORBIDDEN");
}

async function context() {
  const database = createPactDatabase(checkedDatabaseUrl());
  const rpcUrl = checkedRpcUrl();
  const manifest = assertTestnetManifest(
    await loadDeploymentManifest("deployments/arc-testnet.json"),
  );
  const chain = createProductChainClient({ rpcUrl, timeoutMs: 20_000 });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await chain.verifyDeployment();
      break;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !/rate limit|exceeds defined limit/i.test(error.message) ||
        attempt === 3
      ) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
  }
  const github = createGitHubPullRequestClient({ timeoutMs: 20_000 });
  const repository = new PostgresProductRepository(database);
  const automation = new PostgresAutomationRepository(database);
  const clientAccount = privateKeyToAccount(
    privateKey("PACT_E2E_CLIENT_PRIVATE_KEY"),
  );
  const providerAccount = privateKeyToAccount(
    privateKey("PACT_E2E_PROVIDER_PRIVATE_KEY"),
  );
  const verifierKey = privateKey("PACT_VERIFIER_PRIVATE_KEY");
  const relayKey = privateKey("PACT_RELAY_PRIVATE_KEY");
  const relayAccount = privateKeyToAccount(relayKey);
  for (const account of [clientAccount, providerAccount, relayAccount])
    assertTestnetAccount(account.address);
  if (
    getAddress(privateKeyToAccount(verifierKey).address) !==
      getAddress(manifest.pactEvaluator.verifier) ||
    getAddress(relayAccount.address) !==
      getAddress(required("PACT_RELAY_ADDRESS"))
  ) {
    throw new Error("TESTNET_SIGNER_IDENTITY_MISMATCH");
  }
  return {
    database,
    rpcUrl,
    manifest,
    chain,
    github,
    repository,
    automation,
    clientAccount,
    providerAccount,
    verifierKey,
    relayKey,
    relayAccount,
  };
}

async function draftFor(
  repository: PostgresProductRepository,
  client: Address,
) {
  const draft = await repository.getDraftByIdempotency(client, draftKey);
  if (draft === undefined) throw new Error("PHASE6E_DRAFT_MISSING");
  if (draft.githubPullRequest !== pullRequest)
    throw new Error("PHASE6E_DRAFT_CONDITION_MISMATCH");
  return draft;
}

async function verifierScheduler(input: Awaited<ReturnType<typeof context>>) {
  const certifiedRepository = new PostgresPactRepository(input.database);
  const arc = createArcReadClient({ rpcUrl: input.rpcUrl });
  const orchestrator = createPhase4AOrchestrator({
    repository: certifiedRepository,
    github: input.github,
    arc,
    signer: createPactCompletionSigner({ privateKey: input.verifierKey }),
    configuredChainId: PRODUCT_CHAIN_ID,
    configuredPactEvaluator: input.manifest.pactEvaluator.address,
    configuredCommerceContract: input.manifest.erc8183.proxy,
  });
  return createVerifierScheduler({
    automation: input.automation,
    certifiedRepository,
    arc,
    orchestrator,
    workerId: `phase6e-live-${crypto.randomUUID()}`,
    leaseSeconds: 120,
    batchSize: 1,
    pollSeconds: 30,
    configuredPactEvaluator: input.manifest.pactEvaluator.address,
    configuredCommerceContract: input.manifest.erc8183.proxy,
    configuredVerifier: input.manifest.pactEvaluator.verifier,
  });
}

async function tableCounts(
  database: Awaited<ReturnType<typeof context>>["database"],
) {
  const rows = await database.sql<
    {
      readonly operations: number;
      readonly evidence: number;
      readonly attestations: number;
      readonly relay: number;
    }[]
  >`
    SELECT
      (SELECT count(*)::int FROM operations) AS operations,
      (SELECT count(*)::int FROM evidence_records) AS evidence,
      (SELECT count(*)::int FROM attestations) AS attestations,
      (SELECT count(*)::int FROM relay_intents) AS relay
  `;
  if (rows[0] === undefined) throw new Error("PHASE6E_COUNT_QUERY_FAILED");
  return rows[0];
}

describeTestnet("Phase 6E controlled Arc Testnet automatic settlement", () => {
  it(
    `runs the ${stage ?? "disabled"} stage`,
    async () => {
      if (!(["prepare", "false", "settle"] as const).includes(stage as never))
        throw new Error("PACT_PHASE6E_TESTNET_STAGE is invalid");
      const input = await context();
      try {
        if (stage === "prepare") {
          const chainDefinition = defineChain({
            id: Number(PRODUCT_CHAIN_ID),
            name: "Arc Testnet",
            nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
            rpcUrls: { default: { http: [input.rpcUrl] } },
          });
          const publicClient = createPublicClient({
            chain: chainDefinition,
            transport: http(input.rpcUrl, { retryCount: 1, timeout: 20_000 }),
          });
          if (BigInt(await publicClient.getChainId()) !== PRODUCT_CHAIN_ID)
            throw new Error("WRONG_CHAIN");
          const wallet = createWalletClient({
            chain: chainDefinition,
            transport: http(input.rpcUrl, { retryCount: 0, timeout: 20_000 }),
          });
          const created = await createDraft({
            repository: input.repository,
            github: input.github,
            sessionWallet: input.clientAccount.address,
            idempotencyKey: draftKey,
            request: {
              repository: repositoryName,
              pullRequest,
              provider: input.providerAccount.address,
              amount: "0.001",
            },
          });
          const runtime: WalletLifecycleRuntime = {
            repository: input.repository,
            github: input.github,
            chain: input.chain,
            registrar: new ProductCanonicalPactRegistrar(input.database),
            automation: input.automation,
          };
          const transactions: Record<string, string> = {};
          const recoverTransaction = async (input: {
            readonly from: Address;
            readonly to: Address;
            readonly data: Hex;
            readonly preparedAtBlock: bigint;
          }): Promise<Hex | undefined> => {
            const latest = await publicClient.getBlockNumber();
            const lower =
              latest - input.preparedAtBlock > 600n
                ? latest - 600n
                : input.preparedAtBlock;
            for (let high = latest; high >= lower; high -= 20n) {
              const low = high - 19n < lower ? lower : high - 19n;
              const numbers: bigint[] = [];
              for (let number = high; number >= low; number -= 1n)
                numbers.push(number);
              const blocks = await Promise.all(
                numbers.map((blockNumber) =>
                  publicClient.getBlock({
                    blockNumber,
                    includeTransactions: true,
                  }),
                ),
              );
              for (const block of blocks) {
                const transaction = block.transactions.find(
                  (candidate) =>
                    typeof candidate !== "string" &&
                    getAddress(candidate.from) === getAddress(input.from) &&
                    candidate.to !== null &&
                    getAddress(candidate.to) === getAddress(input.to) &&
                    candidate.input === input.data,
                );
                if (
                  transaction !== undefined &&
                  typeof transaction !== "string"
                )
                  return transaction.hash;
              }
              if (low === lower) break;
            }
            return undefined;
          };
          const run = async (
            actionPath: string,
            account: typeof input.clientAccount,
            ordinal: number,
          ) => {
            const plan = await prepareWalletAction({
              runtime,
              slug: created.publicSlug,
              actionPath,
              sessionWallet: account.address,
              idempotencyKey: `phase6e-action-${ordinal.toString().padStart(2, "0")}-pr-${pullRequest}`,
            });
            if (plan.result !== "PREPARED")
              throw new Error(
                `${actionPath} unexpectedly required no transaction`,
              );
            if (plan.fee.readiness === "INSUFFICIENT_BALANCE") {
              throw new Error(
                `TESTNET_FUNDING_REQUIRED:${actionPath}:${account.address}:${plan.fee.nativeBalance}:${plan.fee.requiredNativeBalance ?? "unknown"}`,
              );
            }
            const checkpoint =
              actionPath === "create-job"
                ? process.env.PACT_PHASE6E_RECOVER_CREATE_TX
                : undefined;
            if (
              checkpoint !== undefined &&
              !/^0x[0-9a-fA-F]{64}$/.test(checkpoint)
            ) {
              throw new Error("PACT_PHASE6E_RECOVER_CREATE_TX is invalid");
            }
            const recovered =
              (checkpoint as Hex | undefined) ??
              (await recoverTransaction({
                from: account.address,
                to: plan.to,
                data: plan.data,
                preparedAtBlock: BigInt(plan.preparedAtBlock),
              }));
            const hash =
              recovered ??
              (await wallet.sendTransaction({
                account,
                to: plan.to,
                value: BigInt(plan.value),
                data: plan.data,
              }));
            const receipt = await publicClient.waitForTransactionReceipt({
              hash,
              confirmations: 1,
              timeout: 120_000,
            });
            if (receipt.status !== "success")
              throw new Error(`${actionPath} reverted on Arc Testnet`);
            let result;
            for (let attempt = 0; attempt < 8; attempt += 1) {
              try {
                result = await confirmWalletAction({
                  runtime,
                  slug: created.publicSlug,
                  actionPath,
                  sessionWallet: account.address,
                  transactionHash: hash,
                });
                break;
              } catch (error) {
                if (
                  !(error instanceof Error) ||
                  error.message !== "CHAIN_READ_RETRYABLE" ||
                  attempt === 7
                ) {
                  throw error;
                }
                await new Promise((resolve) => setTimeout(resolve, 3_000));
              }
            }
            if (result === undefined)
              throw new Error(`${actionPath} confirmation did not resolve`);
            transactions[actionPath] = hash;
            return result;
          };
          const createdJob = await run("create-job", input.clientAccount, 1);
          await run("bind-condition", input.clientAccount, 2);
          await run("set-budget", input.providerAccount, 3);
          await run("approve-usdc", input.clientAccount, 4);
          await run("fund", input.clientAccount, 5);
          await run("submit", input.providerAccount, 6);
          const draft = await draftFor(
            input.repository,
            input.clientAccount.address,
          );
          const jobId = BigInt(createdJob.jobId);
          const [job, binding, schedule] = await Promise.all([
            input.chain.readJob(jobId),
            input.chain.readBinding(jobId),
            input.database.sql<
              { readonly count: number }[]
            >`SELECT count(*)::int AS count FROM pact_automation WHERE draft_id = ${draft.id} AND enabled = true`,
          ]);
          expect(job.status).toBe(2);
          expect(job.budget).toBe(1_000n);
          expect(binding.accepted).toBe(false);
          expect(schedule[0]?.count).toBe(1);
          process.stdout.write(
            `${JSON.stringify({ stage, status: "PASS", repository: repositoryName, pullRequest, publicSlug: draft.publicSlug, pactRecordId: draft.linkedPactRecordId, jobId: jobId.toString(), jobKey: createdJob.jobKey, conditionHash: draft.conditionHash, completionDeadline: binding.completionDeadline.toString(), jobExpiredAt: job.expiredAt.toString(), client: input.clientAccount.address, provider: input.providerAccount.address, transactions, productStatus: "AWAITING_CONDITION" })}\n`,
          );
          return;
        }

        const draft = await draftFor(
          input.repository,
          input.clientAccount.address,
        );
        if (draft.linkedPactRecordId === null)
          throw new Error("PHASE6E_PACT_LINK_MISSING");
        const pactRows = await input.database.sql<
          { readonly job_id: string; readonly job_key: string }[]
        >`SELECT job_id, job_key FROM pact_records WHERE id = ${draft.linkedPactRecordId}`;
        const pact = pactRows[0];
        if (pact === undefined) throw new Error("PHASE6E_PACT_RECORD_MISSING");
        const jobId = BigInt(pact.job_id);

        if (stage === "false") {
          const scheduler = await verifierScheduler(input);
          const scheduled = await scheduler.runOnce();
          expect(scheduled).toMatchObject([
            { result: "NOT_SATISFIED_RETRYABLE" },
          ]);
          const afterScheduled = await tableCounts(input.database);
          expect(afterScheduled).toMatchObject({
            operations: 1,
            evidence: 0,
            attestations: 0,
            relay: 0,
          });
          const wakeKey = `phase6e-manual-retry-pr-${pullRequest}`;
          const firstWake = await input.automation.wake(
            draft.id,
            draft.linkedPactRecordId,
            wakeKey,
          );
          expect(firstWake.replayed).toBe(false);
          const retried = await scheduler.runOnce();
          expect(retried).toMatchObject([
            { result: "NOT_SATISFIED_RETRYABLE" },
          ]);
          const replayedWake = await input.automation.wake(
            draft.id,
            draft.linkedPactRecordId,
            wakeKey,
          );
          expect(replayedWake.replayed).toBe(true);
          expect(await scheduler.runOnce()).toEqual([]);
          const [counts, projection, job, binding] = await Promise.all([
            tableCounts(input.database),
            input.repository.getPublicProjection(draft.publicSlug),
            input.chain.readJob(jobId),
            input.chain.readBinding(jobId),
          ]);
          if (projection === undefined)
            throw new Error("PHASE6E_PUBLIC_PROJECTION_MISSING");
          expect(counts).toMatchObject({
            operations: 2,
            evidence: 0,
            attestations: 0,
            relay: 0,
          });
          expect(job.status).toBe(2);
          expect(binding.accepted).toBe(false);
          const remaining =
            binding.completionDeadline -
            (await input.chain.readContext()).timestamp;
          expect(remaining).toBeGreaterThan(900n);
          process.stdout.write(
            `${JSON.stringify({ stage, status: "PASS", repository: repositoryName, pullRequest, publicSlug: draft.publicSlug, jobId: jobId.toString(), jobKey: pact.job_key, productStatus: "AWAITING_CONDITION", scheduledResult: scheduled[0]?.result, manualRetryResult: retried[0]?.result, manualRetryReplay: replayedWake.replayed, operations: counts.operations, evidence: counts.evidence, attestations: counts.attestations, relayIntents: counts.relay, bindingAccepted: binding.accepted, remainingCompletionSeconds: remaining.toString() })}\n`,
          );
          return;
        }

        const scheduler = await verifierScheduler(input);
        await input.automation.wake(
          draft.id,
          draft.linkedPactRecordId,
          `phase6e-post-merge-poll-pr-${pullRequest}`,
        );
        const verified = await scheduler.runOnce();
        expect(verified).toMatchObject([{ result: "READY_TO_RELAY" }]);

        const relayNativeBalance = await createPublicClient({
          transport: http(input.rpcUrl, { retryCount: 1, timeout: 20_000 }),
        }).getBalance({ address: input.relayAccount.address });
        if (relayNativeBalance === 0n)
          throw new Error(
            `TESTNET_FUNDING_REQUIRED:relay:${input.relayAccount.address}`,
          );
        const relayRepository = new PostgresRelayRepository(input.database);
        const relayChain = createRelayChainClient({ rpcUrl: input.rpcUrl });
        const relay = createPactRelayService({
          repository: relayRepository,
          chain: relayChain,
          transport: relayChain.broadcast,
          signer: createPactRelaySigner({
            privateKey: input.relayKey,
            verifierAddress: input.manifest.pactEvaluator.verifier,
          }),
          configuredChainId: PRODUCT_CHAIN_ID,
          configuredPactEvaluator: input.manifest.pactEvaluator.address,
          configuredCommerceContract: input.manifest.erc8183.proxy,
        });
        const worker = createRelayWorker({ relay });
        let terminal = "";
        for (let attempt = 0; attempt < 24; attempt += 1) {
          const result = await worker.runOnce();
          const settled = result.reconciled.find((item) =>
            ["SETTLED", "SETTLED_EXTERNALLY"].includes(item.state),
          );
          if (settled !== undefined) {
            terminal = settled.state;
            break;
          }
          if (
            [
              "COMPLETED_BY_DIFFERENT_ATTESTATION",
              "REVERTED",
              "INTEGRITY_FAILURE",
              "EXPIRED_UNSENT",
              "PRECONDITION_FAILED",
              "NONCE_DRIFT",
              "INSUFFICIENT_RELAY_GAS",
            ].includes(result.processed.state)
          ) {
            throw new Error(`PHASE6E_RELAY_${result.processed.state}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 5_000));
        }
        expect(terminal).toBe("SETTLED");

        const records = await input.database.sql<
          {
            readonly operation_id: string;
            readonly evidence_hash: string;
            readonly attestation_digest: string;
            readonly relay_intent_id: string;
            readonly relay_state: string;
            readonly nonce: string;
            readonly expected_tx_hash: string;
            readonly returned_tx_hash: string;
            readonly canonical_tx_hash: string;
            readonly broadcast_attempt_count: number;
          }[]
        >`
          SELECT op.id AS operation_id, ev.evidence_hash,
            att.digest AS attestation_digest, ri.id AS relay_intent_id,
            ri.state AS relay_state, ri.nonce, ri.expected_tx_hash,
            ri.returned_tx_hash, ri.canonical_tx_hash,
            ri.broadcast_attempt_count
          FROM operations op
          JOIN verification_attempts va ON va.operation_id = op.id
            AND va.evidence_hash IS NOT NULL
          JOIN evidence_records ev ON ev.evidence_hash = va.evidence_hash
          JOIN attestations att ON att.operation_id = op.id
          JOIN relay_intents ri ON ri.attestation_digest = att.digest
          WHERE op.pact_record_id = ${draft.linkedPactRecordId}
          ORDER BY op.updated_at DESC LIMIT 1
        `;
        const record = records[0];
        if (record === undefined)
          throw new Error("PHASE6E_SETTLEMENT_RECORD_MISSING");
        expect(record.broadcast_attempt_count).toBe(1);
        expect(record.expected_tx_hash).toBe(record.returned_tx_hash);
        expect(record.expected_tx_hash).toBe(record.canonical_tx_hash);

        const runtime: ProductRuntime = {
          config: {
            publicOrigin: new URL("https://pact.invalid"),
            sessionSecret: `${crypto.randomUUID()}${crypto.randomUUID()}`,
            secureCookie: true,
            sessionTtlSeconds: 900,
            chainId: Number(PRODUCT_CHAIN_ID),
            databaseUrl: checkedDatabaseUrl(),
            arcRpcUrl: input.rpcUrl,
          },
          repository: input.repository,
          github: input.github,
          rateLimiter: new InMemoryRateLimiter(),
        };
        const [pactResponse, evidenceResponse, settlementResponse] =
          await Promise.all([
            handleReadPact(
              new Request(
                `https://pact.invalid/api/v1/pacts/${draft.publicSlug}`,
              ),
              runtime,
              draft.publicSlug,
            ),
            handleReadEvidence(
              new Request(
                `https://pact.invalid/api/v1/pacts/${draft.publicSlug}/evidence`,
              ),
              runtime,
              draft.publicSlug,
            ),
            handleReadSettlement(
              new Request(
                `https://pact.invalid/api/v1/pacts/${draft.publicSlug}/settlement`,
              ),
              runtime,
              draft.publicSlug,
            ),
          ]);
        expect([
          pactResponse.status,
          evidenceResponse.status,
          settlementResponse.status,
        ]).toEqual([200, 200, 200]);
        const pactBody = (await pactResponse.json()) as {
          readonly status: string;
        };
        const evidenceBody = (await evidenceResponse.json()) as {
          readonly evidenceHash: string;
        };
        const settlementBody = (await settlementResponse.json()) as {
          readonly transactionHash: string;
          readonly grossBudget: string;
          readonly grossProviderPayout: string;
          readonly treasuryApplicationPayout: string;
          readonly evaluatorApplicationPayout: string;
        };
        expect(pactBody.status).toBe("COMPLETED");
        expect(evidenceBody.evidenceHash).toBe(record.evidence_hash);
        expect(settlementBody).toMatchObject({
          transactionHash: record.canonical_tx_hash,
          grossBudget: "1000",
          grossProviderPayout: "1000",
          treasuryApplicationPayout: "0",
          evaluatorApplicationPayout: "0",
        });
        const serializedPublic = JSON.stringify({
          pactBody,
          evidenceBody,
          settlementBody,
        });
        for (const forbidden of [
          "serializedTransaction",
          "serialized_transaction",
          "privateKey",
          "signature",
          "databaseUrl",
        ]) {
          expect(serializedPublic).not.toContain(forbidden);
        }

        const publicClient = createPublicClient({
          transport: http(input.rpcUrl, { retryCount: 1, timeout: 20_000 }),
        });
        const settlementReceipt = await publicClient.getTransactionReceipt({
          hash: record.canonical_tx_hash as Hex,
        });
        const fundRows = await input.database.sql<
          { readonly transaction_hash: string }[]
        >`
          SELECT transaction_hash FROM wallet_actions
          WHERE draft_id = ${draft.id} AND action = 'FUND'
            AND confirmation_status = 'CONFIRMED'
        `;
        const fundHash = fundRows[0]?.transaction_hash as Hex | undefined;
        if (fundHash === undefined) throw new Error("PHASE6E_FUND_TX_MISSING");
        const fundReceipt = await publicClient.getTransactionReceipt({
          hash: fundHash,
        });
        const transferLogs = (receipt: typeof settlementReceipt) =>
          parseEventLogs({
            abi: [transferEvent],
            logs: receipt.logs.filter(
              (log) =>
                getAddress(log.address) === getAddress(PRODUCT_USDC_ADDRESS),
            ),
            eventName: "Transfer",
            strict: true,
          });
        const sum = (
          logs: ReturnType<typeof transferLogs>,
          from: Address,
          to: Address,
        ) =>
          logs
            .filter(
              (log) =>
                getAddress(log.args.from) === getAddress(from) &&
                getAddress(log.args.to) === getAddress(to),
            )
            .reduce((total, log) => total + log.args.value, 0n);
        const funding = sum(
          transferLogs(fundReceipt),
          input.clientAccount.address,
          PRODUCT_COMMERCE_ADDRESS,
        );
        const providerPayout = sum(
          transferLogs(settlementReceipt),
          PRODUCT_COMMERCE_ADDRESS,
          input.providerAccount.address,
        );
        const completed = parseEventLogs({
          abi: [jobCompletedEvent],
          logs: settlementReceipt.logs,
          eventName: "JobCompleted",
          strict: true,
        });
        const [job, binding, counts] = await Promise.all([
          input.chain.readJob(jobId),
          input.chain.readBinding(jobId),
          tableCounts(input.database),
        ]);
        expect(funding).toBe(1_000n);
        expect(providerPayout).toBe(1_000n);
        expect(completed).toHaveLength(1);
        expect(completed[0]?.args.reason).toBe(record.evidence_hash);
        expect(job.status).toBe(3);
        expect(binding.accepted).toBe(true);
        process.stdout.write(
          `${JSON.stringify({ stage, status: "PASS", repository: repositoryName, pullRequest, publicSlug: draft.publicSlug, jobId: jobId.toString(), jobKey: pact.job_key, operationId: record.operation_id, evidenceHash: record.evidence_hash, attestationDigest: record.attestation_digest, relayIntentId: record.relay_intent_id, relayState: record.relay_state, relayNonce: record.nonce, expectedTxHash: record.expected_tx_hash, returnedTxHash: record.returned_tx_hash, canonicalTxHash: record.canonical_tx_hash, broadcastAttemptCount: record.broadcast_attempt_count, receiptStatus: settlementReceipt.status, receiptBlockNumber: settlementReceipt.blockNumber.toString(), finalJobStatus: job.status, bindingAccepted: binding.accepted, grossFunding: funding.toString(), grossProviderPayout: providerPayout.toString(), treasuryApplicationPayout: "0", evaluatorApplicationPayout: "0", completionReason: completed[0]?.args.reason, productStatus: pactBody.status, durableCounts: counts, publicReadsSanitized: true })}\n`,
        );
      } finally {
        await input.database.close();
      }
    },
    10 * 60_000,
  );
});
