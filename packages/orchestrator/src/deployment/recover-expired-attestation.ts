import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  PostgresPactRepository,
  PostgresRelayRepository,
  createPactDatabaseFromEnv,
} from "@pact/database";
import {
  hashGithubPrMergedCondition,
  normalizeGithubPrMergedCondition,
} from "@pact/protocol";
import {
  createGitHubPullRequestClientFromEnv,
  verifyGitHubPrMerged,
} from "@pact/verifier/github";
import { createPactCompletionSignerFromEnv } from "@pact/verifier/signer";
import { getAddress, isHash, keccak256, stringToHex, type Hex } from "viem";
import { createArcReadClient } from "../chain.js";
import {
  assertMainnetRecoveryApproval,
  createExpiredAttestationRecoveryService,
  type ExpiredAttestationRecoveryIdentity,
} from "../recovery.js";
import { createPhase4AOrchestrator } from "../service.js";
import { verifyDeploymentIntegrity } from "./integrity.js";
import { assertMainnetGate, loadDeploymentManifest } from "./manifest.js";
import { createExpiredRecoveryCoordinator } from "./recovery-state.js";
import { FileControlledOperatorState } from "./staged-operator.js";

interface FoundryArtifact {
  readonly bytecode: { readonly object: Hex };
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "")
    throw new Error(`${name} is required`);
  return value;
}

function argument(name: string): string {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline !== undefined) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith("--"))
    throw new Error(`--${name} is required`);
  return value;
}

function positiveBigInt(value: string, name: string): bigint {
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`--${name} is invalid`);
  return BigInt(value);
}

async function main(): Promise<void> {
  // A visible relay key is a configuration failure even though this module has
  // no relay imports. The caller must remove it from this process boundary.
  if (Object.hasOwn(process.env, "PACT_RELAY_PRIVATE_KEY"))
    throw new Error("RECOVERY_RELAY_PRIVATE_KEY_FORBIDDEN");

  const pactRecordId = argument("pact-record-id");
  const operationId = argument("operation-id");
  const attestationDigest = argument("attestation-digest");
  const expectedJobId = positiveBigInt(
    argument("expected-job-id"),
    "expected-job-id",
  );
  const expectedJobKey = argument("expected-job-key");
  if (!isHash(attestationDigest) || !isHash(expectedJobKey))
    throw new Error("recovery digest/job key must be bytes32 values");

  const repositoryRoot = resolve(import.meta.dirname, "../../../..");
  const manifest = await loadDeploymentManifest(
    resolve(required("PACT_E2E_MANIFEST_PATH")),
  );
  if (manifest.network !== "arc-mainnet" || manifest.chainId !== "5042")
    throw new Error("RECOVERY_ARC_MAINNET_MANIFEST_REQUIRED");
  const gitCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();

  // Validate recovery-specific authorization before loading signers or database
  assertMainnetRecoveryApproval(process.env.PACT_MAINNET_RECOVERY_APPROVAL, {
    gitCommit,
    pactRecordId,
    attestationDigest,
  });

  const evaluatorArtifact = JSON.parse(
    await readFile(
      resolve(
        repositoryRoot,
        "packages/contracts/out/PactEvaluator.sol/PactEvaluator.json",
      ),
      "utf8",
    ),
  ) as FoundryArtifact;
  const evaluatorHash = keccak256(evaluatorArtifact.bytecode.object);
  const testnet = await loadDeploymentManifest(
    resolve(required("PACT_TESTNET_MANIFEST_PATH")),
  );
  assertMainnetGate(gitCommit, evaluatorHash, testnet, {
    repository: repositoryRoot,
  });

  const rpcUrl = required("PACT_E2E_RPC_URL");
  await verifyDeploymentIntegrity(rpcUrl, manifest);
  const statePath = resolve(required("PACT_E2E_STATE_PATH"));
  const releaseLock =
    await FileControlledOperatorState.acquireExclusive(statePath);
  try {
    const stateStore = FileControlledOperatorState.open(statePath);
    const initialState = await stateStore.load();
    if (initialState === undefined)
      throw new Error("RECOVERY_OPERATOR_STATE_MISSING");
    if (
      initialState.pactId !== pactRecordId ||
      initialState.jobId !== expectedJobId.toString() ||
      initialState.jobKey !== expectedJobKey
    )
      throw new Error("RECOVERY_OPERATOR_ARGUMENT_MISMATCH");

    const condition = normalizeGithubPrMergedCondition({
      provider: "github",
      repository: required("PACT_E2E_GITHUB_REPOSITORY"),
      pullRequest: Number(required("PACT_E2E_GITHUB_PULL_REQUEST")),
      baseBranch: required("PACT_E2E_GITHUB_BASE_BRANCH"),
      event: "PR_MERGED",
    });
    const conditionHash = hashGithubPrMergedCondition(condition);
    if (conditionHash !== initialState.conditionHash)
      throw new Error("RECOVERY_CONDITION_IDENTITY_MISMATCH");

    const verifier = createPactCompletionSignerFromEnv(process.env);
    if (getAddress(verifier.address) !== manifest.pactEvaluator.verifier)
      throw new Error("RECOVERY_VERIFIER_IDENTITY_MISMATCH");
    const arc = createArcReadClient({ rpcUrl, timeoutMs: 30_000 });
    const github = createGitHubPullRequestClientFromEnv(process.env);
    const database = createPactDatabaseFromEnv(process.env);
    try {
      const pactRepository = new PostgresPactRepository(database);
      const relayRepository = new PostgresRelayRepository(database);
      const phase4A = createPhase4AOrchestrator({
        repository: pactRepository,
        github,
        arc,
        signer: verifier,
        configuredChainId: 5042n,
        configuredPactEvaluator: manifest.pactEvaluator.address,
        configuredCommerceContract: manifest.erc8183.proxy,
      });
      const service = createExpiredAttestationRecoveryService({
        recoveryRepository: relayRepository,
        operationRepository: pactRepository,
        arc,
        phase4A,
      });
      const identity: ExpiredAttestationRecoveryIdentity = {
        pactRecordId,
        operationId,
        attestationDigest,
        expectedChainId: 5042n,
        expectedCommerceContract: manifest.erc8183.proxy,
        expectedPactEvaluator: manifest.pactEvaluator.address,
        expectedJobId,
        expectedJobKey,
        expectedConditionHash: conditionHash,
        expectedCompletionDeadline: BigInt(initialState.completionDeadline),
        expectedVerifier: manifest.pactEvaluator.verifier,
        expectedClient: getAddress(initialState.client),
        expectedProvider: getAddress(initialState.provider),
        relayAddress: getAddress(initialState.relay),
      };
      const coordinator = createExpiredRecoveryCoordinator({
        stateStore,
        service,
        expectedManifestIdentity: keccak256(
          stringToHex(JSON.stringify(manifest)),
        ),
        expectedRepository: condition.repository,
        expectedPullRequest: condition.pullRequest,
        expectedBaseBranch: condition.baseBranch,
        observeCondition: async (observedAt: bigint) => {
          const result = await verifyGitHubPrMerged({
            condition,
            completionDeadline: identity.expectedCompletionDeadline,
            observedAt,
            client: github,
          });
          if (result.status === "SATISFIED") return { status: "SATISFIED" };
          if (result.status === "NOT_SATISFIED")
            return { status: "NOT_SATISFIED", reason: result.reason };
          return { status: "INDETERMINATE", reason: result.reason };
        },
      });
      const result = await coordinator.run(identity);
      const finalSnapshot = await arc.readSnapshot({
        pactEvaluator: identity.expectedPactEvaluator,
        commerceContract: identity.expectedCommerceContract,
        jobId: identity.expectedJobId,
      });
      process.stdout.write(
        `${JSON.stringify(
          {
            status: "READY_TO_RELAY",
            operationId: result.operationId,
            evidenceHash: result.evidenceHash,
            attestationDigest: result.attestationDigest,
            verifiedAt: result.verifiedAt.toString(),
            validUntil: result.validUntil.toString(),
            blockNumber: finalSnapshot.blockNumber.toString(),
            blockTimestamp: finalSnapshot.blockTimestamp.toString(),
            jobStatus: finalSnapshot.jobStatus,
            bindingAccepted: finalSnapshot.bindingAccepted,
            verifierRevoked: finalSnapshot.verifierRevoked,
            relayIntentId: result.retirement.relayIntentId,
            relayTransactionSigning: 0,
            nonceReservations: 0,
            broadcasts: 0,
          },
          null,
          2,
        )}\n`,
      );
    } finally {
      await database.close();
    }
  } finally {
    await releaseLock();
  }
}

await main();
