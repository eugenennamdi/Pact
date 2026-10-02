# Phase 5A Arc Testnet rehearsal record

This record preserves the three controlled Arc Testnet rehearsals without
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

## Job 3 — corrected staged-runtime certification

The corrective certification used public repository
`eugenennamdi/pact-arc-demo`, PR `#3`, branch `demo/pact-condition-3`, and base
branch `main`. Pact observed the open PR as
`NOT_SATISFIED_RETRYABLE / PULL_REQUEST_NOT_MERGED`. A resume at the durable
`AWAITING_CONDITION` checkpoint produced zero database or financial writes and
left the job canonically `Submitted`. The PR was merged only after that proof;
its merge commit was `44b45357b864f2448397777efa2af759a190c454` at
`2026-10-01T18:36:37Z`.

Job `3` used budget `1000`, condition hash
`0x652413b1b76d227bd9270b4dad75e54a183005b4881b9061abadacce1adb5300`, completion
deadline `1790886591`, and expiry `1790900991`. These deadlines are exactly 7200
and 21600 seconds after the authoritative creation-chain timestamp `1790879391`.
Production verification generated evidence hash
`0x77aa6c15f1681dd2ed764893973396e85cb3828fa8e58d337a0110d427738eef` and
attestation digest
`0x73402c17d9dafba119e57a22d9f7c49b8d12481431845364386d2ecee12be9db`.

The relay broadcast exactly one transaction,
`0x6c7c876d7b68d6f79374d70fc6299c7f76829d49bbe233c3a8350b5773c38235`. The
canonical receipt is in block `64989743`, block hash
`0x071adb13abf64f501be0d939224740283047458e4223abb29ed15daa27aa9653`,
transaction index `5`. `PactCompletionAccepted` is log index `22` and
`JobCompleted` is log index `26`. A temporary RPC read-order skew exposed the
canonical event and completed post-state before the receipt read succeeded. The
corrected runtime reclassified that exact legacy failure signature as retryable
and reconciled the already-mined transaction; it did not sign or broadcast a
second transaction.

Final canonical state was job status `Completed`, binding `accepted = true`,
gross funding and provider payout `1000`, treasury and evaluator application
transfers `0`, and escrow `0`. `JobCompleted.reason` exactly equals the evidence
hash. The runtime certified by this rehearsal is Git commit
`fa20328df6643b0d85f6c2b6074d79dd0e5de54c`.
