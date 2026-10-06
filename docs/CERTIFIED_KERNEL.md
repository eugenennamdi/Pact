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
identities, toolchain, and dependency provenance. Schema V2 preserves both the
historical dependency fingerprint reproduced from `certifiedBaselineCommit` and
the effective fingerprint required from the current checkout. An append-only
maintenance chain links those identities with exact reviewed dependency changes;
it does not rewrite protocol, runtime, deployment, or evidence provenance.

Each maintenance event classifies the reviewed operational role of its changed
dependencies. `BUILD_TOOLING_ONLY` means the dependency is absent from deployed
Pact application runtimes and is used only for build, test, or tooling.
`DEPLOYED_APPLICATION_RUNTIME` means the dependency is shipped in a deployed
application runtime while the maintenance event leaves Pact source, protocol,
contract identities, and transaction semantics unchanged. Classification is
descriptive provenance metadata; it does not relax fingerprint, exact-diff, or
protected-source verification.

Every changed protected dependency resolution is listed explicitly in the
event's `changes` array. A native runtime security patch may update multiple
platform artifact resolutions, but each package and exact version transition
must be declared and independently matched to the actual closure diff. The
schema provides no wildcard or implied package-family allowance.

`npm run kernel:verify` independently checks the historical closure, the
maintenance chain and its exact closure diff, the effective current closure,
protected paths, contract artifacts, deployment manifests, and provenance.
Generated outputs are not authoritative. Future dependency maintenance requires
explicit review, an exact closure diff, security audit, full regression, and a
new append-only maintenance record.

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
