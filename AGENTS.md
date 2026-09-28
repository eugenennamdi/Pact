# Pact agent rules

- Phase scope is authoritative. Do not add features or alter protocol semantics
  without explicit Tech Lead approval.
- ERC-8183 owns job escrow, payout, refund, and canonical financial state. Never
  duplicate that lifecycle or its balances inside Pact.
- ERC-8183 is a draft dependency. Use only the explicitly reviewed
  specification, implementation commit, and ABI; never follow an unpinned branch
  silently.
- Never treat an example, testnet, or third-party ERC-8183 deployment as
  canonical.
- Pact may complete only a job whose condition was immutably bound while the job
  was Open and whose evaluator is the PactEvaluator contract.
- MVP evaluation is positive-only. Pact never rejects a job merely because a
  condition is currently false or verification is unavailable.
- Keep onchain financial authority separate from offchain metadata,
  orchestration, and projections. The chain wins on settlement state.
- Never expose private keys, GitHub credentials, webhook secrets, or signing
  material to browser code or `NEXT_PUBLIC_*` variables.
- Preserve canonical serialization and deterministic hashes. Any change requires
  test vectors, migration analysis, and explicit approval.
- Never treat a client claim or webhook delivery as verified evidence. Re-read
  GitHub's authoritative API state before signing.
- Never infer transaction failure from an RPC timeout or missing submission
  response. Reconcile by transaction hash, sender/nonce, receipt, events, and
  onchain state before retrying.
- Financial writes must be explicit and observable. Never silently auto-submit,
  switch networks, or hide fallback behavior.
- Do not change protocol semantics for UI or orchestration convenience.
- Make idempotency keys and retry behavior explicit. Restarts and duplicate
  deliveries must not duplicate financial actions.
- Update tests whenever protocol behavior changes; security invariants require
  negative tests, not only happy paths.
- Add only dependencies needed by the approved phase. Prefer narrow, boring
  interfaces.
- Display user-visible financial state from authoritative chain data, with
  projections clearly labeled when pending, stale, or ambiguous.
- Stay within the GitHub `PR_MERGED` / Arc / USDC MVP unless scope is explicitly
  changed.
