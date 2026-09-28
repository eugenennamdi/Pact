// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function assume(bool condition) external;
    function chainId(uint256 newChainId) external;
    function etch(address target, bytes calldata newRuntimeBytecode) external;
    function expectEmit(bool checkTopic1, bool checkTopic2, bool checkTopic3, bool checkData)
        external;
    function expectEmit(
        bool checkTopic1,
        bool checkTopic2,
        bool checkTopic3,
        bool checkData,
        address emitter
    ) external;
    function expectRevert() external;
    function expectRevert(bytes4 revertData) external;
    function expectRevert(bytes calldata revertData) external;
    function expectPartialRevert(bytes4 revertData) external;
    function prank(address msgSender) external;
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 newTimestamp) external;
}

abstract contract TestBase {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function assertTrue(bool value) internal pure {
        assert(value);
    }

    function assertFalse(bool value) internal pure {
        assert(!value);
    }

    function assertEq(address actual, address expected) internal pure {
        assert(actual == expected);
    }

    function assertEq(bytes32 actual, bytes32 expected) internal pure {
        assert(actual == expected);
    }

    function assertEq(uint256 actual, uint256 expected) internal pure {
        assert(actual == expected);
    }

    function assertEq(bytes memory actual, bytes memory expected) internal pure {
        assert(keccak256(actual) == keccak256(expected));
    }
}
