import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { recoverTypedDataAddress } from "viem";
import {
  getPactAttestationDomain,
  hashGithubPrMergedCondition,
  hashPactCompletionAttestation,
  hashPactGitHubPrMergedEvidenceV1,
  normalizeGithubPrMergedCondition,
  normalizePactGitHubPrMergedEvidenceV1,
  pactCompletionAttestationTypes,
  PACT_COMPLETION_ATTESTATION_PRIMARY_TYPE,
} from "@pact/protocol";
import { mainnetProof, testnetProof } from "./artifacts";
import {
  assertPublicProofDto,
  lifecycleOrder,
  validateSettlementProofArtifact,
  type SettlementProofArtifact,
} from "./schema";

const TESTNET_ARTIFACT_SHA256 =
  "c83e09ef92ec06071ba4ac2d94ec3abf037da9153b9517ee2cc0c640865c47a5";

const artifactPath = new URL(
  "./artifacts/arc-testnet-job-6.json",
  import.meta.url,
);

function recomputeCondition(proof: SettlementProofArtifact) {
  return hashGithubPrMergedCondition(
    normalizeGithubPrMergedCondition({
      provider: proof.condition.provider,
      repository: proof.condition.repository,
      pullRequest: proof.condition.pullRequest,
      baseBranch: proof.condition.baseBranch,
      event: proof.condition.event,
    }),
  );
}

function recomputeEvidence(proof: SettlementProofArtifact) {
  return hashPactGitHubPrMergedEvidenceV1(
    normalizePactGitHubPrMergedEvidenceV1({
      conditionHash: proof.conditionHash,
      repository: proof.githubEvidence.repository,
      pullRequest: proof.githubEvidence.pullRequest,
      baseBranch: proof.githubEvidence.baseBranch,
      mergeCommitSha: proof.githubEvidence.mergeCommitSha,
      mergedAt: BigInt(proof.githubEvidence.mergedAt),
      observedAt: BigInt(proof.githubEvidence.observedAt),
    }),
  );
}

function attestationMessage(proof: SettlementProofArtifact) {
  return {
    commerceContract: proof.attestation.commerceContract as `0x${string}`,
    jobId: BigInt(proof.attestation.jobId),
    conditionHash: proof.attestation.conditionHash as `0x${string}`,
    evidenceHash: proof.attestation.evidenceHash as `0x${string}`,
    satisfiedAt: BigInt(proof.attestation.satisfiedAt),
    verifiedAt: BigInt(proof.attestation.verifiedAt),
    validUntil: BigInt(proof.attestation.validUntil),
  };
}

describe("canonical proof artifacts", () => {
  it("freezes the Testnet job #6 artifact bytes", async () => {
    const artifact = await readFile(artifactPath);
    expect(createHash("sha256").update(artifact).digest("hex")).toBe(
      TESTNET_ARTIFACT_SHA256,
    );
  });

  it.each([mainnetProof, testnetProof])(
    "validates $artifactId and preserves lifecycle order",
    (proof) => {
      expect(validateSettlementProofArtifact(proof)).toBe(proof);
      expect(proof.walletActions.map(({ action }) => action)).toEqual(
        lifecycleOrder,
      );
      expect(proof.settlement.treasuryPayout).toBe("0");
      expect(proof.settlement.evaluatorPayout).toBe("0");
    },
  );

  it.each([mainnetProof, testnetProof])(
    "recomputes condition and evidence commitments for $artifactId",
    (proof) => {
      expect(recomputeCondition(proof)).toBe(proof.conditionHash);
      expect(recomputeEvidence(proof)).toBe(proof.evidenceHash);
    },
  );

  it.each([mainnetProof, testnetProof])(
    "recomputes and recovers the signed attestation for $artifactId",
    async (proof) => {
      const domainInput = {
        chainId: proof.chainId,
        verifyingContract: proof.contracts.pactEvaluator as `0x${string}`,
      };
      const message = attestationMessage(proof);
      expect(hashPactCompletionAttestation(domainInput, message)).toBe(
        proof.attestation.digest,
      );
      await expect(
        recoverTypedDataAddress({
          domain: getPactAttestationDomain(domainInput),
          types: pactCompletionAttestationTypes,
          primaryType: PACT_COMPLETION_ATTESTATION_PRIMARY_TYPE,
          message,
          signature: proof.attestation.signature as `0x${string}`,
        }),
      ).resolves.toBe(proof.actors.verifier);
    },
  );

  it("records the exact two independent settlement transactions", () => {
    expect(mainnetProof.relay.transactionHash).toBe(
      "0x876a6b547bbc512cb8b6ba99a1e6054fad6a1491edb1a18418ec05f860a65d66",
    );
    expect(testnetProof.relay.transactionHash).toBe(
      "0x7ebf9a4f15c74e74e56478fd6e28adc6569165f858be8f6f0922cecd043fd8e9",
    );
    expect(testnetProof.walletActions).toHaveLength(6);
    expect(testnetProof.job.id).toBe("6");
    expect(mainnetProof.job.id).toBe("1");
  });

  it("does not leak network-specific identities between artifacts", () => {
    const mainnet = JSON.stringify(mainnetProof);
    const testnet = JSON.stringify(testnetProof);
    for (const value of [
      testnetProof.contracts.implementation,
      testnetProof.contracts.commerce,
      testnetProof.contracts.pactEvaluator,
      testnetProof.actors.client,
      testnetProof.actors.provider,
      testnetProof.actors.verifier,
      testnetProof.actors.relay,
      ...testnetProof.walletActions.map(({ txHash }) => txHash),
      testnetProof.relay.transactionHash,
    ]) {
      expect(mainnet.toLowerCase()).not.toContain(value.toLowerCase());
    }
    for (const value of [
      mainnetProof.contracts.implementation,
      mainnetProof.contracts.commerce,
      mainnetProof.contracts.pactEvaluator,
      mainnetProof.actors.client,
      mainnetProof.actors.provider,
      mainnetProof.actors.verifier,
      mainnetProof.actors.relay,
      ...mainnetProof.walletActions.map(({ txHash }) => txHash),
      mainnetProof.relay.transactionHash,
    ]) {
      expect(testnet.toLowerCase()).not.toContain(value.toLowerCase());
    }
  });

  it("rejects malformed or secret-bearing artifacts", () => {
    expect(() =>
      validateSettlementProofArtifact({ ...testnetProof, walletActions: [] }),
    ).toThrow("exactly six wallet actions");
    expect(() =>
      validateSettlementProofArtifact({
        ...testnetProof,
        conditionHash: "0x1234",
      }),
    ).toThrow("conditionHash is invalid");
    expect(() =>
      assertPublicProofDto({
        ...testnetProof,
        privateKey: "forbidden",
      } as SettlementProofArtifact),
    ).toThrow("forbidden secret field");
  });
});
