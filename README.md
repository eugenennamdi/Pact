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

Phases 0–3 and Phase 4A code review are complete. Phase 4A.1 validates the
durable PostgreSQL orchestration, uniqueness, CAS, rollback, and recovery model
against real PostgreSQL; its gate passes and is pending Tech Lead review before
Phase 4B. No transaction broadcaster, relayer wallet, final UI, or deployment
exists yet.

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
