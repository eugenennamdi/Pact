# Phase 6F-B frontend handoff

Gemini may freely improve page composition, layout, spacing, typography, visual
tokens, presentational components, responsive behavior, motion, loading
skeletons, empty states, copy and accessibility presentation.

Gemini must not change ABIs, API contracts, transaction construction, the
prepare/send/confirm sequence, auth challenge construction, session
verification, server authorization, persistence, workers, signer handling or the
certified kernel. Browser code must never construct transaction targets or
calldata and must never trigger Mainnet signing.

Stable integration surfaces:

- `WalletBoundary` / `useWallet` — EIP-6963 discovery, explicit connection, Arc
  Testnet guard and server authentication.
- `ProductApiClient` — same-origin public API client and safe error categories.
- `ActionController` — authoritative next-actor/next-action projection.
- `WalletActionPanel` — prepare, explicit confirmation, wallet send and
  canonical server confirmation.
- `PactDetail` — public polling, action history, evidence and settlement.
- `MainnetLiveConfirmation` — read-only proof enhancement; never a wallet flow.

The wallet lifecycle and actor ownership are frozen, in this exact order:

1. Client: `CREATE_JOB`
2. Client: `BIND_CONDITION`
3. Provider: `SET_BUDGET`
4. Client: `APPROVE_USDC`
5. Client: `FUND`
6. Provider: `SUBMIT`
7. Automatic: verification and settlement

There is no interactive `SET_PROVIDER` or `RECLAIM` action. Gemini must not add,
alias, reorder, or rename wallet actions, and must not expose a wallet
settlement CTA after `SUBMIT`.

Functional routes are `/`, `/create`, `/pacts/[slug]`, and
`/proof/arc-mainnet/job/1`.
