// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CommonBase} from "forge-std/Base.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {ChimiV4Launcher} from "../src/v4/ChimiV4Launcher.sol";
import {ChimiTaxHook} from "../src/v4/ChimiTaxHook.sol";
import {ChimiV4Router} from "../src/v4/ChimiV4Router.sol";

/// @notice Shared by the GIWA deploy script and the fork test.
///         1. Uniswap v4 PoolManager from the pinned v4-core package (or an existing one, when `poolManager_` is set),
///         2. the launcher, which creates the token factory and the  locker,
///         3. the tax hook, CREATE2-mined so its address carries the hook permission bits,
///         4. `setHook`, then the router.
///         Ownership of the launcher stays with `deployer` until they pass it on. PoolManager ownership is `owner`.
abstract contract ChimiV4Deployer is CommonBase {
    uint160 internal constant HOOK_FLAGS = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
        | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;

    struct V4Deployment {
        IPoolManager poolManager;
        ChimiV4Launcher launcher;
        ChimiTaxHook hook;
        ChimiV4Router router;
    }

    error HookSaltNotFound();
    error Create2Failed();

    function _deployChimiV4(
        address owner,
        address treasury,
        address stakingPool,
        address bpsSource,
        address deployer,
        uint64 lockDuration,
        address poolManager_
    ) internal returns (V4Deployment memory d) {
        if (poolManager_ == address(0)) {
            d.poolManager = IPoolManager(address(new PoolManager(owner)));
        } else {
            d.poolManager = IPoolManager(poolManager_);
        }
        d.launcher = new ChimiV4Launcher(d.poolManager, treasury, stakingPool, bpsSource, deployer, lockDuration);
        bytes memory initCode = abi.encodePacked(type(ChimiTaxHook).creationCode, abi.encode(d.poolManager, d.launcher));
        bytes32 salt = mineHookSalt(keccak256(initCode));
        (bool ok, bytes memory ret) = CREATE2_FACTORY.call(abi.encodePacked(salt, initCode));
        if (!ok || ret.length != 20) revert Create2Failed();
        d.hook = ChimiTaxHook(address(bytes20(ret)));
        d.launcher.setHook(d.hook);
        d.router = new ChimiV4Router(d.poolManager, d.hook);
        if (owner != deployer) d.launcher.transferOwnership(owner);
    }

    /// @notice The first salt whose CREATE2 address, from the canonical factory, carries exactly the hook's permission bits.
    function mineHookSalt(bytes32 initCodeHash) public view returns (bytes32) {
        for (uint256 i; i < 200_000; ++i) {
            address a = vm.computeCreate2Address(bytes32(i), initCodeHash, CREATE2_FACTORY);
            if (uint160(a) & Hooks.ALL_HOOK_MASK == HOOK_FLAGS) return bytes32(i);
        }
        revert HookSaltNotFound();
    }
}
