# Pact MVP security model

Status: Updated through the passing Phase 4A.1 PostgreSQL durability gate; not
an audit result. The local EOA signer is gated by authoritative same-block chain
reads and live-validated durable orchestration, but there is no transaction
broadcaster or production key.

## Assets to protect

- USDC held by the selected ERC-8183 commerce deployment.
- Integrity of ERC-8183 client, provider, evaluator, token, budget, expiry, job
  status, payout, and refund.
- Integrity of each Pact job identity, condition hash, completion deadline, and
  verifier snapshot.
- Verifier signing authority and optional server-side GitHub API token.
- Canonical evidence and its link to the Pact attestation and ERC-8183
  completion reason.
- Replay/acceptance state, transaction intents, nonces, and audit history.
- User wallet consent, chain/deployment selection, and displayed terms.
- Liveness sufficient to verify and complete qualifying jobs before expiry.

## Trust boundaries and assumptions

V1 trusts:

- Arc consensus/execution and canonical USDC behavior;
- the exact selected ERC-8183 implementation, deployment configuration, proxy
  implementation, and administrators for all escrow/financial semantics;
- PactEvaluator bytecode/configuration for immutable bindings and proof checks;
- one centralized Pact verifier to read GitHub honestly and protect its key;
- GitHub as the factual source for repository and pull-request state;
- the client/provider wallets to review and authorize their ERC-8183 actions.

PactEvaluator does not reduce ERC-8183 implementation or administrator risk. A
commerce upgrade, pause, emergency withdrawal, fee change, hook, token setting,
or implementation bug can affect escrow independently of Pact.

The database, frontend, relayer, webhook, client request, provider deliverable,
and any single RPC response are not trusted for financial truth. V1 verification
is centralized and must not be marketed as decentralized.

## Draft-standard and version risk

ERC-8183 remains Draft. The normative source, reference repository, and Arc
testnet tutorial currently expose different surfaces. Pact must pin the exact
specification revision, implementation commit, ABI, tuple layout, status
ordinals, code hashes, and deployment administration recorded in
`ERC8183_COMPATIBILITY.md`.

Risks include:

- the draft changing while existing jobs retain old semantics;
- two “ERC-8183” deployments having incompatible ABIs or lifecycle behavior;
- a proxy changing implementation behind the same commerce address;
- an example/testnet contract being mistaken for a canonical production one;
- unused reference features expanding the attack/admin surface.

An upgrade or migration requires a new reviewed adapter/PactEvaluator version.
Existing bound jobs never silently move to another commerce contract or ABI.

## Threat actors

- malicious client attempting condition substitution, binding manipulation, or
  misleading funding terms;
- malicious provider submitting an unrelated deliverable or seeking payout
  without the exact outcome;
- copied/front-running relayer attempting to reuse a valid signature;
- external attacker forging evidence/signatures or replaying across jobs,
  deployments, evaluators, or chains;
- compromised verifier, default-verifier/admin key, GitHub App, frontend,
  database, RPC, or ERC-8183 administrator;
- buggy/malicious ERC-8183 implementation, proxy upgrade, hook, payment token,
  payout receiver, or external callback;
- honest operators mishandling expiry races, ambiguous transactions, restarts,
  or source-version drift.

## Attack surfaces

- PactEvaluator binding/settle entry points, EIP-712 domain/type, signature
  recovery, time checks, storage effects, admin rotation/revocation, and
  external ERC-8183 call;
- pinned ERC-8183 getters, status ordinal/tuple decoding, `complete`, escrow
  accounting, token transfers, hooks/callbacks, proxy/admin roles, and expiry;
- canonical condition/job/evidence serialization across TypeScript/Solidity;
- GitHub API/App/webhook, repository rename/transfer, rate limits, and malformed
  responses;
- permissionless relaying, RPC submission, fee/nonce management, receipt/event
  reconciliation, and provider disagreement;
- browser chain/address/calldata display and dependency/build supply chain;
- database uniqueness, leases, migrations, backups, and administrative access.

## Composition invariants

Phase 1+ must preserve all of the following:

1. ERC-8183 alone custodies the job budget and is authoritative for financial
   state.
2. PactEvaluator has no token-receive, payout, refund, fee, budget, or arbitrary
   withdrawal path.
3. PactEvaluator targets one immutable commerce contract; another deployment
   requires another reviewed evaluator version.
4. Job identity binds `block.chainid`, commerce address, and job ID.
5. Only the ERC-8183 job client can create a Pact binding.
6. Binding succeeds only while the job is exactly `Open` and names this
   PactEvaluator as evaluator.
7. The client supplies `expectedVerifier`, which must equal the current nonzero,
   non-revoked default verifier at execution.
8. Condition hash, completion deadline, verifier snapshot, job identity, and
   commerce target cannot change after binding.
9. A job key can be bound at most once; zero/invalid values are rejected.
10. `block.timestamp < completionDeadline < job.expiredAt` at binding.
11. A job funded before binding can never be retroactively made Pact-settleable.
12. Pact MVP calls only `complete`; it exposes no path to ERC-8183 `reject` or
    claim settlement.
13. A negative/currently-false/indeterminate verification never creates a
    completion signature or onchain negative decision.
14. Settlement requires the exact bound job, condition, evidence, verifier,
    domain, and positive completion type.
15. `satisfiedAt <= completionDeadline` and
    `satisfiedAt <= verifiedAt <= block.timestamp <= validUntil < expiredAt`.
16. The job is still `Submitted` and still names PactEvaluator at execution.
17. The EIP-712 digest cannot be consumed twice; a job binding cannot accept two
    different attestations.
18. Cross-job, cross-commerce, cross-evaluator, and cross-chain replay fails.
19. Pact replay/acceptance effects occur before ERC-8183 external interaction; a
    reverted completion atomically rolls them back.
20. A copied attestation cannot redirect payment; ERC-8183 pays its stored
    provider/payout receiver under its own semantics.
21. `evidenceHash` accepted by Pact equals the `reason` passed to ERC-8183
    `complete` and appears in reconciliation events.
22. The provider's submitted deliverable equals the bound condition hash before
    the verifier signs; deliverable alone never proves satisfaction.
23. Rotating the default verifier does not authorize that new key for old
    bindings.
24. An irreversibly revoked verifier cannot settle any still-pending binding;
    revocation cannot redirect escrow or reject a job.
25. Any relayer may broadcast, but no relayer identity grants evaluation
    authority.
26. Duplicate webhook delivery, verification, relay, retry, or process restart
    causes at most one successful Pact acceptance/ERC-8183 completion.
27. GitHub/webhook/client/provider content is independently validated before
    signing.
28. Database/UI state never overrides ERC-8183 job state or Pact binding state.
29. RPC transport ambiguity never triggers blind resubmission or a false final
    label.
30. Signing keys and GitHub secrets never enter browser bundles, public
    variables, evidence, or logs.
31. Phase 0 condition semantics/vector never change silently.

## Binding threats

| Threat                                  | Control                                                                                      |
| --------------------------------------- | -------------------------------------------------------------------------------------------- |
| Attacker binds someone else's job       | Require caller equals client read from pinned commerce.                                      |
| Bind against wrong deployment           | Immutable commerce address plus canonical job key/event.                                     |
| Bind job with another evaluator         | Require job evaluator equals PactEvaluator.                                                  |
| Bind after funds move                   | Require exact `Open` status; no later binding.                                               |
| Rebind/change condition or deadline     | One immutable binding per job key.                                                           |
| Zero/expired terms                      | Reject zero hash/address/IDs and invalid time ordering.                                      |
| Front-run client binding                | Non-client call reverts; client transaction content remains wallet-visible.                  |
| Admin rotates key before binding lands  | Client supplies wallet-reviewed `expectedVerifier`; mismatch reverts.                        |
| Commerce getter decoded under wrong ABI | Pinned tuple/selectors/status tests and deployment manifest.                                 |
| Client funds unbound job                | UI/preflight blocks it; evaluator cannot settle it, so ERC-8183 expiry is the safe fallback. |

The last case is a liveness/user-error risk, not unauthorized payout. Adding a
hook solely to block funding would introduce callback and allowlist complexity,
so it is outside the minimal MVP.

## Attestation and replay threats

| Threat                                | Control                                                                            |
| ------------------------------------- | ---------------------------------------------------------------------------------- |
| Wrong job with same numeric ID        | Signed commerce address/job ID and immutable target.                               |
| Cross-chain use                       | EIP-712 chain ID.                                                                  |
| Cross-evaluator use                   | EIP-712 verifying contract.                                                        |
| Condition or evidence substitution    | Signed hashes and binding equality.                                                |
| Unauthorized/current key substitution | Recovered signer must equal snapshotted verifier.                                  |
| Revoked compromised signer            | Global irreversible revocation check.                                              |
| Stale proof                           | `validUntil`, completion deadline, and ERC expiry checks.                          |
| Duplicate signature                   | Used EIP-712 digest mapping.                                                       |
| Different signature for same job      | Binding-level accepted bit.                                                        |
| Signature malleability                | Reviewed strict ECDSA recovery; reject invalid/high-s/zero signer.                 |
| Caller-supplied arbitrary digest      | Contract reconstructs typed digest from fields; signer signs validated typed data. |

No `result` exists because the type is positive-only. No caller-chosen replay ID
exists because the EIP-712 digest is the deterministic attestation identity.

## Verifier compromise and rotation

Each binding snapshots the default verifier. Rotation changes only future
bindings; this prevents a newly appointed key from silently gaining authority
over already funded work.

An emergency revocation permanently disables a compromised key. Existing jobs
bound to it lose the Pact completion path and must expire/refund through
ERC-8183. This is an explicit availability tradeoff. MVP does not let an admin
replace a funded job's verifier because that would introduce surprising new
payment authority.

The admin can rotate future authority or deny completion through revocation, but
must not be able to call completion without a valid snapshotted signature,
change bindings, reject jobs, or withdraw ERC-8183 escrow. Admin custody and
revocation monitoring require a production runbook; no governance/upgrade system
is introduced into PactEvaluator.

## GitHub and evidence threats

- Verify webhook HMAC over raw bytes, size/content-type limits, and delivery ID;
  use the webhook only as a trigger.
- Independently fetch the exact repository and PR from a fixed GitHub API base.
- Validate canonical owner/name, PR number, merged state, exact case-sensitive
  base ref, non-null `merged_at`, and merge commit SHA.
- Reconcile the exact canonical ERC-8183 `JobSubmitted` transition and require
  `deliverable == conditionHash` before signing.
- Do not infer merge from `closed`, branch deletion, issue events, client data,
  provider data, or a webhook alone.
- Treat ambiguous 404/private/revoked access, timeout, rate limit, malformed
  response, and outage as indeterminate.
- Repository rename/transfer remains fail-closed under condition schema v1.
- Build `evidenceHash` from canonical typed fields, not display JSON or raw API
  bytes; escape projections and restrict raw-response retention.
- The signer reconstructs/validates typed content and never signs an arbitrary
  caller-supplied hash.

## Provider submission semantics

`deliverable = conditionHash` is a reference/readiness signal, not factual
proof. The current pinned reference implementation emits but does not retain it
in the job view. A malicious provider can emit another value; the verifier must
detect that from the canonical submission event and refuse to sign.
PactEvaluator relies on the verifier's signed condition for this fact in v1.

If onchain enforcement of deliverable becomes required, that is a reviewed
protocol change—likely involving a compatible stored getter or hook—not a
frontend assumption.

## External-call and reentrancy considerations

PactEvaluator calls an untrusted external commerce contract after setting its
accepted/replay effects. It must use reentrancy protection or equivalent state
ordering. ERC-8183 may transfer tokens, invoke a payout receiver, or invoke
hooks during `complete`; any can reenter or revert. PactEvaluator must expose no
path that allows callback-driven rebinding, second acceptance, verifier
mutation, or arbitrary call.

If ERC-8183 completion reverts, the entire transaction—including Pact effects—
reverts. If it returns without transitioning to `Completed`, PactEvaluator
re-reads the job and reverts `CompletionDidNotFinalize`; the replay effects roll
back with that revert.

Pact does not attempt to correct ERC-8183 escrow accounting. Reference hooks,
payout callbacks, partial claims, fee rounding, pausing, upgradeability, and
emergency withdrawal remain commerce-layer risks even when Pact never invokes
those features.

## Completion and expiry races

- Pact requires `validUntil < expiredAt` and execution by `validUntil`.
- A qualifying merge just before `completionDeadline` still needs verification,
  submission state, and inclusion before expiry.
- At the boundary, a completion and ERC-8183 expiry/refund transaction may race;
  canonical transaction ordering decides.
- The reviewed reference commit provides an extra one-hour refund grace for
  `Submitted` jobs, but Pact does not rely on it or extend `validUntil` past
  `expiredAt`. Another deployment may omit it.
- A valid signature that arrives too late is not evidence failure; it is an
  expired settlement opportunity.

## Relayer and RPC safety

Relayers are untrusted and permissionless. They may copy, delay, front-run, or
withhold an attestation, but cannot change signed fields or payment recipient.
The first valid included relay may succeed; duplicates revert or observe a
terminal job.

Persist transaction intent before send: chain, commerce, evaluator, job,
attestation digest, calldata hash, relayer, and nonce. A timeout or missing hash
may mean the transaction was broadcast. Reconcile known/derived hash,
sender/nonce, Pact events, and ERC-8183 status through independent reads before
replacement. Finality after inclusion does not remove pre-inclusion ambiguity.

## Wallet and frontend safety

- Show chain, commerce deployment/version, evaluator, client, provider, USDC
  token, amount, condition, completion deadline, and expiry before signatures.
- Block funding until the binding is confirmed onchain and still matches an
  `Open` job.
- Refuse unsupported chain/address/ABI; never silently switch or fall back.
- Distinguish ERC-8183 approval/funding/submission from Pact binding/completion.
- Never request seed phrases or expose verifier/GitHub secrets.
- Validate public configuration against server manifest and contract reads;
  stale builds disable writes.
- Treat condition/evidence fields as untrusted display data.

## Database and projection safety

Database state is operational only. Rebuild financial state from the pinned
ERC-8183 contract and binding/acceptance state from PactEvaluator. A row marked
completed without ERC-8183 `Completed` and matching final events is corrupt or
stale. Use unique canonical job keys, evidence hashes, attestation digests,
delivery IDs, and active transaction intents. Leases must recover after restart.

## Failure semantics

| Observation                                       | Classification                          | Consequence                                                    |
| ------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------- |
| Exact GitHub PR merged in time                    | Positive factual result                 | Build evidence; sign only if all job/submission checks pass.   |
| PR currently unmerged before deadline             | Time-dependent                          | Record and retry under explicit policy; never reject.          |
| GitHub unavailable/ambiguous                      | Retryable/indeterminate                 | No signature or financial conclusion.                          |
| Wrong signature/domain/job/binding                | Definitive invalid proof                | Revert unchanged.                                              |
| Valid proof but job not Submitted/wrong evaluator | Definitive current precondition failure | No completion; reassess only if state can legitimately change. |
| Valid proof after Pact/commerce expiry policy     | Definitive stale proof                  | No completion; allow ERC-8183 lifecycle.                       |
| RPC timeout/missing hash                          | Ambiguous transaction                   | Reconcile; do not blindly retry.                               |
| Final revert receipt                              | Definitive for that transaction         | Read both contracts before a new intent.                       |
| ERC-8183 Completed with matching reason/events    | Canonical financial success             | Update projection and show evidence/receipt.                   |
| Database disagrees with contracts                 | Projection failure                      | Quarantine/rebuild; contracts win.                             |

## Centralization and residual risk

V1 is centralized around the verifier, Pact admin/revocation authority, ERC-8183
implementation/admins, GitHub availability, evidence hosting, and application
operations. A compromised active verifier can falsely attest that a bound
condition was satisfied. A compromised commerce admin may alter or drain escrow
if the selected implementation permits it. A compromised Pact admin can revoke
completion liveness, but the chosen design does not let it replace verifier
authority for existing bindings or redirect funds.

These risks must be visible in deployment review and product copy.

## Required adversarial tests

Before production consideration, cover:

- wrong client/status/evaluator/commerce/job/condition/evidence/domain/signer;
- zero/invalid values, rebind/front-run attempts, and all deadline boundaries;
- cross-chain/contract/evaluator/job replay and alternate signatures for one
  job;
- signer rotation, irreversible revocation, and revoked-job expiry behavior;
- malformed/malleable/future/expired attestations;
- reentrancy and revert from commerce, token, hook, and payout receiver;
- commerce returns/unexpected state, proxy implementation drift, pause/admin
  behavior, and ABI/status-layout mismatch;
- completion-versus-expiry and concurrent relayer races;
- duplicate submissions/webhooks/workers and restart recovery;
- timeout after successful broadcast, dropped transactions, nonce replacement,
  and provider disagreement;
- database rebuild and stale/malicious frontend configuration;
- cross-language condition, job identity, evidence, and typed-data vectors.
