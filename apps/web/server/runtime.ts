import {
  PostgresPactRepository,
  PostgresRelayRepository,
  createPactDatabase,
  type PactDatabase,
} from "@pact/database";
import {
  createArcReadClient,
  createPhase4AOrchestrator,
  createPactRelayService,
  createPactRelaySignerFromEnv,
  createRelayChainClient,
  loadPhase4AConfig,
  type Phase4AConfig,
} from "@pact/orchestrator";
import { createGitHubPullRequestClientFromEnv } from "@pact/verifier/github";
import { createPactCompletionSignerFromEnv } from "@pact/verifier/signer";

export interface Phase4ARuntime {
  readonly config: Phase4AConfig;
  readonly database: PactDatabase;
  readonly repository: PostgresPactRepository;
  readonly orchestrator: ReturnType<typeof createPhase4AOrchestrator>;
}

export interface Phase4BRuntime extends Phase4ARuntime {
  readonly relayRepository: PostgresRelayRepository;
  readonly relay: ReturnType<typeof createPactRelayService>;
}

let runtime: Phase4ARuntime | undefined;
let relayRuntime: Phase4BRuntime | undefined;

export function getPhase4ARuntime(): Phase4ARuntime {
  if (runtime !== undefined) return runtime;
  const config = loadPhase4AConfig(process.env);
  const database = createPactDatabase(config.databaseUrl);
  const repository = new PostgresPactRepository(database);
  const signer = createPactCompletionSignerFromEnv(process.env);
  runtime = Object.freeze({
    config,
    database,
    repository,
    orchestrator: createPhase4AOrchestrator({
      repository,
      github: createGitHubPullRequestClientFromEnv(process.env),
      arc: createArcReadClient({ rpcUrl: config.arcRpcUrl }),
      signer,
      configuredChainId: config.arcChainId,
      configuredPactEvaluator: config.pactEvaluatorAddress,
      configuredCommerceContract: config.commerceContractAddress,
    }),
  });
  return runtime;
}

export function getPhase4BRuntime(): Phase4BRuntime {
  if (relayRuntime !== undefined) return relayRuntime;
  const phase4A = getPhase4ARuntime();
  const verifierSigner = createPactCompletionSignerFromEnv(process.env);
  const relaySigner = createPactRelaySignerFromEnv(
    verifierSigner.address,
    process.env,
  );
  const chain = createRelayChainClient({ rpcUrl: phase4A.config.arcRpcUrl });
  const relayRepository = new PostgresRelayRepository(phase4A.database);
  relayRuntime = Object.freeze({
    ...phase4A,
    relayRepository,
    relay: createPactRelayService({
      repository: relayRepository,
      chain,
      transport: chain.broadcast,
      signer: relaySigner,
      configuredChainId: phase4A.config.arcChainId,
      configuredPactEvaluator: phase4A.config.pactEvaluatorAddress,
      configuredCommerceContract: phase4A.config.commerceContractAddress,
    }),
  });
  return relayRuntime;
}
