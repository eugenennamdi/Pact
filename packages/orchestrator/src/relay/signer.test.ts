import type { ReadyToRelayArtifact } from "@pact/database";
import {
  hashPactCompletionAttestation,
  hashPactGitHubPrMergedEvidenceV1,
  hashPactJobIdentity,
  normalizeGithubPrMergedCondition,
  normalizePactGitHubPrMergedEvidenceV1,
  normalizePactJobIdentity,
} from "@pact/protocol";
import { decodeFunctionData, recoverTransactionAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { pactRelayAbi } from "./abi.js";
import {
  assertPactRelayCalldata,
  buildPactRelayCalldata,
  createPactRelaySigner,
  preparePactRelayTransaction,
} from "./signer.js";

const verifierKey =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8413f4603b6b78690d";
const relayKey =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const verifier = privateKeyToAccount(verifierKey).address;
const relay = privateKeyToAccount(relayKey).address;
const commerce = "0x1111111111111111111111111111111111111111" as const;
const evaluator = "0x2222222222222222222222222222222222222222" as const;
const conditionHash =
  "0x3da848928dfb0c9f0e98058ec9dc003e1a73952469488ce90fcab1699ccb18b4" as const;
const evidence = normalizePactGitHubPrMergedEvidenceV1({
  conditionHash,
  repository: "pact-protocol/demo",
  pullRequest: 81,
  baseBranch: "main",
  mergeCommitSha: "0x0123456789abcdef0123456789abcdef01234567",
  mergedAt: 1_800_000_000n,
  observedAt: 1_800_000_010n,
});
const evidenceHash = hashPactGitHubPrMergedEvidenceV1(evidence);

function artifact(): ReadyToRelayArtifact {
  const condition = normalizeGithubPrMergedCondition({
    provider: "github",
    repository: "pact-protocol/demo",
    pullRequest: 81,
    baseBranch: "main",
    event: "PR_MERGED",
  });
  const jobKey = hashPactJobIdentity(
    normalizePactJobIdentity({
      chainId: 5042n,
      commerceContract: commerce,
      jobId: 81n,
    }),
  );
  const attestation = {
    commerceContract: commerce,
    jobId: 81n,
    conditionHash,
    evidenceHash,
    satisfiedAt: 1_800_000_000n,
    verifiedAt: 1_800_000_010n,
    validUntil: 1_800_000_300n,
  } as const;
  return Object.freeze({
    operationId: "123e4567-e89b-42d3-a456-426614174001",
    pact: Object.freeze({
      id: "123e4567-e89b-42d3-a456-426614174000",
      chainId: 5042n,
      commerceContract: commerce,
      pactEvaluator: evaluator,
      jobId: 81n,
      jobKey,
      condition,
      conditionHash,
      completionDeadline: 1_800_000_120n,
    }),
    evidence,
    attestation: Object.freeze({
      digest: hashPactCompletionAttestation(
        { chainId: 5042n, verifyingContract: evaluator },
        attestation,
      ),
      signature: `0x${"11".repeat(65)}`,
      signer: verifier,
      chainId: 5042n,
      verifyingContract: evaluator,
      ...attestation,
      jobKey,
    }),
    readyBlockNumber: 100n,
  });
}

function exactRequest(data = buildPactRelayCalldata(artifact())) {
  return {
    chainId: 5042,
    from: relay,
    to: evaluator,
    value: 0n as const,
    data,
    nonce: 7,
    gas: 250_000n,
    type: "eip1559" as const,
    maxFeePerGas: 2_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
  };
}

describe("dedicated Pact relay signer", () => {
  it("keeps verifier and relay authority separate and validates key scalars", () => {
    expect(
      createPactRelaySigner({ privateKey: relayKey, verifierAddress: verifier })
        .address,
    ).toBe(relay);
    expect(() =>
      createPactRelaySigner({
        privateKey: verifierKey,
        verifierAddress: verifier,
      }),
    ).toThrow("must differ");
    expect(() =>
      createPactRelaySigner({ privateKey: "0x01", verifierAddress: verifier }),
    ).toThrow("PACT_RELAY_PRIVATE_KEY is invalid");
    expect(() =>
      createPactRelaySigner({
        privateKey: `0x${"00".repeat(32)}`,
        verifierAddress: verifier,
      }),
    ).toThrow("PACT_RELAY_PRIVATE_KEY is invalid");
  });

  it("constructs only completeWithAttestation and round-trips every persisted field", () => {
    const value = artifact();
    const calldata = buildPactRelayCalldata(value);
    expect(() => assertPactRelayCalldata(value, calldata)).not.toThrow();
    const decoded = decodeFunctionData({ abi: pactRelayAbi, data: calldata });
    expect(decoded.functionName).toBe("completeWithAttestation");
    expect(decoded.args?.[0]).toMatchObject({
      commerceContract: commerce,
      jobId: 81n,
      conditionHash,
      evidenceHash,
    });
    expect(decoded.args?.[1]).toBe(value.attestation.signature);
  });

  it("rejects chain, sender, target, value, nonce, calldata, and fee mutation", () => {
    const value = artifact();
    const base = {
      artifact: value,
      request: exactRequest(),
      relayAddress: relay,
      configuredChainId: 5042n,
      configuredPactEvaluator: evaluator,
      reservedNonce: 7,
    } as const;
    expect(() => preparePactRelayTransaction(base)).not.toThrow();
    for (const request of [
      { ...base.request, chainId: 1 },
      { ...base.request, from: verifier },
      { ...base.request, to: commerce },
      { ...base.request, value: 1n as 0n },
      { ...base.request, nonce: 8 },
      { ...base.request, data: "0xdeadbeef" as const },
      { ...base.request, maxFeePerGas: undefined },
    ]) {
      expect(() =>
        preparePactRelayTransaction({ ...base, request: request as never }),
      ).toThrow();
    }
  });

  it("signs deterministic immutable bytes and derives the expected hash locally", async () => {
    const value = artifact();
    const signer = createPactRelaySigner({
      privateKey: relayKey,
      verifierAddress: verifier,
    });
    const prepared = preparePactRelayTransaction({
      artifact: value,
      request: exactRequest(),
      relayAddress: relay,
      configuredChainId: 5042n,
      configuredPactEvaluator: evaluator,
      reservedNonce: 7,
    });
    const first = await signer.signPactRelayTransaction(prepared);
    const second = await signer.signPactRelayTransaction(prepared);
    expect(first).toEqual(second);
    expect(first.expectedTxHash).toMatch(/^0x[0-9a-f]{64}$/);
    await expect(
      recoverTransactionAddress({
        serializedTransaction: first.serializedTransaction as never,
      }),
    ).resolves.toBe(relay);
  });
});
