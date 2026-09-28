// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IPactERC8183} from "../src/interfaces/IPactERC8183.sol";
import {MockERC8183} from "./fixtures/MockERC8183.sol";
import {TestBase} from "./TestBase.sol";

contract ERC8183CompatibilityTest is TestBase {
    function testPinnedFunctionSelectors() public pure {
        assertEq(bytes32(IPactERC8183.getJob.selector), bytes32(bytes4(0xbf22c457)));
        assertEq(bytes32(IPactERC8183.complete.selector), bytes32(bytes4(0xd75bbdf3)));
    }

    function testPinnedStatusOrdinals() public pure {
        assertEq(uint8(IPactERC8183.JobStatus.Open), 0);
        assertEq(uint8(IPactERC8183.JobStatus.Funded), 1);
        assertEq(uint8(IPactERC8183.JobStatus.Submitted), 2);
        assertEq(uint8(IPactERC8183.JobStatus.Completed), 3);
        assertEq(uint8(IPactERC8183.JobStatus.Rejected), 4);
        assertEq(uint8(IPactERC8183.JobStatus.Expired), 5);
    }

    function testPinnedJobTupleEncodingVector() public pure {
        IPactERC8183.Job memory job = IPactERC8183.Job({
            client: 0x1111111111111111111111111111111111111111,
            status: IPactERC8183.JobStatus.Submitted,
            provider: 0x2222222222222222222222222222222222222222,
            expiredAt: 1_234_567_890,
            evaluator: 0x3333333333333333333333333333333333333333,
            submittedAt: 1_234_560_000,
            budget: 1_000_000,
            hook: 0x4444444444444444444444444444444444444444,
            paymentToken: 0x5555555555555555555555555555555555555555,
            providerAgentId: 77,
            description: "pinned-layout",
            settledAmount: 42,
            payoutReceiver: 0x6666666666666666666666666666666666666666
        });

        assertEq(
            keccak256(abi.encode(job)),
            0x1a6ad581720777244fd47c2eaf8fe36ba06b5119fc70ee494b0b318c383d6000
        );
    }

    function testFixtureRoundTripsEveryPinnedJobField() public {
        MockERC8183 fixture = new MockERC8183();
        IPactERC8183.Job memory expected = IPactERC8183.Job({
            client: address(1),
            status: IPactERC8183.JobStatus.Rejected,
            provider: address(2),
            expiredAt: 3,
            evaluator: address(4),
            submittedAt: 5,
            budget: 6,
            hook: address(7),
            paymentToken: address(8),
            providerAgentId: 9,
            description: "all-fields",
            settledAmount: 10,
            payoutReceiver: address(11)
        });

        fixture.setJob(1, expected);
        IPactERC8183.Job memory actual = fixture.getJob(1);

        assertEq(keccak256(abi.encode(actual)), keccak256(abi.encode(expected)));
    }
}

