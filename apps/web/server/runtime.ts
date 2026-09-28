import {
  PostgresPactRepository,
  createPactDatabase,
  type PactDatabase,
} from "@pact/database";
import {
  createArcReadClient,
  createPhase4AOrchestrator,
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

let runtime: Phase4ARuntime | undefined;

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
