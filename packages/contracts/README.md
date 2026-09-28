# Contracts package

Phase 2 implements positive EIP-712 completion authorization in the
non-upgradeable `PactEvaluator`, against the exact local compatibility interface
for ERC-8183 reference commit `142e669c1fd318486a4628395b629f033654dd06`.

## Locked toolchain

- Foundry: `v1.8.3`, commit `cae51ad458f6abb64852b7709eb784352429825d`
- Solidity: exact `0.8.28`
- EVM target: `cancun`
- Optimizer: enabled, 200 runs
- Fuzz runs: 1,024 per property
- Solidity dependency: OpenZeppelin Contracts `v5.6.1`, commit
  `5fd1781b1454fd1ef8e722282f86f9293cacf256` (ECDSA and EIP712 only)

`FOUNDRY_VERSION` is the repository lock record. Install the matching official
release with `foundryup --install v1.8.3`. Compiler and EVM settings are locked
in `foundry.toml`.

## Contract boundary

`src/interfaces/IPactERC8183.sol` reproduces the pinned implementation's exact
status ordinals and `Job` tuple:

```text
client address
status uint8 enum
provider address
expiredAt uint48
evaluator address
submittedAt uint48
budget uint256
hook address
paymentToken address
providerAgentId uint256
description string
settledAmount uint256
payoutReceiver address
```

`getJob(uint256)` is used for binding and settlement pre/postconditions.
`complete(uint256,bytes32,bytes)` is called only after a valid positive
attestation, with the signed `evidenceHash` passed unchanged as `reason`. Tests
lock both selectors, all status ordinals, tuple encoding, fixture behavior, and
the published TypeScript/Solidity vectors.

`PactEvaluator` stores one immutable commerce address, one immutable admin, the
default verifier for future bindings, irreversible verifier revocations,
immutable condition bindings with an acceptance bit, and used attestation
digests. It has no payable function, token operation, financial-state mirror,
reject/refund path, arbitrary external call, or payout calculation.

GitHub's proposed `deliverable = conditionHash` convention is not a generic
contract invariant. Submission reconciliation remains Phase 3 orchestration
work.

Settlement is permissionlessly relayed through
`completeWithAttestation(attestation, signature)`. Authority comes exclusively
from an unrevoked EOA signature by the verifier snapshotted when the condition
was bound. The EIP-712 domain is `Pact` version `2`, runtime chain ID, and the
exact evaluator address. The positive-only primary type and fixed vector are
published in `docs/ATTESTATION_V2_VECTOR.md`.

Pact accepts `satisfiedAt <= completionDeadline`,
`satisfiedAt <= verifiedAt <= block.timestamp <= validUntil`, and strictly
requires both `validUntil < job.expiredAt` and
`block.timestamp < job.expiredAt`. Future factual/verification timestamps are
rejected; no clock tolerance is added.

Checks and signer validation precede effects. The digest-used flag and binding
acceptance bit are written before the external ERC-8183 call. A same-binding
callback therefore fails without a global reentrancy guard. Any downstream
revert atomically restores both flags; a successful call is followed by an
explicit `Completed` status check. Success emits `PactCompletionAccepted` with
job, condition, evidence, digest, verifier, and relayer.

## Commands

```bash
forge fmt --check
forge build
forge test -vv
```

Nothing in this package is deployed by Phase 2.
