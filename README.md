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

Phases 0–3 and Phase 4A code review are complete. Phase 4A.1 and the local-only
Phase 4B implementation pass their PostgreSQL, unit, contract, and Anvil gates
and are pending Tech Lead review. Phase 4B adds one dedicated server-side relay
EOA, durable nonce ownership, exact raw-transaction persistence, a single
dispatch boundary, and read-only canonical reconciliation. No Arc transaction,
final UI, or production deployment has been performed.

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
