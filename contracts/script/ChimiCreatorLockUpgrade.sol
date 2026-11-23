// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {ITransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {ChimiCreatorLock} from "../src/ChimiCreatorLock.sol";
import {ChimiPadV3} from "../src/ChimiPadV3.sol";
import {InstantErc20QuoteFactoryProxyInit} from "../src/InstantErc20QuoteFactoryProxyInit.sol";
import {ChimiFeeChoice} from "./ChimiFeeChoice.sol";

/// @notice The creator first-buy lock, on a pad that already has the fee choice (ChimiPadV2): `deploy` creates the
///         ChimiCreatorLock (fixed to the pad's proxy) and ChimiPadV3 (the same quote, WETH and burner as the live
///         implementation, plus the lock); `wire` upgrades the pad. Coins already launched are untouched: the lock only
///         ever holds first buys of launches made with `createTokenWithEthLocked`.
///         Not a Script, so forge tests can call it.
library ChimiCreatorLockUpgrade {
    struct Addresses {
        address creatorLock;
        address padImpl;
    }

    /// @param burner the ChimiBurner the live pad uses (ChimiPadV2.BURNER()).
    function deploy(address pad, address burner) internal returns (Addresses memory a) {
        InstantErc20QuoteFactoryProxyInit p = InstantErc20QuoteFactoryProxyInit(payable(pad));
        a.creatorLock = address(new ChimiCreatorLock(pad));
        // Same quote, decimals and WETH as the live implementation; those are in its code, not in the proxy.
        a.padImpl = address(new ChimiPadV3(address(p.QUOTE()), p.quoteDecimals(), address(p.WETH()), burner, a.creatorLock));
    }

    function wire(Addresses memory a, address pad) internal {
        ProxyAdmin(ChimiFeeChoice.proxyAdmin(pad)).upgradeAndCall(ITransparentUpgradeableProxy(pad), a.padImpl, "");
    }
}
