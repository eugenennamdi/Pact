# Pact — Arc Microgrants Submission

## Project name

Pact

## One-line description

Pact is an Arc-native outcome verification layer that turns objective external
facts into ERC-8183 USDC settlement decisions.

## Short description

Many onchain agreements depend on outcomes that happen outside the chain, but
escrow contracts cannot determine those facts by themselves. Pact binds an
objective condition to an ERC-8183 job before funding, independently verifies
the external source, and produces canonical evidence plus a signed verifier
attestation for deterministic evaluation. The current proof of concept supports
one deliberately narrow condition: a specified GitHub pull request merged into
its target branch. On Arc Mainnet, ERC-8183 holds the USDC budget and canonical
job state; when Pact verifies the merge, PactEvaluator completes the job and
ERC-8183 releases payment to the provider.

## What does Pact use Arc for?

Arc is the execution and settlement layer, not an incidental deployment target.
The ERC-8183 job and USDC escrow live on Arc Mainnet, the budget is denominated
in USDC, and the provider payout settles there. PactEvaluator records the
evidence-linked completion decision onchain, while ERC-8183 records the
canonical completed job and financial result. Arc also uses USDC for transaction
gas, so both the 0.01 USDC principal settlement and the execution costs are
native to the same USDC-centered environment.

## What is live today?

- A public Pact application and Proof Center running against Arc Mainnet.
- A deployed ERC-8183 proxy and PactEvaluator integration using Arc USDC.
- An end-to-end `PR_MERGED` verification flow: immutable condition binding,
  independent GitHub verification, canonical evidence, signed attestation, one
  relay broadcast, evaluation, and ERC-8183 payout.
- A canonical completed Arc Mainnet proof: job `#2`, settled for `0.01 USDC`
  (`10000` base units).
- Public source, deployment facts, architecture, demo instructions, and an
  immutable proof artifact in the repository.

## Why is this worth continuing?

Many useful agreements depend on objective outcomes outside a blockchain:
software delivery, operational milestones, or other independently checkable
business events. ERC-8183 supplies the commerce and escrow lifecycle, while Pact
experiments with the missing verification layer that converts one external fact
into auditable settlement evidence. The working GitHub `PR_MERGED` adapter
proves the full primitive on Arc Mainnet, including real USDC custody and
payout. Continuing the experiment would test additional narrowly specified,
objectively verifiable adapters without changing the underlying separation of
verification authority from ERC-8183 financial authority.

## Live deployment

<https://pact-web-production-ea97.up.railway.app>

## Proof Center

<https://pact-web-production-ea97.up.railway.app/proof>

## Public repository

<https://github.com/eugenennamdi/Pact>

## Canonical Arc Mainnet proof

- Direct proof:
  <https://pact-web-production-ea97.up.railway.app/proof/arc-mainnet/job/2>
- Network: Arc Mainnet (`chainId 5042`)
- ERC-8183 job: `#2`, status `Completed`
- Condition: `eugenennamdi/pact-arc-demo` pull request `#7` merged into `main`
- Budget and provider payout: `0.01 USDC` (`10000` base units)
- Settlement transaction:
  `0x48310ebfa80301d5f48e6ac61be74cbaaf37f9eff141e82885fd20a5a9d166aa`
- Evidence hash:
  `0x49dc4aff1ef5dd759f4f84f802001f5169cd12636342193e02988cebd5406d65`
- Relay broadcasts: exactly one

Arc Mainnet contracts:

- ERC-8183 proxy: `0x9Da745D2A6e03b049bdAE5aE7a193f1B00E520d6`
- ERC-8183 implementation: `0x4B46C1aa98B1d82cF4eeFFDDD129a57402851901`
- PactEvaluator: `0x3fd3AC5bE6eE41DcD11233833DCD96c21F3b1129`
- USDC: `0x3600000000000000000000000000000000000000`

## Technical highlights

- Deterministic Condition V1 serialization and condition commitments.
- Immutable condition binding while an ERC-8183 job is open.
- Independent authoritative GitHub API verification; client claims and webhook
  deliveries are not treated as evidence.
- Canonical Evidence V1 artifacts and domain-separated verifier attestations.
- Positive-only evaluation: an unmet or temporarily unverifiable condition is
  never converted into a rejection.
- Idempotent, nonce-aware relay processing with ambiguity resolved through
  onchain reconciliation rather than blind retries.
- Strict authority boundary: Pact owns verification and evidence; ERC-8183 owns
  escrow, job state, payout, and refund.
- Public proof projection linking the condition, evidence, transaction,
  contracts, and final Arc state.

## Current scope

Implemented today:

- Arc Mainnet execution and USDC settlement through the reviewed ERC-8183
  deployment.
- One condition provider and event: GitHub `PR_MERGED` for a specified
  repository, pull request, and base branch.
- Public Pact creation workflow, verification workers, relay, Proof Center, and
  canonical settlement trace.

Potential future work, not claimed as implemented:

- Additional narrowly defined adapters for objective, independently verifiable
  outcomes.
- Broader usability and operational hardening based on real builder feedback.
- More public proof traces and controlled settlement rehearsals without
  expanding Pact into escrow or financial custody.

## Builder profile

- GitHub: `[ADD BUILDER GITHUB PROFILE]`
- X: `[ADD X PROFILE]`
- Farcaster: `[ADD FARCASTER PROFILE]`

# Copy-ready application answers

## PROJECT NAME

Pact

## PROJECT URL

<https://pact-web-production-ea97.up.railway.app>

## PUBLIC REPOSITORY

<https://github.com/eugenennamdi/Pact>

## BUILDER PROFILE

- GitHub: `[ADD BUILDER GITHUB PROFILE]`
- X: `[ADD X PROFILE]`
- Farcaster: `[ADD FARCASTER PROFILE]`

## ONE-LINER

Pact is an Arc-native outcome verification layer that turns objective external
facts into ERC-8183 USDC settlement decisions.

## WHAT DOES YOUR PROJECT DO?

Pact lets parties bind an objective external condition to an ERC-8183 job before
it is funded. It independently checks the authoritative source, creates
canonical evidence, signs a verifier attestation, and asks PactEvaluator to
complete the job when the condition is satisfied. The current proof of concept
verifies that a specified GitHub pull request was merged into its target branch.
Pact does not hold funds or duplicate job state: ERC-8183 remains the canonical
owner of escrow, submission, completion, payout, and refund.

## WHAT DOES IT USE ARC FOR?

Arc is Pact's execution and settlement environment. ERC-8183 holds the USDC
escrow and canonical job state on Arc Mainnet; PactEvaluator records the
evidence-linked completion decision; and ERC-8183 pays the provider after
successful evaluation. The canonical live proof settled a real `0.01 USDC` job
on Arc Mainnet, with transaction gas also paid in USDC.

## WHAT HAVE YOU BUILT / WHAT IS LIVE?

Pact has a public application, a public Proof Center, deployed Arc Mainnet
contracts, and a completed end-to-end settlement. Canonical job `#2` bound a
GitHub `PR_MERGED` condition, funded `0.01 USDC`, verified the real merge,
generated evidence and a signed attestation, relayed exactly one completion
transaction, and paid the provider through ERC-8183. The public proof page
exposes the condition, evidence hash, settlement transaction, contract
addresses, and final completed state.

## WHY SHOULD THIS PROJECT RECEIVE AN ARC MICROGRANT?

Pact is a working Arc-native experiment addressing a concrete gap between
offchain outcomes and onchain commerce. It already demonstrates a real,
auditable Mainnet path from an immutable external condition to ERC-8183 USDC
settlement, while preserving a strict separation between verification authority
and financial authority. A microgrant would support disciplined continuation of
the experiment: hardening the live system, gathering builder feedback, and
testing additional narrowly specified objective-condition adapters. The request
is grounded in shipped public infrastructure and a canonical Arc Mainnet proof,
not a speculative architecture.

# 60-second reviewer flow

1. Open the live app: <https://pact-web-production-ea97.up.railway.app>.
2. Read the landing-page explanation of Pact's GitHub-to-ERC-8183 settlement
   flow.
3. Open the Proof Center:
   <https://pact-web-production-ea97.up.railway.app/proof>.
4. Select the canonical Arc Mainnet proof for job `#2`.
5. Confirm the GitHub `PR_MERGED` condition, `0.01 USDC` budget, and `Completed`
   status.
6. Inspect the evidence hash, settlement transaction, contract addresses, and
   one-broadcast relay record.
7. Open the public repository to review the architecture, deployment facts, demo
   script, tests, and immutable proof artifact:
   <https://github.com/eugenennamdi/Pact>.

# Submission recommendation

**SUBMIT_NOW.** The public product, source, and canonical Arc Mainnet settlement
proof already support the application narrative. Replace the builder-profile
placeholders with the applicant's real public profiles before submitting.
