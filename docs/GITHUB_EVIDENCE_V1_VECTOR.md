# Pact GitHub evidence V1 vector

This vector locks the canonical evidence representation independently of JSON
serialization. All times are integer Unix seconds.

## Condition and observation

```text
provider       = github
repository     = pact-protocol/demo
pullRequest    = 81
baseBranch     = main
event          = PR_MERGED
conditionHash  = 0x3da848928dfb0c9f0e98058ec9dc003e1a73952469488ce90fcab1699ccb18b4

mergeCommitSha = 0x0123456789abcdef0123456789abcdef01234567
mergedAt       = 1800000000
observedAt     = 1800000060
```

Input repository casing `Pact-Protocol/Demo` normalizes to lowercase. The base
branch is preserved exactly. A 40-hex SHA may arrive without `0x` and with
uppercase hex; V1 stores lowercase with `0x`. Values are rejected rather than
trimmed. The schema requires positive `uint64` values, `mergedAt <= observedAt`,
and a PR number within the Phase 0 positive safe-integer condition range.

## Type and encoding

```text
PactGitHubPrMergedEvidence(uint8 schemaVersion,bytes32 conditionHash,string repository,uint64 pullRequest,string baseBranch,bytes20 mergeCommitSha,uint64 mergedAt,uint64 observedAt)
```

```text
typeHash = keccak256(UTF8(type declaration))
         = 0x6aa35fd3cfcfea53c0af3bff550d9bd8ec717510b7db9525eafc0ee9fff9a261

encoded = abi.encode(
  typeHash,
  uint8(1),
  conditionHash,
  keccak256(UTF8(repository)),
  uint64(pullRequest),
  keccak256(UTF8(baseBranch)),
  bytes20(mergeCommitSha),
  uint64(mergedAt),
  uint64(observedAt)
)
```

Full encoded representation:

```text
0x6aa35fd3cfcfea53c0af3bff550d9bd8ec717510b7db9525eafc0ee9fff9a26100000000000000000000000000000000000000000000000000000000000000013da848928dfb0c9f0e98058ec9dc003e1a73952469488ce90fcab1699ccb18b4070d4775c0b837a639d2c1b3c0022c2441fbc21e631d73b001cacb07135f63f00000000000000000000000000000000000000000000000000000000000000051b8e2054f8a912367e38a22ce773328ff8aabf8082c4120bad9ef085e1dbf29a70123456789abcdef0123456789abcdef01234567000000000000000000000000000000000000000000000000000000000000000000000000000000006b49d200000000000000000000000000000000000000000000000000000000006b49d23c
```

```text
evidenceHash = keccak256(encoded)
             = 0x0a1ed8785c5d5548b1d6472aa40a10b7c297485d8f244dc216fced19544a4eea
```

The schema excludes job, chain, contract, token, amount, recipient, webhook,
signature, and raw GitHub response data. Attestation V2 binds this factual hash
to a particular ERC-8183 settlement context.
