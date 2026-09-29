// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @notice Standard ERC-1967 proxy used for Pact's pinned ERC-8183 deployment.
/// @dev Runtime behavior is inherited unchanged from OpenZeppelin 5.6.1.
contract PactManagedERC8183Proxy is ERC1967Proxy {
    constructor(address implementation, bytes memory initialization)
        ERC1967Proxy(implementation, initialization)
    {}
}
