// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vm} from "forge-std/Vm.sol";
import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {
    ITransparentUpgradeableProxy,
    TransparentUpgradeableProxy
} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {ArcBpsSource} from "../src/ArcBpsSource.sol";
import {ChimiBurner} from "../src/ChimiBurner.sol";
import {ChimiPadV3} from "../src/ChimiPadV3.sol";
import {ChimiCreatorLock} from "../src/ChimiCreatorLock.sol";
import {ChimiTips} from "../src/ChimiTips.sol";
import {InstantErc20QuoteFactoryProxyInit} from "../src/InstantErc20QuoteFactoryProxyInit.sol";
import {MonLockProxyInit} from "../src/MonLockProxyInit.sol";
import {DummyNFTDescriptor} from "./testnet/DummyNFTDescriptor.sol";
import {ChimiFeeChoice} from "./ChimiFeeChoice.sol";

interface IUniV3FactoryMain {
    function enableFeeAmount(uint24 fee, int24 tickSpacing) external;
    function feeAmountTickSpacing(uint24 fee) external view returns (int24);
    function setOwner(address owner) external;
    function owner() external view returns (address);
    function getPool(address a, address b, uint24 fee) external view returns (address);
}

interface IRouterFactoryMain {
    function factory() external view returns (address);
}

/// @notice Chimi on a new chain, in its final form, in one go: the shape GIWA Sepolia reached in steps (first DEX at
///         1%, then the 2% DEX and flywheel, then the fee choice), without the steps.
///
///           1. `deployStack`: a copy of Uniswap v3 with the 2% and 3% tiers switched on and its owner given up, the
///              fee settings (80/5/15 for a coin that doesn't burn itself, 70/10/5/15 for one that does), the locker
///              and the pad, launching into 2% pools. Until the burner exists, the 5% CHIMI-burn share of a launch
///              goes to the platform wallet.
///           2. CHIMI: `launchChimi` launches it on the pad just deployed, or it is a token that already has a pool.
///           3. `deployBurns` + `wireBurns`: the ChimiBurner (fixed to CHIMI, the router of CHIMI's pool and that pool's
///              fee) and the pad's implementation with the launch choice; the pad's 5% share then goes to the burner,
///              the pad is upgraded, and launches made before (CHIMI's own, when it launched here) are pointed at the
///              burner too.
///           4. `deployTips`: tips to streaming creators (90% creator, 10% platform).
///
///         The ChimiBurner needs the pad's address and the pad's new code needs the burner's, which is why the pad
///         starts on its first implementation and is upgraded in step 3. No flywheel: holder payouts ended with the
///         fee choice. Not a Script, so forge tests can call it.
library ChimiMainnet {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint24 internal constant POOL_FEE = 20_000;
    int24 internal constant TICK_SPACING = 400;
    uint24 internal constant FEE_3PCT = 30_000;
    int24 internal constant TICK_SPACING_3PCT = 600;

    struct Params {
        /// Owns the pad, its ProxyAdmin, the fee settings, the locker, the burner and tips. The signer.
        address owner;
        /// The platform: the pad's treasury (creation fees), the locks' beneficiary (the 15% share) and tips' 10%.
        address platform;
        /// The canonical wrapped ETH (0x4200…0006 on an OP Stack chain such as GIWA).
        address weth;
        uint64 lockDuration;
        uint256 creationFee;
        /// Sets the opening price of every coin: spot FDV in ETH is quote × 1e9 / VIRTUAL_TOKEN_INIT.
        uint256 launchVirtualQuote;
    }

    struct Stack {
        address uniFactory;
        address nftDescriptor;
        address nfpm;
        address swapRouter02;
        address bpsSource;
        address lockerImpl;
        address locker;
        address padImpl;
        address pad;
    }

    struct Burns {
        address burner;
        address coinBurnerImpl;
        address padImpl;
        /// Holds creators' locked first buys (ChimiPadV3.createTokenWithEthLocked).
        address creatorLock;
    }

    // ─── 1. the stack ───────────────────────────────────────────────────────────────────────────────────────────

    function deployStack(Params memory p) internal returns (Stack memory s) {
        require(p.owner != address(0) && p.platform != address(0) && p.weth != address(0), "params");
        require(p.weth.code.length > 0, "no WETH at that address");
        require(p.launchVirtualQuote > 0, "launch price");

        s.uniFactory = _deployCode(_creation("UniswapV3Factory.hex"));
        IUniV3FactoryMain(s.uniFactory).enableFeeAmount(POOL_FEE, TICK_SPACING);
        IUniV3FactoryMain(s.uniFactory).enableFeeAmount(FEE_3PCT, TICK_SPACING_3PCT);
        s.nftDescriptor = address(new DummyNFTDescriptor());
        s.nfpm = _deployCode(
            _creation("NonfungiblePositionManager.hex"), abi.encode(s.uniFactory, p.weth, s.nftDescriptor)
        );
        // SwapRouter02 has no deadline. factoryV2 stays unset; Chimi has no v2.
        s.swapRouter02 =
            _deployCode(_creation("SwapRouter02.hex"), abi.encode(address(0), s.uniFactory, s.nfpm, p.weth));

        ArcBpsSource bps = new ArcBpsSource(p.owner);
        s.bpsSource = address(bps);
        bps.setMemeBps(ChimiFeeChoice.CREATOR_BPS, ChimiFeeChoice.CHIMI_BURN_BPS);
        bps.setBackedBps(ChimiFeeChoice.OWN_BURN_BPS, ChimiFeeChoice.CHIMI_BURN_BPS, ChimiFeeChoice.BURNING_CREATOR_BPS);

        MonLockProxyInit lockerImpl = new MonLockProxyInit(s.nfpm);
        s.lockerImpl = address(lockerImpl);
        s.locker = address(
            new TransparentUpgradeableProxy(
                address(lockerImpl),
                p.owner,
                abi.encodeCall(MonLockProxyInit.initialize, (p.platform, p.owner, p.lockDuration))
            )
        );

        InstantErc20QuoteFactoryProxyInit padImpl = new InstantErc20QuoteFactoryProxyInit(p.weth, 18, p.weth);
        s.padImpl = address(padImpl);
        s.pad = address(
            new TransparentUpgradeableProxy(
                address(padImpl),
                p.owner,
                // The staker leg (the 5% CHIMI burn) goes to the platform until the burner exists (wireBurns).
                abi.encodeCall(
                    InstantErc20QuoteFactoryProxyInit.initialize,
                    (p.platform, p.platform, p.owner, s.bpsSource, p.launchVirtualQuote)
                )
            )
        );
        InstantErc20QuoteFactoryProxyInit pad = InstantErc20QuoteFactoryProxyInit(payable(s.pad));
        pad.setUniV3Config(s.nfpm, POOL_FEE, TICK_SPACING, s.locker, s.swapRouter02);
        if (p.creationFee > 0) pad.setCreationFee(p.creationFee);
        MonLockProxyInit(payable(s.locker)).setStamper(s.pad);

        // No one can switch on Uniswap's protocol fee or add tiers. Permanent.
        IUniV3FactoryMain uni = IUniV3FactoryMain(s.uniFactory);
        require(uni.feeAmountTickSpacing(POOL_FEE) == TICK_SPACING, "2% tier");
        require(uni.feeAmountTickSpacing(FEE_3PCT) == TICK_SPACING_3PCT, "3% tier");
        uni.setOwner(address(0));
    }

    // ─── 2. CHIMI ───────────────────────────────────────────────────────────────────────────────────────────────

    /// @notice Launches CHIMI on the pad from the signer, who becomes its creator. `value` is the creation fee plus
    ///         any first buy.
    function launchChimi(Stack memory s, string memory name, string memory symbol, uint256 value)
        internal
        returns (address chimi)
    {
        chimi = InstantErc20QuoteFactoryProxyInit(payable(s.pad)).createTokenMemeInstantQuoteWithEth{value: value}(
            name, symbol
        );
    }

    /// @notice True when `router`'s Uniswap v3 factory has a CHIMI/WETH pool at `fee`: where the burner will buy.
    function chimiPoolExists(address weth, address chimi, address router, uint24 fee) internal view returns (bool) {
        address factory = IRouterFactoryMain(router).factory();
        return IUniV3FactoryMain(factory).getPool(weth, chimi, fee) != address(0);
    }

    // ─── 3. the burns ───────────────────────────────────────────────────────────────────────────────────────────

    function deployBurns(
        Stack memory s,
        address weth,
        address chimi,
        address chimiRouter,
        uint24 chimiPoolFee,
        address keeper,
        address owner
    ) internal returns (Burns memory b) {
        require(chimiPoolExists(weth, chimi, chimiRouter, chimiPoolFee), "no CHIMI pool on that router at that fee");
        ChimiBurner burner = new ChimiBurner(weth, chimi, chimiRouter, chimiPoolFee, s.pad, keeper, owner);
        b.burner = address(burner);
        b.coinBurnerImpl = burner.COIN_BURNER_IMPL();
        b.creatorLock = address(new ChimiCreatorLock(s.pad));
        b.padImpl = address(new ChimiPadV3(weth, 18, weth, b.burner, b.creatorLock));
    }

    /// @notice The pad's 5% share goes to the burner, the pad gets the launch choice and the creator first-buy lock
    ///         (ChimiPadV3), and launches made before now
    ///         (whose 5% went to the platform) feed the burner too. Returns how many of those were moved.
    function wireBurns(Stack memory s, Burns memory b, address platform) internal returns (uint256 moved) {
        InstantErc20QuoteFactoryProxyInit(payable(s.pad)).setStakingPool(b.burner);
        ProxyAdmin(ChimiFeeChoice.proxyAdmin(s.pad)).upgradeAndCall(ITransparentUpgradeableProxy(s.pad), b.padImpl, "");
        moved = ChimiFeeChoice.retarget(s.locker, platform, b.burner);
    }

    // ─── 4. tips ────────────────────────────────────────────────────────────────────────────────────────────────

    function deployTips(Stack memory s, address platform, address owner) internal returns (address) {
        return address(new ChimiTips(s.pad, platform, owner));
    }

    // ─── helpers ────────────────────────────────────────────────────────────────────────────────────────────────

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
