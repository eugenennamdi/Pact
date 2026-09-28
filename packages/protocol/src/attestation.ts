import {
  hashDomain,
  hashStruct,
  hashTypedData,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from "viem";

export const PACT_EIP712_DOMAIN_NAME = "Pact" as const;
export const PACT_EIP712_DOMAIN_VERSION = "2" as const;
export const PACT_COMPLETION_ATTESTATION_PRIMARY_TYPE =
  "PactCompletionAttestation" as const;
export const PACT_COMPLETION_ATTESTATION_TYPE =
  "PactCompletionAttestation(address commerceContract,uint256 jobId,bytes32 conditionHash,bytes32 evidenceHash,uint64 satisfiedAt,uint64 verifiedAt,uint64 validUntil)" as const;
export const PACT_COMPLETION_ATTESTATION_TYPEHASH = keccak256(
  stringToHex(PACT_COMPLETION_ATTESTATION_TYPE),
);

export type Hex32 = `0x${string}`;

export interface PactCompletionAttestationV2 {
  commerceContract: Address;
  jobId: bigint;
  conditionHash: Hex32;
  evidenceHash: Hex32;
  satisfiedAt: bigint;
  verifiedAt: bigint;
  validUntil: bigint;
}

/** @deprecated Prefer the version-explicit PactCompletionAttestationV2 name. */
export type PactCompletionAttestation = PactCompletionAttestationV2;

export interface PactAttestationDomain {
  chainId: number | bigint;
  verifyingContract: Address;
}

export const pactCompletionAttestationTypes = {
  PactCompletionAttestation: [
    { name: "commerceContract", type: "address" },
    { name: "jobId", type: "uint256" },
    { name: "conditionHash", type: "bytes32" },
    { name: "evidenceHash", type: "bytes32" },
    { name: "satisfiedAt", type: "uint64" },
    { name: "verifiedAt", type: "uint64" },
    { name: "validUntil", type: "uint64" },
  ],
} as const;

export const pactEip712DomainTypes = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
} as const;

export function getPactAttestationDomain(domain: PactAttestationDomain) {
  return {
    name: PACT_EIP712_DOMAIN_NAME,
    version: PACT_EIP712_DOMAIN_VERSION,
    chainId: BigInt(domain.chainId),
    verifyingContract: domain.verifyingContract,
  } as const;
}

export function hashPactAttestationDomain(domain: PactAttestationDomain): Hex {
  return hashDomain({
    domain: getPactAttestationDomain(domain),
    types: pactEip712DomainTypes,
  });
}

export function hashPactCompletionAttestationStruct(
  attestation: PactCompletionAttestationV2,
): Hex {
  return hashStruct({
    data: attestation,
    primaryType: PACT_COMPLETION_ATTESTATION_PRIMARY_TYPE,
    types: pactCompletionAttestationTypes,
  });
}

export function hashPactCompletionAttestation(
  domain: PactAttestationDomain,
  attestation: PactCompletionAttestationV2,
): Hex {
  return hashTypedData({
    domain: getPactAttestationDomain(domain),
    message: attestation,
    primaryType: PACT_COMPLETION_ATTESTATION_PRIMARY_TYPE,
    types: pactCompletionAttestationTypes,
  });
}
