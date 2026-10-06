import {
  assertTestnetManifest,
  assertSignerIdentity,
  createRelayWorker,
  createWorkerHealth,
  countBroadcastUnknown,
  jsonWorkerLogger,
  loadWorkerHealthPort,
  loadRelayWorkerConfig,
  probeArcRpc,
  probeDatabase,
  probeRelayBalance,
  safeWorkerReason,
  startWorkerHealthServer,
} from "@pact/automation";
import { PostgresRelayRepository, createPactDatabase } from "@pact/database";
import {
  createPactRelayService,
  createPactRelaySignerFromEnv,
  createRelayChainClient,
  loadDeploymentManifest,
  verifyDeploymentIntegrity,
} from "@pact/orchestrator";

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main(): Promise<void> {
  const config = loadRelayWorkerConfig(process.env);
  const manifest = assertTestnetManifest(
    await loadDeploymentManifest(config.deploymentManifestPath),
  );
  const signer = createPactRelaySignerFromEnv(
    manifest.pactEvaluator.verifier,
    process.env,
  );
  assertSignerIdentity("relay", signer.address, config.relayAddress);
  const database = createPactDatabase(config.databaseUrl);
  const repository = new PostgresRelayRepository(database);
  const chain = createRelayChainClient({ rpcUrl: config.arcRpcUrl });
  const relay = createPactRelayService({
    repository,
    chain,
    transport: chain.broadcast,
    signer,
    configuredChainId: BigInt(manifest.chainId),
    configuredPactEvaluator: manifest.pactEvaluator.address,
    configuredCommerceContract: manifest.erc8183.proxy,
  });
  const worker = createRelayWorker({ relay, logger: jsonWorkerLogger });
  const health = createWorkerHealth({
    role: "relay",
    signerAddress: signer.address,
    expectedSignerAddress: config.relayAddress,
    includesGithub: false,
    staleAfterMs: Math.max(config.pollIntervalMs * 3, 30_000),
  });
  await startWorkerHealthServer(health, loadWorkerHealthPort(process.env));
  let deploymentIntegrityVerified = false;
  let staleLogged = false;
  setInterval(
    () => {
      const stale = health.read().stale;
      if (stale && !staleLogged) {
        staleLogged = true;
        jsonWorkerLogger({ role: "relay", event: "worker_loop_stale" });
      } else if (!stale) {
        staleLogged = false;
      }
    },
    Math.max(config.pollIntervalMs, 5_000),
  ).unref();
  jsonWorkerLogger({
    role: "relay",
    event: "worker_started",
    chainId: manifest.chainId,
  });
  while (true) {
    let databaseReady = false;
    let arcReady = false;
    let balanceReady = false;
    let broadcastUnknown = 0;
    try {
      await probeDatabase(database);
      broadcastUnknown = await countBroadcastUnknown(database);
      databaseReady = true;
    } catch {
      jsonWorkerLogger({ role: "relay", event: "database_unavailable" });
    }
    health.database(databaseReady);
    try {
      await probeArcRpc(config.arcRpcUrl);
      if (!deploymentIntegrityVerified) {
        await verifyDeploymentIntegrity(config.arcRpcUrl, manifest);
        deploymentIntegrityVerified = true;
      }
      const relayBalance = await probeRelayBalance({
        rpcUrl: config.arcRpcUrl,
        relayAddress: config.relayAddress,
      });
      health.relayBalance({
        ...relayBalance,
        unresolvedBroadcastUnknown: broadcastUnknown,
      });
      balanceReady = relayBalance.balance >= relayBalance.required;
      if (!balanceReady) {
        jsonWorkerLogger({
          role: "relay",
          event: "relay_balance_unavailable",
          reason: "INSUFFICIENT_RELAY_GAS",
        });
      }
      arcReady = true;
    } catch {
      jsonWorkerLogger({ role: "relay", event: "arc_rpc_unavailable" });
    }
    health.arcRpc(arcReady);
    if (databaseReady && arcReady && balanceReady) {
      try {
        const result = await worker.runOnce();
        health.loopSucceeded(result === undefined ? "IDLE" : "PROCESSED");
      } catch (error) {
        const reason = safeWorkerReason(error);
        health.loopFailed(reason);
        jsonWorkerLogger({
          role: "relay",
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
    role: "relay",
    event:
      reason === "RELAY_SIGNER_IDENTITY_MISMATCH"
        ? "signer_mismatch"
        : "startup_configuration_failed",
    reason,
  });
  process.exitCode = 1;
});
