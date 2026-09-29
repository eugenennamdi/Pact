// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Local-only six-decimal stand-in for Arc's canonical USDC interface.
contract MockArcUSDC is ERC20 {
    constructor(address recipient, uint256 amount) ERC20("Mock Arc USDC", "USDC") {
        _mint(recipient, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}
