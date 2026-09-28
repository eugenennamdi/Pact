# Pact Attestation V2 canonical vector

This is the fixed interoperability vector for the positive-only Pact completion
attestation. The private key is public deterministic test material and must
never be used for funds or production authorization.

## EIP-712 schema

Domain:

```text
EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)
name              = Pact
version           = 2
chainId           = runtime chain ID
verifyingContract = PactEvaluator address
```

Primary type (with no whitespace in the encoded type string):

```text
PactCompletionAttestation(address commerceContract,uint256 jobId,bytes32 conditionHash,bytes32 evidenceHash,uint64 satisfiedAt,uint64 verifiedAt,uint64 validUntil)
```

## Fixed inputs

```text
chainId           = 5042
PactEvaluator     = 0x2222222222222222222222222222222222222222
commerceContract  = 0x1111111111111111111111111111111111111111
jobId             = 81
conditionHash     = 0x3da848928dfb0c9f0e98058ec9dc003e1a73952469488ce90fcab1699ccb18b4
evidenceHash      = 0xbf6e337b678f5f33edaadbb04807b1e721e3893b77e9a758183e931be119f1bc
satisfiedAt       = 1800000000
verifiedAt        = 1800000060
validUntil        = 1800003600
```

The evidence hash is `keccak256(utf8("pact-phase-2-evidence-vector"))`.

## Public test signer and outputs

```text
private test key  = 0x00000000000000000000000000000000000000000000000000000000000a11ce
signer address    = 0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7
type hash         = 0x64fe06ab75261d9f645c41ae59f820d32bbc92b534ff01cb1db5604bd350c005
struct hash       = 0x708f3b319473d92387dc959dfcdd95a05f9b105233eed2386e2431bf36c3146f
domain separator  = 0x8f5c9fb11eac7b5732837fe88fc0d679d87ac5708696141b8abe752e5870e05d
EIP-712 digest    = 0xec6e064c28963959e257c85f104997d6a3413f3e28994f0cb115a559fcf93f25
signature         = 0x2f5976b6bdd5b18bb68549c97e0614322a2cf783d3591fd00d3cefd7ff06430e3a0368046e93ec72b7e57895c6b70a373fc1e033b686c61fd07508578905ba8c1c
recovered signer  = 0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7
```

The Foundry vector test and the viem protocol-package test assert the type hash,
struct hash, domain separator, digest, signature recovery, and signer exactly.
