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
import {
  mainnetJob1Proof,
  mainnetJob2Proof,
  mainnetProof,
  testnetProof,
} from "./artifacts";
import {
  assertPublicProofDto,
  lifecycleOrder,
  validateSettlementProofArtifact,
  type SettlementProofArtifact,
} from "./schema";

const TESTNET_ARTIFACT_SHA256 =
  "d322fdd53fa6193d68d8ed22e39617d40b24721109b528c2788d3a76230e141f";
const MAINNET_JOB_2_ARTIFACT_SHA256 =
  "b10522debb0522f576941b59cd6b06910573f6980104612fcad31bd61e506fdc";

const artifactPath = new URL(
  "./artifacts/arc-testnet-job-6.json",
  import.meta.url,
);
const mainnetJob2ArtifactPath = new URL(
  "./artifacts/arc-mainnet-job-2.json",
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

  it("freezes the Mainnet job #2 artifact bytes", async () => {
    const artifact = await readFile(mainnetJob2ArtifactPath);
    expect(createHash("sha256").update(artifact).digest("hex")).toBe(
      MAINNET_JOB_2_ARTIFACT_SHA256,
    );
  });

  it.each([mainnetJob1Proof, mainnetJob2Proof, testnetProof])(
    "validates $artifactId and preserves lifecycle order",
    (proof) => {
      expect(validateSettlementProofArtifact(proof)).toBe(proof);
      expect(proof.walletActions.map(({ action }) => action)).toEqual(
        lifecycleOrder,
      );
      expect(proof.settlement.treasuryPayout).toBe("0");
      expect(proof.settlement.evaluatorPayout).toBe("0");
      expect(proof.job.canonicalSettledAmount).toBe("0");
      expect(proof.settlement.grossSettledAmount).toBe(proof.budget.baseUnits);
    },
  );

  it.each([mainnetJob1Proof, mainnetJob2Proof, testnetProof])(
    "recomputes condition and evidence commitments for $artifactId",
    (proof) => {
      expect(recomputeCondition(proof)).toBe(proof.conditionHash);
      expect(recomputeEvidence(proof)).toBe(proof.evidenceHash);
    },
  );

  it.each([mainnetJob1Proof, mainnetJob2Proof, testnetProof])(
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

  it("records the exact three independent settlement transactions", () => {
    expect(mainnetJob1Proof.relay.transactionHash).toBe(
      "0x876a6b547bbc512cb8b6ba99a1e6054fad6a1491edb1a18418ec05f860a65d66",
    );
    expect(mainnetJob2Proof.relay.transactionHash).toBe(
      "0x48310ebfa80301d5f48e6ac61be74cbaaf37f9eff141e82885fd20a5a9d166aa",
    );
    expect(testnetProof.relay.transactionHash).toBe(
      "0x7ebf9a4f15c74e74e56478fd6e28adc6569165f858be8f6f0922cecd043fd8e9",
    );
    expect(testnetProof.walletActions).toHaveLength(6);
    expect(testnetProof.job.id).toBe("6");
    expect(mainnetJob1Proof.job.id).toBe("1");
    expect(mainnetJob2Proof.job.id).toBe("2");
    expect(mainnetProof).toBe(mainnetJob2Proof);
  });

  it("validates the recovery lineage and one-broadcast settlement", () => {
    expect(mainnetJob1Proof.recovery).toBeUndefined();
    expect(testnetProof.recovery).toBeUndefined();
    expect(mainnetJob2Proof.recovery).toMatchObject({
      historical: {
        operationState: "EXPIRED",
        relayState: "EXPIRED_UNSENT",
        broadcastAttemptCount: 0,
      },
      relayNonceBefore: 1,
      relayNonceAfter: 2,
    });
    expect(mainnetJob2Proof.recovery?.recovery.evidenceHash).toBe(
      mainnetJob2Proof.evidenceHash,
    );
    expect(mainnetJob2Proof.settlement.completionReason).toBe(
      mainnetJob2Proof.evidenceHash,
    );
    expect(mainnetJob2Proof.relay.broadcastCount).toBe(1);
    expect(mainnetJob2Proof.settlement.providerPayout).toBe("10000");
    expect(mainnetJob2Proof.accounting.escrowAfterComplete).toBe(
      mainnetJob2Proof.accounting.escrowBeforeFund,
    );
  });

  it("rejects recovery evidence drift and additional broadcasts", () => {
    expect(() =>
      validateSettlementProofArtifact({
        ...mainnetJob2Proof,
        recovery: {
          ...mainnetJob2Proof.recovery!,
          recovery: {
            ...mainnetJob2Proof.recovery!.recovery,
            evidenceHash:
              "0x0000000000000000000000000000000000000000000000000000000000000000",
          },
        },
      }),
    ).toThrow("recovery evidence equality is invalid");
    expect(() =>
      validateSettlementProofArtifact({
        ...mainnetJob2Proof,
        relay: { ...mainnetJob2Proof.relay, broadcastCount: 2 },
      } as unknown),
    ).toThrow("relay broadcast identity is invalid");
  });

  it("does not leak network-specific identities between artifacts", () => {
    const mainnet = JSON.stringify(mainnetJob2Proof);
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
      mainnetJob2Proof.contracts.implementation,
      mainnetJob2Proof.contracts.commerce,
      mainnetJob2Proof.contracts.pactEvaluator,
      mainnetJob2Proof.actors.client,
      mainnetJob2Proof.actors.provider,
      mainnetJob2Proof.actors.verifier,
      mainnetJob2Proof.actors.relay,
      ...mainnetJob2Proof.walletActions.map(({ txHash }) => txHash),
      mainnetJob2Proof.relay.transactionHash,
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
