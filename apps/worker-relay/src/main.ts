import {
  assertTestnetManifest,
  assertSignerIdentity,
  createRelayWorker,
  createWorkerHealth,
  jsonWorkerLogger,
  loadRelayWorkerConfig,
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
  await verifyDeploymentIntegrity(config.arcRpcUrl, manifest);
  const signer = createPactRelaySignerFromEnv(
    manifest.pactEvaluator.verifier,
    process.env,
  );
  assertSignerIdentity("relay", signer.address, config.relayAddress);
  const database = createPactDatabase(config.databaseUrl);
  await database.sql`SELECT 1`;
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
    includesGithub: false,
  });
  jsonWorkerLogger({
    role: "relay",
    event: "worker_started",
    chainId: manifest.chainId,
  });
  while (true) {
    try {
      await worker.runOnce();
      health.ready();
    } catch (error) {
      const reason = error instanceof Error ? error.message : "UNKNOWN_FAILURE";
      health.failed(reason);
      jsonWorkerLogger({
        role: "relay",
        event: "worker_loop_failed",
        reason,
      });
    }
    await sleep(config.pollIntervalMs);
  }
}

await main();
