import type { Address } from "viem";

export type ProductNetworkId = "arc-mainnet" | "arc-testnet";

export interface ProductNetworkConfig {
  readonly id: ProductNetworkId;
  readonly displayName: "Arc Mainnet" | "Arc Testnet";
  readonly chainId: bigint;
  readonly chainIdNumber: number;
  readonly hexChainId: `0x${string}`;
  readonly defaultPublicRpcUrl: string;
  readonly rpcEnvironmentKey: "PACT_PRODUCT_ARC_RPC_URL";
  readonly nativeCurrency: Readonly<{
    name: "USDC";
    symbol: "USDC";
    decimals: 18;
  }>;
  readonly usdcAddress: Address;
  readonly deploymentManifest: "arc-mainnet" | "arc-testnet";
}

const ARC_USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;
const PRODUCT_RPC_ENVIRONMENT_KEY = "PACT_PRODUCT_ARC_RPC_URL" as const;
const ARC_NATIVE_CURRENCY = Object.freeze({
  name: "USDC" as const,
  symbol: "USDC" as const,
  decimals: 18 as const,
});

export const ARC_MAINNET_PRODUCT_NETWORK: ProductNetworkConfig = Object.freeze({
  id: "arc-mainnet",
  displayName: "Arc Mainnet",
  chainId: 5_042n,
  chainIdNumber: 5_042,
  hexChainId: "0x13b2",
  defaultPublicRpcUrl: "https://rpc.mainnet.arc.io",
  rpcEnvironmentKey: PRODUCT_RPC_ENVIRONMENT_KEY,
  nativeCurrency: ARC_NATIVE_CURRENCY,
  usdcAddress: ARC_USDC_ADDRESS,
  deploymentManifest: "arc-mainnet",
});

export const ARC_TESTNET_PRODUCT_NETWORK: ProductNetworkConfig = Object.freeze({
  id: "arc-testnet",
  displayName: "Arc Testnet",
  chainId: 5_042_002n,
  chainIdNumber: 5_042_002,
  hexChainId: "0x4cef52",
  defaultPublicRpcUrl: "https://rpc.testnet.arc.io",
  rpcEnvironmentKey: PRODUCT_RPC_ENVIRONMENT_KEY,
  nativeCurrency: ARC_NATIVE_CURRENCY,
  usdcAddress: ARC_USDC_ADDRESS,
  deploymentManifest: "arc-testnet",
});

const PRODUCT_NETWORKS: Readonly<
  Record<ProductNetworkId, ProductNetworkConfig>
> = Object.freeze({
  "arc-mainnet": ARC_MAINNET_PRODUCT_NETWORK,
  "arc-testnet": ARC_TESTNET_PRODUCT_NETWORK,
});

export const DEFAULT_PRODUCT_NETWORK = ARC_MAINNET_PRODUCT_NETWORK;

// Phase 2 must migrate the persisted product schema before this can change.
export const PERSISTED_PRODUCT_NETWORK = ARC_TESTNET_PRODUCT_NETWORK;
export const MAINNET_SELF_SERVICE_ENABLED = false as const;

export function getProductNetwork(id: ProductNetworkId): ProductNetworkConfig {
  return PRODUCT_NETWORKS[id];
}

export function getProductNetworkByChainId(
  chainId: number | bigint,
): ProductNetworkConfig | undefined {
  const normalized = BigInt(chainId);
  return Object.values(PRODUCT_NETWORKS).find(
    (network) => network.chainId === normalized,
  );
}

export function isProductSelfServiceEnabled(
  network: ProductNetworkConfig,
): boolean {
  if (network.id === ARC_MAINNET_PRODUCT_NETWORK.id) {
    return MAINNET_SELF_SERVICE_ENABLED;
  }
  return (
    network.id === PERSISTED_PRODUCT_NETWORK.id &&
    network.chainId === PERSISTED_PRODUCT_NETWORK.chainId
  );
}
