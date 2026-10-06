import {
  PostgresAutomationRepository,
  assertSignerIdentity,
  assertTestnetManifest,
  createVerifierScheduler,
  createWorkerHealth,
  loadWorkerHealthPort,
  jsonWorkerLogger,
  loadVerifierWorkerConfig,
  probeArcRpc,
  probeDatabase,
  probeGithub,
  safeWorkerReason,
  startWorkerHealthServer,
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
  const signer = createPactCompletionSignerFromEnv(process.env);
  assertSignerIdentity(
    "verifier",
    signer.address,
    manifest.pactEvaluator.verifier,
  );
  const database = createPactDatabase(config.databaseUrl);
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
    expectedSignerAddress: manifest.pactEvaluator.verifier,
    includesGithub: true,
    staleAfterMs: Math.max(config.pollIntervalMs * 3, 60_000),
  });
  await startWorkerHealthServer(health, loadWorkerHealthPort(process.env));
  let deploymentIntegrityVerified = false;
  let staleLogged = false;
  setInterval(
    () => {
      const stale = health.read().stale;
      if (stale && !staleLogged) {
        staleLogged = true;
        jsonWorkerLogger({ role: "verifier", event: "worker_loop_stale" });
      } else if (!stale) {
        staleLogged = false;
      }
    },
    Math.max(config.pollIntervalMs, 5_000),
  ).unref();
  jsonWorkerLogger({
    role: "verifier",
    event: "worker_started",
    chainId: manifest.chainId,
  });
  while (true) {
    let databaseReady = false;
    let arcReady = false;
    let githubReady = false;
    try {
      await probeDatabase(database);
      databaseReady = true;
    } catch {
      jsonWorkerLogger({ role: "verifier", event: "database_unavailable" });
    }
    health.database(databaseReady);
    try {
      await probeArcRpc(config.arcRpcUrl);
      if (!deploymentIntegrityVerified) {
        await verifyDeploymentIntegrity(config.arcRpcUrl, manifest);
        deploymentIntegrityVerified = true;
      }
      arcReady = true;
    } catch {
      jsonWorkerLogger({ role: "verifier", event: "arc_rpc_unavailable" });
    }
    health.arcRpc(arcReady);
    try {
      await probeGithub(process.env.GITHUB_TOKEN);
      githubReady = true;
    } catch {
      jsonWorkerLogger({ role: "verifier", event: "github_unavailable" });
    }
    health.github(githubReady);
    if (databaseReady && arcReady && githubReady) {
      try {
        const outcomes = await scheduler.runOnce();
        health.loopSucceeded(outcomes.length === 0 ? "IDLE" : "PROCESSED");
      } catch (error) {
        const reason = safeWorkerReason(error);
        health.loopFailed(reason);
        jsonWorkerLogger({
          role: "verifier",
          event: "worker_loop_failed",
          reason,
        });
      }
    } else {
      health.loopFailed("DEPENDENCY_UNAVAILABLE");
    }
    await sleep(config.pollIntervalMs);
  }
}

main().catch((error: unknown) => {
  const reason = safeWorkerReason(error);
  jsonWorkerLogger({
    role: "verifier",
    event:
      reason === "VERIFIER_SIGNER_IDENTITY_MISMATCH"
        ? "signer_mismatch"
        : "startup_configuration_failed",
    reason,
  });
  process.exitCode = 1;
});
