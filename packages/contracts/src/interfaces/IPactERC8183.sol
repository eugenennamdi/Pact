// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Minimal Pact compatibility boundary for ERC-8183.
/// @dev Pinned to erc-8183/base-contracts commit
///      142e669c1fd318486a4628395b629f033654dd06. Field order and types are ABI-critical.
interface IPactERC8183 {
    enum JobStatus {
        Open,
        Funded,
        Submitted,
        Completed,
        Rejected,
        Expired
    }

    struct Job {
        address client;
        JobStatus status;
        address provider;
        uint48 expiredAt;
        address evaluator;
        uint48 submittedAt;
        uint256 budget;
        address hook;
        address paymentToken;
        uint256 providerAgentId;
        string description;
        uint256 settledAmount;
        address payoutReceiver;
    }

    function getJob(uint256 jobId) external view returns (Job memory);

    /// @dev Exact pinned completion selector invoked by PactEvaluator after authorization.
    function complete(uint256 jobId, bytes32 reason, bytes calldata optParams) external;
}
