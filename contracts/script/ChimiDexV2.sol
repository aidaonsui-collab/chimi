// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vm} from "forge-std/Vm.sol";
import {TransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {InstantErc20QuoteFactoryProxyInit} from "../src/InstantErc20QuoteFactoryProxyInit.sol";
import {MonLockProxyInit} from "../src/MonLockProxyInit.sol";
import {ArcBpsSource} from "../src/ArcBpsSource.sol";
import {ChimiFlywheel} from "../src/ChimiFlywheel.sol";
import {DummyNFTDescriptor} from "./testnet/DummyNFTDescriptor.sol";

interface IUniV3FactoryTiers {
    function enableFeeAmount(uint24 fee, int24 tickSpacing) external;
    function feeAmountTickSpacing(uint24 fee) external view returns (int24);
    function setOwner(address owner) external;
    function owner() external view returns (address);
}

/// @notice The second DEX for Chimi and the fee flywheel. New coins launch into 2% pools on a fresh copy of
///         Uniswap v3 (2% and 3% tiers switched on, from the same published bytecode as the first DEX), with
///         their own position manager, router and locker (a locker serves one position manager). Their ETH
///         fees split 70% creator / 15% flywheel / 15% platform; the flywheel halves its 15% into CHIMI
///         buybacks that burn and ETH for CHIMI holders. Coins already launched keep their 1% pools and 70/30.
///
///         `deploy` creates the contracts. `wire` is the owner's three settings that send new launches there.
///         Not a Script, so forge tests can call it.
library ChimiDexV2 {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint24 internal constant POOL_FEE = 20_000;
    int24 internal constant TICK_SPACING = 400;
    uint24 internal constant FEE_3PCT = 30_000;
    int24 internal constant TICK_SPACING_3PCT = 600;
    /// @notice New coins' ETH fees: 70% creator, 15% flywheel (the locker's staker leg), 15% platform (the rest).
    uint16 internal constant CREATOR_BPS = 7_000;
    uint16 internal constant FLYWHEEL_BPS = 1_500;

    struct Params {
        address owner;
        /// The lock beneficiary: collects the platform's 15% and could reclaim a position after the term.
        address platform;
        address weth;
        uint64 lockDuration;
        /// CHIMI, the router of the DEX its pool is on, and that pool's fee.
        address chimi;
        address chimiRouter;
        uint24 chimiPoolFee;
        address keeper;
    }

    struct Addresses {
        address uniFactory;
        address nftDescriptor;
        address nfpm;
        address swapRouter02;
        address lockerImpl;
        address locker;
        address flywheel;
    }

    function deploy(Params memory p) internal returns (Addresses memory a) {
        require(p.owner != address(0) && p.platform != address(0) && p.weth != address(0), "params");

        a.uniFactory = _deployCode(_creation("UniswapV3Factory.hex"));
        IUniV3FactoryTiers(a.uniFactory).enableFeeAmount(POOL_FEE, TICK_SPACING);
        IUniV3FactoryTiers(a.uniFactory).enableFeeAmount(FEE_3PCT, TICK_SPACING_3PCT);

        a.nftDescriptor = address(new DummyNFTDescriptor());
        a.nfpm = _deployCode(
            _creation("NonfungiblePositionManager.hex"), abi.encode(a.uniFactory, p.weth, a.nftDescriptor)
        );
        // SwapRouter02 has no deadline. factoryV2 stays unset; Chimi has no v2.
        a.swapRouter02 =
            _deployCode(_creation("SwapRouter02.hex"), abi.encode(address(0), a.uniFactory, a.nfpm, p.weth));

        MonLockProxyInit lockerImpl = new MonLockProxyInit(a.nfpm);
        a.lockerImpl = address(lockerImpl);
        a.locker = address(
            new TransparentUpgradeableProxy(
                address(lockerImpl),
                p.owner,
                abi.encodeCall(MonLockProxyInit.initialize, (p.platform, p.owner, p.lockDuration))
            )
        );

        a.flywheel = address(new ChimiFlywheel(p.weth, p.chimi, p.chimiRouter, p.chimiPoolFee, p.keeper, p.owner));
    }

    /// @notice The owner's settings, in order: the new locker accepts stamps from the pad; new launches split
    ///         70/15/15 with the 15% flywheel share going to the flywheel; new launches go to the 2% DEX.
    ///         Each one only reaches coins launched after it.
    function wire(Addresses memory a, address factory, address bpsSource) internal {
        MonLockProxyInit(payable(a.locker)).setStamper(factory);
        ArcBpsSource(bpsSource).setMemeBps(CREATOR_BPS, FLYWHEEL_BPS);
        InstantErc20QuoteFactoryProxyInit pad = InstantErc20QuoteFactoryProxyInit(payable(factory));
        pad.setStakingPool(a.flywheel);
        pad.setUniV3Config(a.nfpm, POOL_FEE, TICK_SPACING, a.locker, a.swapRouter02);
    }

    /// @notice Gives up the new DEX's owner once its tiers are checked, so no one can switch on Uniswap's
    ///         protocol fee or add tiers. Permanent, as it was for the first DEX.
    function renounce(Addresses memory a) internal {
        IUniV3FactoryTiers uni = IUniV3FactoryTiers(a.uniFactory);
        require(uni.feeAmountTickSpacing(POOL_FEE) == TICK_SPACING, "2% tier");
        require(uni.feeAmountTickSpacing(FEE_3PCT) == TICK_SPACING_3PCT, "3% tier");
        uni.setOwner(address(0));
    }

    function _deployCode(bytes memory bytecode) private returns (address addr) {
        assembly {
            addr := create(0, add(bytecode, 0x20), mload(bytecode))
        }
        require(addr != address(0), "deploy");
    }

    function _deployCode(bytes memory creation, bytes memory ctorArgs) private returns (address) {
        return _deployCode(abi.encodePacked(creation, ctorArgs));
    }

    function _creation(string memory filename) private view returns (bytes memory) {
        return vm.parseBytes(vm.readFile(string.concat("./script/bytecode/", filename)));
    }
}
