# Phase 4A durability and signing gate

Status: Phase 4A passed code review. Phase 4A.1 real-PostgreSQL durability gate
passes; pending Tech Lead review before Phase 4B.

## End-to-end flow

```text
signed GitHub webhook or protected manual trigger
→ durable operation (PENDING)
→ independent Phase 3 GitHub verification
→ immutable evidence record
→ same-block read-only Arc snapshot
→ strict reconciliation against configuration, Pact record, binding, key, and job
→ restricted Phase 3 signer
→ transactional prepared-attestation record
→ READY_TO_RELAY
```

There is no wallet client, transaction sender key, nonce reservation,
`writeContract`, `sendTransaction`, or `completeWithAttestation` call.

## PostgreSQL schema

Drizzle migration `0000_overrated_baron_zemo.sql` creates:

- `pact_records`: canonical chain/evaluator/commerce/job identity,
  reconstructible GitHub condition, condition hash, and completion deadline.
  Unique semantic identity and `job_key`.
- `github_deliveries`: `X-GitHub-Delivery` primary key, event/action, bounded
  routing keys, authenticated flag, processing state, and timestamps.
- `operations`: explicit state, trigger identity, retry classification, CAS
  version, and timestamps. A partial unique index permits only one active
  operation per Pact.
- `verification_attempts`: append-only GitHub outcomes and rate-limit metadata.
- `evidence_records`: immutable canonical evidence keyed by `evidence_hash`.
  Evidence is global content-addressed data so the same proof may safely support
  more than one Pact; operation and attestation foreign keys provide context.
- `chain_reconciliations`: append-only same-block binding/job/key snapshots and
  machine-readable outcomes.
- `attestations`: immutable digest, typed fields, signature, signer,
  job/evidence linkage, and validity. A partial unique index permits one active
  prepared artifact per Pact.

Financial values and ERC-8183 lifecycle state are not copied into `pact_records`
as authority. Chain snapshots are timestamped audit observations.

## State machine

Happy path:

```text
PENDING → VERIFYING_GITHUB → VERIFIED → RECONCILING_CHAIN
→ READY_TO_SIGN → SIGNING → READY_TO_RELAY
```

Outcome states:

```text
NOT_SATISFIED_RETRYABLE
NOT_SATISFIED_TERMINAL
INDETERMINATE
CHAIN_RETRYABLE
CHAIN_INVALID
ALREADY_ACCEPTED
EXPIRED
FAILED_DEFINITE
```

Outcome states are terminal for that operation. `retryable` means a later manual
or scheduled trigger may create a new semantically keyed operation; it does not
hide an in-process retry loop.

Workers acquire sensitive transitions with conditional
`UPDATE ... WHERE state IN (...)`. Database partial unique indexes independently
prevent parallel active operations and active prepared artifacts.

## Webhook contract

`POST /api/github/webhook` accepts at most 1 MiB of raw `application/json`. It
authenticates the original bytes using HMAC-SHA256 and `X-Hub-Signature-256`
with constant-time comparison before JSON parsing. It requires UUID-shaped
`X-GitHub-Delivery` and `X-GitHub-Event`. Only `pull_request/closed` yields
repository/PR routing keys; all factual payload claims, including `merged`, are
ignored.

The delivery is committed before returning `202`. Duplicate delivery IDs return
`200` without creating another attempt. No fire-and-forget work is promised.
Protected `/api/operations/process` explicitly processes durable pending work.

## Manual and operational routes

- `POST /api/pacts/:id/verify`: requires a constant-time checked bearer token,
  exact trusted `Origin`, an idempotency key, and an empty body no larger than 1
  KiB.
- `POST /api/operations/process`: internal bearer token; processes at most ten
  pending operations per call.
- `POST /api/operations/recover`: internal bearer token; resets transitional
  operations stale for five minutes to `PENDING`.

No route accepts condition, evidence, hash, address, expiry, or signing fields.

## Arc read and finality model

The viem public client uses a 5-second default timeout and zero transport
retries. It reads runtime chain ID and the latest block, then pins every
contract read to that block number:

- `PactEvaluator.commerceContract()`;
- `PactEvaluator.jobKey(jobId)`;
- `PactEvaluator.getBinding(jobId)`;
- `PactEvaluator.isVerifierRevoked(binding.verifier)`;
- pinned ERC-8183 `getJob(jobId)`.

Arc documentation says blocks have deterministic finality, so no Ethereum-style
confirmation buffer or reorg rollback is added. Block number, then log index if
logs are later introduced, is the ordering key; timestamps are protocol time,
not an ordering key, because multiple sub-second blocks may share a timestamp.

Current official Connect to Arc documentation lists Mainnet chain ID `5042` and
`https://rpc.mainnet.arc.io`, while the current documentation index still says
testnet-only. Pact therefore supplies no silent network default: configured
chain ID and RPC must agree at runtime. No canonical ERC-8183 address is
invented.

## Immediate pre-sign checks

Signing requires canonical stored condition/job-key integrity, SATISFIED
evidence read back and recomputed inside its persistence transaction, matching
runtime/configured/stored chain ID, matching configured evaluator and commerce
target, matching onchain job key, existing unaccepted binding, exact condition
hash and deadline, signing key equal to the snapshotted verifier, unrevoked
verifier, nonzero job client, `Submitted` status, exact evaluator, chain time
at/after `verifiedAt` and before expiry, and a validity window still usable at
the observed block.

`Open` and `Funded` are retryable. Terminal jobs, mismatches, revocation,
acceptance, and expired/empty windows never sign.

## Crash recovery

Evidence and reconciliation are durably committed before their next stage. The
signed artifact and `READY_TO_RELAY` transition commit in one PostgreSQL
transaction. A crash after EOA signing but before commit leaves `SIGNING`; after
the five-minute stale threshold recovery returns it to `PENDING`. The operation
then re-runs GitHub and chain reads and prepares a fresh safe artifact.
Re-signing identical typed fields produces the same digest; a later observation
time deliberately produces a new digest backed by a new verification attempt. It
never reconstructs the Phase 3 verified brand from database data.

`READY_TO_RELAY` means only that a currently valid signed artifact was prepared.
It does not mean broadcast, submitted, settled, completed, or paid. Phase 4B
owns transaction intent, single dispatch, ambiguous send recovery, receipts,
events, and canonical financial outcome reconciliation.

## Phase 4A.1 live PostgreSQL gate

`npm run test:database-live` remains excluded from ordinary unit tests and runs
only with both `PACT_DATABASE_LIVE_TEST=1` and an explicit `DATABASE_URL`. The
target database name must contain `test`. Each execution creates uniquely named
child databases, applies the migrations in their normal `public` schema, and
drops only those child databases. It never truncates an existing schema or user
table.

Validated against PostgreSQL 17.11 on 2026-09-28:

- two fresh migration-from-zero runs with catalog validation;
- application startup with no implicit migration;
- semantic Pact identity, job-key, delivery, attestation-digest, active
  operation, and active-artifact uniqueness;
- 100 two-connection `PENDING → VERIFYING_GITHUB` CAS races;
- 100 two-connection `READY_TO_SIGN → SIGNING` CAS races;
- concurrent duplicate-webhook and webhook/manual triggers;
- repository and direct-constraint `READY_TO_RELAY` races;
- forced verification and artifact transaction rollbacks;
- stale/fresh transitional-state recovery and crash-before-artifact recovery;
- unavailable, terminated, aborted, and statement-timeout database failures.

The migration contains `public`-qualified foreign-key targets, so the live gate
uses disposable databases rather than alternate schemas. This mirrors the
supported deployment layout and avoids mutating the migration solely for test
convenience.
