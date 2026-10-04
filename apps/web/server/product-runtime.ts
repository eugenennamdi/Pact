import { createPactDatabase, type PactDatabase } from "@pact/database";
import { PostgresAutomationRepository } from "@pact/automation";
import { createGitHubPullRequestClient } from "@pact/verifier/github";
import {
  InMemoryRateLimiter,
  PostgresProductRepository,
  ProductCanonicalPactRegistrar,
  createProductChainClient,
  loadProductConfig,
  type ProductRuntime,
} from "../../../packages/product/src/index";

export {
  handleAuthChallenge,
  handleAuthLogout,
  handleAuthSession,
  handleCreateDraft,
  handleReadEvidence,
  handleReadPact,
  handleReadSettlement,
  handlePrepareWalletAction,
  handleConfirmWalletAction,
  handleRetryPact,
} from "../../../packages/product/src/http";

let runtime: ProductRuntime | undefined;
let database: PactDatabase | undefined;

export function getProductRuntime(): ProductRuntime {
  if (runtime !== undefined) return runtime;
  const config = loadProductConfig(process.env);
  database = createPactDatabase(config.databaseUrl);
  runtime = Object.freeze({
    config,
    repository: new PostgresProductRepository(database),
    github: createGitHubPullRequestClient(
      config.githubToken === undefined ? {} : { token: config.githubToken },
    ),
    rateLimiter: new InMemoryRateLimiter(),
    chain: createProductChainClient({ rpcUrl: config.arcRpcUrl }),
    registrar: new ProductCanonicalPactRegistrar(database),
    automation: new PostgresAutomationRepository(database),
  });
  return runtime;
}
