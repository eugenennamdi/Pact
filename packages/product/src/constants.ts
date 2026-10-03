import arcTestnetManifest from "../../../deployments/arc-testnet.json";

export const PRODUCT_NETWORK = "arc-testnet" as const;
export const PRODUCT_CHAIN_ID = 5_042_002n;
export const PRODUCT_CHAIN_ID_NUMBER = 5_042_002;
export const PRODUCT_BASE_BRANCH = "main" as const;
export const PRODUCT_EVENT = "PR_MERGED" as const;
export const PRODUCT_COMPLETION_POLICY_VERSION = 1;
export const PRODUCT_COMPLETION_OFFSET_SECONDS = 7_200;
export const PRODUCT_EXPIRY_POLICY_VERSION = 1;
export const PRODUCT_EXPIRY_OFFSET_SECONDS = 21_600;
export const PRODUCT_PREPARATION_VERSION = 1;
export const AUTH_NONCE_TTL_SECONDS = 300;
export const SESSION_TTL_SECONDS = 900;
export const SESSION_VERSION = 1;
export const SESSION_COOKIE_NAME = "pact_session";

if (BigInt(arcTestnetManifest.chainId) !== PRODUCT_CHAIN_ID) {
  throw new Error("certified Arc Testnet manifest chain mismatch");
}

export const PRODUCT_COMMERCE_ADDRESS = arcTestnetManifest.erc8183.proxy;
export const PRODUCT_EVALUATOR_ADDRESS =
  arcTestnetManifest.pactEvaluator.address;
