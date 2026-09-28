# GitHub `PR_MERGED` verification contract

Status: Phase 3 completed. Phase 4A composes this factual verification primitive
behind durable webhook/orchestration and chain reconciliation; it remains
separate from transaction relay.

## Trust model and API contract

GitHub is the factual source for the public-repository MVP. A caller, provider,
database row, webhook, and raw `merge_commit_sha` are not proof. A successful
attempt independently performs, in order:

1. canonicalize the existing Phase 0 condition and recompute `conditionHash`;
2. `GET /repos/{owner}/{repo}/pulls/{pull_number}`;
3. validate the returned PR number, base repository `full_name`, exact
   case-sensitive base `ref`, public visibility, state, merge timestamp, and
   merge SHA subset;
4. `GET /repos/{owner}/{repo}/pulls/{pull_number}/merge`;
5. reconcile the two observations, time boundaries, and evidence fields;
6. construct canonical evidence only for coherent positive observations.

The fixed origin is `https://api.github.com`; it is not environment
configurable. Requests use native `fetch`, `redirect: manual`, a 5-second
default timeout, a 256-KiB response limit, no automatic retry, and:

```text
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2026-03-10
User-Agent: Pact-Verifier/0.0.0
Authorization: Bearer <GITHUB_TOKEN>  # only when configured server-side
```

Unauthenticated public reads are supported. Redirects are `INDETERMINATE` and
never rewrite the committed repository. Private repositories are outside V1.

## Merge and failure semantics

The primary PR read must first succeed for the exact public PR. Only then is a
merge-endpoint `404` interpreted as unmerged; a primary `404` is ambiguous and
`INDETERMINATE`. A positive result requires merge endpoint `204`, metadata
`merged == true`, state `closed`, and non-null valid `merged_at` and full 40-hex
`merge_commit_sha`. Disagreement is `INDETERMINATE`.

`merge_commit_sha` before merge may be a temporary mergeability commit, so Pact
ignores it until the dedicated endpoint confirms merge. Merge, squash, and
rebase strategies all qualify; the SHA GitHub reports after merge is recorded.

| Observation                                                      | Result                     |
| ---------------------------------------------------------------- | -------------------------- |
| unmerged and `observedAt < completionDeadline`                   | `NOT_SATISFIED`, retryable |
| unmerged at/after deadline                                       | `NOT_SATISFIED`, terminal  |
| wrong base branch while unmerged and before deadline             | `NOT_SATISFIED`, retryable |
| wrong base branch after merge or deadline                        | `NOT_SATISFIED`, terminal  |
| merged after deadline                                            | `NOT_SATISFIED`, terminal  |
| timeout/network/429/5xx                                          | `INDETERMINATE`, retryable |
| redirect, malformed/oversized 200, ambiguous 401/403/primary 404 | `INDETERMINATE`            |
| conflicting merge observations or future source timestamp        | `INDETERMINATE`            |

Rate-limit metadata (`retry-after`, `x-ratelimit-remaining`, and
`x-ratelimit-reset`) is exposed for Phase 4 scheduling but cannot change the
factual decision. One call is one attempt.

## Clock, evidence, and signer boundary

`observedAt` is an injected positive integer Unix timestamp in seconds.
`mergedAt > observedAt` is clock inconsistency. A merge exactly at
`completionDeadline` qualifies; after it does not. Evidence normalization and
hashing are specified by `GITHUB_EVIDENCE_V1_VECTOR.md`.

Only the successful verifier creates a `VerifiedGitHubCompletion`. A module
private `WeakSet` plus recomputed condition/evidence hashes protects the runtime
boundary; TypeScript branding is only an additional misuse guard. The signer has
no arbitrary-digest or arbitrary-typed-data method. It derives factual
attestation fields from the verified object and accepts only settlement context
(`chainId`, evaluator address, commerce address, job ID, ERC-8183 expiry) from
the caller. Phase 4A now independently reads and reconciles that settlement
context before invoking it.

The default attestation TTL is 300 seconds, configurable from 30 through 900
seconds. `validUntil = min(verifiedAt + TTL, erc8183ExpiredAt - 1)`. An empty
window fails closed. The local raw-key implementation is server-only; a managed
signer/HSM remains a production deployment decision.

## Phase 4A webhook boundary

Phase 3 itself exposes no webhook route. Phase 4A composes it behind a webhook
used only as a trigger for the independent reads above. The route preserves the
original bounded raw body, verifies `X-Hub-Signature-256` using HMAC-SHA256 and
constant-time comparison, filters exact `X-GitHub-Event` and action values,
records `X-GitHub-Delivery`, and deduplicates redeliveries. SHA-1 is not used.
No webhook field directly constructs signable evidence.

## Known limitations

- Public GitHub.com repositories only; no GitHub Enterprise, OAuth, or private
  installation flow.
- Repository identity is canonical lowercase `owner/name`; rename/transfer
  redirects fail closed. Numeric repository IDs are not part of schema V1.
- Evidence requires GitHub.com's current full 40-hex commit SHA representation.
- GitHub availability and integrity and the centralized Pact verifier remain
  trusted.
- Phase 3 remains a pure verification/signing package. Phase 4A supplies
  persistence, service endpoints, and ERC-8183 reconciliation, but still does
  not relay a transaction.
