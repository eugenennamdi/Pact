# Phase 8 — Arc Testnet job #6 proof

The immutable public artifact at
`apps/web/proof/artifacts/arc-testnet-job-6.json` reconstructs hosted Pact
`pact_b0d744b3821543e3981f28d4d5a0fdc8` from canonical Arc Testnet receipts,
GitHub pull request state, the public Pact projection, and the signed relay
calldata.

It records six successful human wallet transactions, the canonical GitHub
`PR_MERGED` evidence, the independently recovered V2 verifier signature, the
single relay settlement, and separate USDC principal and Arc-native gas
accounting. It contains no runtime credentials or signing material.

The source freeze is the SHA-256 of the artifact's exact bytes:

`d322fdd53fa6193d68d8ed22e39617d40b24721109b528c2788d3a76230e141f`

`apps/web/proof/proof.test.ts` recomputes the condition hash, evidence hash,
EIP-712 digest, recovered verifier, lifecycle ordering, and artifact
fingerprint. Rendering reads only the committed artifact and performs no runtime
chain or GitHub call.
