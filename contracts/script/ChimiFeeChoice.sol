// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vm} from "forge-std/Vm.sol";
import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {ITransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {ArcBpsSource} from "../src/ArcBpsSource.sol";
import {ChimiBurner} from "../src/ChimiBurner.sol";
import {ChimiPadV2} from "../src/ChimiPadV2.sol";
import {InstantErc20QuoteFactoryProxyInit} from "../src/InstantErc20QuoteFactoryProxyInit.sol";
import {MonLock} from "../src/MonLock.sol";

/// @notice The launch fee choice. A creator decides at launch whether 10% of the coin's ETH trading fees buy the coin
///         back and burn it:
///           • burns itself (the default in the app): 70% creator, 10% the coin's own burn, 5% CHIMI burn, 15% platform;
///           • doesn't: 80% creator, 5% CHIMI burn, 15% platform.
///         Coins already launched keep the percentages on their locks.
///
///         `deploy` creates the ChimiBurner and the new pad implementation. `wire` is the owner's settings and the
///         pad upgrade, in an order where every launch in between still gets a whole split. `retarget` points the
///         flywheel share of coins already on the locker at the CHIMI burn instead (their percentages stay).
///         Not a Script, so forge tests can call it.
library ChimiFeeChoice {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    /// @dev ERC-1967 admin slot: the ProxyAdmin of a TransparentUpgradeableProxy.
    bytes32 internal constant ADMIN_SLOT = 0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;

    /// @notice A coin that doesn't burn itself: 80% creator, 5% CHIMI burn, 15% platform (the rest).
    uint16 internal constant CREATOR_BPS = 8_000;
    uint16 internal constant CHIMI_BURN_BPS = 500;
    /// @notice A coin that burns itself: 70% creator, 10% own burn, 5% CHIMI burn, 15% platform (the rest).
    uint16 internal constant BURNING_CREATOR_BPS = 7_000;
    uint16 internal constant OWN_BURN_BPS = 1_000;

    struct Params {
        address owner;
        address pad;
        address chimi;
        /// The router of the DEX CHIMI's pool is on, and that pool's fee.
        address chimiRouter;
        uint24 chimiPoolFee;
        address keeper;
    }

    struct Addresses {
        address burner;
        address coinBurnerImpl;
        address padImpl;
    }

    function deploy(Params memory p) internal returns (Addresses memory a) {
        InstantErc20QuoteFactoryProxyInit pad = InstantErc20QuoteFactoryProxyInit(payable(p.pad));
        address weth = address(pad.WETH());
        ChimiBurner burner = new ChimiBurner(weth, p.chimi, p.chimiRouter, p.chimiPoolFee, p.pad, p.keeper, p.owner);
        a.burner = address(burner);
        a.coinBurnerImpl = burner.COIN_BURNER_IMPL();
        // Same quote, decimals and WETH as the live implementation; those are in its code, not in the proxy.
        a.padImpl = address(new ChimiPadV2(address(pad.QUOTE()), pad.quoteDecimals(), weth, a.burner));
    }

    /// @notice The pad's ProxyAdmin.
    function proxyAdmin(address pad) internal view returns (address) {
        return address(uint160(uint256(vm.load(pad, ADMIN_SLOT))));
    }

    /// @notice In order: the burning split (read only by the new implementation, so it changes nothing yet); the
    ///         non-burning split and the CHIMI burn as the staker leg (from here, launches through the old
    ///         implementation already get 80/5/15); then the upgrade, which adds the choice.
    function wire(Addresses memory a, address pad, address bpsSource) internal {
        ArcBpsSource bps = ArcBpsSource(bpsSource);
        bps.setBackedBps(OWN_BURN_BPS, CHIMI_BURN_BPS, BURNING_CREATOR_BPS);
        bps.setMemeBps(CREATOR_BPS, CHIMI_BURN_BPS);
        InstantErc20QuoteFactoryProxyInit(payable(pad)).setStakingPool(a.burner);
        ProxyAdmin(proxyAdmin(pad)).upgradeAndCall(ITransparentUpgradeableProxy(pad), a.padImpl, "");
    }

    /// @notice Every lock on `locker` whose staker share goes to `from` (the flywheel) now sends it to `to` (the
    ///         CHIMI burn). Its percentages don't change. Returns how many locks moved.
    function retarget(address locker, address from, address to) internal returns (uint256 moved) {
        MonLock l = MonLock(payable(locker));
        uint256[] memory ids = l.allLockedPositions();
        for (uint256 i = 0; i < ids.length; i++) {
            (address wallet,) = l.stakerSplits(ids[i]);
            if (wallet != from) continue;
            l.retargetFeeRecipients(ids[i], address(0), to);
            moved++;
        }
    }
}
