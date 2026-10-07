# Phase 8 — Arc Mainnet job #2 recovery proof

The immutable public artifact at
`apps/web/proof/artifacts/arc-mainnet-job-2.json` reconstructs Pact record
`4b7db1c8-6d64-51e6-a34c-05bdc2b8fd0d`, ERC-8183 job `2`, from canonical Arc
Mainnet receipts, authoritative GitHub state, and the durable Pact verification
and relay records.

## Run identity

- Arc Mainnet chain ID: `5042`
- ERC-8183 proxy: `0x9Da745D2A6e03b049bdAE5aE7a193f1B00E520d6`
- PactEvaluator: `0x3fd3AC5bE6eE41DcD11233833DCD96c21F3b1129`
- Job key: `0x70d001701d55ebac31a299ab7301938a0c002a355311cdac3da784311822294d`
- Budget: `10000` base units (`0.01 USDC`)
- Condition: `eugenennamdi/pact-arc-demo#7`, base `main`, event `PR_MERGED`
- Merge commit: `fbe64ea0b2975c5a4c5a2129a6717309049dc963`

The six successful lifecycle transactions are preserved in canonical order in
the artifact: create job, bind condition, set budget, approve USDC, fund, and
submit. Each entry records the decoded call, actor, receipt, canonical event,
block identity, and gas accounting.

## Recovery lineage

Historical Phase 4A operation `932711d6-dda1-400c-8988-5bb405448303` produced
evidence `0x5214beeb56ab86c68824e8dfb9cfabfebb0d4005072aeeb2b7e6ce5970c1ffe5`
and attestation
`0x0a2b0620199ece37f72d64f577c083d03c30c68273dfa940aa31e3b1f2ab9644`. The
attestation expired before relay. Its immutable audit state is `EXPIRED`,
inactive, and `EXPIRED_UNSENT`; nonce, calldata, serialized transaction,
expected hash, and returned hash are all null, with zero broadcast attempts.

Recovery operation `95cf7937-55f0-45a5-9609-1ae117ce4ef4` independently
re-verified GitHub and produced fresh evidence
`0x49dc4aff1ef5dd759f4f84f802001f5169cd12636342193e02988cebd5406d65` and fresh
attestation
`0x83682c4c85f880e39c90dfdadffc4cb0c6536348b24a50311a3d18eaf2300888`, valid
through timestamp `1791408639`.

## Canonical settlement

Exactly one relay broadcast used nonce `1`; the canonical receipt advanced the
relay nonce to `2`:

- Transaction:
  `0x48310ebfa80301d5f48e6ac61be74cbaaf37f9eff141e82885fd20a5a9d166aa`
- Block: `24794104`
- Receipt: success
- Final job status: Completed
- Binding accepted: true
- Provider gross payout: `10000` base units
- Treasury payout: `0`
- Evaluator payout: `0`
- Residual job escrow: `0`

`JobCompleted.reason`, `PactCompletionAccepted.evidenceHash`, and the fresh
evidence hash are exactly equal. Arc-native relay gas accounting remains
separate from the USDC principal flow.

## Reproducible provenance

- Recovery runtime: `92932adab77a246a4492bc08464d13d38263366e`
- Certified-kernel governance: `5b74ee0718d5a609d0da53ea52e73ab5e0299b45`
- Mainnet release-provenance fix: `1eb711a67d24b33a04dfb18c87f27767625e6bd7`
- Pinned ERC-8183 source: `142e669c1fd318486a4628395b629f033654dd06`

The SHA-256 of the artifact's exact bytes is:

`b10522debb0522f576941b59cd6b06910573f6980104612fcad31bd61e506fdc`

The proof tests recompute the condition, evidence, EIP-712 attestation digest,
recovered verifier, lifecycle ordering, recovery equality, one-broadcast
constraint, financial accounting, and artifact fingerprint. Rendering is static
and requires no wallet, RPC, GitHub, database, or secret at runtime.
