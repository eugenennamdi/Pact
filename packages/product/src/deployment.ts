import {
  assertDeploymentManifest,
  verifyDeploymentIntegrity,
  type DeploymentManifest,
} from "@pact/orchestrator";
import { getAddress, type Address } from "viem";
import manifestJson from "../../../deployments/arc-testnet.json";
import {
  PRODUCT_CHAIN_ID,
  PRODUCT_COMMERCE_ADDRESS,
  PRODUCT_EVALUATOR_ADDRESS,
  PRODUCT_USDC_ADDRESS,
  PRODUCT_VERIFIER_ADDRESS,
} from "./constants";

export interface ProductDeployment {
  readonly chainId: bigint;
  readonly commerce: Address;
  readonly evaluator: Address;
  readonly usdc: Address;
  readonly verifier: Address;
  readonly manifest: DeploymentManifest;
}

export function loadCertifiedProductDeployment(): ProductDeployment {
  const manifest = assertDeploymentManifest(manifestJson);
  if (
    manifest.network !== "arc-testnet" ||
    manifest.testnetGate?.status !== "PASS" ||
    BigInt(manifest.chainId) !== PRODUCT_CHAIN_ID ||
    getAddress(manifest.erc8183.proxy) !==
      getAddress(PRODUCT_COMMERCE_ADDRESS) ||
    getAddress(manifest.pactEvaluator.address) !==
      getAddress(PRODUCT_EVALUATOR_ADDRESS) ||
    getAddress(manifest.usdc.address) !== getAddress(PRODUCT_USDC_ADDRESS) ||
    getAddress(manifest.pactEvaluator.verifier) !==
      getAddress(PRODUCT_VERIFIER_ADDRESS)
  ) {
    throw new Error("PRODUCT_DEPLOYMENT_IDENTITY_MISMATCH");
  }
  return Object.freeze({
    chainId: PRODUCT_CHAIN_ID,
    commerce: getAddress(manifest.erc8183.proxy),
    evaluator: getAddress(manifest.pactEvaluator.address),
    usdc: getAddress(manifest.usdc.address),
    verifier: getAddress(manifest.pactEvaluator.verifier),
    manifest,
  });
}

export async function verifyCertifiedProductDeployment(
  rpcUrl: string,
): Promise<ProductDeployment> {
  const deployment = loadCertifiedProductDeployment();
  await verifyDeploymentIntegrity(rpcUrl, deployment.manifest);
  return deployment;
}
