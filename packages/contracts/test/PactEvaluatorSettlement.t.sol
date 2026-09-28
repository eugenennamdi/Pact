// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {PactEvaluator} from "../src/PactEvaluator.sol";
import {IPactERC8183} from "../src/interfaces/IPactERC8183.sol";
import {MockERC8183} from "./fixtures/MockERC8183.sol";
import {TestBase} from "./TestBase.sol";

contract PactEvaluatorSettlementTest is TestBase {
    event PactCompletionAccepted(
        bytes32 indexed jobKey,
        uint256 indexed jobId,
        bytes32 indexed evidenceHash,
        bytes32 conditionHash,
        bytes32 attestationDigest,
        address verifier,
        address relayer
    );

    uint256 internal constant JOB_ID = 81;
    uint256 internal constant OTHER_JOB_ID = 82;
    uint256 internal constant VERIFIER_KEY = 0xA11CE;
    uint256 internal constant WRONG_KEY = 0xB0B;
    uint64 internal constant BIND_NOW = 1_000_000;
    uint64 internal constant DEADLINE = 1_050_000;
    uint64 internal constant SETTLE_NOW = 1_060_000;
    uint48 internal constant EXPIRES_AT = 1_100_000;
    uint64 internal constant SATISFIED_AT = 1_040_000;
    uint64 internal constant VERIFIED_AT = 1_055_000;
    uint64 internal constant VALID_UNTIL = 1_080_000;
    bytes32 internal constant CONDITION_HASH = keccak256("condition");
    bytes32 internal constant EVIDENCE_HASH = keccak256("evidence");

    address internal constant CLIENT = address(0xC11E17);
    address internal constant PROVIDER = address(0xBEEF);
    address internal constant RELAYER = address(0xA71A5);

    MockERC8183 internal commerce;
    PactEvaluator internal evaluator;
    address internal verifier;

    function setUp() public {
        vm.warp(BIND_NOW);
        verifier = vm.addr(VERIFIER_KEY);
        commerce = new MockERC8183();
        evaluator = new PactEvaluator(address(commerce), verifier, address(this));
        _setJob(JOB_ID, IPactERC8183.JobStatus.Open, address(evaluator));
        vm.prank(CLIENT);
        evaluator.bindCondition(JOB_ID, CONDITION_HASH, DEADLINE, verifier);
        commerce.setStatus(JOB_ID, IPactERC8183.JobStatus.Funded);
        commerce.setStatus(JOB_ID, IPactERC8183.JobStatus.Submitted);
        vm.warp(SETTLE_NOW);
    }

    function testPermissionlessSettlementCompletesExactJobAndEmits() public {
        PactEvaluator.PactCompletionAttestation memory attestation = _attestation(JOB_ID);
        bytes memory signature = _sign(evaluator, attestation, VERIFIER_KEY);
        bytes32 digest = evaluator.hashAttestation(attestation);
        bytes32 key = evaluator.jobKey(JOB_ID);

        vm.expectEmit(true, true, true, true, address(evaluator));
        emit PactCompletionAccepted(
            key, JOB_ID, EVIDENCE_HASH, CONDITION_HASH, digest, verifier, RELAYER
        );
        vm.prank(RELAYER);
        evaluator.completeWithAttestation(attestation, signature);

        (, PactEvaluator.Binding memory binding) = evaluator.getBinding(JOB_ID);
        assertTrue(binding.accepted);
        assertTrue(evaluator.usedAttestations(digest));
        assertEq(uint256(commerce.getJob(JOB_ID).status), uint256(IPactERC8183.JobStatus.Completed));
        assertEq(commerce.completionReason(JOB_ID), EVIDENCE_HASH);
        assertEq(commerce.completionCaller(JOB_ID), address(evaluator));
        assertEq(commerce.completeCallCount(JOB_ID), 1);
    }

    function testRejectsMissingBinding() public {
        _setJob(OTHER_JOB_ID, IPactERC8183.JobStatus.Submitted, address(evaluator));
        PactEvaluator.PactCompletionAttestation memory attestation = _attestation(OTHER_JOB_ID);
        bytes memory signature = _sign(evaluator, attestation, VERIFIER_KEY);
        vm.expectRevert(
            abi.encodeWithSelector(
                PactEvaluator.BindingNotFound.selector, evaluator.jobKey(OTHER_JOB_ID)
            )
        );
        evaluator.completeWithAttestation(attestation, signature);
    }

    function testRejectsWrongCommerceConditionAndZeroEvidence() public {
        PactEvaluator.PactCompletionAttestation memory attestation = _attestation(JOB_ID);

        attestation.commerceContract = address(0xBAD);
        vm.expectRevert(
            abi.encodeWithSelector(PactEvaluator.InvalidCommerceContract.selector, address(0xBAD))
        );
        evaluator.completeWithAttestation(attestation, hex"");

        attestation = _attestation(JOB_ID);
        attestation.conditionHash = keccak256("wrong");
        vm.expectRevert(
            abi.encodeWithSelector(
                PactEvaluator.ConditionMismatch.selector, attestation.conditionHash, CONDITION_HASH
            )
        );
        evaluator.completeWithAttestation(attestation, hex"");

        attestation = _attestation(JOB_ID);
        attestation.evidenceHash = bytes32(0);
        vm.expectRevert(PactEvaluator.ZeroEvidenceHash.selector);
        evaluator.completeWithAttestation(attestation, hex"");
    }

    function testRejectsEveryNonSubmittedState(uint8 rawStatus) public {
        vm.assume(rawStatus <= uint8(IPactERC8183.JobStatus.Expired));
        vm.assume(rawStatus != uint8(IPactERC8183.JobStatus.Submitted));
        IPactERC8183.JobStatus status = IPactERC8183.JobStatus(rawStatus);
        commerce.setStatus(JOB_ID, status);
        PactEvaluator.PactCompletionAttestation memory attestation = _attestation(JOB_ID);
        bytes memory signature = _sign(evaluator, attestation, VERIFIER_KEY);

        vm.expectRevert(abi.encodeWithSelector(PactEvaluator.WrongJobStatus.selector, status));
        evaluator.completeWithAttestation(attestation, signature);
    }

    function testRejectsWrongAndChangedEvaluator() public {
        commerce.setEvaluator(JOB_ID, address(0xBAD));
        PactEvaluator.PactCompletionAttestation memory attestation = _attestation(JOB_ID);
        bytes memory signature = _sign(evaluator, attestation, VERIFIER_KEY);
        vm.expectRevert(
            abi.encodeWithSelector(PactEvaluator.WrongEvaluator.selector, address(0xBAD))
        );
        evaluator.completeWithAttestation(attestation, signature);
    }

    function testRejectsAtFinancialExpiryBoundary() public {
        vm.warp(EXPIRES_AT);
        PactEvaluator.PactCompletionAttestation memory attestation = _attestation(JOB_ID);
        bytes memory signature = _sign(evaluator, attestation, VERIFIER_KEY);
        vm.expectRevert(
            abi.encodeWithSelector(PactEvaluator.JobAlreadyExpired.selector, EXPIRES_AT)
        );
        evaluator.completeWithAttestation(attestation, signature);
    }

    function testSnapshotVerifierSurvivesDefaultRotation() public {
        evaluator.setDefaultVerifier(vm.addr(WRONG_KEY));
        _complete(JOB_ID, EVIDENCE_HASH, VERIFIER_KEY, RELAYER);
    }

    function testRotatedDefaultCannotSignForExistingBinding() public {
        evaluator.setDefaultVerifier(vm.addr(WRONG_KEY));
        PactEvaluator.PactCompletionAttestation memory attestation = _attestation(JOB_ID);
        bytes memory signature = _sign(evaluator, attestation, WRONG_KEY);
        vm.expectPartialRevert(PactEvaluator.InvalidVerifierSignature.selector);
        evaluator.completeWithAttestation(attestation, signature);
    }

    function testRevocationInvalidatesPreviouslyIssuedSignature() public {
        PactEvaluator.PactCompletionAttestation memory attestation = _attestation(JOB_ID);
        bytes memory signature = _sign(evaluator, attestation, VERIFIER_KEY);
        evaluator.revokeVerifier(verifier);
        vm.expectRevert(abi.encodeWithSelector(PactEvaluator.VerifierIsRevoked.selector, verifier));
        evaluator.completeWithAttestation(attestation, signature);
    }

    function testRejectsMalformedInvalidVAndHighSSignatures() public {
        PactEvaluator.PactCompletionAttestation memory attestation = _attestation(JOB_ID);

        vm.expectPartialRevert(ECDSA.ECDSAInvalidSignatureLength.selector);
        evaluator.completeWithAttestation(attestation, hex"1234");

        bytes memory signature = _sign(evaluator, attestation, VERIFIER_KEY);
        signature[64] = bytes1(uint8(1));
        vm.expectRevert(ECDSA.ECDSAInvalidSignature.selector);
        evaluator.completeWithAttestation(attestation, signature);

        bytes32 highS = bytes32(type(uint256).max);
        bytes memory highSignature = abi.encodePacked(bytes32(uint256(1)), highS, bytes1(uint8(27)));
        vm.expectPartialRevert(ECDSA.ECDSAInvalidSignatureS.selector);
        evaluator.completeWithAttestation(attestation, highSignature);
    }

    function testRejectsZeroAndCorruptedSignatures() public {
        PactEvaluator.PactCompletionAttestation memory attestation = _attestation(JOB_ID);
        vm.expectRevert(ECDSA.ECDSAInvalidSignature.selector);
        evaluator.completeWithAttestation(attestation, new bytes(65));

        bytes memory corrupted = _sign(evaluator, attestation, VERIFIER_KEY);
        corrupted[0] = bytes1(uint8(corrupted[0]) ^ 1);
        vm.expectPartialRevert(PactEvaluator.InvalidVerifierSignature.selector);
        evaluator.completeWithAttestation(attestation, corrupted);
    }

    function testRejectsCrossCommerceReplay() public {
        PactEvaluator.PactCompletionAttestation memory attestation = _attestation(JOB_ID);
        bytes memory signature = _sign(evaluator, attestation, VERIFIER_KEY);
        address alternateCommerce = address(0x8183);
        attestation.commerceContract = alternateCommerce;
        vm.expectRevert(
            abi.encodeWithSelector(
                PactEvaluator.InvalidCommerceContract.selector, alternateCommerce
            )
        );
        evaluator.completeWithAttestation(attestation, signature);
    }

    function testRejectsCrossChainReplay() public {
        PactEvaluator.PactCompletionAttestation memory attestation = _attestation(JOB_ID);
        bytes memory oldChainSignature = _sign(evaluator, attestation, VERIFIER_KEY);
        vm.chainId(block.chainid + 1);
        vm.expectPartialRevert(PactEvaluator.BindingNotFound.selector);
        evaluator.completeWithAttestation(attestation, oldChainSignature);
    }

    function testRejectsCrossEvaluatorReplay() public {
        PactEvaluator.PactCompletionAttestation memory attestation = _attestation(JOB_ID);
        bytes memory firstSignature = _sign(evaluator, attestation, VERIFIER_KEY);

        PactEvaluator second = new PactEvaluator(address(commerce), verifier, address(this));
        commerce.setStatus(JOB_ID, IPactERC8183.JobStatus.Open);
        commerce.setEvaluator(JOB_ID, address(second));
        vm.warp(BIND_NOW);
        vm.prank(CLIENT);
        second.bindCondition(JOB_ID, CONDITION_HASH, DEADLINE, verifier);
        commerce.setStatus(JOB_ID, IPactERC8183.JobStatus.Submitted);
        vm.warp(SETTLE_NOW);

        vm.expectPartialRevert(PactEvaluator.InvalidVerifierSignature.selector);
        second.completeWithAttestation(attestation, firstSignature);
    }

    function testRejectsCrossJobReplay() public {
        _setJob(OTHER_JOB_ID, IPactERC8183.JobStatus.Open, address(evaluator));
        vm.warp(BIND_NOW);
        _bindAndSubmit(evaluator, commerce, OTHER_JOB_ID);
        vm.warp(SETTLE_NOW);

        PactEvaluator.PactCompletionAttestation memory original = _attestation(JOB_ID);
        bytes memory signature = _sign(evaluator, original, VERIFIER_KEY);
        original.jobId = OTHER_JOB_ID;
        vm.expectPartialRevert(PactEvaluator.InvalidVerifierSignature.selector);
        evaluator.completeWithAttestation(original, signature);
    }

    function testChangedEvidenceAndTimestampInvalidateSignature() public {
        PactEvaluator.PactCompletionAttestation memory attestation = _attestation(JOB_ID);
        bytes memory signature = _sign(evaluator, attestation, VERIFIER_KEY);

        attestation.evidenceHash = keccak256("mutated");
        vm.expectPartialRevert(PactEvaluator.InvalidVerifierSignature.selector);
        evaluator.completeWithAttestation(attestation, signature);

        attestation = _attestation(JOB_ID);
        signature = _sign(evaluator, attestation, VERIFIER_KEY);
        attestation.verifiedAt++;
        vm.expectPartialRevert(PactEvaluator.InvalidVerifierSignature.selector);
        evaluator.completeWithAttestation(attestation, signature);
    }

    function testTimestampBoundaryPolicy() public {
        PactEvaluator.PactCompletionAttestation memory attestation = _attestation(JOB_ID);
        attestation.satisfiedAt = DEADLINE;
        attestation.verifiedAt = SETTLE_NOW;
        attestation.validUntil = SETTLE_NOW;
        evaluator.completeWithAttestation(attestation, _sign(evaluator, attestation, VERIFIER_KEY));
    }

    function testRejectsInvalidTimestampOrderAndZero() public {
        PactEvaluator.PactCompletionAttestation memory attestation = _attestation(JOB_ID);
        attestation.satisfiedAt = 0;
        vm.expectPartialRevert(PactEvaluator.InvalidTimestampOrder.selector);
        evaluator.completeWithAttestation(attestation, hex"");

        attestation = _attestation(JOB_ID);
        attestation.verifiedAt = attestation.satisfiedAt - 1;
        vm.expectPartialRevert(PactEvaluator.InvalidTimestampOrder.selector);
        evaluator.completeWithAttestation(attestation, hex"");

        attestation = _attestation(JOB_ID);
        attestation.validUntil = attestation.verifiedAt - 1;
        vm.expectPartialRevert(PactEvaluator.InvalidTimestampOrder.selector);
        evaluator.completeWithAttestation(attestation, hex"");
    }

    function testRejectsFutureExpiredAndBeyondJobValidity() public {
        PactEvaluator.PactCompletionAttestation memory attestation = _attestation(JOB_ID);
        attestation.verifiedAt = SETTLE_NOW + 1;
        vm.expectRevert(
            abi.encodeWithSelector(PactEvaluator.FutureTimestamp.selector, SETTLE_NOW + 1)
        );
        evaluator.completeWithAttestation(attestation, hex"");

        attestation = _attestation(JOB_ID);
        attestation.validUntil = SETTLE_NOW - 1;
        vm.expectRevert(
            abi.encodeWithSelector(PactEvaluator.AttestationExpired.selector, SETTLE_NOW - 1)
        );
        evaluator.completeWithAttestation(attestation, hex"");

        attestation = _attestation(JOB_ID);
        attestation.validUntil = EXPIRES_AT;
        vm.expectRevert(
            abi.encodeWithSelector(
                PactEvaluator.AttestationValidityBeyondExpiry.selector, EXPIRES_AT, EXPIRES_AT
            )
        );
        evaluator.completeWithAttestation(attestation, hex"");
    }

    function testRejectsSignedAttestationAfterValidUntil() public {
        PactEvaluator.PactCompletionAttestation memory attestation = _attestation(JOB_ID);
        bytes memory signature = _sign(evaluator, attestation, VERIFIER_KEY);
        vm.warp(VALID_UNTIL + 1);
        vm.expectRevert(
            abi.encodeWithSelector(PactEvaluator.AttestationExpired.selector, VALID_UNTIL)
        );
        evaluator.completeWithAttestation(attestation, signature);
    }

    function testExactDigestReplayAndAlternateAttestationAreBlocked() public {
        PactEvaluator.PactCompletionAttestation memory attestation = _attestation(JOB_ID);
        bytes memory signature = _sign(evaluator, attestation, VERIFIER_KEY);
        bytes32 digest = evaluator.hashAttestation(attestation);
        evaluator.completeWithAttestation(attestation, signature);

        commerce.setStatus(JOB_ID, IPactERC8183.JobStatus.Submitted);
        vm.expectRevert(
            abi.encodeWithSelector(PactEvaluator.AttestationAlreadyUsed.selector, digest)
        );
        evaluator.completeWithAttestation(attestation, signature);

        PactEvaluator.PactCompletionAttestation memory alternate = _attestation(JOB_ID);
        alternate.evidenceHash = keccak256("alternate");
        bytes memory alternateSignature = _sign(evaluator, alternate, VERIFIER_KEY);
        vm.expectRevert(
            abi.encodeWithSelector(
                PactEvaluator.BindingAlreadyAccepted.selector, evaluator.jobKey(JOB_ID)
            )
        );
        evaluator.completeWithAttestation(alternate, alternateSignature);
    }

    function testSameDigestReentrancyCannotDoubleComplete() public {
        PactEvaluator.PactCompletionAttestation memory attestation = _attestation(JOB_ID);
        bytes memory signature = _sign(evaluator, attestation, VERIFIER_KEY);
        commerce.setCompleteReentry(
            address(evaluator),
            abi.encodeCall(PactEvaluator.completeWithAttestation, (attestation, signature))
        );

        evaluator.completeWithAttestation(attestation, signature);
        assertFalse(commerce.lastCompleteReentrySucceeded());
        assertEq(commerce.completeCallCount(JOB_ID), 1);
    }

    function testAlternateDigestReentrancyCannotDoubleComplete() public {
        PactEvaluator.PactCompletionAttestation memory first = _attestation(JOB_ID);
        PactEvaluator.PactCompletionAttestation memory alternate = _attestation(JOB_ID);
        alternate.evidenceHash = keccak256("alternate");
        bytes memory alternateSignature = _sign(evaluator, alternate, VERIFIER_KEY);
        commerce.setCompleteReentry(
            address(evaluator),
            abi.encodeCall(PactEvaluator.completeWithAttestation, (alternate, alternateSignature))
        );

        evaluator.completeWithAttestation(first, _sign(evaluator, first, VERIFIER_KEY));
        assertFalse(commerce.lastCompleteReentrySucceeded());
        assertEq(commerce.completeCallCount(JOB_ID), 1);
        assertEq(commerce.completionReason(JOB_ID), EVIDENCE_HASH);
    }

    function testDownstreamRevertRollsBackReplayStateAndAllowsRetry() public {
        PactEvaluator.PactCompletionAttestation memory attestation = _attestation(JOB_ID);
        bytes memory signature = _sign(evaluator, attestation, VERIFIER_KEY);
        bytes32 digest = evaluator.hashAttestation(attestation);
        commerce.setCompleteBehavior(true, false, false, false);

        vm.expectRevert(MockERC8183.ForcedCompleteRevert.selector);
        evaluator.completeWithAttestation(attestation, signature);
        _assertUnused(JOB_ID, digest);

        commerce.setCompleteBehavior(false, false, false, false);
        evaluator.completeWithAttestation(attestation, signature);
        assertTrue(evaluator.usedAttestations(digest));
    }

    function testHookRevertRollsBackReplayState() public {
        PactEvaluator.PactCompletionAttestation memory attestation = _attestation(JOB_ID);
        bytes memory signature = _sign(evaluator, attestation, VERIFIER_KEY);
        bytes32 digest = evaluator.hashAttestation(attestation);
        commerce.setCompleteBehavior(false, true, false, false);

        vm.expectRevert(MockERC8183.ForcedHookRevert.selector);
        evaluator.completeWithAttestation(attestation, signature);
        _assertUnused(JOB_ID, digest);
    }

    function testNoopCompletionRollsBackReplayState() public {
        PactEvaluator.PactCompletionAttestation memory attestation = _attestation(JOB_ID);
        bytes memory signature = _sign(evaluator, attestation, VERIFIER_KEY);
        bytes32 digest = evaluator.hashAttestation(attestation);
        commerce.setCompleteBehavior(false, false, true, false);

        vm.expectRevert(
            abi.encodeWithSelector(
                PactEvaluator.CompletionDidNotFinalize.selector, IPactERC8183.JobStatus.Submitted
            )
        );
        evaluator.completeWithAttestation(attestation, signature);
        _assertUnused(JOB_ID, digest);
    }

    function testStaleStatusChangeRollsBackReplayState() public {
        PactEvaluator.PactCompletionAttestation memory attestation = _attestation(JOB_ID);
        bytes memory signature = _sign(evaluator, attestation, VERIFIER_KEY);
        bytes32 digest = evaluator.hashAttestation(attestation);
        commerce.setCompleteBehavior(false, false, false, true);

        vm.expectRevert(MockERC8183.WrongStatus.selector);
        evaluator.completeWithAttestation(attestation, signature);
        _assertUnused(JOB_ID, digest);
        assertEq(uint256(commerce.getJob(JOB_ID).status), uint256(IPactERC8183.JobStatus.Submitted));
    }

    function testFuzzRelayerNeutrality(address arbitraryRelayer) public {
        vm.prank(arbitraryRelayer);
        PactEvaluator.PactCompletionAttestation memory attestation = _attestation(JOB_ID);
        evaluator.completeWithAttestation(attestation, _sign(evaluator, attestation, VERIFIER_KEY));
        assertEq(uint256(commerce.getJob(JOB_ID).status), uint256(IPactERC8183.JobStatus.Completed));
    }

    function testFuzzWrongSignerNeverAuthorizes(uint256 privateKey) public {
        privateKey =
            (privateKey % (0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141 - 1))
                + 1;
        if (vm.addr(privateKey) == verifier) privateKey = WRONG_KEY;
        PactEvaluator.PactCompletionAttestation memory attestation = _attestation(JOB_ID);
        bytes memory signature = _sign(evaluator, attestation, privateKey);
        vm.expectPartialRevert(PactEvaluator.InvalidVerifierSignature.selector);
        evaluator.completeWithAttestation(attestation, signature);
    }

    function testFuzzEvidenceMutationInvalidatesSignature(bytes32 mutatedEvidence) public {
        vm.assume(mutatedEvidence != bytes32(0));
        vm.assume(mutatedEvidence != EVIDENCE_HASH);
        PactEvaluator.PactCompletionAttestation memory attestation = _attestation(JOB_ID);
        bytes memory signature = _sign(evaluator, attestation, VERIFIER_KEY);
        attestation.evidenceHash = mutatedEvidence;
        vm.expectPartialRevert(PactEvaluator.InvalidVerifierSignature.selector);
        evaluator.completeWithAttestation(attestation, signature);
    }

    function testFuzzEveryAttestationFieldChangesDigest(uint8 selectedField, bytes32 entropy)
        public
        view
    {
        PactEvaluator.PactCompletionAttestation memory attestation = _attestation(JOB_ID);
        bytes32 original = evaluator.hashAttestation(attestation);
        uint8 field = selectedField % 7;
        if (field == 0) {
            address changed = address(uint160(uint256(entropy)));
            if (changed == attestation.commerceContract) {
                changed = address(uint160(uint256(entropy) + 1));
            }
            attestation.commerceContract = changed;
        } else if (field == 1) {
            uint256 changed = uint256(entropy);
            attestation.jobId = changed == attestation.jobId ? changed + 1 : changed;
        } else if (field == 2) {
            attestation.conditionHash =
                entropy == attestation.conditionHash ? bytes32(uint256(entropy) ^ 1) : entropy;
        } else if (field == 3) {
            attestation.evidenceHash =
                entropy == attestation.evidenceHash ? bytes32(uint256(entropy) ^ 1) : entropy;
        } else if (field == 4) {
            uint64 changed = uint64(uint256(entropy));
            attestation.satisfiedAt = changed == attestation.satisfiedAt ? changed + 1 : changed;
        } else if (field == 5) {
            uint64 changed = uint64(uint256(entropy));
            attestation.verifiedAt = changed == attestation.verifiedAt ? changed + 1 : changed;
        } else {
            uint64 changed = uint64(uint256(entropy));
            attestation.validUntil = changed == attestation.validUntil ? changed + 1 : changed;
        }
        assertTrue(evaluator.hashAttestation(attestation) != original);
    }

    function testFuzzAtMostOneAcceptancePerBinding(bytes32 alternateEvidence) public {
        vm.assume(alternateEvidence != bytes32(0));
        vm.assume(alternateEvidence != EVIDENCE_HASH);
        _complete(JOB_ID, EVIDENCE_HASH, VERIFIER_KEY, RELAYER);
        commerce.setStatus(JOB_ID, IPactERC8183.JobStatus.Submitted);

        PactEvaluator.PactCompletionAttestation memory alternate = _attestation(JOB_ID);
        alternate.evidenceHash = alternateEvidence;
        bytes memory signature = _sign(evaluator, alternate, VERIFIER_KEY);
        vm.expectRevert(
            abi.encodeWithSelector(
                PactEvaluator.BindingAlreadyAccepted.selector, evaluator.jobKey(JOB_ID)
            )
        );
        evaluator.completeWithAttestation(alternate, signature);
        assertEq(commerce.completeCallCount(JOB_ID), 1);
    }

    function testFuzzSatisfactionAfterDeadline(uint64 late) public {
        late = DEADLINE + 1 + (late % (SETTLE_NOW - DEADLINE));
        PactEvaluator.PactCompletionAttestation memory attestation = _attestation(JOB_ID);
        attestation.satisfiedAt = late;
        attestation.verifiedAt = SETTLE_NOW;
        vm.expectRevert(
            abi.encodeWithSelector(PactEvaluator.SatisfactionAfterDeadline.selector, late, DEADLINE)
        );
        evaluator.completeWithAttestation(attestation, hex"");
    }

    function testFuzzAtOrAfterExpiryAlwaysRejects(uint64 timestamp) public {
        timestamp = EXPIRES_AT + (timestamp % (type(uint64).max - EXPIRES_AT));
        vm.warp(timestamp);
        PactEvaluator.PactCompletionAttestation memory attestation = _attestation(JOB_ID);
        bytes memory signature = _sign(evaluator, attestation, VERIFIER_KEY);
        vm.expectRevert(
            abi.encodeWithSelector(PactEvaluator.JobAlreadyExpired.selector, EXPIRES_AT)
        );
        evaluator.completeWithAttestation(attestation, signature);
    }

    function testFuzzDownstreamFailureLeavesDigestReusable(bytes32 evidenceHash) public {
        vm.assume(evidenceHash != bytes32(0));
        PactEvaluator.PactCompletionAttestation memory attestation = _attestation(JOB_ID);
        attestation.evidenceHash = evidenceHash;
        bytes memory signature = _sign(evaluator, attestation, VERIFIER_KEY);
        bytes32 digest = evaluator.hashAttestation(attestation);
        commerce.setCompleteBehavior(true, false, false, false);
        vm.expectRevert(MockERC8183.ForcedCompleteRevert.selector);
        evaluator.completeWithAttestation(attestation, signature);
        _assertUnused(JOB_ID, digest);

        commerce.setCompleteBehavior(false, false, false, false);
        evaluator.completeWithAttestation(attestation, signature);
        assertTrue(evaluator.usedAttestations(digest));
    }

    function _complete(uint256 jobId, bytes32 evidenceHash, uint256 key, address relayer) private {
        PactEvaluator.PactCompletionAttestation memory attestation = _attestation(jobId);
        attestation.evidenceHash = evidenceHash;
        vm.prank(relayer);
        evaluator.completeWithAttestation(attestation, _sign(evaluator, attestation, key));
    }

    function _attestation(uint256 jobId)
        private
        view
        returns (PactEvaluator.PactCompletionAttestation memory)
    {
        return PactEvaluator.PactCompletionAttestation({
            commerceContract: address(commerce),
            jobId: jobId,
            conditionHash: CONDITION_HASH,
            evidenceHash: EVIDENCE_HASH,
            satisfiedAt: SATISFIED_AT,
            verifiedAt: VERIFIED_AT,
            validUntil: VALID_UNTIL
        });
    }

    function _sign(
        PactEvaluator target,
        PactEvaluator.PactCompletionAttestation memory attestation,
        uint256 privateKey
    ) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, target.hashAttestation(attestation));
        return abi.encodePacked(r, s, v);
    }

    function _bindAndSubmit(PactEvaluator target, MockERC8183 targetCommerce, uint256 jobId)
        private
    {
        vm.prank(CLIENT);
        target.bindCondition(jobId, CONDITION_HASH, DEADLINE, verifier);
        targetCommerce.setStatus(jobId, IPactERC8183.JobStatus.Submitted);
    }

    function _assertUnused(uint256 jobId, bytes32 digest) private view {
        (, PactEvaluator.Binding memory binding) = evaluator.getBinding(jobId);
        assertFalse(binding.accepted);
        assertFalse(evaluator.usedAttestations(digest));
    }

    function _setJob(uint256 jobId, IPactERC8183.JobStatus status, address jobEvaluator) private {
        commerce.setJob(
            jobId,
            IPactERC8183.Job({
                client: CLIENT,
                status: status,
                provider: PROVIDER,
                expiredAt: EXPIRES_AT,
                evaluator: jobEvaluator,
                submittedAt: 0,
                budget: 1 ether,
                hook: address(0),
                paymentToken: address(0xFEE),
                providerAgentId: 7,
                description: "job",
                settledAmount: 0,
                payoutReceiver: PROVIDER
            })
        );
    }
}

contract PactAttestationVectorTest is TestBase {
    address internal constant VECTOR_EVALUATOR = 0x2222222222222222222222222222222222222222;

    function testCanonicalTypeHashDomainStructDigestAndSignature() public {
        vm.chainId(5042);
        PactEvaluator implementation = new PactEvaluator(
            0x1111111111111111111111111111111111111111,
            0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7,
            address(this)
        );
        vm.etch(VECTOR_EVALUATOR, address(implementation).code);
        PactEvaluator vectorEvaluator = PactEvaluator(VECTOR_EVALUATOR);
        PactEvaluator.PactCompletionAttestation memory attestation =
            PactEvaluator.PactCompletionAttestation({
                commerceContract: 0x1111111111111111111111111111111111111111,
                jobId: 81,
                conditionHash: 0x3da848928dfb0c9f0e98058ec9dc003e1a73952469488ce90fcab1699ccb18b4,
                evidenceHash: 0xbf6e337b678f5f33edaadbb04807b1e721e3893b77e9a758183e931be119f1bc,
                satisfiedAt: 1_800_000_000,
                verifiedAt: 1_800_000_060,
                validUntil: 1_800_003_600
            });

        assertEq(
            vectorEvaluator.PACT_COMPLETION_ATTESTATION_TYPEHASH(),
            0x64fe06ab75261d9f645c41ae59f820d32bbc92b534ff01cb1db5604bd350c005
        );
        assertEq(
            vectorEvaluator.domainSeparator(),
            0x8f5c9fb11eac7b5732837fe88fc0d679d87ac5708696141b8abe752e5870e05d
        );
        assertEq(
            vectorEvaluator.hashAttestationStruct(attestation),
            0x708f3b319473d92387dc959dfcdd95a05f9b105233eed2386e2431bf36c3146f
        );
        bytes32 digest = vectorEvaluator.hashAttestation(attestation);
        assertEq(digest, 0xec6e064c28963959e257c85f104997d6a3413f3e28994f0cb115a559fcf93f25);
        bytes memory signature =
            hex"2f5976b6bdd5b18bb68549c97e0614322a2cf783d3591fd00d3cefd7ff06430e3a0368046e93ec72b7e57895c6b70a373fc1e033b686c61fd07508578905ba8c1c";
        assertEq(ECDSA.recover(digest, signature), 0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7);
    }
}
