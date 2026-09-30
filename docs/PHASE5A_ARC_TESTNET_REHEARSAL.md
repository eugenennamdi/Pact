# Phase 5A Arc Testnet rehearsal record

This record preserves the two controlled Arc Testnet rehearsals without
rewriting deployment history. The deployed contracts remain attributable to Git
commit `5e9214f996ef48bc465ca2ee6a4f8e30d782a362` and pinned ERC-8183 source
commit `142e669c1fd318486a4628395b629f033654dd06`.

## Job 1 — failed rehearsal and cleanup

Job `1` was the failed first rehearsal associated with GitHub PR `#1`. It was
left `Submitted`, with budget `1000`, `settledAmount = 0`, an unaccepted Pact
binding, and `1000` held in escrow. Its `expiredAt` was `1790719774`.

After the pinned ERC-8183 evaluation grace period had elapsed, the client used
the exact pinned `claimRefund(1)` path. The one cleanup transaction was
`0x793cb0dc26c24c0119482481906c16209c2fc6b2717273acd424f919b08bb61c` at block
`64822551`. It returned the gross unsettled `1000` to the client, consumed
`78920` gas at `25000000000`, and left job `1` `Expired`, `settledAmount = 0`,
binding `accepted = false`, and escrow `0`.

## Job 2 — fresh successful rehearsal

The fresh condition used public repository `eugenennamdi/pact-arc-demo`, PR
`#2`, and base branch `main`. Pact first observed the open PR as
`NOT_SATISFIED_RETRYABLE / PULL_REQUEST_NOT_MERGED`, with no evidence,
attestation, or relay intent. The PR was merged only after job `2` was
canonically `Submitted` and funded with `1000` base units.

The merged PR commit was `0697674a4dcdf47360ce1de469903284bafee616`. Production
verification generated condition hash
`0x8fd8bbc6d7a269a730a7ffd88177763edff507206d54fac939c11f5d8a144f60` and
evidence hash
`0xc626568af1aaa8c1d3a2bdaa0ffc04db05f274e7519a182f469774481aaa407f`. The signed
attestation digest was
`0x8a115f4790006029c92215d32ebf6d6ee6e396221cb64b81be694b88257d6b69`.

The relay broadcast exactly one transaction,
`0xb0524bb47bebf540f05bf4c4c04d35cd91e73004632dec22b7fd5b15ebecde10`. An Arc RPC
read-skew briefly exposed the successful receipt before a concurrent
latest-state/log read had reached the receipt block. The durable intent was
reconciled by reads only after anchoring state and logs to the receipt block; it
was never rebroadcast. The canonical `PactCompletionAccepted` event is at block
`64825394`, log index `0`.

Final canonical state was job status `Completed`, binding `accepted = true`,
gross provider payout `1000`, treasury and evaluator application transfers `0`,
and escrow `0`. The ERC-8183 completion reason exactly matched the Pact evidence
hash. The runtime that completed and accounted for the rehearsal was Git commit
`f8c7c6240f0655e86cdd156bcd4f8792ab672549`.

The public Arc explorer reports the EIP-1967 proxy source as `VERIFIED`. Source
metadata for the implementation and PactEvaluator remains `UNAVAILABLE`; runtime
code hashes in the deployment manifest remain authoritative.
