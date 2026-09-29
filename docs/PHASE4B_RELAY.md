# Phase 4B relay and reconciliation

Status: implemented and verified locally; pending Tech Lead review. No Arc
transaction has been sent.

## Authority boundary

ERC-8183 remains the only authority for job escrow and financial state.
`PactEvaluator` remains the only evaluator used by Pact. The verifier key signs
positive evidence; a different, dedicated relay EOA only pays gas and submits
the already-bound attestation. Database records are operational evidence, never
canonical settlement state.

`PACT_RELAY_PRIVATE_KEY` is server-only and startup rejects equality with the
verifier address. The relay is configured for exactly one chain, commerce
contract, and evaluator. Browser code receives none of the key material.

## Durable states

`PREPARING -> SIGNED -> DISPATCHING` is the one-way pre-broadcast path.
`SUBMITTED` means the node returned the locally derived hash; it does not mean
settled. Any send exception or recovered `DISPATCHING` becomes
`BROADCAST_UNKNOWN`. Canonical reads may then produce `SETTLED`,
`SETTLED_EXTERNALLY`, `COMPLETED_BY_DIFFERENT_ATTESTATION`, `REVERTED`, or
`INTEGRITY_FAILURE`.

Pre-dispatch terminal states are `EXPIRED_UNSENT`, `PRECONDITION_FAILED`,
`INSUFFICIENT_RELAY_GAS`, and `NONCE_DRIFT`. They consume no broadcast attempt.
The signed identity columns are immutable after they are first persisted.

## Nonce and dispatch invariants

Nonce reservation runs inside a PostgreSQL transaction holding an advisory lock
for `(chainId, relayAddress)`. A partial unique index independently enforces one
unresolved intent per sender, and another prevents duplicate active nonce use.
The first use establishes the observed chain nonce baseline. Thereafter:

- `pending` must equal `latest`;
- `latest` must equal the highest Pact-dispatched nonce plus one;
- only one intent may own that nonce;
- drift records `NONCE_DRIFT` and sends nothing.

The service re-reads job, binding, deadline, expiry, and accepted state before
signing and again before dispatch. It simulates the exact call from the relay,
estimates a bounded gas margin, checks balance, prepares only the allowed
transaction fields, signs locally, and verifies the resulting sender, target,
value, calldata, chain, and nonce. Serialized bytes and the locally derived hash
are stored before a CAS changes `SIGNED` to `DISPATCHING`.

Only the CAS winner invokes `eth_sendRawTransaction`, exactly once. Errors are
not parsed into retry permission: timeout, connection failure, `already known`,
and `nonce too low` are all ambiguous. Phase 4B has no automatic rebroadcast,
replacement, fee bump, nonce repair, or network switching.

## Canonical reconciliation

Reconciliation is read-only. It searches from the durable READY chain block and
orders events by block number and log index. A normal settlement requires all of
the following to agree:

- the expected transaction has a successful canonical receipt;
- its exact `PactCompletionAccepted` event matches job, condition, evidence,
  attestation digest, verifier, and relay;
- the binding is accepted;
- ERC-8183 reports `Completed` with the configured evaluator.

A successful receipt without those postconditions is an integrity failure. A
reverted expected receipt is `REVERTED` unless a separate canonical completion
proves that another relayer won the race. Exact external completion is
`SETTLED_EXTERNALLY`; an accepted different digest is
`COMPLETED_BY_DIFFERENT_ATTESTATION`.

Arc documents deterministic finality, so Phase 5 must revalidate that deployment
assumption and the exact provider behavior before any approved Arc write. Phase
4B nevertheless stores receipt/event block hashes and refuses to infer success
from submission or nonce movement alone.

## Protected API and operation

`POST /api/relay/process` and `POST /api/relay/reconcile` require the existing
internal authorization header and an empty JSON body. `process` handles at most
one durable unit; `reconcile` performs no send. Callers cannot provide calldata,
nonce, fee, target, evidence, or transaction bytes.

After a process crash:

- `PREPARING` resumes simulation and signing;
- `SIGNED` rechecks chain state and may claim its existing exact bytes;
- `DISPATCHING` recovers only to `BROADCAST_UNKNOWN` and read reconciliation;
- `SUBMITTED` and `BROADCAST_UNKNOWN` remain read-only reconciliation work.

If `BROADCAST_UNKNOWN` remains unresolved, keep the sender blocked and inspect
the expected hash, sender/nonce, receipts, Pact events, binding, and ERC-8183
state. Do not manually resend the raw bytes or reuse the relay account until the
canonical outcome and nonce history are understood.

## Local verification

The opt-in PostgreSQL gate validates schema, constraints, rollback, 100-way
claim races, signed-byte immutability, and dispatch recovery. The opt-in Anvil
gate signs and broadcasts actual raw transactions and covers normal settlement,
response loss after acceptance, failure before forwarding, returned-hash
mismatch, reverted receipt, external completion, a concurrent external race, and
an outside relay transaction causing nonce drift. These gates use only
test-named databases and local chains.
