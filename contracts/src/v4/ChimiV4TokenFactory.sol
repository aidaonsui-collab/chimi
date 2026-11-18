// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ChimiV4Token} from "./ChimiV4Token.sol";

/// @title ChimiV4TokenFactory
/// @notice Deploys v4 launch tokens for the launcher that created it, which keeps the token's code out of the
///         launcher (the 24 KB contract size limit). CREATE2, so addresses are predictable.
contract ChimiV4TokenFactory {
    address public immutable launcher;

    error OnlyLauncher();

    constructor() {
        launcher = msg.sender;
    }

    function deploy(
        bytes32 salt,
        string calldata name,
        string calldata symbol,
        address hook,
        address poolManager,
        address locker
    ) external returns (address) {
        if (msg.sender != launcher) revert OnlyLauncher();
        return address(new ChimiV4Token{salt: salt}(name, symbol, launcher, hook, poolManager, locker));
    }

    function predict(
        bytes32 salt,
        string calldata name,
        string calldata symbol,
        address hook,
        address poolManager,
        address locker
    ) external view returns (address) {
        bytes32 initCode = keccak256(
            abi.encodePacked(
                type(ChimiV4Token).creationCode, abi.encode(name, symbol, launcher, hook, poolManager, locker)
            )
        );
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCode)))));
    }
}
