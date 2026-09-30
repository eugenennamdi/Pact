# Pact Arc deployment and controlled settlement runbook

Status: tooling implemented; live Testnet deployment blocked until operator
inputs are supplied. Mainnet is prohibited until the Testnet gate passes.

## Reviewed network and dependency constants

| Item                  | Arc Testnet                                  | Arc Mainnet                  |
| --------------------- | -------------------------------------------- | ---------------------------- |
| Chain ID              | `5042002`                                    | `5042`                       |
| RPC documented by Arc | `https://rpc.testnet.arc.io`                 | `https://rpc.mainnet.arc.io` |
| Explorer              | `https://explorer.testnet.arc.io`            | `https://explorer.arc.io`    |
| USDC ERC-20 interface | `0x3600000000000000000000000000000000000000` | same                         |
| USDC decimals         | 6                                            | 6                            |

The deployer does not infer a network, RPC, administrator, treasury, verifier,
or amount. Arc uses native USDC for gas with 18-decimal gas accounting while the
ERC-20 USDC interface uses six decimals. Operator E2E amounts are always
supplied as integer ERC-20 base units.

The deployed commerce contract is explicitly described as a **Pact-managed
pinned ERC-8183 deployment**, never as canonical Arc infrastructure. It uses
reference commit `142e669c1fd318486a4628395b629f033654dd06`, OpenZeppelin 5.6.1,
UUPS/ ERC-1967, zero platform and evaluator fees, only canonical Arc USDC
allowed, and no nonzero hook.

## Build and release checkpoint

Run the full repository gate, commit the resulting clean tree, then build the
exact artifacts:

```bash
npm ci
npm run lint
npm run typecheck
npm run test
npm run build
cd packages/contracts && forge test && forge build --force && cd ../..
git status --short
git rev-parse HEAD
```

The deployment command refuses a dirty worktree. Do not rebuild, amend, or
change dependencies between Testnet and Mainnet. Preserve the full commit ID,
artifacts, dependency locks, deployment journal, and manifest.

Before Testnet, run the full local composition against a freshly migrated,
disposable PostgreSQL database:

```bash
PACT_PHASE5_LOCAL_E2E=1 DATABASE_URL=postgresql://.../pact_phase5_local_test \
  npm run test:phase5-local
```

This gate deploys the real pinned ERC-8183 implementation/proxy and a
six-decimal local token, then executes the existing GitHub verification, Phase
4A signing orchestration, and Phase 4B relay. The GitHub client is a local
fixture in this gate only; a live Testnet or Mainnet result must use GitHub's
authoritative API.

## Operator separation and custody

Use distinct server-side identities for the deployer/ERC-8183 admin,
PactEvaluator admin, verifier signer, client, provider, and relay. A raw
deployment key is supported only as an explicit operator input; production
custody should replace it with an approved managed signer procedure. Never put
any of these values in `NEXT_PUBLIC_*` variables.

The ERC-8183 default admin can upgrade all escrow semantics. Its admin role can
pause, change fees/treasury, change allowlists, detach hooks, and withdraw
escrow while paused. These are material trusted controls. Phase 5 does not claim
immutability or decentralization.

## Deploy to Arc Testnet

Populate a local ignored environment file from `.env.example`. The confirmation
must match exactly:

```bash
PACT_DEPLOY_NETWORK=arc-testnet \
PACT_DEPLOY_CONFIRM='DEPLOY arc-testnet 5042002' \
npm run deploy:arc
```

The tool validates the RPC chain, canonical USDC code and decimals, clean Git
commit, exact Foundry artifacts, and explicit roles. Each signed transaction is
persisted before broadcast. Once a transaction enters `DISPATCHING`, an error or
timeout becomes `BROADCAST_UNKNOWN`; rerunning only reconciles its hash and
never blindly resends it. The output manifest uses exclusive creation and is
written only after receipts and runtime integrity checks pass.

After deployment, independently verify the manifest, proxy EIP-1967
implementation slot, runtime code hashes, roles, fees, pause state, allowlist,
PactEvaluator target/verifier/admin, and source publication in the explorer.
Mark source verification accurately; never label a pending or unavailable
verification as verified.

## Controlled Testnet E2E gate

Use a real GitHub repository and merged pull request. With separate
client/provider/relay identities:

After configuring the operator-only variables in a local ignored environment
file, run:

```bash
PACT_E2E_CONFIRM='RUN arc-testnet 5042002' npm run operator:e2e
```

`operator:e2e` validates the manifest and live bytecode/configuration before
writes, uses a secret external recovery journal for each exact signed
transaction, simulates each lifecycle call immediately before signing, reads
GitHub through the production client, and settles only through the persisted
Phase 4A → Phase 4B path. It refuses a verifier/relay collision, non-integer
amount, Mainnet amount over 0.10 USDC, release drift, or a state/journal path
inside the repository. On a complete Testnet pass it atomically adds the
version-bound `testnetGate` record to the existing manifest. The root
`gitCommit` (and gate `deploymentGitCommit`) identifies the source that produced
the deployed contracts; `e2eRuntimeCommit` separately identifies the corrected
backend/verifier code that ran the rehearsal.

Arc read-only RPC operations use a bounded 10-second production default and a
15-second controlled Testnet rehearsal bound, with a hard 30-second maximum and
zero hidden retries. Relay broadcasting retains its independent five-second
single-dispatch transport bound; a timeout after dispatch remains
`BROADCAST_UNKNOWN` and is reconciled rather than resent.

1. Create the ERC-8183 job with PactEvaluator as evaluator and a finite expiry.
   The controlled Testnet harness uses a two-hour completion deadline and a
   further four-hour settlement margin (six hours total, below 24 hours).
2. Bind the canonical `PR_MERGED` condition while the job is `Open`.
3. Provider sets a small six-decimal USDC budget; client explicitly approves and
   funds that exact token and amount.
4. Provider submits; Pact re-reads GitHub authoritative API state and canonical
   chain state.
5. The verifier signs only a positive, current result. Persist the evidence and
   exact signed attestation before relay.
6. Relay with the existing durable Phase 4B state machine; reconcile receipt and
   `PactCompletionAccepted`/ERC-8183 completion events.
7. Prove the gross canonical USDC funding and provider payout transfers equal
   the budget, the pinned job state is completed, escrow returns to baseline,
   and treasury/evaluator application transfers are zero. Record transaction gas
   separately in Arc's 18-decimal native accounting; six-decimal `balanceOf`
   deltas are diagnostics, not payout proof.

Only after all evidence, hashes, transaction IDs, event coordinates, and balance
snapshots are recorded may an operator add the manifest `testnetGate` PASS
object. A failed, unavailable, or incomplete check leaves the phase blocked.

## Mainnet gate

Mainnet is not a retry of Testnet. It requires explicit Tech Lead approval and a
Testnet PASS manifest whose E2E runtime commit, ERC-8183 source commit, and
PactEvaluator creation-artifact hash exactly match the Mainnet release. The
command enforces this identity. The controlled Mainnet E2E amount has a
non-configurable ceiling of `100000` base units (0.10 USDC); lowering it is
allowed, raising it requires a code review.

Both Mainnet commands also require a separate commit-bound acknowledgement:
`PACT_MAINNET_DEPLOY_APPROVAL='APPROVED <full-git-commit>'` for deployment and
`PACT_MAINNET_E2E_APPROVAL='APPROVED <full-git-commit>'` for the controlled
settlement. These inputs record the explicit go/no-go decision; they are not a
substitute for approved custody or review.

Stop on any chain mismatch, code-hash drift, implementation-slot drift,
role/configuration mismatch, ambiguous operator identity, insufficient gas,
unexpected fee, GitHub evidence mismatch, or unresolved transaction. Reconcile
from authoritative chain data; do not redeploy or resend to make an error
disappear.
