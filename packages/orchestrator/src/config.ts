import { validateDatabaseUrl } from "@pact/database";
import { createHash, timingSafeEqual } from "node:crypto";
import { getAddress, isAddress, type Address } from "viem";
import { validateWebhookSecret } from "./webhook.js";

export interface Phase4AConfig {
  readonly environment: "development" | "test" | "production";
  readonly databaseUrl: string;
  readonly arcRpcUrl: string;
  readonly arcChainId: bigint;
  readonly pactEvaluatorAddress: Address;
  readonly commerceContractAddress: Address;
  readonly webhookSecret: string;
  readonly internalApiToken: string;
  readonly appOrigin: string;
}

function required(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = environment[name];
  if (value === undefined || value.length === 0)
    throw new Error(`${name} is required`);
  return value;
}

function address(name: string, value: string): Address {
  if (!isAddress(value, { strict: true }) || /^0x0{40}$/i.test(value)) {
    throw new Error(`${name} must be a valid nonzero address`);
  }
  return getAddress(value);
}

function url(
  name: string,
  value: string,
  environment: Phase4AConfig["environment"],
): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  const localDevelopment =
    environment !== "production" &&
    parsed.protocol === "http:" &&
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !localDevelopment)
    throw new Error(`${name} must use HTTPS outside local development`);
  return parsed.toString().replace(/\/$/, "");
}

export function loadPhase4AConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Phase4AConfig {
  const mode = environment.PACT_ENVIRONMENT ?? "development";
  if (mode !== "development" && mode !== "test" && mode !== "production") {
    throw new Error("PACT_ENVIRONMENT is invalid");
  }
  const chainIdText = required(environment, "ARC_CHAIN_ID");
  if (!/^\d+$/.test(chainIdText) || BigInt(chainIdText) <= 0n)
    throw new Error("ARC_CHAIN_ID must be a positive integer");
  const internalApiToken = required(environment, "PACT_INTERNAL_API_TOKEN");
  const tokenBytes = new TextEncoder().encode(internalApiToken).byteLength;
  if (tokenBytes < 32 || tokenBytes > 256)
    throw new Error("PACT_INTERNAL_API_TOKEN length is invalid");
  return Object.freeze({
    environment: mode,
    databaseUrl: validateDatabaseUrl(required(environment, "DATABASE_URL")),
    arcRpcUrl: url("ARC_RPC_URL", required(environment, "ARC_RPC_URL"), mode),
    arcChainId: BigInt(chainIdText),
    pactEvaluatorAddress: address(
      "PACT_EVALUATOR_ADDRESS",
      required(environment, "PACT_EVALUATOR_ADDRESS"),
    ),
    commerceContractAddress: address(
      "ERC8183_COMMERCE_CONTRACT_ADDRESS",
      required(environment, "ERC8183_COMMERCE_CONTRACT_ADDRESS"),
    ),
    webhookSecret: validateWebhookSecret(
      required(environment, "GITHUB_WEBHOOK_SECRET"),
    ),
    internalApiToken,
    appOrigin: url(
      "PACT_APP_ORIGIN",
      required(environment, "PACT_APP_ORIGIN"),
      mode,
    ),
  });
}

export function authorizeInternalRequest(
  request: Request,
  config: Pick<Phase4AConfig, "internalApiToken" | "appOrigin">,
  requireOrigin: boolean,
): boolean {
  const authorization = request.headers.get("authorization");
  if (authorization === null) return false;
  const actual = createHash("sha256").update(authorization).digest();
  const expected = createHash("sha256")
    .update(`Bearer ${config.internalApiToken}`)
    .digest();
  if (!timingSafeEqual(actual, expected)) return false;
  if (!requireOrigin) return true;
  const origin = request.headers.get("origin");
  return origin === config.appOrigin;
}
