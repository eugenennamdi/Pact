# ERC-8183 compatibility record

Status: Phase 5 revalidated research record Observed: 2026-09-29 Policy: every
production review must re-check these sources; a moving branch is never a
compatibility target.

## Source ledger

### Normative draft

- Specification:
  [ERC-8183: Agentic Commerce](https://eips.ethereum.org/EIPS/eip-8183)
- Status: **Draft**, Standards Track ERC; created 2026-02-25.
- Source repository: `ethereum/ERCs`, `ERCS/erc-8183.md`.
- Exact reviewed revision:
  [`a078cab5cc8e9581c15f76c091ed96eed28f02f7`](https://github.com/ethereum/ERCs/commit/a078cab5cc8e9581c15f76c091ed96eed28f02f7),
  committed 2026-03-13.

This revision defines
`Open -> Funded -> Submitted -> Completed | Rejected | Expired`,
client/provider/evaluator roles, ERC-20 escrow, provider submission, evaluator
completion/rejection, expiry refund, an optional `bytes32` reason, and optional
hooks. An evaluator may be a contract.

Draft status is a material compatibility risk. `ERC-8183` is a semantic label,
not a stable ABI identifier.

### Reference implementation candidate

- Repository:
  [`erc-8183/base-contracts`](https://github.com/erc-8183/base-contracts)
- Exact reviewed commit:
  [`142e669c1fd318486a4628395b629f033654dd06`](https://github.com/erc-8183/base-contracts/commit/142e669c1fd318486a4628395b629f033654dd06),
  committed 2026-06-30.
- No GitHub tags or releases were published when checked.
- Toolchain at that commit: Solidity 0.8.28, Cancun EVM, OpenZeppelin 5.6.1,
  forge-std 1.16.1.

This commit was a candidate implementation baseline in Phase 0.5. Phase 5
vendors its exact reviewed source for a Pact-managed deployment, but no live
deployment is approved or claimed. It is UUPS-upgradeable and exposes materially
more surface than Pact needs: hooks, token allowlisting, fees, payout receivers,
partial claims, meta-transaction extensions, pausing, and admin emergency
withdrawal. Its privileged and upgrade surfaces must be reviewed before any
deployment. Pinning a commit does not make that code safe.

### Arc sources

- [Arc Mainnet launch announcement](https://www.circle.com/pressroom/circle-launches-arc-mainnet-an-economic-operating-system-for-the-internet),
  dated 2026-09-16.
- [Connect to Arc](https://docs.arc.io/arc/references/connect-to-arc.md).
- [Arc contract addresses](https://docs.arc.io/arc/references/contract-addresses.md).
- [Create an ERC-8183 job](https://docs.arc.io/arc/tutorials/create-your-first-erc-8183-job.md).
- [Arc ERC-8183 article](https://www.arc.io/blog/running-an-agentic-economic-flow-on-arc-with-erc-8183),
  dated 2026-04-07.
- [Arc documentation index](https://docs.arc.io/llms.txt).

Verified Arc Mainnet configuration is recorded in `ARCHITECTURE.md`. The Arc
ERC-8183 tutorial and article are explicitly testnet material and name testnet
deployment `0x0747EEf0706327138c69792bF28Cd525089e4583`. That address is not a
Mainnet configuration value and Pact must never promote it as one.

## Source conflicts

The reviewed sources do not present one stable interface:

1. The official draft revision describes a smaller core and embeds an earlier
   reference implementation.
2. `base-contracts` commit `142e...` adds per-job payment tokens, provider-only
   budget setting, provider agent IDs, payout receivers, evaluator fees, claims,
   an evaluation grace period, and authorization extensions.
3. Arc's testnet tutorial uses an older five-argument `createJob`,
   `setBudget(uint256,uint256,bytes)`, and `fund(uint256,bytes)` ABI. Those do
   not match `base-contracts` commit `142e...`, whose corresponding calls
   include `providerAgentId`, a payment-token address, and expected
   token/budget.
4. Circle's 2026-09-16 announcement and Arc's connection/address pages say
   Mainnet is live, while the current Arc `llms.txt` instruction still says Arc
   is testnet-only. The latter appears stale but remains an official-source
   inconsistency.

These conflicts prohibit using `main`, copying an example ABI, or treating an
old testnet address as production-compatible.

## Arc Mainnet ERC-8183 deployment classification

**Classification C — available official sources are insufficient or
contradictory.**

Arc Mainnet is verified as launched, but no official canonical ERC-8183 Arc
Mainnet deployment was verified. The official Arc contract-address registry does
not list ERC-8183, and official ERC-8183 instructions identify only a testnet
deployment. Absence from a list is not proof that no deployment exists, so Phase
0.5 does not assert category B.

Operationally, category C is treated like “no usable canonical deployment”:
`ERC8183_COMMERCE_CONTRACT_ADDRESS` stays blank and financial actions remain
disabled.

Future behavior by classification:

- **A — official deployment documented:** verify chain, address, runtime/proxy
  implementation, exact ABI, admin/upgrade state, payment-token configuration,
  fees, and source verification before adopting it.
- **B — no canonical deployment:** deploy an exact, audited, pinned ERC-8183
  reference implementation rather than inventing Pact escrow semantics.
- **C — insufficient/contradictory:** obtain authoritative confirmation. Until
  then, plan for a Pact-managed pinned reference deployment but do not deploy or
  publish an address.

## Pact compatibility target

Pact implements the exact tuple layout of reference commit `142e...` behind the
deliberately small local `IPactERC8183` interface. The compatibility boundary
exposes only:

```solidity
function getJob(uint256 jobId) external view returns (Job memory);

function complete(
    uint256 jobId,
    bytes32 reason,
    bytes calldata optParams
) external;
```

At binding, PactEvaluator calls `getJob` and reads `client`, `status`,
`expiredAt`, and `evaluator`. At settlement it re-reads those canonical fields,
calls the pinned `complete` selector with the signed evidence hash as `reason`,
then verifies the job reached `Completed`. Pact does not use hooks, claims,
rejection, fees, payout receivers, ERC-8004 identifiers, or ERC-2771.

Compatibility tests lock:

- `getJob(uint256)` selector `0xbf22c457`;
- `complete(uint256,bytes32,bytes)` selector `0xd75bbdf3`;
- status ordinals `Open=0` through `Expired=5`;
- the complete 13-field tuple through encoding vector
  `0x1a6ad581720777244fd47c2eaf8fe36ba06b5119fc70ee494b0b318c383d6000`;
- round-trip decoding through the exact local fixture.

Because `getJob` returns an implementation-specific struct, its ABI is pinned to
the reviewed commit. A deployment with another tuple, selector, status ordinal,
proxy implementation, or lifecycle semantic requires a new reviewed adapter or
PactEvaluator version. Duck typing by function name is forbidden.

## Version and deployment policy

Phase 1 compiled with Foundry `v1.8.3` commit
`cae51ad458f6abb64852b7709eb784352429825d`, Solidity `0.8.28`, Cancun EVM, and
optimizer 200. Pact pins OpenZeppelin Contracts `v5.6.1` for EIP-712, ECDSA, and
ownership primitives in `packages/contracts/SOLIDITY_DEPENDENCIES.lock`.

Compatibility policy:

1. Vendor or lock the minimal interface and test fixture to full commit
   `142e...`; record source hashes and selectors.
2. Never depend on a Git branch, floating package range, article ABI, or EIP
   number alone.
3. Test the interface against the exact pinned reference bytecode/fixture.
4. Treat any normative draft or implementation change as a compatibility
   proposal requiring diff, threat review, new tests, and a new
   adapter/evaluator version. Existing jobs retain their old semantics.
5. Bind each PactEvaluator deployment to one immutable commerce contract. Do not
   silently change its target.
6. At deployment review, verify proxy implementation and admin roles. An
   upgradeable commerce proxy can change escrow semantics after Pact binds jobs;
   this is an explicit trust boundary. Prefer an immutable/frozen deployment if
   safely achievable from the reviewed implementation.
7. Publish chain ID, commerce address, implementation commit, runtime/proxy code
   hashes, ABI hash, payment token, fees, grace behavior, and admin state in a
   versioned deployment manifest.

If Pact deploys the reference implementation itself, that does not make it a
canonical Arc deployment. Product copy must call it a Pact-managed pinned
ERC-8183 deployment.

## Phase 5 revalidation

On 2026-09-29, the current `erc-8183/base-contracts` default branch still
resolved to exact commit `142e669c1fd318486a4628395b629f033654dd06`. The current
official EIP markdown was byte-for-byte identical to reviewed revision
`a078cab5cc8e9581c15f76c091ed96eed28f02f7` (SHA-256
`257c35bbaecab58d0c36823fe8fb2d0fffc83d6f1fd7301d97674707784efa3a`). This
absence of observed upstream drift does not remove Draft status or make a moving
branch an acceptable pin.

The pinned reference source is vendored under
`packages/contracts/lib/erc8183-base-contracts` and is compiled unchanged. Its
reviewed implementation source SHA-256 is
`c5db4bcdc89dce6cc53629a19fcbcb73e973bc07f83b07a730aa4712bdedb1e4`. Phase 5 also
vendors the exact minimal OpenZeppelin Contracts Upgradeable 5.6.1 files
required to build it. `Phase5Deployment.t.sol` executes the real pinned escrow
lifecycle behind the same ERC-1967/UUPS proxy used by deployment tooling and
proves zero-fee settlement through PactEvaluator.

The security review confirms that `DEFAULT_ADMIN_ROLE` authorizes arbitrary UUPS
upgrades and `ADMIN_ROLE` authorizes pause/unpause, fee and treasury changes,
payment-token and hook allowlists, hook detachment, and emergency withdrawal of
escrow while paused. Phase 5 therefore records both roles, treasury,
implementation slot, runtime code hashes, fee values, pause state, canonical
USDC allowlisting, and zero-hook policy. These checks detect drift; they do not
eliminate privileged operator trust.
