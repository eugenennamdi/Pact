# Pact MVP product specification

Status: Product contract updated through Phase 4A  
Scope owner: Tech Lead  
Scope changes require explicit approval.

## Product thesis

> Pact turns objectively verifiable outcomes into ERC-8183 settlement decisions.

The flagship promise is:

> Lock USDC against an outcome. Prove the outcome happened. Settle through
> ERC-8183.

ERC-8183 owns the job, budget, escrow, submission, completion, rejection,
expiry, payout, refund, and canonical financial state. Pact owns the immutable
condition, independent verification, canonical evidence, verifier attestation,
and deterministic evaluator decision.

## Problem

ERC-8183 supplies a reusable job-commerce lifecycle but deliberately does not
define how an evaluator proves an objective real-world outcome. A client and
provider still need a narrow, inspectable answer to: **why did this evaluator
complete this job?**

Pact fills that gap. For the MVP, it independently verifies that one identified
GitHub pull request was merged into one repository and base branch before the
agreed completion deadline. It commits evidence and authorizes
`ERC8183.complete(...)` through a contract evaluator.

Pact is not another escrow protocol, an ERC-8183 replacement, a generic bounty
marketplace, an arbitration service, or an AI evaluator.

## Target user

The first user is a grant issuer or project sponsor paying a known contributor
for a specific GitHub deliverable. The client and provider can use
EVM-compatible wallets and inspect the ERC-8183 job, Pact condition binding,
GitHub evidence, and Arc completion receipt.

Pact does not discover, match, rank, identify, or govern counterparties.

## MVP scope

- One explicitly version-pinned ERC-8183 commerce deployment on Arc.
- One ERC-8183 client, provider, evaluator, USDC budget, and job lifecycle.
- One non-custodial `PactEvaluator` designated as the job evaluator.
- One immutable Pact binding per ERC-8183 job.
- One authorized centralized verifier snapshotted at binding time.
- One condition schema: GitHub `PR_MERGED` for an exact `owner/repository`,
  pull-request number, and required base branch.
- One positive-only completion path: valid Pact evidence may call `complete`;
  Pact never calls `reject` in the MVP.
- One condition deadline before ERC-8183 `expiredAt`, leaving time for
  verification and transaction inclusion.
- Human-readable immutable evidence retained offchain and committed through the
  Pact attestation and ERC-8183 completion reason.
- Product projections reconciled with ERC-8183 and PactEvaluator state.

## Non-goals

The MVP does not include a custom escrow, custom refund rules, another financial
state machine, subjective/AI verification, negative evaluator decisions,
disputes, arbitration, multiple condition types, ERC-8004, provider discovery,
marketplaces, milestone claims, recurring payments, multiple chains, governance,
staking, credit, tokenomics, agents, or a generic automation framework.

Optional capabilities in a reference ERC-8183 implementation—hooks, streaming
claims, payout receivers, evaluator fees, ERC-2771, and ERC-8004 identifiers—are
not Pact MVP features.

## Roles

| Role                       | MVP responsibility                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Client                     | Creates the ERC-8183 job, selects PactEvaluator, binds the condition, reviews terms, and funds escrow.                         |
| Provider                   | Performs the work and submits `deliverable = conditionHash` to signal readiness.                                               |
| ERC-8183 commerce contract | Custodies USDC and owns the canonical job/financial lifecycle.                                                                 |
| Pact verifier              | Reads canonical job/submission context and GitHub state, constructs evidence, and signs only positive completion attestations. |
| PactEvaluator              | Validates the immutable binding and signed attestation, consumes replay protection, and calls ERC-8183 `complete`.             |
| Relayer                    | Pays Arc gas and submits a signed attestation; gains no verification authority.                                                |
| Application/database       | Coordinates attempts and projects authoritative state; cannot settle by itself.                                                |

## Canonical MVP journey

1. The client creates an ERC-8183 job with the known provider,
   `evaluator = PactEvaluator`, a reviewed `expiredAt`, and no unsupported Pact
   extensions.
2. While the job is still `Open`, the client calls PactEvaluator to bind the
   exact `(chainId, commerceContract, jobId)` to `conditionHash`,
   `completionDeadline`, and a wallet-reviewed `expectedVerifier`; the call
   reverts if that key is not still the current allowed default at inclusion.
3. The application confirms the immutable binding. A Pact-enabled job must be
   bound before funding; a job funded without a binding is not recoverable by
   later binding and can only follow ERC-8183's remaining lifecycle.
4. The provider sets the USDC budget under the pinned ERC-8183 ABI. The client
   reviews token and amount, approves USDC, and funds ERC-8183 escrow.
5. Work occurs. The provider submits `conditionHash` as the ERC-8183
   `deliverable`, moving the job to `Submitted` and signaling readiness for
   evaluation.
6. A webhook or explicit request may trigger verification, but Pact reads the
   ERC-8183 job/submission and independently fetches authoritative GitHub state.
7. If the exact PR was merged into the exact base branch at or before
   `completionDeadline`, Pact constructs canonical evidence and signs a
   short-lived EIP-712 completion attestation.
8. Any relayer may submit the attestation. PactEvaluator validates the domain,
   signer snapshot, job identity, condition, evidence, times, replay status,
   ERC-8183 evaluator, and `Submitted` status.
9. PactEvaluator marks its acceptance before the external call and invokes
   `ERC8183.complete(jobId, evidenceHash, "")`.
10. ERC-8183 transitions to `Completed` and releases escrow to the provider
    according to the pinned implementation.
11. The UI displays the condition, evidence, Pact acceptance event, ERC-8183
    completion/payment events, and Arc receipt.

If no valid positive completion reaches Arc before ERC-8183 expiry rules win,
the commerce contract's standard expiry/refund path applies. Pact does not
invent a competing refund path.

## Flagship condition

```text
schemaVersion = 1
provider      = github
repository    = pact-protocol/demo
pullRequest   = 81
baseBranch    = main
event         = PR_MERGED
```

Pact pays only if GitHub's authoritative state says PR 81 belongs to
`pact-protocol/demo`, is merged, and its base ref is exactly `main`. A similarly
numbered PR, a merge to `Main`, client data, provider submission, or a webhook
payload alone is insufficient.

The Phase 0 condition schema and published hash vector remain unchanged.

## Three distinct commitments

```text
conditionHash = what must happen
deliverable   = provider readiness/reference for the bound work
evidenceHash  = what Pact independently observed proving it happened
```

For the MVP, `deliverable` is exactly `conditionHash`. The enclosing
`JobSubmitted` log already supplies chain, commerce contract, and job ID, so
rehashing those into a second deliverable format adds no meaning. The verifier
checks the submitted event and its value before signing. The provider's value is
not proof; it is a reference and readiness signal.

## Deadline model

For the Arc Testnet product flow, the canonical anchor is the Arc block
timestamp used when `CREATE_JOB` is prepared (`T`):

```text
completionDeadline = T + 7200
expiredAt = T + 21600
```

Both absolute values are persisted with the prepared action and reused through
the remaining lifecycle. Funding does not reset either deadline.

- `completionDeadline`: stored by PactEvaluator. GitHub's `merged_at` must be at
  or before this time.
- `expiredAt`: stored by ERC-8183. A Pact completion transaction must execute
  before this upper bound under Pact's policy.
- settlement grace: `expiredAt - completionDeadline`; verification and
  submission may use it, but the objective outcome may not.

Required ordering:

```text
binding time < completionDeadline < ERC8183.expiredAt
```

Example: a PR merged at 17:59 for an 18:00 completion deadline remains eligible
during the grace period. A PR merged at 18:01 is ineligible. If a valid
attestation reaches chain after `expiredAt`, PactEvaluator does not complete the
job even if the underlying ERC-8183 implementation has an additional evaluator
grace feature.

## Positive-only resolution

Pact signs and executes only positive satisfaction:

- “not merged yet” is an observation, not rejection;
- wrong current state may become correct before the completion deadline;
- GitHub/API/credential failure is indeterminate;
- verifier/signing failure is an operational failure;
- PactEvaluator exposes no MVP path that calls ERC-8183 `reject`.

Uncompleted jobs resolve through the pinned ERC-8183 expiry/refund semantics.
There is no Pact dispute system.

## User-visible states

| Display state                  | Authority                | Meaning                                                                                          |
| ------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------ |
| Draft                          | Database                 | Mutable inputs; no onchain job.                                                                  |
| Open / unbound                 | ERC-8183 + PactEvaluator | Job exists but has no Pact condition; it must not be funded as a Pact flow.                      |
| Open / bound                   | Both contracts           | Immutable Pact condition exists; ERC-8183 terms may still follow allowed Open-state negotiation. |
| Funded                         | ERC-8183                 | USDC is escrowed by ERC-8183; PactEvaluator holds no budget.                                     |
| Submitted                      | ERC-8183 event/state     | Provider signaled readiness with the condition hash.                                             |
| Verification queued/running    | Application              | An attempt exists; no financial conclusion.                                                      |
| Not yet satisfied              | GitHub observation       | False at that observation only; no rejection.                                                    |
| Verification unavailable       | Application              | Indeterminate and potentially retryable.                                                         |
| Completion submitted/ambiguous | Application/RPC          | Broadcast or outcome is not yet definitive.                                                      |
| Completed                      | ERC-8183                 | Terminal financial success; reconcile reason/evidence and payout events.                         |
| Rejected                       | ERC-8183                 | Terminal refund state, but never initiated by Pact MVP.                                          |
| Expired                        | ERC-8183                 | Terminal timeout/refund state.                                                                   |

Pact “accepted attestation” is not equivalent to ERC-8183 `Completed` unless the
same atomic transaction completed successfully; a revert rolls both back.

## Failure semantics

- GitHub unavailable, rate-limited, unauthorized, or malformed means
  `indeterminate`, not failed condition or rejected job.
- A valid response showing the PR currently open/closed-unmerged/wrong-base
  means `not_satisfied` at that observation; it is non-terminal before the
  deadline.
- A valid attestation presented while the ERC-8183 job is not `Submitted`, has
  another evaluator, is already terminal, or is past Pact's expiry policy
  reverts without consuming it.
- Condition satisfied before `completionDeadline` but transaction included after
  `expiredAt` does not complete; the ERC-8183 expiry race determines the
  financial result.
- RPC timeout or missing transaction hash is ambiguous, not a revert and not
  proof the transaction was never broadcast.
- Database `SETTLED` cannot override an ERC-8183 job that is not `Completed`.
- ERC-8183 transfer or hook failure reverts the whole evaluator transaction;
  Pact acceptance/replay effects revert atomically too.

## Success criteria

- The same `(chainId, commerceContract, jobId)` always produces the same Pact
  job key, and identically numbered jobs elsewhere do not collide.
- Only the ERC-8183 client can bind while the job is `Open`; binding is
  immutable and the job names PactEvaluator as evaluator.
- A funded job never gives Pact custody of its USDC.
- Exact qualifying GitHub state produces inspectable evidence and one possible
  positive completion.
- Wrong job/deployment/chain/evaluator/condition/evidence/signer/time cannot
  complete.
- Duplicate triggers, relayers, retries, or restarts produce at most one Pact
  acceptance and one ERC-8183 completion.
- The product reconstructs why payment moved from evidenceHash through the
  ERC-8183 completion reason and Arc receipt.

## Complete MVP definition

The MVP is complete only after pinned-interface contract tests, cross-language
condition/job/attestation vectors, GitHub fixture/integration tests,
idempotency/reconciliation tests, Arc environment validation, and one real
end-to-end ERC-8183 settlement demonstrate completion and expiry/refund paths.
It must reject wrong bindings and replay boundaries and demonstrate ambiguous
transaction recovery.

A custom escrow, mocked payout, styled dashboard, provider-submitted boolean, or
server that trusts webhooks is not a complete Pact MVP.
