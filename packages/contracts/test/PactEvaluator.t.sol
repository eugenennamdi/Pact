// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PactEvaluator} from "../src/PactEvaluator.sol";
import {IPactERC8183} from "../src/interfaces/IPactERC8183.sol";
import {MalformedERC8183, MockERC8183} from "./fixtures/MockERC8183.sol";
import {TestBase} from "./TestBase.sol";

contract PactEvaluatorTest is TestBase {
    event ConditionBound(
        bytes32 indexed jobKey,
        uint256 indexed jobId,
        bytes32 indexed conditionHash,
        uint64 completionDeadline,
        address verifier
    );
    event DefaultVerifierChanged(address indexed previousVerifier, address indexed newVerifier);
    event VerifierRevoked(address indexed verifier);

    uint256 internal constant JOB_ID = 81;
    uint256 internal constant NOW = 1_000_000;
    uint48 internal constant EXPIRES_AT = 1_100_000;
    uint64 internal constant DEADLINE = 1_050_000;
    bytes32 internal constant CONDITION_HASH = keccak256("condition");

    address internal constant CLIENT = address(0xC11E17);
    address internal constant PROVIDER = address(0xBEEF);
    address internal constant VERIFIER_A = address(0xA11CE);
    address internal constant VERIFIER_B = address(0xB0B);
    address internal constant ATTACKER = address(0xBAD);
    address internal constant OTHER_CLIENT = address(0xCAFE);

    MockERC8183 internal commerce;
    PactEvaluator internal evaluator;

    function setUp() public {
        vm.warp(NOW);
        commerce = new MockERC8183();
        evaluator = new PactEvaluator(address(commerce), VERIFIER_A, address(this));
        _setJob(JOB_ID, CLIENT, IPactERC8183.JobStatus.Open, address(evaluator), EXPIRES_AT);
    }

    function testConstructorStoresImmutableConfiguration() public view {
        assertEq(address(evaluator.commerceContract()), address(commerce));
        assertEq(evaluator.defaultVerifier(), VERIFIER_A);
        assertEq(evaluator.admin(), address(this));
    }

    function testConstructorRejectsZeroCommerce() public {
        vm.expectRevert(PactEvaluator.ZeroCommerceContract.selector);
        new PactEvaluator(address(0), VERIFIER_A, address(this));
    }

    function testConstructorRejectsZeroVerifier() public {
        vm.expectRevert(PactEvaluator.ZeroInitialVerifier.selector);
        new PactEvaluator(address(commerce), address(0), address(this));
    }

    function testConstructorRejectsZeroAdmin() public {
        vm.expectRevert(PactEvaluator.ZeroAdmin.selector);
        new PactEvaluator(address(commerce), VERIFIER_A, address(0));
    }

    function testBindStoresExactImmutableFieldsAndEmits() public {
        bytes32 key = evaluator.jobKey(JOB_ID);

        vm.expectEmit(true, true, true, true, address(evaluator));
        emit ConditionBound(key, JOB_ID, CONDITION_HASH, DEADLINE, VERIFIER_A);
        vm.prank(CLIENT);
        evaluator.bindCondition(JOB_ID, CONDITION_HASH, DEADLINE, VERIFIER_A);

        (bool exists, PactEvaluator.Binding memory binding) = evaluator.getBinding(JOB_ID);
        assertTrue(exists);
        assertEq(binding.conditionHash, CONDITION_HASH);
        assertEq(binding.completionDeadline, DEADLINE);
        assertEq(binding.verifier, VERIFIER_A);
    }

    function testMissingBindingHasExplicitExistenceFlag() public view {
        (bool exists, PactEvaluator.Binding memory binding) = evaluator.getBinding(JOB_ID);
        assertFalse(exists);
        assertEq(binding.conditionHash, bytes32(0));
        assertEq(binding.completionDeadline, 0);
        assertEq(binding.verifier, address(0));
    }

    function testPublishedArcJobIdentityVector() public {
        vm.chainId(5042);
        PactEvaluator vectorEvaluator = new PactEvaluator(
            0x1111111111111111111111111111111111111111, VERIFIER_A, address(this)
        );

        assertEq(
            vectorEvaluator.jobKey(81),
            0x3fc68520644941b41fc25c71eda15a50c082760a14b99b90f39864ded7975ea7
        );
    }

    function testJobIdentityChangesAcrossEveryInput() public {
        vm.chainId(5042);
        PactEvaluator first = new PactEvaluator(
            0x1111111111111111111111111111111111111111, VERIFIER_A, address(this)
        );
        PactEvaluator second = new PactEvaluator(
            0x2222222222222222222222222222222222222222, VERIFIER_A, address(this)
        );

        bytes32 baseline = first.jobKey(81);
        assertTrue(baseline != first.jobKey(82));
        assertTrue(baseline != second.jobKey(81));

        vm.chainId(5043);
        assertTrue(baseline != first.jobKey(81));
    }

    function testRejectsZeroJobId() public {
        vm.expectRevert(PactEvaluator.InvalidJobId.selector);
        evaluator.jobKey(0);
    }

    function testRejectsMissingJobDefaultStruct() public {
        vm.prank(CLIENT);
        vm.expectRevert(abi.encodeWithSelector(PactEvaluator.JobNotFound.selector, 404));
        evaluator.bindCondition(404, CONDITION_HASH, DEADLINE, VERIFIER_A);
    }

    function testRejectsNonClient() public {
        vm.prank(ATTACKER);
        vm.expectRevert(
            abi.encodeWithSelector(PactEvaluator.UnauthorizedClient.selector, ATTACKER, CLIENT)
        );
        evaluator.bindCondition(JOB_ID, CONDITION_HASH, DEADLINE, VERIFIER_A);
    }

    function testAdminCannotBindForClient() public {
        vm.expectRevert(
            abi.encodeWithSelector(PactEvaluator.UnauthorizedClient.selector, address(this), CLIENT)
        );
        evaluator.bindCondition(JOB_ID, CONDITION_HASH, DEADLINE, VERIFIER_A);
    }

    function testProviderCannotBindForClient() public {
        vm.prank(PROVIDER);
        vm.expectRevert(
            abi.encodeWithSelector(PactEvaluator.UnauthorizedClient.selector, PROVIDER, CLIENT)
        );
        evaluator.bindCondition(JOB_ID, CONDITION_HASH, DEADLINE, VERIFIER_A);
    }

    function testEvaluatorCannotBindForClient() public {
        vm.prank(address(evaluator));
        vm.expectRevert(
            abi.encodeWithSelector(
                PactEvaluator.UnauthorizedClient.selector, address(evaluator), CLIENT
            )
        );
        evaluator.bindCondition(JOB_ID, CONDITION_HASH, DEADLINE, VERIFIER_A);
    }

    function testClientOfAnotherJobCannotBind() public {
        _setJob(
            JOB_ID + 1, OTHER_CLIENT, IPactERC8183.JobStatus.Open, address(evaluator), EXPIRES_AT
        );

        vm.prank(OTHER_CLIENT);
        vm.expectRevert(
            abi.encodeWithSelector(PactEvaluator.UnauthorizedClient.selector, OTHER_CLIENT, CLIENT)
        );
        evaluator.bindCondition(JOB_ID, CONDITION_HASH, DEADLINE, VERIFIER_A);
    }

    function testRejectsWrongEvaluator() public {
        commerce.setEvaluator(JOB_ID, ATTACKER);

        vm.prank(CLIENT);
        vm.expectRevert(abi.encodeWithSelector(PactEvaluator.WrongEvaluator.selector, ATTACKER));
        evaluator.bindCondition(JOB_ID, CONDITION_HASH, DEADLINE, VERIFIER_A);
    }

    function testRejectsWrongStatusChangedBeforeInclusion() public {
        commerce.setStatus(JOB_ID, IPactERC8183.JobStatus.Funded);

        vm.prank(CLIENT);
        vm.expectRevert(
            abi.encodeWithSelector(
                PactEvaluator.WrongJobStatus.selector, IPactERC8183.JobStatus.Funded
            )
        );
        evaluator.bindCondition(JOB_ID, CONDITION_HASH, DEADLINE, VERIFIER_A);
    }

    function testFuzzRejectsEveryNonOpenStatus(uint8 rawStatus) public {
        vm.assume(rawStatus > uint8(IPactERC8183.JobStatus.Open));
        vm.assume(rawStatus <= uint8(IPactERC8183.JobStatus.Expired));
        IPactERC8183.JobStatus status = IPactERC8183.JobStatus(rawStatus);
        commerce.setStatus(JOB_ID, status);

        vm.prank(CLIENT);
        vm.expectRevert(abi.encodeWithSelector(PactEvaluator.WrongJobStatus.selector, status));
        evaluator.bindCondition(JOB_ID, CONDITION_HASH, DEADLINE, VERIFIER_A);
    }

    function testRejectsZeroCondition() public {
        vm.prank(CLIENT);
        vm.expectRevert(PactEvaluator.ZeroConditionHash.selector);
        evaluator.bindCondition(JOB_ID, bytes32(0), DEADLINE, VERIFIER_A);
    }

    function testRejectsZeroExpectedVerifier() public {
        vm.prank(CLIENT);
        vm.expectRevert(PactEvaluator.ZeroExpectedVerifier.selector);
        evaluator.bindCondition(JOB_ID, CONDITION_HASH, DEADLINE, address(0));
    }

    function testVerifierRotationRaceRevertsThenReviewedVerifierSucceeds() public {
        vm.expectEmit(true, true, false, true, address(evaluator));
        emit DefaultVerifierChanged(VERIFIER_A, VERIFIER_B);
        evaluator.setDefaultVerifier(VERIFIER_B);

        vm.prank(CLIENT);
        vm.expectRevert(
            abi.encodeWithSelector(PactEvaluator.VerifierChanged.selector, VERIFIER_A, VERIFIER_B)
        );
        evaluator.bindCondition(JOB_ID, CONDITION_HASH, DEADLINE, VERIFIER_A);

        vm.prank(CLIENT);
        evaluator.bindCondition(JOB_ID, CONDITION_HASH, DEADLINE, VERIFIER_B);

        (, PactEvaluator.Binding memory binding) = evaluator.getBinding(JOB_ID);
        assertEq(binding.verifier, VERIFIER_B);
    }

    function testRotationDoesNotChangeExistingSnapshot() public {
        _bind(JOB_ID, CLIENT, CONDITION_HASH, DEADLINE, VERIFIER_A);
        evaluator.setDefaultVerifier(VERIFIER_B);

        (, PactEvaluator.Binding memory binding) = evaluator.getBinding(JOB_ID);
        assertEq(binding.verifier, VERIFIER_A);
        assertEq(evaluator.defaultVerifier(), VERIFIER_B);
    }

    function testRejectsRevokedVerifierForNewBinding() public {
        vm.expectEmit(true, false, false, true, address(evaluator));
        emit VerifierRevoked(VERIFIER_A);
        evaluator.revokeVerifier(VERIFIER_A);

        vm.prank(CLIENT);
        vm.expectRevert(
            abi.encodeWithSelector(PactEvaluator.VerifierIsRevoked.selector, VERIFIER_A)
        );
        evaluator.bindCondition(JOB_ID, CONDITION_HASH, DEADLINE, VERIFIER_A);
    }

    function testRevokingDefaultBlocksUntilNewDefaultSelected() public {
        evaluator.revokeVerifier(VERIFIER_A);

        vm.prank(CLIENT);
        vm.expectRevert(
            abi.encodeWithSelector(PactEvaluator.VerifierIsRevoked.selector, VERIFIER_A)
        );
        evaluator.bindCondition(JOB_ID, CONDITION_HASH, DEADLINE, VERIFIER_A);

        evaluator.setDefaultVerifier(VERIFIER_B);
        _bind(JOB_ID, CLIENT, CONDITION_HASH, DEADLINE, VERIFIER_B);
    }

    function testRevocationIsIrreversibleAndRepeatedRevocationReverts() public {
        evaluator.revokeVerifier(VERIFIER_A);
        assertTrue(evaluator.isVerifierRevoked(VERIFIER_A));

        vm.expectRevert(
            abi.encodeWithSelector(PactEvaluator.VerifierAlreadyRevoked.selector, VERIFIER_A)
        );
        evaluator.revokeVerifier(VERIFIER_A);
        assertTrue(evaluator.isVerifierRevoked(VERIFIER_A));

        (bool success,) = address(evaluator)
            .call(abi.encodeWithSignature("unrevokeVerifier(address)", VERIFIER_A));
        assertFalse(success);
    }

    function testUnauthorizedCannotRotateOrRevoke() public {
        vm.prank(ATTACKER);
        vm.expectRevert(abi.encodeWithSelector(PactEvaluator.UnauthorizedAdmin.selector, ATTACKER));
        evaluator.setDefaultVerifier(VERIFIER_B);

        vm.prank(ATTACKER);
        vm.expectRevert(abi.encodeWithSelector(PactEvaluator.UnauthorizedAdmin.selector, ATTACKER));
        evaluator.revokeVerifier(VERIFIER_A);
    }

    function testRejectsZeroUnchangedAndRevokedDefaultVerifier() public {
        vm.expectRevert(PactEvaluator.ZeroVerifier.selector);
        evaluator.setDefaultVerifier(address(0));

        vm.expectRevert(PactEvaluator.DefaultVerifierUnchanged.selector);
        evaluator.setDefaultVerifier(VERIFIER_A);

        evaluator.revokeVerifier(VERIFIER_B);
        vm.expectRevert(
            abi.encodeWithSelector(PactEvaluator.VerifierIsRevoked.selector, VERIFIER_B)
        );
        evaluator.setDefaultVerifier(VERIFIER_B);
    }

    function testRejectsZeroRevocationTarget() public {
        vm.expectRevert(PactEvaluator.ZeroVerifier.selector);
        evaluator.revokeVerifier(address(0));
    }

    function testRejectsDuplicateBindingWithoutMutation() public {
        _bind(JOB_ID, CLIENT, CONDITION_HASH, DEADLINE, VERIFIER_A);
        bytes32 key = evaluator.jobKey(JOB_ID);

        vm.prank(CLIENT);
        vm.expectRevert(abi.encodeWithSelector(PactEvaluator.BindingAlreadyExists.selector, key));
        evaluator.bindCondition(JOB_ID, keccak256("replacement"), DEADLINE + 1, VERIFIER_A);

        (, PactEvaluator.Binding memory binding) = evaluator.getBinding(JOB_ID);
        assertEq(binding.conditionHash, CONDITION_HASH);
        assertEq(binding.completionDeadline, DEADLINE);
        assertEq(binding.verifier, VERIFIER_A);
    }

    function testRejectsDeadlineAlreadyPassedOrEqualToNow() public {
        vm.prank(CLIENT);
        vm.expectRevert(
            abi.encodeWithSelector(PactEvaluator.CompletionDeadlineNotFuture.selector, uint64(NOW))
        );
        evaluator.bindCondition(JOB_ID, CONDITION_HASH, uint64(NOW), VERIFIER_A);
    }

    function testRejectsDeadlineInPast() public {
        uint64 pastDeadline = uint64(NOW - 1);
        vm.prank(CLIENT);
        vm.expectRevert(
            abi.encodeWithSelector(PactEvaluator.CompletionDeadlineNotFuture.selector, pastDeadline)
        );
        evaluator.bindCondition(JOB_ID, CONDITION_HASH, pastDeadline, VERIFIER_A);
    }

    function testRejectsDeadlineEqualToExpiry() public {
        vm.prank(CLIENT);
        vm.expectRevert(
            abi.encodeWithSelector(
                PactEvaluator.InsufficientSettlementWindow.selector, uint64(EXPIRES_AT), EXPIRES_AT
            )
        );
        evaluator.bindCondition(JOB_ID, CONDITION_HASH, uint64(EXPIRES_AT), VERIFIER_A);
    }

    function testRejectsDeadlineAfterExpiry() public {
        uint64 tooLate = uint64(EXPIRES_AT) + 1;
        vm.prank(CLIENT);
        vm.expectRevert(
            abi.encodeWithSelector(
                PactEvaluator.InsufficientSettlementWindow.selector, tooLate, EXPIRES_AT
            )
        );
        evaluator.bindCondition(JOB_ID, CONDITION_HASH, tooLate, VERIFIER_A);
    }

    function testRejectsNoFiniteExpiry() public {
        _setJob(JOB_ID, CLIENT, IPactERC8183.JobStatus.Open, address(evaluator), 0);

        vm.prank(CLIENT);
        vm.expectRevert(PactEvaluator.FiniteExpiryRequired.selector);
        evaluator.bindCondition(JOB_ID, CONDITION_HASH, DEADLINE, VERIFIER_A);
    }

    function testRejectsAlreadyExpiredOpenJob() public {
        uint48 expired = uint48(NOW - 1);
        _setJob(JOB_ID, CLIENT, IPactERC8183.JobStatus.Open, address(evaluator), expired);

        vm.prank(CLIENT);
        vm.expectRevert(abi.encodeWithSelector(PactEvaluator.JobAlreadyExpired.selector, expired));
        evaluator.bindCondition(JOB_ID, CONDITION_HASH, DEADLINE, VERIFIER_A);
    }

    function testCommerceGetterRevertPropagatesWithoutBinding() public {
        commerce.setRevertGetJob(true);
        vm.prank(CLIENT);
        vm.expectRevert(MockERC8183.ForcedGetJobRevert.selector);
        evaluator.bindCondition(JOB_ID, CONDITION_HASH, DEADLINE, VERIFIER_A);

        commerce.setRevertGetJob(false);
        (bool exists,) = evaluator.getBinding(JOB_ID);
        assertFalse(exists);
    }

    function testMalformedCommerceReturnRevertsStrictDecode() public {
        MalformedERC8183 malformed = new MalformedERC8183();
        PactEvaluator malformedEvaluator =
            new PactEvaluator(address(malformed), VERIFIER_A, address(this));

        vm.prank(CLIENT);
        vm.expectRevert();
        malformedEvaluator.bindCondition(JOB_ID, CONDITION_HASH, DEADLINE, VERIFIER_A);
    }

    function testStaticGetterReentryCannotCreateASecondBinding() public {
        bytes memory reentry = abi.encodeCall(
            PactEvaluator.bindCondition, (JOB_ID, keccak256("reentrant"), DEADLINE + 1, VERIFIER_A)
        );
        commerce.setReentry(address(evaluator), reentry);

        _bind(JOB_ID, CLIENT, CONDITION_HASH, DEADLINE, VERIFIER_A);

        (, PactEvaluator.Binding memory binding) = evaluator.getBinding(JOB_ID);
        assertEq(binding.conditionHash, CONDITION_HASH);
        assertEq(binding.completionDeadline, DEADLINE);
    }

    function testExtremeJobIdCanBindWithoutIdentityTruncation() public {
        uint256 extremeJobId = type(uint256).max;
        _setJob(extremeJobId, CLIENT, IPactERC8183.JobStatus.Open, address(evaluator), EXPIRES_AT);

        _bind(extremeJobId, CLIENT, CONDITION_HASH, DEADLINE, VERIFIER_A);
        (bool exists,) = evaluator.getBinding(extremeJobId);
        assertTrue(exists);
    }

    function testEvaluatorDoesNotExposeRawCommerceCompleteOrGenericSettle() public {
        (bool completeSuccess,) = address(evaluator)
            .call(
                abi.encodeWithSelector(
                    IPactERC8183.complete.selector, JOB_ID, CONDITION_HASH, bytes("")
                )
            );
        (bool settleSuccess,) = address(evaluator)
            .call(abi.encodeWithSignature("settle(bytes,bytes)", bytes(""), bytes("")));

        assertFalse(completeSuccess);
        assertFalse(settleSuccess);
    }

    function testFuzzOnlyCanonicalClientCanBind(address caller) public {
        vm.assume(caller != CLIENT);
        vm.prank(caller);
        vm.expectRevert(
            abi.encodeWithSelector(PactEvaluator.UnauthorizedClient.selector, caller, CLIENT)
        );
        evaluator.bindCondition(JOB_ID, CONDITION_HASH, DEADLINE, VERIFIER_A);
    }

    function testFuzzDifferentJobIdsProduceDifferentKeys(uint256 otherJobId) public {
        vm.assume(otherJobId != 0 && otherJobId != JOB_ID);
        assertTrue(evaluator.jobKey(JOB_ID) != evaluator.jobKey(otherJobId));
    }

    function testFuzzBindingIsImmutable(bytes32 replacementCondition, uint64 replacementDeadline)
        public
    {
        _bind(JOB_ID, CLIENT, CONDITION_HASH, DEADLINE, VERIFIER_A);

        vm.prank(CLIENT);
        vm.expectRevert();
        evaluator.bindCondition(JOB_ID, replacementCondition, replacementDeadline, VERIFIER_A);

        (, PactEvaluator.Binding memory binding) = evaluator.getBinding(JOB_ID);
        assertEq(binding.conditionHash, CONDITION_HASH);
        assertEq(binding.completionDeadline, DEADLINE);
        assertEq(binding.verifier, VERIFIER_A);
    }

    function testFuzzSuccessfulBindingAlwaysHasSettlementWindow(
        uint64 completionDeadline,
        uint48 expiredAt
    ) public {
        vm.assume(completionDeadline > NOW);
        vm.assume(expiredAt > completionDeadline);
        _setJob(JOB_ID, CLIENT, IPactERC8183.JobStatus.Open, address(evaluator), expiredAt);

        _bind(JOB_ID, CLIENT, CONDITION_HASH, completionDeadline, VERIFIER_A);
        (, PactEvaluator.Binding memory binding) = evaluator.getBinding(JOB_ID);

        assertTrue(binding.completionDeadline > block.timestamp);
        assertTrue(binding.completionDeadline < expiredAt);
    }

    function testFuzzRevokedVerifierCannotBeSnapshotted(address verifier) public {
        vm.assume(verifier != address(0));
        PactEvaluator localEvaluator = new PactEvaluator(address(commerce), verifier, address(this));
        _setJob(JOB_ID, CLIENT, IPactERC8183.JobStatus.Open, address(localEvaluator), EXPIRES_AT);
        localEvaluator.revokeVerifier(verifier);

        vm.prank(CLIENT);
        vm.expectRevert(abi.encodeWithSelector(PactEvaluator.VerifierIsRevoked.selector, verifier));
        localEvaluator.bindCondition(JOB_ID, CONDITION_HASH, DEADLINE, verifier);
    }

    function _bind(
        uint256 jobId,
        address client,
        bytes32 conditionHash,
        uint64 completionDeadline,
        address verifier
    ) internal {
        vm.prank(client);
        evaluator.bindCondition(jobId, conditionHash, completionDeadline, verifier);
    }

    function _setJob(
        uint256 jobId,
        address client,
        IPactERC8183.JobStatus status,
        address jobEvaluator,
        uint48 expiredAt
    ) internal {
        commerce.setJob(
            jobId,
            IPactERC8183.Job({
                client: client,
                status: status,
                provider: PROVIDER,
                expiredAt: expiredAt,
                evaluator: jobEvaluator,
                submittedAt: 0,
                budget: 0,
                hook: address(0),
                paymentToken: address(0),
                providerAgentId: 0,
                description: "fixture",
                settledAmount: 0,
                payoutReceiver: address(0)
            })
        );
    }
}
