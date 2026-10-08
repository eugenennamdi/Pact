# Pact submission facts

## Product

- **Name:** Pact
- **One-liner:** Pact turns objectively verifiable outcomes into ERC-8183
  settlement decisions.
- **Problem:** ERC-8183 defines a job and escrow lifecycle but does not
  determine whether an external software outcome actually occurred.
- **Solution:** Pact binds an objective condition before funding, independently
  verifies authoritative external state, produces canonical evidence and a
  verifier attestation, and deterministically completes the matching ERC-8183
  job.
- **Why ERC-8183:** It provides the canonical client/provider/job lifecycle,
  budget, USDC custody, submission, completion, rejection, expiry, payout, and
  refund semantics. Pact adds verification without duplicating financial state.
- **Why Arc:** Arc provides the EVM execution environment and canonical USDC
  used by the deployed ERC-8183 settlement flow.
- **Implemented condition:** GitHub `PR_MERGED` for an exact repository, pull
  request, target base branch, and merge event.

## Production

- **Network:** Arc Mainnet, chain ID `5042`
- **Application:** https://pact-web-production-ea97.up.railway.app
- **Proof Center:** https://pact-web-production-ea97.up.railway.app/proof
- **Mainnet Job #2:**
  https://pact-web-production-ea97.up.railway.app/proof/arc-mainnet/job/2
- **Repository:** https://github.com/eugenennamdi/Pact
- **ERC-8183 proxy:** `0x9Da745D2A6e03b049bdAE5aE7a193f1B00E520d6`
- **ERC-8183 implementation:** `0x4B46C1aa98B1d82cF4eeFFDDD129a57402851901`
- **PactEvaluator:** `0x3fd3AC5bE6eE41DcD11233833DCD96c21F3b1129`
- **USDC:** `0x3600000000000000000000000000000000000000`

## Canonical Mainnet Job #2

- **Condition:** `eugenennamdi/pact-arc-demo#7`, base `main`, event `PR_MERGED`
- **Status:** Completed
- **Budget/provider payout:** `10000` base units (`0.01 USDC`)
- **Fresh evidence:**
  `0x49dc4aff1ef5dd759f4f84f802001f5169cd12636342193e02988cebd5406d65`
- **Settlement transaction:**
  `0x48310ebfa80301d5f48e6ac61be74cbaaf37f9eff141e82885fd20a5a9d166aa`
- **Relay broadcasts:** `1`

## Technical differentiators

- Deterministic condition, evidence, job identity, and EIP-712 attestation
  commitments
- Immutable pre-funding condition binding and verifier snapshot
- Independent authoritative GitHub verification; webhooks and client claims are
  never accepted as evidence
- Separation of verifier, relay, evaluator, and financial authority
- Nonce ownership, idempotency, and reconciliation instead of blind resend
- Certified source/dependency/deployment provenance and immutable public proof
  artifacts

## Safety properties

- Positive-only evaluation: false, pending, or unavailable conditions do not
  reject the ERC-8183 job
- Single-broadcast relay semantics
- Expired unsent attestations are retired before replacement
- PactEvaluator validates the exact job, binding, evidence, verifier, deadlines,
  and replay state before completion
- ERC-8183 remains canonical for all financial state
- Release gates fail closed on unreviewed drift

## Implemented

- GitHub `PR_MERGED` Condition V1 and canonical hashing
- Evidence V1, Attestation V2, signer recovery, and PactEvaluator validation
- Browser-wallet lifecycle for create, bind, budget, approval, funding, and
  submission
- Automatic verification and relay workers with durable reconciliation
- Arc Testnet certification and two completed Arc Mainnet proof records
- Static public Proof Center requiring no wallet or runtime RPC

## Future work

- Additional condition providers only after their objective verification
  semantics and security boundaries are specified and reviewed
- Broader operator tooling and production observability
- Standards updates as ERC-8183 evolves from draft status

Pact does not currently claim support for generic conditions, dispute
resolution, an oracle network, or AI-based evaluation.
