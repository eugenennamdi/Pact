# Pact MVP implementation plan

Each phase ends with Tech Lead review. Acceptance requires tests/evidence, not
files merely existing. No phase implicitly authorizes deployment or the next
phase.

## Phase 0 — Foundation and architecture (completed)

### Objective

Establish the narrow GitHub condition, deterministic commitment, trust model,
tooling, and delivery plan.

### Delivered scope

Strict npm/TypeScript workspace, Next.js shell, package boundaries, condition
canonicalizer/hash vector, initial attestation type,
product/architecture/security documents, and agent/environment guidance.

### Superseded decision

The original Pact-owned custody/refund/settlement contract model is replaced by
Phase 0.5. The condition schema and published vector remain valid.

### Verification

Phase 0 lint, typecheck, tests, formatting, and production build passed.

---

## Phase 0.5 — ERC-8183 architecture correction (completed)

### Objective

Make ERC-8183 the sole job/escrow/financial lifecycle and redefine Pact as a
positive deterministic evaluator.

### Implementation scope

- Research and pin current draft/reference revisions and Arc primary sources.
- Classify Arc Mainnet ERC-8183 deployment availability without guessing.
- Replace PactEscrow concepts with PactEvaluator, immutable bindings,
  positive-only EIP-712 V2, and permissionless relaying.
- Define canonical `(chainId, commerceContract, jobId)` identity and tests.
- Preserve GitHub condition schema/vector and evidence distinction.
- Correct product, architecture, security, plan, agent, environment, README,
  protocol types, and package-boundary documentation.

### Files/components

All `docs/*`, `AGENTS.md`, `.env.example`, `README.md`, contracts package
README, and protocol attestation/job identity types/tests.

### Explicit non-goals

No Solidity, ERC-8183 installation/deployment, USDC movement, wallet/GitHub/
webhook/signer/relayer/database/UI implementation, ERC-8004, AI, marketplace, or
disputes.

### Required tests

- Existing condition vectors remain unchanged.
- Job identity is deterministic and separates chain/deployment/job.
- Invalid/zero job identity input and forged noncanonical objects fail closed.
- Lint, strict typecheck, tests, formatting, and build pass.

### Acceptance criteria

- Every document consistently assigns financial authority to ERC-8183.
- Exact research revisions/conflicts and deployment classification are recorded.
- Phase 1 has one bounded evaluator/interface scope and no custody work.

### Blocking dependencies

Satisfied: Phase 0.5 passed and the Tech Lead authorized Phase 1.

---

## Phase 1 — PactEvaluator foundation and pinned interface (completed)

### Objective

Implement the smallest non-custodial PactEvaluator foundation and exhaustive
unit tests against an exact ERC-8183 compatibility fixture. Do not deploy.

### Exact implementation scope

1. Select and pin the Arc-compatible Solidity/Foundry toolchain after current
   Arc review.
2. Vendor/define a minimal `IPactERC8183` locked to reference commit
   `142e669c1fd318486a4628395b629f033654dd06`: exact `Job` tuple/status
   ordinals, `getJob(uint256)`, and `complete(uint256,bytes32,bytes)` only.
3. Add a pinned mock/fixture that exercises the exact interface and adversarial
   external-call behavior. Do not copy/deploy the full reference commerce
   implementation in this phase.
4. Implement non-upgradeable `PactEvaluator` with one immutable commerce
   address, canonical job-key derivation, one-time Open-state condition binding,
   completion deadline, verifier snapshot, events, and read methods.
5. Add a default verifier for future bindings, explicit rotation for future
   jobs, and irreversible global verifier revocation. No replacement for an
   existing binding.
6. Establish internal checks-effects-interactions/reentrancy structure for the
   later `settle` external call, but do not yet accept production attestations.
7. Publish ABI/selectors/layout hashes and Solidity/TypeScript job-key vectors.

Implemented external surface:

```text
bindCondition(jobId, conditionHash, completionDeadline, expectedVerifier)
jobKey(jobId)
getBinding(jobId)
admin()
defaultVerifier()
isVerifierRevoked(verifier)
setDefaultVerifier(newVerifier)       // admin; future bindings only
revokeVerifier(verifier)              // admin; irreversible
commerceContract()
```

No disabled/test-harness completion transition or temporary unauthenticated
settlement bypass was added.

### Delivered implementation

- Foundry `v1.8.3`, Solidity `0.8.28`, Cancun, optimizer 200, and 1,024 fuzz
  runs are pinned locally; no Solidity library dependency was added.
- The exact 13-field pinned `Job` tuple, six status ordinals, `getJob(uint256)`,
  and future `complete(uint256,bytes32,bytes)` selector are protected by
  compatibility vectors.
- `PactEvaluator` uses immutable commerce/admin configuration, deterministic
  cross-language job keys, immutable client-authorized Open-state bindings,
  future-only verifier rotation, and irreversible revocation.
- Unit, fuzz, malformed-return, reverting-getter, and bounded static-reentry
  tests are implemented. No settlement or financial path exists.

### Files/components

`packages/contracts/foundry.toml`, `src/PactEvaluator.sol`,
`src/interfaces/IPactERC8183.sol`, pinned fixture/mocks, unit/fuzz/invariant
tests, and ABI/vector artifacts.

### Explicit non-goals

No ERC-8183 deployment, token custody/approval/transfer, Pact payout/refund/
reject, GitHub logic, evidence hashing, signature acceptance, relayer,
upgradeability, hooks, claims, ERC-8004, or Arc deployment.

### Required tests

- Constructor rejects zero/invalid commerce/verifier/admin assumptions.
- Job key matches TypeScript vectors and changes across chain/address/job.
- Bind only by exact client, only `Open`, only when evaluator is this contract.
- Reject nonexistent/wrong-status/already-funded/wrong-evaluator jobs, zero
  hash, rebind, and invalid time ordering.
- Reject a stale or substituted `expectedVerifier`, including an admin rotation
  between client review and transaction inclusion.
- Binding/verifier/deadline/job identity are immutable.
- Rotation affects future bindings only; old snapshots remain; revocation is
  irreversible and blocks revoked defaults from new binding.
- Malicious/reentrant commerce getter cannot mutate evaluator state.
- ABI/status/tuple mismatch tests fail loudly.
- Fuzz job IDs, hashes, timestamps, addresses, and concurrent/repeated calls.

### Acceptance criteria

- PactEvaluator stores no budget/financial status and has no token or refund
  path.
- Every successful binding is provably client-authorized, pre-funding, exact
  commerce/evaluator, immutable, and evented.
- Interface selectors/layout and cross-language job-key vectors are published.
- Contract compile/lint/unit/fuzz/invariant suites pass.

### Blocking dependencies

Tech Lead approval is required before Phase 2. Reconfirm the pinned reference
commit and interface before adding completion authorization; no deployment is
authorized.

---

## Phase 2 — EIP-712 V2 and evidence commitment (completed)

### Objective

Enable one positive, replay-safe Pact completion that atomically calls the
pinned ERC-8183 `complete` function.

### Implementation scope

- Freeze `PactCompletionAttestation` V2 domain/type and cross-language vectors.
- Add strict signature recovery, snapshotted/revoked verifier checks, timestamp
  rules, digest consumption, binding acceptance, and permissionless
  `completeWithAttestation`.
- Re-read exact ERC-8183 `Submitted` status/evaluator/expiry immediately before
  completion.
- Call `complete(jobId, evidenceHash, empty)` and verify atomic behavior.
- Define/publish version-1 evidence schema and exact hash vectors.
- Emit enough Pact acceptance data to reconcile with ERC-8183 completion events.

### Likely files/components

PactEvaluator and signature libraries/tests, protocol evidence/attestation
helpers, Solidity/TypeScript fixtures, generated ABI, and docs if reviewed
fields change.

### Explicit non-goals

No GitHub requests, production signer, automatic relay, negative result/reject,
new condition type, hooks/claims, or deployment.

### Required tests

- Identical Solidity/TypeScript domain/digest/evidence vectors.
- Reject wrong chain/evaluator/commerce/job/condition/evidence/signer and all
  timestamp violations.
- Reject malformed/malleable signatures, revoked verifier, duplicate digest, and
  alternate valid signature for accepted job.
- Require Submitted/exact evaluator; reject every terminal/wrong state.
- Reentrancy, commerce revert/no-op/unexpected postcondition, concurrent relay,
  and expiry race tests.
- Prove commerce revert rolls back Pact acceptance and allows valid retry.

### Acceptance criteria

- Only a positive exact-domain signature for the immutable binding can cause
  `complete`.
- Pact accepts one proof at most and passes exactly `evidenceHash` as reason.
- PactEvaluator remains tokenless/non-custodial and has no reject path.

### Blocking dependencies

Phase 1 approval; EIP-712/time/evidence schema approval; decision on exact
commerce postcondition check; reviewed ECDSA library.

---

## Phase 3 — GitHub `PR_MERGED` verifier (completed)

### Objective

Independently decide the single approved GitHub condition and construct signed
positive evidence without yet sending Arc transactions.

### Implementation scope

- Add a narrow native-fetch GitHub client for public repositories, with optional
  server-only token authentication and no hidden retries.
- Fetch/validate exact repository, PR number, merged state, base ref,
  `merged_at`, and merge SHA.
- Preserve `satisfied`, `not_satisfied`, and `indeterminate` distinctions.
- Build/hash evidence and produce V2 typed data through a server-only EOA signer
  primitive guarded by a verified-completion runtime boundary.
- Resolve/document repository rename/transfer fail-closed semantics.

### Likely files/components

`packages/verifier/src/github/*`, `packages/verifier/src/signer/*`, protocol
evidence builder, error taxonomy, fixtures, and signer-policy tests.

### Explicit non-goals

No OAuth user login, private repository flow, production webhook, persistence,
onchain job/submission reconciliation, other GitHub events/providers, AI,
negative signing, production key, transaction relay, ERC-8004, or marketplace.

### Required tests

- Open, merged, closed-unmerged, wrong base/repo/PR/deliverable,
  missing/renamed/ private repo, 4xx/5xx/rate-limit/timeout/malformed response.
- Redirects and client claims cannot alter independently fetched evidence.
- Golden evidence/attestation inputs and no-signature tests for all nonpositive
  outcomes.

### Acceptance criteria

- Only the exact qualifying GitHub outcome yields deterministic positive typed
  data; Phase 4 must validate onchain binding/job/submission context before use.
- Webhooks remain trigger-only and are not implemented in this phase.
- No secret enters browser output, logs, snapshots, or public configuration.

### Blocking dependencies

Phase 2 vectors are satisfied. Phase 4 still requires chain reconciliation,
webhook policy, persistence, relaying, and production key custody decisions.

---

## Phase 4A — Durable preparation and reconciliation (implemented; pending review)

### Objective

Durably progress from authenticated triggers through independent verification,
same-block authoritative Arc reconciliation, and signing to `READY_TO_RELAY`.

### Implementation scope

- PostgreSQL and Drizzle migrations/repository with semantic uniqueness and CAS.
- Raw-body GitHub webhook authentication, delivery deduplication, and durable
  trigger routing.
- Explicit verification/reconciliation/signing state machine and recovery.
- Read-only viem Arc client pinned to one block for evaluator, binding,
  revocation, job, expiry, and runtime-chain checks.
- Immutable evidence and signed attestation persistence ending at
  `READY_TO_RELAY`.

### Likely files/components

`packages/database`, `packages/orchestrator`, protected Next.js mutation routes,
migrations, and deterministic/live-gated tests.

### Explicit non-goals

No generic workflow engine, distributed event bus, microservice split,
auto-refund, wallet client, nonce, transaction intent, broadcast, production Arc
write, or multi-chain indexer.

### Required tests

- Duplicate/concurrent webhook/manual triggers, worker CAS, and restart
  recovery.
- GitHub/RPC failures and every pre-sign chain/key/deadline/expiry mismatch.
- Crash after signing but before durable commit safely re-verifies; identical
  typed fields regenerate the same digest, while a new observation creates a new
  independently verified digest.
- One active prepared artifact per binding.

### Acceptance criteria

- Restarts and duplicates create at most one active `READY_TO_RELAY` artifact.
- No signature is produced before independent GitHub and chain reconciliation.
- Webhooks are trigger-only; no route accepts evidence or chain context.

### Blocking dependencies

Phase 4B implements the reviewed local relay custody, nonce ownership,
broadcast-intent, ambiguity, receipt, and canonical reconciliation model. It
remains pending Tech Lead review before Phase 5.

---

## Phase 4A.1 — Live PostgreSQL durability gate (passing; pending review)

The explicitly gated live suite applies migrations twice from zero in isolated
test databases and validates PostgreSQL uniqueness, two-connection CAS,
concurrent triggers, prepared-artifact races, rollback, recovery, and database
failure propagation. Both critical CAS transitions completed 100 race iterations
with exactly one winner and one loser per iteration. Ordinary unit tests and
application startup remain database-migration-free.

This prerequisite gate passes. The local Phase 4B implementation also passes and
remains pending Tech Lead review before Phase 5.

---

## Phase 4B — Transaction relay and broadcast reconciliation (implemented locally; pending review)

### Objective

Safely move a durable `READY_TO_RELAY` artifact through single dispatch,
broadcast ambiguity, receipts, and canonical settlement reconciliation.

### Explicit boundary

The approved Phase 4B scope is implemented behind protected server-only routes.
It has been exercised only against local Anvil and test-named PostgreSQL
databases; no Arc write is authorized or performed.

### Implemented safety boundary

- A dedicated relay key, distinct from the verifier, exists only in server
  configuration.
- PostgreSQL serializes nonce reservation per chain/sender and permits one
  unresolved intent; outside or pending nonce use fails closed.
- Exact signed bytes and expected hash are durable before the single CAS-owned
  dispatch call.
- Any ambiguous broadcast result is read-only `BROADCAST_UNKNOWN`; restart and
  retry paths never automatically resend.
- Receipts, `PactCompleted`, binding acceptance, and ERC-8183 `Completed` state
  must form one canonical outcome; external relayers are recorded explicitly.
- Local gates cover response loss, pre-forward failure, hash mismatch, reverted
  receipt, external completion, concurrent external race, crash recovery, and
  nonce drift.

See `PHASE4B_RELAY.md` for states, invariants, APIs, and operator recovery.

---

## Phase 5 — Arc integration and real ERC-8183 settlement

### Objective

Validate the pinned composition on an approved Arc environment and qualify
Mainnet only after resolving the canonical-deployment question.

### Implementation scope

- Revalidate Arc chain/RPC/explorer, USDC interface, EVM/toolchain,
  fee/finality, wallets, and contract-address sources.
- Resolve ERC-8183 deployment classification with authoritative current
  evidence.
- If no official canonical deployment is confirmed, review/audit and deploy an
  exact pinned reference implementation with explicit proxy/admin/fee/hook/token
  posture; do not alter escrow semantics under the Pact name.
- Publish deployment manifest: spec/implementation commits, ABI hash,
  proxy/implementation code hashes, admins, fees, token, grace rules, addresses.
- Deploy PactEvaluator against that one address and verify source/bytecode.
- Run controlled end-to-end completion and expiry/refund using disposable funds.

### Likely files/components

Deployment scripts/config/artifacts, environment parser, Arc RPC adapter,
explorer builder, integration tests, and operations/security runbooks.

### Explicit non-goals

No Mainnet action without separate approval, no third-party address promotion,
multi-chain registry, bridging/onramp, automatic network switching, or custom
escrow fork.

### Required tests

- Chain/address/code/ABI/proxy/token/decimals/domain mismatch fails closed.
- ERC-8183 fees/admin/pause/upgrade/hooks are exactly expected.
- Arc USDC amount handling, fee-floor/drop, timeout-after-broadcast, revert, and
  final inclusion.
- Pact completion reason equals evidence hash and provider receives the exact
  commerce-defined net payout.
- Expiry/refund behavior and completion-versus-expiry boundary.

### Acceptance criteria

- One pre-production run links condition, job key, submission, binding,
  evidence, signature, Pact event, ERC-8183 completion/payment, balances, and
  explorer receipt.
- Every deployment/config value is independently verified and versioned.
- Mainnet remains gated by audit, custody/admin readiness, and explicit
  approval.

### Blocking dependencies

Phases 1–4; authoritative deployment decision; audit of selected commerce code
and administration; managed signer/admin/RPC; funded test wallets; legal and
operational go/no-go.

---

## Phase 6 — Product UI

### Objective

Expose the one approved ERC-8183/Pact flow with accurate authority and explicit
wallet consent.

### Implementation scope

- Create job, bind condition while Open, review budget/token, fund, show
  provider submission, trigger/view verification, relay/view completion, and
  show expiry.
- Display condition/deadline separately from ERC-8183 expiry and settlement
  grace.
- Show ERC-8183 financial state as canonical and Pact binding/proof as separate.
- Verify evidence hash against Pact and ERC-8183 completion reason.
- Represent pending/ambiguous/error states without false certainty.

### Likely files/components

`apps/web` routes/components, wallet configuration, read APIs, amount/time
formatters, accessibility and browser tests.

### Explicit non-goals

No marketplace, other providers/conditions/chains, GitHub OAuth, AI, disputes,
ERC-8004, admin console, or large design system.

### Required tests

- Exact job/binding/funding/submission calldata and supported-chain enforcement.
- Block funding if unbound or mismatched; wallet rejection/wrong account/chain.
- Every user-visible canonical/projected/ambiguous state.
- Evidence/reason recomputation and browser secret scan.
- Keyboard/screen-reader critical flow.

### Acceptance criteria

- A reviewer can answer why ERC-8183 paid the provider.
- UI never claims Pact holds escrow, never silently submits/switches, and never
  treats projections as canonical.

### Blocking dependencies

Stable reviewed deployments/ABIs, wallet support, evidence API, and approved
trust/risk copy.

---

## Phase 7 — Adversarial and security pass

### Objective

Challenge the composed ERC-8183/Pact system and close launch-blocking defects.

### Implementation scope

- Review every invariant in `SECURITY_MODEL.md` across both contract boundaries.
- Expand fuzz/invariant/differential/concurrency/chaos tests.
- Audit commerce/Pact proxy/admin/key/config and supply-chain posture.
- Exercise compromise, rotation/revocation, expiry races, outages, corruption,
  recovery, and deployment provenance.
- Obtain external review appropriate to funds at risk.

### Explicit non-goals

No feature work, decentralization claims, or acceptance of unresolved critical/
high findings.

### Required tests

All security-model adversarial cases, backup/restore, projection rebuild,
signer/admin drills, source/code-hash verification, and full replay/race suite.

### Acceptance criteria

- No unresolved critical/high finding; lower risks have explicit owners.
- Revocation/recovery drills prevent unauthorized completion without enabling
  Pact fund custody.
- Deployed artifacts match reviewed/pinned sources and manifest.

### Blocking dependencies

Integrated MVP, external reviewer, production custody design, incident owner,
and complete deployment manifest.

---

## Phase 8 — Submission and demo polish

### Objective

Produce a repeatable, honest Arc Microgrants demonstration without expanding
protocol scope.

### Implementation scope

- Prepare deterministic demo repository/PR, ERC-8183 job, binding, funding,
  submission, evidence, completion, and receipts.
- Document trust, version pins, deployments, centralization, and limitations.
- Rehearse happy path, expiry path, verification outage, and RPC ambiguity.
- Improve narrow accessibility/usability issues only.

### Explicit non-goals

No new provider, condition, chain, AI, marketplace, ERC-8004, governance, or
unaudited financial semantic change.

### Required tests

Fresh setup, full completion, expiry/refund, evidence/reason linkage, outage/
ambiguity demonstration, and repeated rehearsal.

### Acceptance criteria

- Another engineer can reproduce the demo from clean setup.
- Every product claim matches deployed code and authoritative state.
- “Why did this money move?” is reconstructable end to end.

### Blocking dependencies

Phase 7 approval, stable approved deployments, demo funds/repository, and
program submission requirements.
