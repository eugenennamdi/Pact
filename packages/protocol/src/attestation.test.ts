import { describe, expect, it } from "vitest";
import { recoverAddress } from "viem";

import {
  PACT_COMPLETION_ATTESTATION_TYPE,
  PACT_COMPLETION_ATTESTATION_TYPEHASH,
  PACT_EIP712_DOMAIN_NAME,
  PACT_EIP712_DOMAIN_VERSION,
  hashPactAttestationDomain,
  hashPactCompletionAttestation,
  hashPactCompletionAttestationStruct,
  pactCompletionAttestationTypes,
} from "./attestation.js";

const domain = {
  chainId: 5042,
  verifyingContract: "0x2222222222222222222222222222222222222222",
} as const;

const attestation = {
  commerceContract: "0x1111111111111111111111111111111111111111",
  jobId: 81n,
  conditionHash:
    "0x3da848928dfb0c9f0e98058ec9dc003e1a73952469488ce90fcab1699ccb18b4",
  evidenceHash:
    "0xbf6e337b678f5f33edaadbb04807b1e721e3893b77e9a758183e931be119f1bc",
  satisfiedAt: 1_800_000_000n,
  verifiedAt: 1_800_000_060n,
  validUntil: 1_800_003_600n,
} as const;

const vector = {
  typeHash:
    "0x64fe06ab75261d9f645c41ae59f820d32bbc92b534ff01cb1db5604bd350c005",
  structHash:
    "0x708f3b319473d92387dc959dfcdd95a05f9b105233eed2386e2431bf36c3146f",
  domainSeparator:
    "0x8f5c9fb11eac7b5732837fe88fc0d679d87ac5708696141b8abe752e5870e05d",
  digest: "0xec6e064c28963959e257c85f104997d6a3413f3e28994f0cb115a559fcf93f25",
  signature:
    "0x2f5976b6bdd5b18bb68549c97e0614322a2cf783d3591fd00d3cefd7ff06430e3a0368046e93ec72b7e57895c6b70a373fc1e033b686c61fd07508578905ba8c1c",
  signer: "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7",
} as const;

describe("Pact completion attestation V2", () => {
  it("pins the exact EIP-712 schema and excludes result/replay fields", () => {
    expect(PACT_EIP712_DOMAIN_NAME).toBe("Pact");
    expect(PACT_EIP712_DOMAIN_VERSION).toBe("2");
    expect(PACT_COMPLETION_ATTESTATION_TYPE).toBe(
      "PactCompletionAttestation(address commerceContract,uint256 jobId,bytes32 conditionHash,bytes32 evidenceHash,uint64 satisfiedAt,uint64 verifiedAt,uint64 validUntil)",
    );
    expect(PACT_COMPLETION_ATTESTATION_TYPEHASH).toBe(vector.typeHash);
    expect(pactCompletionAttestationTypes).toEqual({
      PactCompletionAttestation: [
        { name: "commerceContract", type: "address" },
        { name: "jobId", type: "uint256" },
        { name: "conditionHash", type: "bytes32" },
        { name: "evidenceHash", type: "bytes32" },
        { name: "satisfiedAt", type: "uint64" },
        { name: "verifiedAt", type: "uint64" },
        { name: "validUntil", type: "uint64" },
      ],
    });

    const names = pactCompletionAttestationTypes.PactCompletionAttestation.map(
      ({ name }) => name,
    );
    expect(names).not.toContain("result");
    expect(names).not.toContain("replayId");
    expect(names).not.toContain("pactId");
  });

  it("matches the canonical cross-language hashes byte-for-byte", () => {
    expect(hashPactAttestationDomain(domain)).toBe(vector.domainSeparator);
    expect(hashPactCompletionAttestationStruct(attestation)).toBe(
      vector.structHash,
    );
    expect(hashPactCompletionAttestation(domain, attestation)).toBe(
      vector.digest,
    );
  });

  it("recovers the canonical signer from the fixed signature", async () => {
    await expect(
      recoverAddress({ hash: vector.digest, signature: vector.signature }),
    ).resolves.toBe(vector.signer);
  });

  it("domain-separates chain and evaluator address", () => {
    expect(
      hashPactCompletionAttestation({ ...domain, chainId: 5043 }, attestation),
    ).not.toBe(vector.digest);
    expect(
      hashPactCompletionAttestation(
        {
          ...domain,
          verifyingContract: "0x3333333333333333333333333333333333333333",
        },
        attestation,
      ),
    ).not.toBe(vector.digest);
  });

  it("binds every field into the digest", () => {
    expect(
      hashPactCompletionAttestation(domain, {
        ...attestation,
        evidenceHash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    ).not.toBe(vector.digest);
    expect(
      hashPactCompletionAttestation(domain, {
        ...attestation,
        verifiedAt: attestation.verifiedAt + 1n,
      }),
    ).not.toBe(vector.digest);
  });
});
