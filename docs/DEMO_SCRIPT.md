# Pact demo script

## 30-second pitch

Pact turns objectively verifiable outcomes into ERC-8183 settlement decisions.
The current MVP binds a GitHub pull-request merge to an ERC-8183 job, locks USDC
in the canonical escrow, independently verifies GitHub, and produces signed
evidence that PactEvaluator uses to complete the job. This production Proof
Center shows a real Arc Mainnet settlement: Job #2 completed and paid 0.01 USDC
to the provider in one relay broadcast.

## 90-second demo

1. Open the [production app](https://pact-web-production-ea97.up.railway.app)
   and state: “Pact verifies objective outcomes and turns them into ERC-8183
   settlement decisions.”
2. Point to the implemented condition: GitHub `PR_MERGED`, committed to a
   repository, PR number, base branch, and event.
3. Explain the boundary: ERC-8183 owns the job and USDC escrow; Pact owns
   condition verification, evidence, attestation, and evaluation.
4. Open
   [Mainnet Job #2](https://pact-web-production-ea97.up.railway.app/proof/arc-mainnet/job/2).
5. Show `Completed`, GitHub PR #7, the evidence hash, and the 0.01 USDC provider
   payout.
6. Show the single settlement transaction and close: the MVP proves `PR_MERGED`;
   the same architecture can support other objectively verifiable conditions
   after their verifier semantics are implemented and reviewed.

## 3-minute walkthrough

1. **Thesis:** Pact supplies objective verification between an external outcome
   and an ERC-8183 settlement decision.
2. **Condition:** Show GitHub `PR_MERGED`. The exact repository, pull request,
   base branch, and event are deterministically hashed and bound while the job
   is open.
3. **Financial boundary:** Explain that ERC-8183—not Pact—owns the 0.01 USDC
   budget, escrow, lifecycle, and payout.
4. **Canonical flow:** Briefly trace create, bind, set budget, approve, fund,
   submit, verify, and settle.
5. **Mainnet proof:** Open Job #2 and show Arc Mainnet chain ID `5042`, status
   `Completed`, GitHub PR #7, and the immutable condition commitment.
6. **Evidence:** Show fresh evidence
   `0x49dc4aff1ef5dd759f4f84f802001f5169cd12636342193e02988cebd5406d65` and
   explain that Pact independently re-read GitHub before signing.
7. **Recovery lineage:** Show that the expired unsent attestation had zero
   broadcast capability, fresh evidence was generated, and settlement still used
   exactly one relay broadcast.
8. **Settlement:** Open transaction
   `0x48310ebfa80301d5f48e6ac61be74cbaaf37f9eff141e82885fd20a5a9d166aa` and show
   the completed job and 0.01 USDC provider payout.
9. **Close:** Today Pact implements GitHub `PR_MERGED`. Future condition types
   can use the same settlement architecture only after their objective
   verification rules are implemented, tested, and reviewed.
