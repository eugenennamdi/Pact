import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PostgresPactRepository,
  PostgresRelayRepository,
  createPactDatabase,
  type PactDatabase,
  type PactRecord,
  type ReadyToRelayArtifact,
} from "@pact/database";
import {
  hashGithubPrMergedCondition,
  hashPactJobIdentity,
  normalizeGithubPrMergedCondition,
  normalizePactJobIdentity,
  type Hex32,
} from "@pact/protocol";
import type { GitHubPullRequestClient } from "@pact/verifier/github";
import { createPactCompletionSigner } from "@pact/verifier/signer";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres, { type Sql } from "postgres";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  getAddress,
  http,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createArcReadClient, type ArcReadClient } from "./chain.js";
import { createExpiredRecoveryCoordinator } from "./deployment/recovery-state.js";
import type { ControlledOperatorState } from "./deployment/staged-operator.js";
import {
  createExpiredAttestationRecoveryService,
  type ExpiredAttestationRecoveryIdentity,
  type FreshReadyToRelayResult,
} from "./recovery.js";
import { createPhase4AOrchestrator } from "./service.js";

const ANVIL_PATH = "/Users/apple/.foundry/bin/anvil";
const CHAIN_ID = 31_337;
const PORT = 58593;
const RPC_URL = `http://127.0.0.1:${PORT}`;

const RELAY_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const VERIFIER_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const BUDGET = 1_000_000n;
const ADMIN_DB_URL =
  process.env.DATABASE_URL ??
  "postgres://apple@localhost:5432/pact_phase6e_admin_test";

interface FoundryArtifact {
  readonly abi: Abi;
  readonly bytecode: Hex;
}

async function loadArtifact(path: string): Promise<FoundryArtifact> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as {
    readonly abi: Abi;
    readonly bytecode: { readonly object: Hex };
  };
  return { abi: parsed.abi, bytecode: parsed.bytecode.object };
}

async function waitForRpc(url: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_chainId",
          params: [],
        }),
      });
      if (response.ok) return;
    } catch {
      // Waiting for node startup
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("Anvil RPC did not become ready");
}

describe("Correction 4: True Local Recovery E2E with real Anvil and disposable PostgreSQL", () => {
  let anvilProcess: ChildProcess | undefined;
  let adminClient: Sql | undefined;
  let testDbName: string | undefined;
  let pactDb: PactDatabase | undefined;
  let publicClient: PublicClient;
  let walletClient: WalletClient;
  let relay: PrivateKeyAccount;
  let verifier: PrivateKeyAccount;
  let admin: Address;
  let client: Address;
  let provider: Address;
  let commerce: Address;
  let evaluator: Address;
  let usdc: Address;
  let erc8183Artifact: FoundryArtifact;
  let evaluatorArtifact: FoundryArtifact;
  let pactRepo: PostgresPactRepository;
  let relayRepo: PostgresRelayRepository;
  let arcClient: ArcReadClient;
  let phase4A: ReturnType<typeof createPhase4AOrchestrator>;
  let condition: ReturnType<typeof normalizeGithubPrMergedCondition>;
  let conditionHash: Hex32;
  let completionDeadline: bigint;
  let expiredAt: bigint;
  let jobId: bigint;
  let jobKey: Hex32;
  let pactRecord: PactRecord;
  let oldArtifact: ReadyToRelayArtifact;
  let oldDigest: Hex32;
  let relayNonceBefore: number;
  let manifestIdentity: Hex32;
  let recoveryIdentity: ExpiredAttestationRecoveryIdentity;
  let operatorStage: ControlledOperatorState["stage"];
  let savedStages: string[];
  let recoveryResult: FreshReadyToRelayResult;
  let anvilClock: bigint;

  beforeAll(async () => {
    // 1. Start local Anvil child process
    anvilProcess = spawn(
      ANVIL_PATH,
      [
        "--host",
        "127.0.0.1",
        "--port",
        String(PORT),
        "--chain-id",
        String(CHAIN_ID),
      ],
      { stdio: "ignore" },
    );
    await waitForRpc(RPC_URL);

    // 2. Provision disposable PostgreSQL database & apply migrations
    adminClient = postgres(ADMIN_DB_URL, { max: 1 });
    testDbName = `pact_recov_e2e_${Date.now().toString(36)}_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
    await adminClient.unsafe(`create database ${testDbName}`);
    const testDbUrl = new URL(ADMIN_DB_URL);
    testDbUrl.pathname = `/${testDbName}`;
    pactDb = createPactDatabase(testDbUrl.toString());

    const migrationsFolder = fileURLToPath(
      new URL("../../database/drizzle", import.meta.url),
    );
    await migrate(pactDb.db, { migrationsFolder });

    // 3. Set up chain clients and accounts
    const chain = defineChain({
      id: CHAIN_ID,
      name: "Local Anvil",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [RPC_URL] } },
    });
    publicClient = createPublicClient({
      chain,
      transport: http(RPC_URL, { retryCount: 0 }),
    });
    walletClient = createWalletClient({
      chain,
      transport: http(RPC_URL, { retryCount: 0 }),
    });
    const accounts = await walletClient.getAddresses();
    relay = privateKeyToAccount(RELAY_KEY);
    verifier = privateKeyToAccount(VERIFIER_KEY);
    admin = getAddress(accounts[2]!);
    client = getAddress(accounts[3]!);
    provider = getAddress(accounts[4]!);

    // 4. Deploy contracts to local Anvil
    const contractsOut = fileURLToPath(
      new URL("../../contracts/out/", import.meta.url),
    );
    const [erc8183Loaded, proxyArtifact, evaluatorLoaded, tokenArtifact] =
      await Promise.all([
        loadArtifact(resolve(contractsOut, "ERC8183.sol/ERC8183.json")),
        loadArtifact(
          resolve(
            contractsOut,
            "PactManagedERC8183Proxy.sol/PactManagedERC8183Proxy.json",
          ),
        ),
        loadArtifact(
          resolve(contractsOut, "PactEvaluator.sol/PactEvaluator.json"),
        ),
        loadArtifact(resolve(contractsOut, "MockArcUSDC.sol/MockArcUSDC.json")),
      ]);
    erc8183Artifact = erc8183Loaded;
    evaluatorArtifact = evaluatorLoaded;

    const deploy = async (
      abi: Abi,
      bytecode: Hex,
      args: readonly unknown[] = [],
    ): Promise<Address> => {
      const hash = await walletClient.deployContract({
        chain,
        account: admin,
        abi,
        bytecode,
        args,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return getAddress(receipt.contractAddress!);
    };
    const write = async (
      account: Address,
      target: Address,
      abi: Abi,
      functionName: string,
      args: readonly unknown[],
    ): Promise<Hex> => {
      const { request } = await publicClient.simulateContract({
        account,
        address: target,
        abi,
        functionName,
        args,
      } as never);
      const hash = await walletClient.writeContract(request as never);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      expect(receipt.status).toBe("success");
      return hash;
    };

    const implementation = await deploy(
      erc8183Artifact.abi,
      erc8183Artifact.bytecode,
    );
    const initialization = encodeFunctionData({
      abi: erc8183Artifact.abi,
      functionName: "initialize",
      args: [admin, admin],
    });
    commerce = await deploy(proxyArtifact.abi, proxyArtifact.bytecode, [
      implementation,
      initialization,
    ]);
    evaluator = await deploy(
      evaluatorArtifact.abi,
      evaluatorArtifact.bytecode,
      [commerce, verifier.address, admin],
    );
    usdc = await deploy(tokenArtifact.abi, tokenArtifact.bytecode, [
      client,
      BUDGET,
    ]);
    await write(
      admin,
      commerce,
      erc8183Artifact.abi,
      "setPaymentTokenAllowed",
      [usdc, true],
    );

    // 5. Create, fund, and submit ERC-8183 job
    const currentBlock = await publicClient.getBlock();
    completionDeadline = currentBlock.timestamp + 10_000n;
    expiredAt = currentBlock.timestamp + 20_000n;
    condition = normalizeGithubPrMergedCondition({
      provider: "github",
      repository: "pact-local/recovery-e2e",
      pullRequest: 42,
      baseBranch: "main",
      event: "PR_MERGED",
    });
    conditionHash = hashGithubPrMergedCondition(condition);

    await write(client, commerce, erc8183Artifact.abi, "createJob", [
      provider,
      evaluator,
      expiredAt,
      "Recovery local E2E Job",
      "0x0000000000000000000000000000000000000000",
      0n,
    ]);
    jobId = (await publicClient.readContract({
      address: commerce,
      abi: erc8183Artifact.abi,
      functionName: "jobCounter",
    })) as bigint;

    await write(client, evaluator, evaluatorArtifact.abi, "bindCondition", [
      jobId,
      conditionHash,
      completionDeadline,
      verifier.address,
    ]);
    await write(provider, commerce, erc8183Artifact.abi, "setBudget", [
      jobId,
      usdc,
      BUDGET,
      "0x",
    ]);
    await write(client, usdc, tokenArtifact.abi, "approve", [commerce, BUDGET]);
    await write(client, commerce, erc8183Artifact.abi, "fund", [
      jobId,
      usdc,
      BUDGET,
      "0x",
    ]);
    await write(provider, commerce, erc8183Artifact.abi, "submit", [
      jobId,
      conditionHash,
      "0x",
    ]);

    // 6. Ingest GitHub condition & run initial Phase 4A to produce historical READY_TO_RELAY state
    const now = (await publicClient.getBlock()).timestamp;
    const githubClient: GitHubPullRequestClient = {
      getPullRequest: async () => ({
        ok: true,
        value: {
          number: condition.pullRequest,
          state: "closed",
          merged: true,
          mergedAt: new Date(Number(now - 100n) * 1000)
            .toISOString()
            .replace(".000Z", "Z"),
          mergeCommitSha: `0x${"dd".repeat(20)}`,
          baseRepository: condition.repository,
          baseBranch: condition.baseBranch,
          privateRepository: false,
        },
      }),
      checkPullRequestMerged: async () => ({
        ok: true,
        value: { merged: true },
      }),
    };

    pactRepo = new PostgresPactRepository(pactDb);
    relayRepo = new PostgresRelayRepository(pactDb);
    jobKey = hashPactJobIdentity(
      normalizePactJobIdentity({
        chainId: BigInt(CHAIN_ID),
        commerceContract: commerce,
        jobId,
      }),
    );
    pactRecord = {
      id: crypto.randomUUID(),
      chainId: BigInt(CHAIN_ID),
      commerceContract: commerce,
      pactEvaluator: evaluator,
      jobId,
      jobKey,
      condition,
      conditionHash,
      completionDeadline,
    };
    await pactRepo.createPact(pactRecord);
    const initialOp = await pactRepo.enqueueManualOperation(
      pactRecord.id,
      `initial:${crypto.randomUUID()}`,
    );
    anvilClock = now;
    arcClient = createArcReadClient({ rpcUrl: RPC_URL });
    const completionSigner = createPactCompletionSigner({
      privateKey: VERIFIER_KEY,
    });
    phase4A = createPhase4AOrchestrator({
      repository: pactRepo,
      github: githubClient,
      arc: arcClient,
      signer: completionSigner,
      configuredChainId: BigInt(CHAIN_ID),
      configuredPactEvaluator: evaluator,
      configuredCommerceContract: commerce,
      nowSeconds: () => anvilClock,
    });
    const initialResult = await phase4A.processOperation(initialOp.id);
    expect(initialResult.state).toBe("READY_TO_RELAY");

    oldArtifact = (await relayRepo.getActiveArtifactForOperation(
      initialOp.id,
    ))!;
    expect(oldArtifact).toBeDefined();
    oldDigest = oldArtifact.attestation.digest;

    relayNonceBefore = await publicClient.getTransactionCount({
      address: relay.address,
    });
    expect(relayNonceBefore).toBe(0);

    // 7. Advance local Anvil time past attestation validUntil, keeping job unexpired
    const targetTimestamp = oldArtifact.attestation.validUntil + 15n;
    await publicClient.request({
      method: "evm_setNextBlockTimestamp" as never,
      params: [Number(targetTimestamp)] as never,
    });
    await publicClient.request({
      method: "evm_mine" as never,
      params: [] as never,
    });
    anvilClock = targetTimestamp;
    const blockAfterAdvance = await publicClient.getBlock();
    expect(blockAfterAdvance.timestamp).toBeGreaterThan(
      oldArtifact.attestation.validUntil,
    );
    expect(blockAfterAdvance.timestamp).toBeLessThan(expiredAt);

    // 8. Run the recovery coordinator
    const recoveryService = createExpiredAttestationRecoveryService({
      recoveryRepository: relayRepo,
      operationRepository: pactRepo,
      arc: arcClient,
      phase4A,
    });

    manifestIdentity = `0x${"ee".repeat(32)}` as const;
    operatorStage = "SUBMITTED";
    savedStages = [];
    const stateStore = {
      load: async () =>
        ({
          schemaVersion: 2,
          stage: operatorStage,
          manifestIdentity,
          network: "arc-mainnet",
          chainId: String(CHAIN_ID),
          operationScope: "local-recovery-job-1",
          pactId: pactRecord.id,
          commerceContract: commerce,
          pactEvaluator: evaluator,
          client,
          provider,
          verifier: verifier.address,
          relay: relay.address,
          repository: condition.repository,
          pullRequest: condition.pullRequest,
          baseBranch: condition.baseBranch,
          conditionHash,
          amount: String(BUDGET),
          clientBefore: "0",
          providerBefore: "0",
          escrowBefore: "0",
          treasuryBefore: "0",
          evaluatorBefore: "0",
          relayGasBefore: "0",
          completionDeadline: completionDeadline.toString(),
          expiredAt: expiredAt.toString(),
          jobId: jobId.toString(),
          jobKey,
          transactions: {
            createJob: `0x${"01".repeat(32)}`,
            bindCondition: `0x${"02".repeat(32)}`,
            setBudget: `0x${"03".repeat(32)}`,
            approveUsdc: `0x${"04".repeat(32)}`,
            fund: `0x${"05".repeat(32)}`,
            submit: `0x${"06".repeat(32)}`,
          },
          affordabilityChecks: [],
          initialConditionResult: "NOT_SATISFIED_RETRYABLE",
        }) as ControlledOperatorState,
      save: async (next: ControlledOperatorState) => {
        operatorStage = next.stage;
        savedStages.push(next.stage);
      },
    };

    recoveryIdentity = {
      pactRecordId: pactRecord.id,
      operationId: oldArtifact.operationId,
      attestationDigest: oldDigest,
      expectedChainId: BigInt(CHAIN_ID),
      expectedCommerceContract: commerce,
      expectedPactEvaluator: evaluator,
      expectedJobId: jobId,
      expectedJobKey: pactRecord.jobKey,
      expectedConditionHash: pactRecord.conditionHash,
      expectedCompletionDeadline: pactRecord.completionDeadline,
      expectedVerifier: verifier.address,
      expectedClient: client,
      expectedProvider: provider,
      relayAddress: relay.address,
    };

    const coordinator = createExpiredRecoveryCoordinator({
      stateStore,
      service: recoveryService,
      observeCondition: async () => ({ status: "SATISFIED" }),
      expectedManifestIdentity: manifestIdentity,
      expectedRepository: condition.repository,
      expectedPullRequest: condition.pullRequest,
      expectedBaseBranch: condition.baseBranch,
    });

    recoveryResult = await coordinator.run(recoveryIdentity);
  }, 60_000);

  afterAll(async () => {
    if (anvilProcess?.exitCode === null && anvilProcess?.signalCode === null) {
      anvilProcess.kill("SIGTERM");
      await new Promise<void>((done) =>
        anvilProcess?.once("exit", () => done()),
      );
    }
    await pactDb?.close();
    if (adminClient !== undefined && testDbName !== undefined) {
      try {
        await adminClient.unsafe(`drop database ${testDbName} with (force)`);
      } catch {
        // Best-effort cleanup
      }
      await adminClient.end({ timeout: 5 });
    }
  });

  it("advances operator state stages correctly to READY_TO_RELAY", () => {
    expect(savedStages).toEqual([
      "AWAITING_CONDITION",
      "CONDITION_SATISFIED",
      "PHASE4A_ENQUEUED",
      "READY_TO_RELAY",
    ]);
    expect(operatorStage).toBe("READY_TO_RELAY");
  });

  // --- 16 REQUIRED INVARIANTS ---

  it("Invariant 1: old evidence row exists in database", async () => {
    const [row] = await pactDb!.sql<{ count: number }[]>`
      select count(*)::int as count from evidence_records
      where evidence_hash = ${oldArtifact.attestation.evidenceHash}
    `;
    expect(row?.count).toBe(1);
  });

  it("Invariant 2: old attestation row exists in database", async () => {
    const [row] = await pactDb!.sql<{ digest: string }[]>`
      select digest from attestations
      where digest = ${oldDigest}
    `;
    expect(row?.digest).toBe(oldDigest);
  });

  it("Invariant 3: old attestation has active=false", async () => {
    const [row] = await pactDb!.sql<{ active: boolean }[]>`
      select active from attestations
      where digest = ${oldDigest}
    `;
    expect(row?.active).toBe(false);
  });

  it("Invariant 4: fresh attestation has active=true and a distinct digest", async () => {
    expect(recoveryResult.attestationDigest).not.toBe(oldDigest);
    const [row] = await pactDb!.sql<{ active: boolean }[]>`
      select active from attestations
      where digest = ${recoveryResult.attestationDigest}
    `;
    expect(row?.active).toBe(true);
  });

  it("Invariant 5: exactly one active attestation exists for the Pact", async () => {
    const [row] = await pactDb!.sql<{ count: number }[]>`
      select count(*)::int as count from attestations
      where pact_record_id = ${pactRecord.id}::uuid and active = true
    `;
    expect(row?.count).toBe(1);
  });

  it("Invariant 6: old audit row has broadcastAttemptCount === 0", async () => {
    const [audit] = await pactDb!.sql<
      {
        state: string;
        code: string;
        broadcast_attempt_count: number;
      }[]
    >`
      select state, code, broadcast_attempt_count from relay_intents
      where attestation_digest = ${oldDigest}
    `;
    expect(audit).toBeDefined();
    expect(audit?.state).toBe("EXPIRED_UNSENT");
    expect(audit?.code).toBe("ATTESTATION_OR_JOB_EXPIRED");
    expect(audit?.broadcast_attempt_count).toBe(0);
  });

  it("Invariant 7: old audit row has nonce === null", async () => {
    const [audit] = await pactDb!.sql<{ nonce: string | null }[]>`
      select nonce from relay_intents
      where attestation_digest = ${oldDigest}
    `;
    expect(audit?.nonce).toBeNull();
  });

  it("Invariant 8: old audit row has serializedTransaction === null and calldata === null", async () => {
    const [audit] = await pactDb!.sql<
      {
        serialized_transaction: string | null;
        calldata: string | null;
      }[]
    >`
      select serialized_transaction, calldata from relay_intents
      where attestation_digest = ${oldDigest}
    `;
    expect(audit?.serialized_transaction).toBeNull();
    expect(audit?.calldata).toBeNull();
  });

  it("Invariant 9: old audit row has expectedTxHash, returnedTxHash, and canonicalTxHash === null", async () => {
    const [audit] = await pactDb!.sql<
      {
        expected_tx_hash: string | null;
        returned_tx_hash: string | null;
        canonical_tx_hash: string | null;
      }[]
    >`
      select expected_tx_hash, returned_tx_hash, canonical_tx_hash from relay_intents
      where attestation_digest = ${oldDigest}
    `;
    expect(audit?.expected_tx_hash).toBeNull();
    expect(audit?.returned_tx_hash).toBeNull();
    expect(audit?.canonical_tx_hash).toBeNull();
  });

  it("Invariant 10: old audit row has receipt and event coordinates null", async () => {
    const [audit] = await pactDb!.sql<
      {
        receipt_status: string | null;
        receipt_block_number: string | null;
        receipt_block_hash: string | null;
        receipt_transaction_index: number | null;
        event_block_number: string | null;
        event_block_hash: string | null;
        event_log_index: number | null;
        event_relayer: string | null;
        event_verifier: string | null;
      }[]
    >`
      select receipt_status, receipt_block_number, receipt_block_hash,
             receipt_transaction_index, event_block_number, event_block_hash,
             event_log_index, event_relayer, event_verifier
      from relay_intents
      where attestation_digest = ${oldDigest}
    `;
    expect(audit?.receipt_status).toBeNull();
    expect(audit?.receipt_block_number).toBeNull();
    expect(audit?.receipt_block_hash).toBeNull();
    expect(audit?.receipt_transaction_index).toBeNull();
    expect(audit?.event_block_number).toBeNull();
    expect(audit?.event_block_hash).toBeNull();
    expect(audit?.event_log_index).toBeNull();
    expect(audit?.event_relayer).toBeNull();
    expect(audit?.event_verifier).toBeNull();
  });

  it("Invariant 11: no relay intent exists for the new fresh attestation", async () => {
    const [row] = await pactDb!.sql<{ count: number }[]>`
      select count(*)::int as count from relay_intents
      where attestation_digest = ${recoveryResult.attestationDigest}
    `;
    expect(row?.count).toBe(0);
  });

  it("Invariant 12: relay account nonce on Anvil is unchanged", async () => {
    const relayNonceAfter = await publicClient.getTransactionCount({
      address: relay.address,
    });
    expect(relayNonceAfter).toBe(relayNonceBefore);
    expect(relayNonceAfter).toBe(0);
  });

  it("Invariant 13: zero EVM relay transactions were signed", async () => {
    const [signedCount] = await pactDb!.sql<{ count: number }[]>`
      select count(*)::int as count from relay_intents
      where state in ('SIGNED', 'DISPATCHING', 'SUBMITTED')
    `;
    expect(signedCount?.count).toBe(0);
  });

  it("Invariant 14: zero EVM relay transactions were broadcast", async () => {
    const [broadcastCount] = await pactDb!.sql<{ count: number }[]>`
      select count(*)::int as count from relay_intents
      where broadcast_attempt_count > 0
    `;
    expect(broadcastCount?.count).toBe(0);
  });

  it("Invariant 15: no Arc state write occurred during recovery", async () => {
    const latestBlock = await publicClient.getBlock();
    expect(latestBlock.transactions.length).toBe(0);
  });

  it("Invariant 16: job remains in state Submitted (2) and binding remains unaccepted", async () => {
    const job = (await publicClient.readContract({
      address: commerce,
      abi: erc8183Artifact.abi,
      functionName: "getJob",
      args: [jobId],
    })) as { readonly status: number };
    expect(job.status).toBe(2);

    const [exists, binding] = (await publicClient.readContract({
      address: evaluator,
      abi: evaluatorArtifact.abi,
      functionName: "getBinding",
      args: [jobId],
    })) as readonly [boolean, { readonly accepted: boolean }];
    expect(exists).toBe(true);
    expect(binding.accepted).toBe(false);

    const snapshot = await arcClient.readSnapshot({
      pactEvaluator: evaluator,
      commerceContract: commerce,
      jobId,
    });
    expect(snapshot.jobStatus).toBe(2);
    expect(snapshot.bindingAccepted).toBe(false);
  });

  // --- RECOVERY RESTART IDEMPOTENCY ---

  it("supports recovery restart under Shape B idempotently without duplicate mutations", async () => {
    const historicalPreflight = await relayRepo.inspectHistoricalRecoveryState({
      pactRecordId: pactRecord.id,
      operationId: oldArtifact.operationId,
      attestationDigest: oldDigest,
      expectedChainId: BigInt(CHAIN_ID),
      expectedCommerceContract: commerce,
      expectedPactEvaluator: evaluator,
      relayAddress: relay.address,
    });
    expect(historicalPreflight.shape).toBe("SHAPE_B");

    const recoveryService = createExpiredAttestationRecoveryService({
      recoveryRepository: relayRepo,
      operationRepository: pactRepo,
      arc: arcClient,
      phase4A,
    });

    const coordinator = createExpiredRecoveryCoordinator({
      stateStore: {
        load: async () =>
          ({
            schemaVersion: 2,
            stage: "PHASE4A_ENQUEUED",
            operationId: recoveryResult.operationId,
            manifestIdentity,
            network: "arc-mainnet",
            chainId: String(CHAIN_ID),
            operationScope: "local-recovery-job-1",
            pactId: pactRecord.id,
            commerceContract: commerce,
            pactEvaluator: evaluator,
            client,
            provider,
            verifier: verifier.address,
            relay: relay.address,
            repository: condition.repository,
            pullRequest: condition.pullRequest,
            baseBranch: condition.baseBranch,
            conditionHash,
            amount: String(BUDGET),
            clientBefore: "0",
            providerBefore: "0",
            escrowBefore: "0",
            treasuryBefore: "0",
            evaluatorBefore: "0",
            relayGasBefore: "0",
            completionDeadline: completionDeadline.toString(),
            expiredAt: expiredAt.toString(),
            jobId: jobId.toString(),
            jobKey,
            transactions: {
              createJob: `0x${"01".repeat(32)}`,
              bindCondition: `0x${"02".repeat(32)}`,
              setBudget: `0x${"03".repeat(32)}`,
              approveUsdc: `0x${"04".repeat(32)}`,
              fund: `0x${"05".repeat(32)}`,
              submit: `0x${"06".repeat(32)}`,
            },
            affordabilityChecks: [],
            initialConditionResult: "NOT_SATISFIED_RETRYABLE",
          }) as ControlledOperatorState,
        save: async () => {},
      },
      service: recoveryService,
      observeCondition: async () => ({ status: "SATISFIED" }),
      expectedManifestIdentity: manifestIdentity,
      expectedRepository: condition.repository,
      expectedPullRequest: condition.pullRequest,
      expectedBaseBranch: condition.baseBranch,
    });

    const restarted = await coordinator.run(recoveryIdentity);
    expect(restarted.operationId).toBe(recoveryResult.operationId);
    expect(restarted.attestationDigest).toBe(recoveryResult.attestationDigest);

    const [activeCount] = await pactDb!.sql<{ count: number }[]>`
      select count(*)::int as count from attestations
      where pact_record_id = ${pactRecord.id}::uuid and active = true
    `;
    expect(activeCount?.count).toBe(1);

    const [recoveryOpsCount] = await pactDb!.sql<{ count: number }[]>`
      select count(*)::int as count from operations
      where pact_record_id = ${pactRecord.id}::uuid and trigger_kind = 'RECOVERY'
    `;
    expect(recoveryOpsCount?.count).toBe(1);
  });

  it("supports a second consecutive recovery cycle when fresh attestation B expires", async () => {
    // Warp Anvil time past recoveryResult.validUntil so attestation B is expired
    const targetTimestamp2 = recoveryResult.validUntil + 15n;
    await publicClient.request({
      method: "evm_setNextBlockTimestamp" as never,
      params: [Number(targetTimestamp2)] as never,
    });
    await publicClient.request({
      method: "evm_mine" as never,
      params: [] as never,
    });
    anvilClock = targetTimestamp2;

    const secondRecoveryIdentity: ExpiredAttestationRecoveryIdentity = {
      pactRecordId: pactRecord.id,
      operationId: recoveryResult.operationId,
      attestationDigest: recoveryResult.attestationDigest,
      expectedChainId: BigInt(CHAIN_ID),
      expectedCommerceContract: commerce,
      expectedPactEvaluator: evaluator,
      expectedJobId: jobId,
      expectedJobKey: jobKey,
      expectedConditionHash: conditionHash,
      expectedCompletionDeadline: completionDeadline,
      expectedVerifier: verifier.address,
      expectedClient: client,
      expectedProvider: provider,
      relayAddress: relay.address,
    };

    const historicalPreflight = await relayRepo.inspectHistoricalRecoveryState({
      pactRecordId: pactRecord.id,
      operationId: recoveryResult.operationId,
      attestationDigest: recoveryResult.attestationDigest,
      expectedChainId: BigInt(CHAIN_ID),
      expectedCommerceContract: commerce,
      expectedPactEvaluator: evaluator,
      relayAddress: relay.address,
    });
    expect(historicalPreflight.shape).toBe("SHAPE_A");

    const recoveryService = createExpiredAttestationRecoveryService({
      recoveryRepository: relayRepo,
      operationRepository: pactRepo,
      arc: arcClient,
      phase4A,
    });

    let coordinatorState: ControlledOperatorState = {
      schemaVersion: 2,
      stage: "SUBMITTED",
      manifestIdentity,
      network: "arc-mainnet",
      chainId: String(CHAIN_ID),
      operationScope: "local-recovery-job-1",
      pactId: pactRecord.id,
      commerceContract: commerce,
      pactEvaluator: evaluator,
      client,
      provider,
      verifier: verifier.address,
      relay: relay.address,
      repository: condition.repository,
      pullRequest: condition.pullRequest,
      baseBranch: condition.baseBranch,
      conditionHash,
      amount: String(BUDGET),
      clientBefore: "0",
      providerBefore: "0",
      escrowBefore: "0",
      treasuryBefore: "0",
      evaluatorBefore: "0",
      relayGasBefore: "0",
      completionDeadline: completionDeadline.toString(),
      expiredAt: expiredAt.toString(),
      jobId: jobId.toString(),
      jobKey,
      transactions: {
        createJob: `0x${"01".repeat(32)}`,
        bindCondition: `0x${"02".repeat(32)}`,
        setBudget: `0x${"03".repeat(32)}`,
        approveUsdc: `0x${"04".repeat(32)}`,
        fund: `0x${"05".repeat(32)}`,
        submit: `0x${"06".repeat(32)}`,
      },
      affordabilityChecks: [],
      initialConditionResult: "NOT_SATISFIED_RETRYABLE",
    };

    const coordinator = createExpiredRecoveryCoordinator({
      stateStore: {
        load: async () => coordinatorState,
        save: async (next) => {
          coordinatorState = next;
        },
      },
      service: recoveryService,
      observeCondition: async () => ({ status: "SATISFIED" }),
      expectedManifestIdentity: manifestIdentity,
      expectedRepository: condition.repository,
      expectedPullRequest: condition.pullRequest,
      expectedBaseBranch: condition.baseBranch,
    });

    const secondRecoveryResult = await coordinator.run(secondRecoveryIdentity);
    expect(secondRecoveryResult.operationId).not.toBe(
      recoveryResult.operationId,
    );
    expect(secondRecoveryResult.attestationDigest).not.toBe(oldDigest);
    expect(secondRecoveryResult.attestationDigest).not.toBe(
      recoveryResult.attestationDigest,
    );

    const [activeCount] = await pactDb!.sql<{ count: number }[]>`
      select count(*)::int as count from attestations
      where pact_record_id = ${pactRecord.id}::uuid and active = true
    `;
    expect(activeCount?.count).toBe(1);

    const [inactiveCount] = await pactDb!.sql<{ count: number }[]>`
      select count(*)::int as count from attestations
      where pact_record_id = ${pactRecord.id}::uuid and active = false
    `;
    expect(inactiveCount?.count).toBe(2);

    const [recoveryOpsCount] = await pactDb!.sql<{ count: number }[]>`
      select count(*)::int as count from operations
      where pact_record_id = ${pactRecord.id}::uuid and trigger_kind = 'RECOVERY'
    `;
    expect(recoveryOpsCount?.count).toBe(2);

    const retiredIntents = await pactDb!.sql<
      {
        state: string;
        nonce: string | null;
        broadcast_attempt_count: number;
      }[]
    >`
      select state, nonce, broadcast_attempt_count from relay_intents
      where pact_record_id = ${pactRecord.id}::uuid
    `;
    expect(retiredIntents.length).toBe(2);
    for (const intent of retiredIntents) {
      expect(intent.state).toBe("EXPIRED_UNSENT");
      expect(intent.nonce).toBeNull();
      expect(intent.broadcast_attempt_count).toBe(0);
    }
  });
});
