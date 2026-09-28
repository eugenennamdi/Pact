// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IPactERC8183} from "../../src/interfaces/IPactERC8183.sol";

/// @notice Deterministic fixture using the exact pinned IPactERC8183 tuple.
contract MockERC8183 is IPactERC8183 {
    error ForcedGetJobRevert();
    error ForcedCompleteRevert();
    error ForcedHookRevert();
    error InvalidJob();
    error WrongStatus();
    error Unauthorized();
    error ReentryUnexpectedlySucceeded();

    mapping(uint256 jobId => Job job) private _jobs;
    bool public shouldRevertGetJob;
    address public reentryTarget;
    bytes public reentryCalldata;
    bool public shouldRevertComplete;
    bool public shouldRevertHook;
    bool public shouldNoopComplete;
    bool public shouldChangeStatusBeforeComplete;
    address public completeReentryTarget;
    bytes public completeReentryCalldata;
    bool public lastCompleteReentrySucceeded;
    mapping(uint256 jobId => bytes32 reason) public completionReason;
    mapping(uint256 jobId => address caller) public completionCaller;
    mapping(uint256 jobId => uint256 count) public completeCallCount;

    function setJob(uint256 jobId, Job calldata job) external {
        _jobs[jobId] = job;
    }

    function setStatus(uint256 jobId, JobStatus status) external {
        _jobs[jobId].status = status;
    }

    function setEvaluator(uint256 jobId, address evaluator) external {
        _jobs[jobId].evaluator = evaluator;
    }

    function setRevertGetJob(bool enabled) external {
        shouldRevertGetJob = enabled;
    }

    function setReentry(address target, bytes calldata data) external {
        reentryTarget = target;
        reentryCalldata = data;
    }

    function setCompleteBehavior(
        bool revertComplete,
        bool revertHook,
        bool noopComplete,
        bool changeStatusBeforeComplete
    ) external {
        shouldRevertComplete = revertComplete;
        shouldRevertHook = revertHook;
        shouldNoopComplete = noopComplete;
        shouldChangeStatusBeforeComplete = changeStatusBeforeComplete;
    }

    function setCompleteReentry(address target, bytes calldata data) external {
        completeReentryTarget = target;
        completeReentryCalldata = data;
    }

    function getJob(uint256 jobId) external view returns (Job memory) {
        if (shouldRevertGetJob) revert ForcedGetJobRevert();

        address target = reentryTarget;
        if (target != address(0)) {
            // The evaluator calls this view through STATICCALL. A nested binding can execute
            // checks but cannot persist state; the gas cap also bounds a recursive fixture.
            (bool reentrySucceeded,) = target.staticcall{gas: 30_000}(reentryCalldata);
            if (reentrySucceeded) revert ReentryUnexpectedlySucceeded();
        }

        return _jobs[jobId];
    }

    function complete(uint256 jobId, bytes32 reason, bytes calldata) external {
        if (shouldRevertComplete) revert ForcedCompleteRevert();

        Job storage job = _jobs[jobId];
        if (jobId == 0 || job.client == address(0)) revert InvalidJob();
        if (shouldChangeStatusBeforeComplete) job.status = JobStatus.Completed;
        if (job.status != JobStatus.Submitted) revert WrongStatus();
        if (msg.sender != job.evaluator) revert Unauthorized();

        address callbackTarget = completeReentryTarget;
        if (callbackTarget != address(0)) {
            (bool reentrySucceeded,) = callbackTarget.call(completeReentryCalldata);
            lastCompleteReentrySucceeded = reentrySucceeded;
        }

        if (shouldRevertHook) revert ForcedHookRevert();
        if (shouldNoopComplete) return;

        job.status = JobStatus.Completed;
        completionReason[jobId] = reason;
        completionCaller[jobId] = msg.sender;
        completeCallCount[jobId]++;
    }
}

/// @notice Returns malformed data for every selector to exercise strict ABI decoding.
contract MalformedERC8183 {
    fallback(bytes calldata) external returns (bytes memory) {
        return hex"01";
    }
}
