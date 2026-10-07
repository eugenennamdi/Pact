import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PostgresPactRepository,
  PostgresRelayRepository,
  chainReconciliations,
  createPactDatabaseFromEnv,
  operations,
  type PactRecord,
} from "@pact/database";
import {
  hashGithubPrMergedCondition,
  hashPactCompletionAttestation,
  hashPactGitHubPrMergedEvidenceV1,
  hashPactJobIdentity,
  normalizeGithubPrMergedCondition,
  normalizePactGitHubPrMergedEvidenceV1,
  normalizePactJobIdentity,
  pactCompletionAttestationTypes,
} from "@pact/protocol";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { RelayBroadcastTransport } from "./chain.js";
import { createRelayChainClient } from "./chain.js";
import { pactRelayAbi } from "./abi.js";
import { createPactRelayService } from "./service.js";
import { createPactRelaySigner } from "./signer.js";
import { resolveAnvilExecutable } from "../deployment/anvil-executable.js";

const ANVIL_PATH = resolveAnvilExecutable();
const CHAIN_ID = 31_337;
const RELAY_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const VERIFIER_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const DRIFT_RELAY_KEY =
  "0x0000000000000000000000000000000000000000000000000000000000001234";

interface FoundryArtifact {
  readonly abi: Abi;
  readonly bytecode: Hex;
}

interface Scenario {
  readonly jobId: bigint;
  readonly artifactDigest: Hex;
  readonly attestation: {
    readonly commerceContract: Address;
    readonly jobId: bigint;
    readonly conditionHash: Hex;
    readonly evidenceHash: Hex;
    readonly satisfiedAt: bigint;
    readonly verifiedAt: bigint;
    readonly validUntil: bigint;
  };
  readonly signature: Hex;
}

async function foundryArtifact(path: string): Promise<FoundryArtifact> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("abi" in parsed) ||
    !("bytecode" in parsed) ||
    !Array.isArray(parsed.abi) ||
    typeof parsed.bytecode !== "object" ||
    parsed.bytecode === null ||
    !("object" in parsed.bytecode) ||
    typeof parsed.bytecode.object !== "string" ||
    !parsed.bytecode.object.startsWith("0x")
  )
    throw new Error(`invalid Foundry artifact: ${path}`);
  return { abi: parsed.abi as Abi, bytecode: parsed.bytecode.object as Hex };
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
      // The local child is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("Anvil RPC did not become ready");
}

function requiredAddress(
  value: Address | null | undefined,
  label: string,
): Address {
  if (value === null || value === undefined)
    throw new Error(`${label} address is missing`);
  return getAddress(value);
}

async function main(): Promise<void> {
  if (process.env.PACT_RELAY_E2E !== "1") {
    process.stdout.write(
      "SKIP: set PACT_RELAY_E2E=1 for the local relay E2E suite\n",
    );
    return;
  }
  const port = Number(process.env.PACT_RELAY_E2E_PORT ?? "58545");
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535)
    throw new Error("PACT_RELAY_E2E_PORT is invalid");
  const rpcUrl = `http://127.0.0.1:${port}`;
  let anvil: ChildProcess | undefined;
  const database = createPactDatabaseFromEnv(process.env);
  try {
    anvil = spawn(
      ANVIL_PATH,
      [
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--chain-id",
        String(CHAIN_ID),
      ],
      { stdio: "ignore" },
    );
    await waitForRpc(rpcUrl);

    const localChain = defineChain({
      id: CHAIN_ID,
      name: "Pact Anvil",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    });
    const publicClient = createPublicClient({
      chain: localChain,
      transport: http(rpcUrl, { retryCount: 0 }),
    });
    const walletClient = createWalletClient({
      chain: localChain,
      transport: http(rpcUrl, { retryCount: 0 }),
    });
    const accounts = await walletClient.getAddresses();
    const adminClient = requiredAddress(accounts[2], "admin/client");
    const externalRelayer = requiredAddress(accounts[3], "external relayer");
    const relayAccount = privateKeyToAccount(RELAY_KEY);
    const verifierAccount = privateKeyToAccount(VERIFIER_KEY);
    const driftRelayAccount = privateKeyToAccount(DRIFT_RELAY_KEY);
    assert.equal(getAddress(accounts[0]!), getAddress(relayAccount.address));
    assert.equal(getAddress(accounts[1]!), getAddress(verifierAccount.address));

    const contractsRoot = fileURLToPath(
      new URL("../../../contracts/out/", import.meta.url),
    );
    const mockArtifact = await foundryArtifact(
      resolve(contractsRoot, "MockERC8183.sol/MockERC8183.json"),
    );
    const evaluatorArtifact = await foundryArtifact(
      resolve(contractsRoot, "PactEvaluator.sol/PactEvaluator.json"),
    );
    const mockDeployHash = await walletClient.deployContract({
      account: adminClient,
      abi: mockArtifact.abi,
      bytecode: mockArtifact.bytecode,
    });
    const mockReceipt = await publicClient.waitForTransactionReceipt({
      hash: mockDeployHash,
    });
    const commerce = requiredAddress(mockReceipt.contractAddress, "commerce");
    const evaluatorDeployHash = await walletClient.deployContract({
      account: adminClient,
      abi: evaluatorArtifact.abi,
      bytecode: evaluatorArtifact.bytecode,
      args: [commerce, verifierAccount.address, adminClient],
    });
    const evaluatorReceipt = await publicClient.waitForTransactionReceipt({
      hash: evaluatorDeployHash,
    });
    const evaluator = requiredAddress(
      evaluatorReceipt.contractAddress,
      "PactEvaluator",
    );

    const pactRepository = new PostgresPactRepository(database);
    const relayRepository = new PostgresRelayRepository(database);
    const relayChain = createRelayChainClient({ rpcUrl });
    const relaySigner = createPactRelaySigner({
      privateKey: RELAY_KEY,
      verifierAddress: verifierAccount.address,
    });
    let nextJobId = 1n;

    async function createScenario(label: string): Promise<Scenario> {
      const jobId = nextJobId++;
      const block = await publicClient.getBlock({ blockTag: "latest" });
      const verifiedAt = block.timestamp;
      const completionDeadline = verifiedAt + 500n;
      const expiredAt = verifiedAt + 1_000n;
      const condition = normalizeGithubPrMergedCondition({
        provider: "github",
        repository: `pact-e2e/${label}`,
        pullRequest: Number(jobId),
        baseBranch: "main",
        event: "PR_MERGED",
      });
      const conditionHash = hashGithubPrMergedCondition(condition);
      const job = {
        client: adminClient,
        status: 0,
        provider: externalRelayer,
        expiredAt,
        evaluator,
        submittedAt: 0,
        budget: 1_000_000n,
        hook: "0x0000000000000000000000000000000000000000",
        paymentToken: "0x0000000000000000000000000000000000000000",
        providerAgentId: 0n,
        description: label,
        settledAmount: 0n,
        payoutReceiver: externalRelayer,
      } as const;
      await publicClient.waitForTransactionReceipt({
        hash: await walletClient.writeContract({
          account: adminClient,
          address: commerce,
          abi: mockArtifact.abi,
          functionName: "setJob",
          args: [jobId, job],
        }),
      });
      await publicClient.waitForTransactionReceipt({
        hash: await walletClient.writeContract({
          account: adminClient,
          address: evaluator,
          abi: pactRelayAbi,
          functionName: "bindCondition",
          args: [
            jobId,
            conditionHash,
            completionDeadline,
            verifierAccount.address,
          ],
        }),
      });
      await publicClient.waitForTransactionReceipt({
        hash: await walletClient.writeContract({
          account: adminClient,
          address: commerce,
          abi: mockArtifact.abi,
          functionName: "setStatus",
          args: [jobId, 2],
        }),
      });
      const readyBlock = await publicClient.getBlock({ blockTag: "latest" });
      assert(readyBlock.hash !== null);
      const evidence = normalizePactGitHubPrMergedEvidenceV1({
        conditionHash,
        repository: condition.repository,
        pullRequest: condition.pullRequest,
        baseBranch: condition.baseBranch,
        mergeCommitSha: `0x${jobId.toString(16).padStart(40, "0")}`,
        mergedAt: verifiedAt - 1n,
        observedAt: verifiedAt,
      });
      const evidenceHash = hashPactGitHubPrMergedEvidenceV1(evidence);
      const attestation = {
        commerceContract: commerce,
        jobId,
        conditionHash,
        evidenceHash,
        satisfiedAt: evidence.mergedAt,
        verifiedAt: evidence.observedAt,
        validUntil: verifiedAt + 300n,
      } as const;
      const signature = await verifierAccount.signTypedData({
        domain: {
          name: "Pact",
          version: "2",
          chainId: BigInt(CHAIN_ID),
          verifyingContract: evaluator,
        },
        types: pactCompletionAttestationTypes,
        primaryType: "PactCompletionAttestation",
        message: attestation,
      });
      const digest = hashPactCompletionAttestation(
        { chainId: BigInt(CHAIN_ID), verifyingContract: evaluator },
        attestation,
      );
      const jobKey = hashPactJobIdentity(
        normalizePactJobIdentity({
          chainId: BigInt(CHAIN_ID),
          commerceContract: commerce,
          jobId,
        }),
      );
      const pact: PactRecord = {
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
      await pactRepository.createPact(pact);
      const operationId = crypto.randomUUID();
      await database.db.insert(operations).values({
        id: operationId,
        pactRecordId: pact.id,
        triggerKind: "MANUAL",
        triggerKey: `e2e:${label}`,
        state: "SIGNING",
      });
      await database.db.insert(chainReconciliations).values({
        id: crypto.randomUUID(),
        operationId,
        attemptNumber: 1,
        outcome: "READY",
        blockNumber: readyBlock.number.toString(),
        blockHash: readyBlock.hash,
        blockTimestamp: readyBlock.timestamp.toString(),
        chainId: String(CHAIN_ID),
        pactEvaluator: evaluator,
        commerceContract: commerce,
        jobId: jobId.toString(),
        jobKey,
        bindingExists: true,
        bindingConditionHash: conditionHash,
        bindingCompletionDeadline: completionDeadline.toString(),
        bindingVerifier: verifierAccount.address,
        bindingAccepted: false,
        verifierRevoked: false,
        jobClient: adminClient,
        jobProvider: externalRelayer,
        jobEvaluator: evaluator,
        jobStatus: 2,
        jobExpiredAt: expiredAt.toString(),
      });
      await pactRepository.persistReadyToRelay(
        operationId,
        pact.id,
        evidence,
        evidenceHash,
        {
          digest,
          signature,
          signer: verifierAccount.address,
          chainId: BigInt(CHAIN_ID),
          verifyingContract: evaluator,
          ...attestation,
          jobKey,
        },
      );
      return { jobId, artifactDigest: digest, attestation, signature };
    }

    function service(transport: RelayBroadcastTransport) {
      return createPactRelayService({
        repository: relayRepository,
        chain: relayChain,
        transport,
        signer: relaySigner,
        configuredChainId: BigInt(CHAIN_ID),
        configuredPactEvaluator: evaluator,
        configuredCommerceContract: commerce,
      });
    }

    const normalScenario = await createScenario("normal");
    const normalService = service(relayChain.broadcast);
    const normalSubmitted = await normalService.process();
    assert.equal(normalSubmitted.state, "SUBMITTED");
    const [normalSettled] = await normalService.reconcile();
    assert.equal(normalSettled?.state, "SETTLED");
    const normalIntent = await relayRepository.getIntent(
      normalSubmitted.intentId!,
    );
    assert(normalIntent?.expectedTxHash !== null && normalIntent !== undefined);

    const responseLossScenario = await createScenario("response-loss");
    let responseLossSends = 0;
    const responseLossService = service({
      async sendRawTransaction(serializedTransaction) {
        responseLossSends++;
        await relayChain.broadcast.sendRawTransaction(serializedTransaction);
        throw new Error("simulated timeout after node acceptance");
      },
    });
    assert.equal(
      (await responseLossService.process()).state,
      "BROADCAST_UNKNOWN",
    );
    assert.equal((await responseLossService.reconcile())[0]?.state, "SETTLED");
    assert.equal(responseLossSends, 1);

    await createScenario("hash-mismatch");
    const hashMismatchService = service({
      async sendRawTransaction(serializedTransaction) {
        await relayChain.broadcast.sendRawTransaction(serializedTransaction);
        return `0x${"77".repeat(32)}`;
      },
    });
    assert.equal(
      (await hashMismatchService.process()).state,
      "INTEGRITY_FAILURE",
    );

    const externalScenario = await createScenario("external");
    const relayNonceBeforeExternal = await publicClient.getTransactionCount({
      address: relayAccount.address,
      blockTag: "latest",
    });
    await publicClient.waitForTransactionReceipt({
      hash: await walletClient.writeContract({
        account: externalRelayer,
        address: evaluator,
        abi: pactRelayAbi,
        functionName: "completeWithAttestation",
        args: [externalScenario.attestation, externalScenario.signature],
      }),
    });
    assert.equal((await normalService.process()).state, "SETTLED_EXTERNALLY");
    assert.equal(
      await publicClient.getTransactionCount({
        address: relayAccount.address,
        blockTag: "latest",
      }),
      relayNonceBeforeExternal,
    );

    const revertScenario = await createScenario("receipt-revert");
    const revertService = service({
      async sendRawTransaction(serializedTransaction) {
        await publicClient.waitForTransactionReceipt({
          hash: await walletClient.writeContract({
            account: adminClient,
            address: commerce,
            abi: mockArtifact.abi,
            functionName: "setStatus",
            args: [revertScenario.jobId, 4],
          }),
        });
        return relayChain.broadcast.sendRawTransaction(serializedTransaction);
      },
    });
    assert.equal((await revertService.process()).state, "SUBMITTED");
    assert.equal((await revertService.reconcile())[0]?.state, "REVERTED");

    const raceScenario = await createScenario("external-race");
    const raceService = service({
      async sendRawTransaction(serializedTransaction) {
        await publicClient.waitForTransactionReceipt({
          hash: await walletClient.writeContract({
            account: externalRelayer,
            address: evaluator,
            abi: pactRelayAbi,
            functionName: "completeWithAttestation",
            args: [raceScenario.attestation, raceScenario.signature],
          }),
        });
        return relayChain.broadcast.sendRawTransaction(serializedTransaction);
      },
    });
    assert.equal((await raceService.process()).state, "SUBMITTED");
    assert.equal(
      (await raceService.reconcile())[0]?.state,
      "SETTLED_EXTERNALLY",
    );

    await publicClient.waitForTransactionReceipt({
      hash: await walletClient.sendTransaction({
        account: adminClient,
        to: driftRelayAccount.address,
        value: 1_000_000_000_000_000_000n,
      }),
    });
    const driftSigner = createPactRelaySigner({
      privateKey: DRIFT_RELAY_KEY,
      verifierAddress: verifierAccount.address,
    });
    let driftRelaySends = 0;
    const driftService = createPactRelayService({
      repository: relayRepository,
      chain: relayChain,
      transport: {
        async sendRawTransaction(serializedTransaction) {
          driftRelaySends++;
          return relayChain.broadcast.sendRawTransaction(serializedTransaction);
        },
      },
      signer: driftSigner,
      configuredChainId: BigInt(CHAIN_ID),
      configuredPactEvaluator: evaluator,
      configuredCommerceContract: commerce,
    });
    await createScenario("nonce-baseline");
    assert.equal((await driftService.process()).state, "SUBMITTED");
    assert.equal((await driftService.reconcile())[0]?.state, "SETTLED");
    assert.equal(driftRelaySends, 1);
    await publicClient.waitForTransactionReceipt({
      hash: await walletClient.sendTransaction({
        account: driftRelayAccount,
        to: adminClient,
        value: 0n,
      }),
    });
    await createScenario("nonce-drift");
    assert.equal((await driftService.process()).state, "NONCE_DRIFT");
    assert.equal(driftRelaySends, 1);

    await createScenario("pre-forward");
    let preForwardSends = 0;
    const preForwardService = service({
      async sendRawTransaction() {
        preForwardSends++;
        throw new Error("simulated failure before forwarding");
      },
    });
    assert.equal(
      (await preForwardService.process()).state,
      "BROADCAST_UNKNOWN",
    );
    assert.equal(
      (await preForwardService.reconcile())[0]?.state,
      "BROADCAST_UNKNOWN",
    );
    assert.equal((await preForwardService.process()).state, "IDLE");
    assert.equal(preForwardSends, 1);

    const finalBinding = await publicClient.readContract({
      address: evaluator,
      abi: pactRelayAbi,
      functionName: "getBinding",
      args: [normalScenario.jobId],
    });
    const finalJob = (await publicClient.readContract({
      address: commerce,
      abi: mockArtifact.abi,
      functionName: "getJob",
      args: [normalScenario.jobId],
    })) as { readonly status: number };
    process.stdout.write(
      `${JSON.stringify(
        {
          status: "PASS",
          relayAddress: relayAccount.address,
          nonce: normalIntent.nonce,
          expectedTxHash: normalIntent.expectedTxHash,
          returnedTxHash: normalIntent.returnedTxHash,
          receiptBlock: normalIntent.receiptBlockNumber?.toString(),
          eventBlock: normalIntent.eventBlockNumber?.toString(),
          eventLogIndex: normalIntent.eventLogIndex,
          finalBindingAccepted: finalBinding[1].accepted,
          finalErc8183Status: Number(finalJob.status),
          normalArtifactDigest: normalScenario.artifactDigest,
          responseLossArtifactDigest: responseLossScenario.artifactDigest,
          responseLossSends,
          preForwardSends,
          preForwardState: "BROADCAST_UNKNOWN",
          externalRelayNonceConsumed: false,
          receiptRevertState: "REVERTED",
          concurrentExternalRaceState: "SETTLED_EXTERNALLY",
          hashMismatchState: "INTEGRITY_FAILURE",
          nonceDriftState: "NONCE_DRIFT",
          nonceDriftRelaySends: driftRelaySends,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await database.close();
    anvil?.kill("SIGTERM");
  }
}

await main();
