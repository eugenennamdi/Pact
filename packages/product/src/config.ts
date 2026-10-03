import { getAddress } from "viem";
import { PRODUCT_CHAIN_ID_NUMBER, SESSION_TTL_SECONDS } from "./constants";

export interface ProductConfig {
  readonly publicOrigin: URL;
  readonly sessionSecret: string;
  readonly secureCookie: boolean;
  readonly sessionTtlSeconds: number;
  readonly chainId: typeof PRODUCT_CHAIN_ID_NUMBER;
  readonly databaseUrl: string;
  readonly githubToken?: string;
}

function requireString(
  environment: Readonly<Record<string, string | undefined>>,
  key: string,
): string {
  const value = environment[key];
  if (value === undefined || value.length === 0)
    throw new Error(`${key} is required`);
  if (value.trim() !== value)
    throw new Error(`${key} must not contain surrounding whitespace`);
  return value;
}

export function validateSessionSecret(secret: string): string {
  if (new TextEncoder().encode(secret).length < 32) {
    throw new Error("PACT_SESSION_SECRET must contain at least 32 UTF-8 bytes");
  }
  if (/^(change-me|example|placeholder|test-secret)/i.test(secret)) {
    throw new Error(
      "PACT_SESSION_SECRET must not use a documented placeholder",
    );
  }
  return secret;
}

export function loadProductConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ProductConfig {
  const publicOrigin = new URL(
    requireString(environment, "PACT_PUBLIC_ORIGIN"),
  );
  if (
    publicOrigin.username !== "" ||
    publicOrigin.password !== "" ||
    publicOrigin.pathname !== "/" ||
    publicOrigin.search !== "" ||
    publicOrigin.hash !== ""
  ) {
    throw new Error(
      "PACT_PUBLIC_ORIGIN must be an origin without credentials or path",
    );
  }
  if (
    publicOrigin.protocol !== "https:" &&
    publicOrigin.hostname !== "localhost"
  ) {
    throw new Error("PACT_PUBLIC_ORIGIN must use HTTPS outside localhost");
  }
  const sessionSecret = validateSessionSecret(
    requireString(environment, "PACT_SESSION_SECRET"),
  );
  const databaseUrl = requireString(environment, "DATABASE_URL");
  const githubToken = environment.GITHUB_TOKEN;
  if (githubToken !== undefined && githubToken.trim() !== githubToken) {
    throw new Error("GITHUB_TOKEN must not contain surrounding whitespace");
  }
  return Object.freeze({
    publicOrigin,
    sessionSecret,
    secureCookie: environment.NODE_ENV === "production",
    sessionTtlSeconds: SESSION_TTL_SECONDS,
    chainId: PRODUCT_CHAIN_ID_NUMBER,
    databaseUrl,
    ...(githubToken === undefined || githubToken.length === 0
      ? {}
      : { githubToken }),
  });
}

export function authorizeDraftClient(
  sessionWallet: string,
  creatingWallet: string,
): boolean {
  return getAddress(sessionWallet) === getAddress(creatingWallet);
}

export function authorizeDraftProvider(
  sessionWallet: string,
  providerAddress: string,
): boolean {
  return getAddress(sessionWallet) === getAddress(providerAddress);
}
