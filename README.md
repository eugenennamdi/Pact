# Pact

Pact is programmable settlement infrastructure for verifiable outcomes:

> Lock USDC against an outcome. Prove the outcome happened. Settle through
> ERC-8183.

ERC-8183 owns the job, escrow, submission, payout, refund, and canonical
financial lifecycle. Pact binds one GitHub `PR_MERGED` condition to that job,
verifies it independently, and turns positive evidence into an evaluator
decision. Evidence explains why ERC-8183 released payment.

## Repository

- `apps/web` — eventual Next.js product and server orchestration surface
- `packages/contracts` — PactEvaluator and pinned ERC-8183 interface
- `packages/protocol` — canonical condition types and hashing
- `packages/verifier` — GitHub verifier and server-only completion signer
- `packages/database` — PostgreSQL/Drizzle persistence and migrations
- `packages/orchestrator` — webhook, Arc reads, reconciliation, and signing gate
- `docs` — product, architecture, security, and phased implementation contracts

## Status

Phases 0–4B have passed their local gates. Phase 5 adds the exact pinned
ERC-8183 implementation and UUPS proxy, immutable deployment manifests, runtime
code/configuration verification, ambiguity-safe deployment transactions, and
controlled-value Testnet-before-Mainnet gates. Its local contract and tooling
tests pass. Live Arc Testnet is blocked on explicit operator credentials, roles,
funds, and a real GitHub test case; consequently Mainnet remains forbidden.

With Node.js 22 or newer, install and verify with:

```bash
npm install
npm run lint
npm run typecheck
npm run test
npm run build
npm run database:check
```

Apply migrations only as an explicit deployment action with `DATABASE_URL`:

```bash
npm run database:migrate
```

Run the destructive-only-to-its-own-child-databases live gate against an
explicit test-named PostgreSQL database:

```bash
PACT_DATABASE_LIVE_TEST=1 DATABASE_URL=postgresql://.../pact_live_test \
  npm run test:database-live
```

Run the opt-in local PostgreSQL + Anvil relay gate against a fresh migrated test
database:

```bash
PACT_RELAY_E2E=1 DATABASE_URL=postgresql://.../pact_relay_e2e_test \
  npm run test:relay-e2e
```

The relay key is server-only `PACT_RELAY_PRIVATE_KEY`; it must differ from the
verifier key and must never be exposed through `NEXT_PUBLIC_*`. See
`docs/PHASE4B_RELAY.md` for the state machine and recovery runbook.

After creating a clean reviewed release commit, follow `docs/DEPLOYMENT.md` for
the explicit Arc Testnet deployment and controlled settlement gate. Deployment
requires a literal network confirmation and writes a recovery journal before
broadcasting any signed transaction. No deployment address is inferred or
silently reused.

Run the opt-in Phase 5 full-flow local gate against a freshly migrated,
disposable test database. It launches Anvil, deploys the actual pinned ERC-8183
proxy composition, and exercises Phase 4A and Phase 4B rather than a manual
completion call:

```bash
PACT_PHASE5_LOCAL_E2E=1 DATABASE_URL=postgresql://.../pact_phase5_local_test \
  npm run test:phase5-staged-local
```
