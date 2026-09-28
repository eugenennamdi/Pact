// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {IPactERC8183} from "./interfaces/IPactERC8183.sol";

/// @title PactEvaluator
/// @notice Immutable condition binding and positive settlement authority for one ERC-8183 target.
contract PactEvaluator is EIP712 {
    uint8 public constant JOB_IDENTITY_SCHEMA_VERSION = 1;
    bytes32 public constant JOB_IDENTITY_TYPEHASH = keccak256(
        "PactJobIdentity(uint8 schemaVersion,uint256 chainId,address commerceContract,uint256 jobId)"
    );
    bytes32 public constant PACT_COMPLETION_ATTESTATION_TYPEHASH = keccak256(
        "PactCompletionAttestation(address commerceContract,uint256 jobId,bytes32 conditionHash,bytes32 evidenceHash,uint64 satisfiedAt,uint64 verifiedAt,uint64 validUntil)"
    );

    struct PactCompletionAttestation {
        address commerceContract;
        uint256 jobId;
        bytes32 conditionHash;
        bytes32 evidenceHash;
        uint64 satisfiedAt;
        uint64 verifiedAt;
        uint64 validUntil;
    }

    struct Binding {
        bytes32 conditionHash;
        uint64 completionDeadline;
        address verifier;
        bool accepted;
    }

    error ZeroCommerceContract();
    error ZeroInitialVerifier();
    error ZeroAdmin();
    error UnauthorizedAdmin(address caller);
    error InvalidJobId();
    error JobNotFound(uint256 jobId);
    error UnauthorizedClient(address caller, address client);
    error WrongJobStatus(IPactERC8183.JobStatus actual);
    error WrongEvaluator(address actual);
    error ZeroConditionHash();
    error ZeroExpectedVerifier();
    error ZeroVerifier();
    error VerifierChanged(address expected, address current);
    error VerifierIsRevoked(address verifier);
    error VerifierAlreadyRevoked(address verifier);
    error DefaultVerifierUnchanged();
    error BindingAlreadyExists(bytes32 jobKey);
    error CompletionDeadlineNotFuture(uint64 completionDeadline);
    error FiniteExpiryRequired();
    error JobAlreadyExpired(uint48 expiredAt);
    error InsufficientSettlementWindow(uint64 completionDeadline, uint48 expiredAt);
    error BindingNotFound(bytes32 jobKey);
    error BindingAlreadyAccepted(bytes32 jobKey);
    error InvalidCommerceContract(address actual);
    error ZeroEvidenceHash();
    error ConditionMismatch(bytes32 actual, bytes32 expected);
    error SatisfactionAfterDeadline(uint64 satisfiedAt, uint64 completionDeadline);
    error InvalidTimestampOrder(uint64 satisfiedAt, uint64 verifiedAt, uint64 validUntil);
    error FutureTimestamp(uint64 timestamp);
    error AttestationExpired(uint64 validUntil);
    error AttestationValidityBeyondExpiry(uint64 validUntil, uint48 expiredAt);
    error AttestationAlreadyUsed(bytes32 digest);
    error InvalidVerifierSignature(address recovered, address expected);
    error CompletionDidNotFinalize(IPactERC8183.JobStatus actual);

    event ConditionBound(
        bytes32 indexed jobKey,
        uint256 indexed jobId,
        bytes32 indexed conditionHash,
        uint64 completionDeadline,
        address verifier
    );
    event DefaultVerifierChanged(address indexed previousVerifier, address indexed newVerifier);
    event VerifierRevoked(address indexed verifier);
    event PactCompletionAccepted(
        bytes32 indexed jobKey,
        uint256 indexed jobId,
        bytes32 indexed evidenceHash,
        bytes32 conditionHash,
        bytes32 attestationDigest,
        address verifier,
        address relayer
    );

    IPactERC8183 public immutable commerceContract;
    address public immutable admin;
    address public defaultVerifier;
    mapping(address verifier => bool revoked) public isVerifierRevoked;
    mapping(bytes32 attestationDigest => bool used) public usedAttestations;

    mapping(bytes32 jobKey => Binding binding) private _bindings;

    modifier onlyAdmin() {
        if (msg.sender != admin) revert UnauthorizedAdmin(msg.sender);
        _;
    }

    constructor(address commerceContract_, address initialDefaultVerifier_, address admin_)
        EIP712("Pact", "2")
    {
        if (commerceContract_ == address(0)) revert ZeroCommerceContract();
        if (initialDefaultVerifier_ == address(0)) revert ZeroInitialVerifier();
        if (admin_ == address(0)) revert ZeroAdmin();

        commerceContract = IPactERC8183(commerceContract_);
        defaultVerifier = initialDefaultVerifier_;
        admin = admin_;
    }

    /// @notice Derives the canonical Pact identity for a job on this evaluator's immutable target.
    function jobKey(uint256 jobId) public view returns (bytes32) {
        if (jobId == 0) revert InvalidJobId();

        return keccak256(
            abi.encode(
                JOB_IDENTITY_TYPEHASH,
                JOB_IDENTITY_SCHEMA_VERSION,
                block.chainid,
                address(commerceContract),
                jobId
            )
        );
    }

    /// @notice Returns an immutable binding and an explicit existence flag.
    function getBinding(uint256 jobId) external view returns (bool exists, Binding memory binding) {
        binding = _bindings[jobKey(jobId)];
        exists = binding.conditionHash != bytes32(0);
    }

    /// @notice Returns the runtime-chain EIP-712 domain separator for this evaluator.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice Hashes only the canonical Attestation V2 struct fields.
    function hashAttestationStruct(PactCompletionAttestation calldata attestation)
        public
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                PACT_COMPLETION_ATTESTATION_TYPEHASH,
                attestation.commerceContract,
                attestation.jobId,
                attestation.conditionHash,
                attestation.evidenceHash,
                attestation.satisfiedAt,
                attestation.verifiedAt,
                attestation.validUntil
            )
        );
    }

    /// @notice Returns the exact EIP-712 digest accepted by completeWithAttestation.
    function hashAttestation(PactCompletionAttestation calldata attestation)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(hashAttestationStruct(attestation));
    }

    /// @notice Binds an Open ERC-8183 job to one condition and one reviewed verifier.
    function bindCondition(
        uint256 jobId,
        bytes32 conditionHash,
        uint64 completionDeadline,
        address expectedVerifier
    ) external {
        bytes32 key = jobKey(jobId);
        if (conditionHash == bytes32(0)) revert ZeroConditionHash();
        if (expectedVerifier == address(0)) revert ZeroExpectedVerifier();
        if (_bindings[key].conditionHash != bytes32(0)) revert BindingAlreadyExists(key);

        address currentVerifier = defaultVerifier;
        if (expectedVerifier != currentVerifier) {
            revert VerifierChanged(expectedVerifier, currentVerifier);
        }
        if (isVerifierRevoked[expectedVerifier]) revert VerifierIsRevoked(expectedVerifier);

        IPactERC8183.Job memory job = commerceContract.getJob(jobId);
        if (job.client == address(0)) revert JobNotFound(jobId);
        if (msg.sender != job.client) revert UnauthorizedClient(msg.sender, job.client);
        if (job.status != IPactERC8183.JobStatus.Open) revert WrongJobStatus(job.status);
        if (job.evaluator != address(this)) revert WrongEvaluator(job.evaluator);
        // Timestamp ordering is the protocol's explicit deadline model.
        // forge-lint: disable-next-line(block-timestamp)
        if (completionDeadline <= block.timestamp) {
            revert CompletionDeadlineNotFuture(completionDeadline);
        }
        if (job.expiredAt == 0) revert FiniteExpiryRequired();
        // forge-lint: disable-next-line(block-timestamp)
        if (job.expiredAt <= block.timestamp) revert JobAlreadyExpired(job.expiredAt);
        if (completionDeadline >= job.expiredAt) {
            revert InsufficientSettlementWindow(completionDeadline, job.expiredAt);
        }

        _bindings[key] = Binding({
            conditionHash: conditionHash,
            completionDeadline: completionDeadline,
            verifier: expectedVerifier,
            accepted: false
        });

        emit ConditionBound(key, jobId, conditionHash, completionDeadline, expectedVerifier);
    }

    /// @notice Permissionlessly relays one positive authorization into ERC-8183 completion.
    function completeWithAttestation(
        PactCompletionAttestation calldata attestation,
        bytes calldata signature
    ) external {
        address target = address(commerceContract);
        if (attestation.commerceContract != target) {
            revert InvalidCommerceContract(attestation.commerceContract);
        }

        bytes32 key = jobKey(attestation.jobId);
        Binding storage binding = _bindings[key];
        if (binding.conditionHash == bytes32(0)) revert BindingNotFound(key);
        if (attestation.conditionHash != binding.conditionHash) {
            revert ConditionMismatch(attestation.conditionHash, binding.conditionHash);
        }
        if (attestation.evidenceHash == bytes32(0)) revert ZeroEvidenceHash();

        uint48 expiredAt = _validateSettlementJob(attestation.jobId);

        _validateAttestationTime(attestation, binding.completionDeadline, expiredAt);

        bytes32 digest = hashAttestation(attestation);
        address recovered = ECDSA.recoverCalldata(digest, signature);
        if (recovered != binding.verifier) {
            revert InvalidVerifierSignature(recovered, binding.verifier);
        }
        if (isVerifierRevoked[recovered]) revert VerifierIsRevoked(recovered);
        if (usedAttestations[digest]) revert AttestationAlreadyUsed(digest);
        if (binding.accepted) revert BindingAlreadyAccepted(key);

        // Effects precede the untrusted commerce call. Any downstream revert rolls these back.
        usedAttestations[digest] = true;
        binding.accepted = true;

        // The only prior external interaction is getJob through STATICCALL. The event intentionally
        // precedes the state-changing commerce call and rolls back with any downstream failure.
        _emitAcceptance(key, attestation, digest, recovered, msg.sender);

        commerceContract.complete(attestation.jobId, attestation.evidenceHash, bytes(""));

        IPactERC8183.Job memory completedJob = commerceContract.getJob(attestation.jobId);
        if (completedJob.status != IPactERC8183.JobStatus.Completed) {
            revert CompletionDidNotFinalize(completedJob.status);
        }
    }

    /// @notice Changes verifier authority for future bindings only.
    function setDefaultVerifier(address newVerifier) external onlyAdmin {
        if (newVerifier == address(0)) revert ZeroVerifier();
        if (isVerifierRevoked[newVerifier]) revert VerifierIsRevoked(newVerifier);

        address previousVerifier = defaultVerifier;
        if (newVerifier == previousVerifier) revert DefaultVerifierUnchanged();

        defaultVerifier = newVerifier;
        emit DefaultVerifierChanged(previousVerifier, newVerifier);
    }

    /// @notice Permanently disables a verifier for new and settlement checks.
    function revokeVerifier(address verifier) external onlyAdmin {
        if (verifier == address(0)) revert ZeroVerifier();
        if (isVerifierRevoked[verifier]) revert VerifierAlreadyRevoked(verifier);

        isVerifierRevoked[verifier] = true;
        emit VerifierRevoked(verifier);
    }

    function _validateAttestationTime(
        PactCompletionAttestation calldata attestation,
        uint64 completionDeadline,
        uint48 expiredAt
    ) private view {
        if (
            attestation.satisfiedAt == 0 || attestation.verifiedAt == 0
                || attestation.validUntil == 0 || attestation.satisfiedAt > attestation.verifiedAt
                || attestation.verifiedAt > attestation.validUntil
        ) {
            revert InvalidTimestampOrder(
                attestation.satisfiedAt, attestation.verifiedAt, attestation.validUntil
            );
        }
        if (attestation.satisfiedAt > completionDeadline) {
            revert SatisfactionAfterDeadline(attestation.satisfiedAt, completionDeadline);
        }
        // Future factual or verification claims are not accepted.
        // forge-lint: disable-next-line(block-timestamp)
        if (attestation.satisfiedAt > block.timestamp) {
            revert FutureTimestamp(attestation.satisfiedAt);
        }
        // forge-lint: disable-next-line(block-timestamp)
        if (attestation.verifiedAt > block.timestamp) {
            revert FutureTimestamp(attestation.verifiedAt);
        }
        // Validity is inclusive at validUntil.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > attestation.validUntil) {
            revert AttestationExpired(attestation.validUntil);
        }
        // Strict inequality leaves no signature-valid instant at the financial expiry boundary.
        if (attestation.validUntil >= expiredAt) {
            revert AttestationValidityBeyondExpiry(attestation.validUntil, expiredAt);
        }
    }

    function _validateSettlementJob(uint256 jobId) private view returns (uint48 expiredAt) {
        IPactERC8183.Job memory job = commerceContract.getJob(jobId);
        if (job.client == address(0)) revert JobNotFound(jobId);
        if (job.status != IPactERC8183.JobStatus.Submitted) revert WrongJobStatus(job.status);
        if (job.evaluator != address(this)) revert WrongEvaluator(job.evaluator);
        expiredAt = job.expiredAt;
        if (expiredAt == 0) revert FiniteExpiryRequired();
        // Pact deliberately refuses completion at the financial expiry boundary.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp >= expiredAt) revert JobAlreadyExpired(expiredAt);
    }

    function _emitAcceptance(
        bytes32 k,
        PactCompletionAttestation calldata a,
        bytes32 d,
        address v,
        address r
    ) private {
        uint256 id = a.jobId;
        bytes32 e = a.evidenceHash;
        bytes32 c = a.conditionHash;
        // forge-lint: disable-next-line(reentrancy-events)
        emit PactCompletionAccepted(k, id, e, c, d, v, r);
    }
}
