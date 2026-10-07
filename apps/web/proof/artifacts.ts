import mainnetJob1Json from "./artifacts/arc-mainnet-job-1.json";
import mainnetJob2Json from "./artifacts/arc-mainnet-job-2.json";
import testnetJson from "./artifacts/arc-testnet-job-6.json";
import {
  assertPublicProofDto,
  validateSettlementProofArtifact,
  type ProofEnvironment,
  type SettlementProofArtifact,
} from "./schema";

export const mainnetJob1Proof = assertPublicProofDto(
  validateSettlementProofArtifact(mainnetJob1Json),
);

export const mainnetJob2Proof = assertPublicProofDto(
  validateSettlementProofArtifact(mainnetJob2Json),
);

export const mainnetProof = mainnetJob2Proof;

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

export function getMainnetProof(jobId: "1" | "2"): SettlementProofArtifact {
  return jobId === "1" ? mainnetJob1Proof : mainnetJob2Proof;
}
