import {
  PostgresAutomationRepository,
  assertSignerIdentity,
  assertTestnetManifest,
  createVerifierScheduler,
  createWorkerHealth,
  jsonWorkerLogger,
  loadVerifierWorkerConfig,
} from "@pact/automation";
import { PostgresPactRepository, createPactDatabase } from "@pact/database";
import {
  createArcReadClient,
  createPhase4AOrchestrator,
  loadDeploymentManifest,
  verifyDeploymentIntegrity,
} from "@pact/orchestrator";
import { createGitHubPullRequestClientFromEnv } from "@pact/verifier/github";
import { createPactCompletionSignerFromEnv } from "@pact/verifier/signer";

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main(): Promise<void> {
  const config = loadVerifierWorkerConfig(process.env);
  const manifest = assertTestnetManifest(
    await loadDeploymentManifest(config.deploymentManifestPath),
  );
  await verifyDeploymentIntegrity(config.arcRpcUrl, manifest);
  const signer = createPactCompletionSignerFromEnv(process.env);
  assertSignerIdentity(
    "verifier",
    signer.address,
    manifest.pactEvaluator.verifier,
  );
  const database = createPactDatabase(config.databaseUrl);
  await database.sql`SELECT 1`;
  const certifiedRepository = new PostgresPactRepository(database);
  const automation = new PostgresAutomationRepository(database);
  const arc = createArcReadClient({ rpcUrl: config.arcRpcUrl });
  const orchestrator = createPhase4AOrchestrator({
    repository: certifiedRepository,
    github: createGitHubPullRequestClientFromEnv(process.env),
    arc,
    signer,
    configuredChainId: BigInt(manifest.chainId),
    configuredPactEvaluator: manifest.pactEvaluator.address,
    configuredCommerceContract: manifest.erc8183.proxy,
  });
  const scheduler = createVerifierScheduler({
    automation,
    certifiedRepository,
    arc,
    orchestrator,
    workerId: config.workerId,
    leaseSeconds: config.leaseSeconds,
    batchSize: config.batchSize,
    pollSeconds: Math.ceil(config.pollIntervalMs / 1_000),
    configuredPactEvaluator: manifest.pactEvaluator.address,
    configuredCommerceContract: manifest.erc8183.proxy,
    configuredVerifier: manifest.pactEvaluator.verifier,
    logger: jsonWorkerLogger,
  });
  const health = createWorkerHealth({
    role: "verifier",
    signerAddress: signer.address,
    includesGithub: true,
  });
  jsonWorkerLogger({
    role: "verifier",
    event: "worker_started",
    chainId: manifest.chainId,
  });
  while (true) {
    try {
      await scheduler.runOnce();
      health.ready();
    } catch (error) {
      const reason = error instanceof Error ? error.message : "UNKNOWN_FAILURE";
      health.failed(reason);
      jsonWorkerLogger({
        role: "verifier",
        event: "worker_loop_failed",
        reason,
      });
    }
    await sleep(config.pollIntervalMs);
  }
}

await main();
