# Pact

Pact turns objectively verifiable outcomes into ERC-8183 settlement decisions.

Pact lets developers bind an objective software outcome to an ERC-8183 job and
release escrow only after the configured condition is independently verified.
The current MVP proves one deliberately narrow condition: a GitHub pull request
merged into its expected base branch.

> Lock USDC against an outcome. Prove the outcome happened. Settle through
> ERC-8183.

## Why Pact

ERC-8183 defines the commerce lifecycle: client, provider, job, budget, escrow,
submission, completion, rejection, expiry, payout, and refund. Pact supplies the
missing objective-verification layer: immutable condition commitments,
authoritative external-state verification, canonical evidence, signed verifier
attestations, and deterministic evaluation.

Pact is not a second escrow. ERC-8183 remains the canonical financial state.

## How it works

1. The client creates an ERC-8183 job with `PactEvaluator` as evaluator.
2. The client binds an immutable Pact condition while the job is open.
3. The provider sets the budget and the client funds USDC escrow.
4. The provider submits the condition commitment as the deliverable.
5. Pact independently verifies the external condition.
6. Pact produces canonical evidence and an EIP-712 verifier attestation.
7. `PactEvaluator` validates the binding, evidence, signer, deadlines, and job.
8. ERC-8183 completes the job and releases USDC to the provider.

## Current condition

The MVP supports GitHub `PR_MERGED`: one repository, pull request, target base
branch, and merge event are committed before funding. The intentionally narrow
scope keeps verification deterministic and auditable.

## Live Mainnet proof

**[Open the production Proof Center](https://pact-web-production-ea97.up.railway.app/proof)**

Arc Mainnet Job #2 is a real completed settlement of **0.01 USDC** for
`eugenennamdi/pact-arc-demo#7`. The Proof Center renders its immutable
condition, evidence, attestation, recovery lineage, and single settlement
broadcast without requiring a wallet, RPC, database, or secret at runtime.

- [Mainnet Job #2 proof](https://pact-web-production-ea97.up.railway.app/proof/arc-mainnet/job/2)
- [Settlement transaction](https://explorer.arc.io/tx/0x48310ebfa80301d5f48e6ac61be74cbaaf37f9eff141e82885fd20a5a9d166aa)
- [Canonical technical record](docs/PHASE8_MAINNET_JOB2_PROOF.md)
- [Demo script](docs/DEMO_SCRIPT.md)
- [Submission fact sheet](docs/SUBMISSION_FACTS.md)

## Architecture

- **Web/API** prepares wallet-reviewed lifecycle actions and exposes public Pact
  projections.
- **Verifier** re-reads authoritative GitHub state and signs only positive,
  canonical evidence.
- **Relay** broadcasts a valid attestation without holding verification or
  financial authority.
- **PactEvaluator** enforces the immutable binding and completes the exact
  ERC-8183 job.
- **ERC-8183** owns escrow, lifecycle, payout, refund, and canonical financial
  state.

See [Production architecture](docs/ARCHITECTURE.md) and
[Security model](docs/SECURITY_MODEL.md).

## Safety model

- Deterministic condition, evidence, job, and attestation commitments
- Separate verifier and relay capabilities
- One-broadcast relay semantics with durable nonce ownership
- Receipt, event, nonce, and onchain reconciliation instead of blind resend
- Immutable public proof artifacts
- Fail-closed certified-kernel and release-provenance gates

## Repository

Requires Node.js 22 or newer.

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run kernel:verify
```

Start with [Production architecture](docs/ARCHITECTURE.md), then use the focused
documents in [`docs/`](docs/) for verification, deployment, security, and proof
details.
