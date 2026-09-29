# Deployment manifests

This directory holds immutable, reviewed outputs from Pact-managed Arc
deployments. It intentionally contains no placeholder address file: a manifest
is created only after all deployment receipts are canonical and the runtime
integrity check passes.

`manifest.schema.json` documents schema version 1. The TypeScript validator is
authoritative for cross-field rules that JSON Schema cannot express:
network/chain pairing, PactEvaluator-to-proxy binding, exact pins, checksummed
addresses, and testnet gate identity.

Expected filenames are `arc-testnet.json` and `arc-mainnet.json`. A Mainnet
manifest is forbidden until the Testnet manifest contains a `testnetGate.status`
of `PASS` for the exact corrected E2E runtime commit, pinned ERC-8183 source,
and PactEvaluator creation-artifact hash. The root `gitCommit` remains immutable
deployment provenance; the gate records it as `deploymentGitCommit` and records
the independently reviewed backend/verifier checkpoint as `e2eRuntimeCommit`.

Local journals contain signed raw transactions and must remain secret. Store
them outside the repository; they are recovery state, not deployment manifests.
