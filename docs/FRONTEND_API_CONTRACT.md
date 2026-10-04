# Pact frontend API contract

Phase 6F-A freezes the browser-facing contract below. All routes are same-origin
and under `/api/v1`. Mutations require a trusted browser Origin; authenticated
mutations also require the HttpOnly Pact session cookie.

## Authentication

- `POST /auth/challenge` — body `{ walletAddress }`; returns the exact canonical
  challenge message plus wallet, origin, chain, nonce and expiry metadata.
- `POST /auth/session` — body `{ message, signature }`; sets the HttpOnly
  session cookie and returns wallet, Arc Testnet chain ID and session lifetime.
- `DELETE /auth/session` — clears the server session.

The browser signs the server-returned message byte-for-byte. A connected wallet
is not equivalent to an authenticated session.

## Pacts

- `POST /pacts` — body `{ repository, pullRequest, provider, amount }`; returns
  the deterministic draft, condition hash, policy, deployment identity and next
  action.
- `GET /pacts/{slug}` — returns the public Pact DTO, wallet action history,
  public status, evidence summary and settlement summary.

The server owns network, event, base branch, condition normalization, deadlines,
evaluator and contract addresses.

## Allowlisted wallet actions

- `POST /pacts/{slug}/actions/{action}/prepare` — strict empty body.
- `POST /pacts/{slug}/actions/{action}/confirm` — body `{ transactionHash }`.

Allowed `action` values are `create-job`, `bind-condition`, `set-budget`,
`approve-usdc`, `fund`, and `submit`. Preparation returns the only transaction
the browser may request the wallet to send: `chainId`, `requiredSigner`, `to`,
`value`, and `data`, plus its human-readable summary and canonical transition.
Confirmation, not wallet submission, determines product success.

The public DTO and route values have a one-to-one mapping, in lifecycle order:

| Public DTO action | Route action     | Actor    |
| ----------------- | ---------------- | -------- |
| `CREATE_JOB`      | `create-job`     | Client   |
| `BIND_CONDITION`  | `bind-condition` | Client   |
| `SET_BUDGET`      | `set-budget`     | Provider |
| `APPROVE_USDC`    | `approve-usdc`   | Client   |
| `FUND`            | `fund`           | Client   |
| `SUBMIT`          | `submit`         | Provider |

`SET_PROVIDER`, `RECLAIM`, and arbitrary action strings are unsupported. After
`SUBMIT`, the public state advances to `AWAITING_CONDITION`; verification and
settlement are automatic and expose no wallet action.

## Automation and public proof

- `POST /pacts/{slug}/retry` — strict empty body; wakes verification only.
- `GET /pacts/{slug}/evidence` — canonical public evidence/attestation summary.
- `GET /pacts/{slug}/settlement` — canonical public transaction, receipt, event,
  job, binding and economic summary.

The compile-time browser contract is `packages/product/src/public-contract.ts`.
It exports types only and must remain free of server runtime imports at
execution time.
