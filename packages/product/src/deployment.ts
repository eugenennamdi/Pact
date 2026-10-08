import {
  assertDeploymentManifest,
  verifyDeploymentIntegrity,
  type DeploymentManifest,
} from "@pact/orchestrator";
import { getAddress, type Address } from "viem";
import mainnetManifestJson from "../../../deployments/arc-mainnet.json";
import testnetManifestJson from "../../../deployments/arc-testnet.json";
import {
  DEFAULT_PRODUCT_NETWORK,
  type ProductNetworkConfig,
  type ProductNetworkId,
} from "./network";

export interface ProductDeployment {
  readonly network: ProductNetworkId;
  readonly chainId: bigint;
  readonly commerce: Address;
  readonly evaluator: Address;
  readonly usdc: Address;
  readonly verifier: Address;
  readonly manifest: DeploymentManifest;
}

const MANIFESTS = Object.freeze({
  "arc-mainnet": mainnetManifestJson,
  "arc-testnet": testnetManifestJson,
});

function assertGateIdentity(
  network: ProductNetworkConfig,
  manifest: DeploymentManifest,
): void {
  if (network.id === "arc-mainnet") {
    const gate = manifest.mainnetGate;
    if (
      gate?.status !== "PASS" ||
      gate.chainId !== network.chainId.toString() ||
      getAddress(gate.contracts.implementation) !==
        getAddress(manifest.erc8183.implementation) ||
      getAddress(gate.contracts.proxy) !== getAddress(manifest.erc8183.proxy) ||
      getAddress(gate.contracts.pactEvaluator) !==
        getAddress(manifest.pactEvaluator.address)
    ) {
      throw new Error("PRODUCT_DEPLOYMENT_GATE_MISMATCH");
    }
    return;
  }
  if (manifest.testnetGate?.status !== "PASS") {
    throw new Error("PRODUCT_DEPLOYMENT_GATE_MISMATCH");
  }
}

export function loadCertifiedProductDeployment(
  network: ProductNetworkConfig = DEFAULT_PRODUCT_NETWORK,
): ProductDeployment {
  const manifest = assertDeploymentManifest(
    MANIFESTS[network.deploymentManifest],
  );
  if (
    manifest.network !== network.id ||
    BigInt(manifest.chainId) !== network.chainId ||
    getAddress(manifest.usdc.address) !== getAddress(network.usdcAddress) ||
    getAddress(manifest.pactEvaluator.commerceContract) !==
      getAddress(manifest.erc8183.proxy)
  ) {
    throw new Error("PRODUCT_DEPLOYMENT_IDENTITY_MISMATCH");
  }
  assertGateIdentity(network, manifest);
  return Object.freeze({
    network: network.id,
    chainId: network.chainId,
    commerce: getAddress(manifest.erc8183.proxy),
    evaluator: getAddress(manifest.pactEvaluator.address),
    usdc: getAddress(manifest.usdc.address),
    verifier: getAddress(manifest.pactEvaluator.verifier),
    manifest,
  });
}

export async function verifyCertifiedProductDeployment(
  rpcUrl: string,
  network: ProductNetworkConfig = DEFAULT_PRODUCT_NETWORK,
): Promise<ProductDeployment> {
  const deployment = loadCertifiedProductDeployment(network);
  await verifyDeploymentIntegrity(rpcUrl, deployment.manifest);
  return deployment;
}
