# Pact Certified Settlement Kernel

Pact v1 protects the source and configuration that produced the certified Arc
settlement behavior. The evidence checkpoint is
`3d6e6b34c42166b5c3c72dc51abd664de5966af8`; it records evidence for, but did not
execute, the Mainnet release. The distinct runtime identities are:

- Testnet-certified runtime: `fa20328df6643b0d85f6c2b6074d79dd0e5de54c`
- Mainnet execution release: `b5792c756b04fae543b1d3d92a337858ea9f529d`
- Mainnet evidence checkpoint: `3d6e6b34c42166b5c3c72dc51abd664de5966af8`
- Pinned ERC-8183 source: `142e669c1fd318486a4628395b629f033654dd06`

`certified-kernel.json` lists the protected paths, reviewed contract creation
identities, toolchain, and resolved dependency-closure fingerprint.
`npm run kernel:verify` fails when a protected path differs from the evidence
checkpoint, a certified dependency resolution changes, a contract artifact does
not reproduce, a manifest fails validation, or provenance is inconsistent.
Generated outputs are not authoritative.

Product pages, components, DTOs, `packages/product/**`, and `apps/worker/**` may
be added outside the protected paths. Product-only dependencies may be added
when they do not alter the selected certified dependency closure.

CODEOWNERS is a review aid, not the enforcement boundary. CI must run the kernel
verifier with full Git history and branch protection must require that check and
owner review.

A deliberate kernel change requires explicit Tech Lead authorization, a
protocol/version review, the full regression suite, fresh Testnet certification,
any required Mainnet review, and updated provenance through a separate
certification change. It must not be accepted by weakening or overriding the
verifier.
