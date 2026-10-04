import { validateDatabaseUrl } from "@pact/database";
import type { DeploymentManifest } from "@pact/orchestrator";
import { getAddress, isAddress, type Address } from "viem";

export const AUTOMATION_CHAIN_ID = 5_042_002n;

function required(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = environment[name];
  if (value === undefined || value.length === 0)
    throw new Error(`${name} is required`);
  return value;
}

function positiveInteger(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
  maximum: number,
): number {
  const raw = environment[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum)
    throw new Error(`${name} is invalid`);
  return value;
}

function httpsOrLocal(name: string, value: string): string {
  const parsed = new URL(value);
  const local =
    parsed.protocol === "http:" &&
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !local)
    throw new Error(`${name} must use HTTPS outside local development`);
  return parsed.toString().replace(/\/$/, "");
}

function rejectSecrets(
  environment: Readonly<Record<string, string | undefined>>,
  names: readonly string[],
): void {
  for (const name of names) {
    if ((environment[name]?.length ?? 0) > 0)
      throw new Error(`${name} is forbidden for this worker role`);
  }
}

function address(name: string, value: string): Address {
  if (!isAddress(value, { strict: true }) || /^0x0{40}$/i.test(value))
    throw new Error(`${name} is invalid`);
  return getAddress(value);
}

export function assertSignerIdentity(
  role: "verifier" | "relay",
  actual: Address,
  expected: Address,
): void {
  if (getAddress(actual) !== getAddress(expected))
    throw new Error(`${role.toUpperCase()}_SIGNER_IDENTITY_MISMATCH`);
}

export interface VerifierWorkerConfig {
  readonly role: "verifier";
  readonly databaseUrl: string;
  readonly arcRpcUrl: string;
  readonly deploymentManifestPath: string;
  readonly pollIntervalMs: number;
  readonly leaseSeconds: number;
  readonly batchSize: number;
  readonly workerId: string;
}

export interface RelayWorkerConfig {
  readonly role: "relay";
  readonly databaseUrl: string;
  readonly arcRpcUrl: string;
  readonly deploymentManifestPath: string;
  readonly pollIntervalMs: number;
  readonly relayAddress: Address;
}

export function loadVerifierWorkerConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): VerifierWorkerConfig {
  if (required(environment, "PACT_WORKER_ROLE") !== "verifier")
    throw new Error("PACT_WORKER_ROLE must be verifier");
  required(environment, "PACT_VERIFIER_PRIVATE_KEY");
  rejectSecrets(environment, [
    "PACT_RELAY_PRIVATE_KEY",
    "PACT_DEPLOYER_PRIVATE_KEY",
    "PACT_ADMIN_PRIVATE_KEY",
    "PACT_E2E_CLIENT_PRIVATE_KEY",
    "PACT_E2E_PROVIDER_PRIVATE_KEY",
  ]);
  return Object.freeze({
    role: "verifier",
    databaseUrl: validateDatabaseUrl(required(environment, "DATABASE_URL")),
    arcRpcUrl: httpsOrLocal(
      "ARC_RPC_URL",
      required(environment, "ARC_RPC_URL"),
    ),
    deploymentManifestPath:
      environment.PACT_DEPLOYMENT_MANIFEST ?? "deployments/arc-testnet.json",
    pollIntervalMs: positiveInteger(
      environment,
      "PACT_AUTOMATION_POLL_MS",
      30_000,
      300_000,
    ),
    leaseSeconds: positiveInteger(
      environment,
      "PACT_AUTOMATION_LEASE_SECONDS",
      120,
      300,
    ),
    batchSize: positiveInteger(
      environment,
      "PACT_AUTOMATION_BATCH_SIZE",
      10,
      25,
    ),
    workerId: environment.PACT_WORKER_ID ?? `verifier-${crypto.randomUUID()}`,
  });
}

export function loadRelayWorkerConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): RelayWorkerConfig {
  if (required(environment, "PACT_WORKER_ROLE") !== "relay")
    throw new Error("PACT_WORKER_ROLE must be relay");
  required(environment, "PACT_RELAY_PRIVATE_KEY");
  rejectSecrets(environment, [
    "PACT_VERIFIER_PRIVATE_KEY",
    "GITHUB_TOKEN",
    "GITHUB_WEBHOOK_SECRET",
    "PACT_DEPLOYER_PRIVATE_KEY",
    "PACT_ADMIN_PRIVATE_KEY",
    "PACT_E2E_CLIENT_PRIVATE_KEY",
    "PACT_E2E_PROVIDER_PRIVATE_KEY",
  ]);
  return Object.freeze({
    role: "relay",
    databaseUrl: validateDatabaseUrl(required(environment, "DATABASE_URL")),
    arcRpcUrl: httpsOrLocal(
      "ARC_RPC_URL",
      required(environment, "ARC_RPC_URL"),
    ),
    deploymentManifestPath:
      environment.PACT_DEPLOYMENT_MANIFEST ?? "deployments/arc-testnet.json",
    pollIntervalMs: positiveInteger(
      environment,
      "PACT_RELAY_POLL_MS",
      5_000,
      60_000,
    ),
    relayAddress: address(
      "PACT_RELAY_ADDRESS",
      required(environment, "PACT_RELAY_ADDRESS"),
    ),
  });
}

export function assertTestnetManifest(
  manifest: DeploymentManifest,
): DeploymentManifest {
  if (
    manifest.network !== "arc-testnet" ||
    manifest.testnetGate?.status !== "PASS" ||
    BigInt(manifest.chainId) !== AUTOMATION_CHAIN_ID
  ) {
    throw new Error("AUTOMATION_TESTNET_MANIFEST_REQUIRED");
  }
  return manifest;
}
