// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC8183} from "@erc8183/ERC8183.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PactEvaluator} from "../src/PactEvaluator.sol";
import {IPactERC8183} from "../src/interfaces/IPactERC8183.sol";
import {PactManagedERC8183Proxy} from "../src/deployment/PactManagedERC8183Proxy.sol";
import {MockArcUSDC} from "./fixtures/MockArcUSDC.sol";
import {TestBase} from "./TestBase.sol";

contract Phase5DeploymentTest is TestBase {
    uint256 private constant VERIFIER_KEY = 0xA11CE;
    uint256 private constant BUDGET = 1_000_000;
    uint48 private constant START_TIME = 1_000_000;
    address private constant CLIENT = address(0xC11E17);
    address private constant PROVIDER = address(0xBEEF);
    bytes32 private constant CONDITION_HASH = keccak256("PR_MERGED condition");
    bytes32 private constant EVIDENCE_HASH = keccak256("authoritative GitHub evidence");

    ERC8183 private commerce;
    PactEvaluator private evaluator;
    MockArcUSDC private usdc;
    address private verifier;

    function setUp() public {
        vm.warp(START_TIME);
        verifier = vm.addr(VERIFIER_KEY);
        usdc = new MockArcUSDC(CLIENT, BUDGET);

        ERC8183 implementation = new ERC8183();
        PactManagedERC8183Proxy proxy = new PactManagedERC8183Proxy(
            address(implementation),
            abi.encodeCall(ERC8183.initialize, (address(this), address(this)))
        );
        commerce = ERC8183(payable(address(proxy)));
        commerce.setPaymentTokenAllowed(address(usdc), true);
        evaluator = new PactEvaluator(address(commerce), verifier, address(this));
    }

    function testPinnedConfigurationIsExplicitAndLeastFeature() public view {
        assertTrue(commerce.hasRole(bytes32(0), address(this)));
        assertTrue(commerce.hasRole(commerce.ADMIN_ROLE(), address(this)));
        assertEq(commerce.platformTreasury(), address(this));
        assertEq(commerce.platformFeeBP(), 0);
        assertEq(commerce.evaluatorFeeBP(), 0);
        assertFalse(commerce.paused());
        assertTrue(commerce.allowedPaymentTokens(address(usdc)));
        assertTrue(commerce.whitelistedHooks(address(0)));
        assertEq(address(evaluator.commerceContract()), address(commerce));
        assertEq(evaluator.defaultVerifier(), verifier);
        assertEq(evaluator.admin(), address(this));
    }

    function testActualPinnedEscrowCompletesThroughPactWithExactAccounting() public {
        uint48 expiresAt = START_TIME + 2 hours;
        uint64 completionDeadline = uint64(block.timestamp + 1 hours);

        vm.prank(CLIENT);
        uint256 jobId = commerce.createJob(
            PROVIDER,
            address(evaluator),
            expiresAt,
            "merge the reviewed pull request",
            address(0),
            0
        );

        vm.prank(CLIENT);
        evaluator.bindCondition(jobId, CONDITION_HASH, completionDeadline, verifier);
        vm.prank(PROVIDER);
        commerce.setBudget(jobId, address(usdc), BUDGET, bytes(""));
        vm.prank(CLIENT);
        IERC20(address(usdc)).approve(address(commerce), BUDGET);
        vm.prank(CLIENT);
        commerce.fund(jobId, address(usdc), BUDGET, bytes(""));
        vm.prank(PROVIDER);
        commerce.submit(jobId, CONDITION_HASH, bytes(""));

        uint64 nowTimestamp = uint64(block.timestamp);
        PactEvaluator.PactCompletionAttestation memory attestation =
            PactEvaluator.PactCompletionAttestation({
                commerceContract: address(commerce),
                jobId: jobId,
                conditionHash: CONDITION_HASH,
                evidenceHash: EVIDENCE_HASH,
                satisfiedAt: nowTimestamp,
                verifiedAt: nowTimestamp,
                validUntil: nowTimestamp + 30 minutes
            });
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(VERIFIER_KEY, evaluator.hashAttestation(attestation));
        evaluator.completeWithAttestation(attestation, abi.encodePacked(r, s, v));

        IPactERC8183.Job memory job = evaluator.commerceContract().getJob(jobId);
        assertEq(uint256(job.status), uint256(IPactERC8183.JobStatus.Completed));
        assertEq(usdc.balanceOf(PROVIDER), BUDGET);
        assertEq(usdc.balanceOf(CLIENT), 0);
        assertEq(usdc.balanceOf(address(commerce)), 0);
        assertEq(usdc.balanceOf(address(evaluator)), 0);
        assertEq(usdc.balanceOf(address(this)), 0);
    }

    function testSubmittedExpiryPreservesGraceThenRefundsExactEscrow() public {
        uint48 expiresAt = START_TIME + 2 hours;
        vm.prank(CLIENT);
        uint256 jobId = commerce.createJob(
            PROVIDER, address(evaluator), expiresAt, "expiry rehearsal", address(0), 0
        );
        vm.prank(PROVIDER);
        commerce.setBudget(jobId, address(usdc), BUDGET, bytes(""));
        vm.prank(CLIENT);
        IERC20(address(usdc)).approve(address(commerce), BUDGET);
        vm.prank(CLIENT);
        commerce.fund(jobId, address(usdc), BUDGET, bytes(""));
        vm.prank(PROVIDER);
        commerce.submit(jobId, CONDITION_HASH, bytes(""));

        vm.warp(expiresAt);
        vm.expectRevert(ERC8183.GracePeriodActive.selector);
        commerce.claimRefund(jobId);
        vm.warp(uint256(expiresAt) + commerce.EVALUATION_GRACE_PERIOD());
        commerce.claimRefund(jobId);

        IPactERC8183.Job memory job = evaluator.commerceContract().getJob(jobId);
        assertEq(uint256(job.status), uint256(IPactERC8183.JobStatus.Expired));
        assertEq(usdc.balanceOf(CLIENT), BUDGET);
        assertEq(usdc.balanceOf(PROVIDER), 0);
        assertEq(usdc.balanceOf(address(commerce)), 0);
    }
}
