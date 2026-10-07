import mainnetJson from "./artifacts/arc-mainnet-job-1.json";
import testnetJson from "./artifacts/arc-testnet-job-6.json";
import {
  assertPublicProofDto,
  validateSettlementProofArtifact,
  type ProofEnvironment,
  type SettlementProofArtifact,
} from "./schema";

export const mainnetProof = assertPublicProofDto(
  validateSettlementProofArtifact(mainnetJson),
);

export const testnetProof = assertPublicProofDto(
  validateSettlementProofArtifact(testnetJson),
);

export const proofsByEnvironment: Readonly<
  Record<ProofEnvironment, SettlementProofArtifact>
> = Object.freeze({
  mainnet: mainnetProof,
  testnet: testnetProof,
});

export function selectProofEnvironment(value: unknown): ProofEnvironment {
  return value === "testnet" ? "testnet" : "mainnet";
}

export function getSettlementProof(value: unknown): SettlementProofArtifact {
  return proofsByEnvironment[selectProofEnvironment(value)];
}
