// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {InstantErc20QuoteFactory} from "../src/InstantErc20QuoteFactory.sol";
import {MonLock} from "../src/MonLock.sol";
import {ArcBpsSource} from "../src/ArcBpsSource.sol";

interface ILiveV3Factory {
    function owner() external view returns (address);
    function feeAmountTickSpacing(uint24 fee) external view returns (int24);
    function getPool(address a, address b, uint24 fee) external view returns (address);
}

interface ILiveV3Pool {
    function factory() external view returns (address);
    function fee() external view returns (uint24);
}

interface ILivePeriphery {
    function factory() external view returns (address);
    function WETH9() external view returns (address);
}

interface ILiveNpm {
    function ownerOf(uint256 tokenId) external view returns (address);
}

interface ILiveRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
    function unwrapWETH9(uint256 amountMinimum, address recipient) external payable;
    function multicall(uint256 deadline, bytes[] calldata data) external payable returns (bytes[] memory results);
    function positionManager() external view returns (address);
}

/// @notice Checks the contracts that are live on GIWA Sepolia, at the addresses the site reads from
///         `web/public/deployments.json`, on a fork of the chain. Nothing is sent to the real chain.
///
///         Chimi has more than one DEX: coins launched first trade on a 1% copy of Uniswap v3, later ones on a 2%
///         copy with its own position manager, router and locker (`dexes` in deployments.json, oldest first; new
///         coins launch on the last). Each coin is checked against the DEX its pool is on.
///
///         GIWA_RPC=https://sepolia-rpc.giwa.io forge test --match-contract ChimiLiveForkTest
///
///         Without GIWA_RPC every test here is skipped, so a plain `forge test` needs no network.
contract ChimiLiveForkTest is Test {
    address internal constant GIWA_WETH = 0x4200000000000000000000000000000000000006;

    struct Dex {
        uint24 fee;
        int24 tickSpacing;
        address uniFactory;
        address npm;
        address router;
        MonLock locker;
    }

    bool internal live;
    InstantErc20QuoteFactory internal factory;
    address internal bpsSource;
    address internal weth;
    /// Oldest first; new coins launch on the last.
    Dex[] internal dexes;

    function setUp() public {
        string memory rpc = vm.envOr("GIWA_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        string memory json = vm.readFile("./../web/public/deployments.json");
        assertEq(vm.parseJsonUint(json, ".chainId"), block.chainid, "deployments.json is for another chain");
        factory = InstantErc20QuoteFactory(payable(vm.parseJsonAddress(json, ".factory")));
        bpsSource = vm.parseJsonAddress(json, ".bpsSource");
        weth = vm.parseJsonAddress(json, ".weth");

        if (vm.keyExistsJson(json, ".dexes")) {
            for (uint256 i; vm.keyExistsJson(json, string.concat(".dexes[", vm.toString(i), "]")); i++) {
                string memory at = string.concat(".dexes[", vm.toString(i), "]");
                dexes.push(
                    Dex({
                        fee: uint24(vm.parseJsonUint(json, string.concat(at, ".fee"))),
                        tickSpacing: int24(vm.parseJsonInt(json, string.concat(at, ".tickSpacing"))),
                        uniFactory: vm.parseJsonAddress(json, string.concat(at, ".uniFactory")),
                        npm: vm.parseJsonAddress(json, string.concat(at, ".positionManager")),
                        router: vm.parseJsonAddress(json, string.concat(at, ".swapRouter")),
                        locker: MonLock(payable(vm.parseJsonAddress(json, string.concat(at, ".locker"))))
                    })
                );
            }
        } else {
            // A deployment from before the second DEX: the first DEX's addresses are at the top level.
            dexes.push(
                Dex({
                    fee: 10_000,
                    tickSpacing: 200,
                    uniFactory: vm.parseJsonAddress(json, ".uniFactory"),
                    npm: vm.parseJsonAddress(json, ".positionManager"),
                    router: vm.parseJsonAddress(json, ".swapRouter"),
                    locker: MonLock(payable(vm.parseJsonAddress(json, ".locker")))
                })
            );
        }
        // The top-level addresses stay the first DEX's, for everything written before there were two.
        assertEq(vm.parseJsonAddress(json, ".uniFactory"), dexes[0].uniFactory);
        assertEq(vm.parseJsonAddress(json, ".locker"), address(dexes[0].locker));
        live = true;
    }

    modifier onlyLive() {
        if (!live) vm.skip(true);
        _;
    }

    function _launchDex() internal view returns (Dex memory) {
        return dexes[dexes.length - 1];
    }

    /// @dev The DEX whose factory made `token`'s pool.
    function _dexOf(address token) internal view returns (Dex memory) {
        address made = ILiveV3Pool(factory.getPool(token).uniPool).factory();
        for (uint256 i; i < dexes.length; i++) {
            if (dexes[i].uniFactory == made) return dexes[i];
        }
        revert("coin's pool isn't on any of Chimi's DEXes");
    }

    /// @dev A 0.1 ETH buy sold straight back pays the pool's fee each way (fee in hundredths of a bip), so it returns at
    ///      least 0.1 x (1 - fee)^2, and a little more on a thin pool (the sale is a little smaller than the buy, so it
    ///      covers the higher part of the price it moved), but never as much as 0.1 x (1 - fee).
    function _checkRoundTrip(uint256 back, uint24 fee) internal pure {
        uint256 keep = 1_000_000 - uint256(fee);
        assertGe(back, (0.1 ether * keep * keep) / 1e12, "the fee each way, nothing more");
        assertLt(back, (0.1 ether * keep) / 1e6, "a fee each way");
    }

    function test_live_everything_points_at_everything_else() public onlyLive {
        assertEq(weth, GIWA_WETH);
        Dex memory launch = _launchDex();

        // the pad launches on the last DEX
        assertEq(address(factory.QUOTE()), weth);
        assertEq(address(factory.WETH()), weth);
        assertEq(factory.quoteDecimals(), 18);
        assertEq(factory.positionManager(), launch.npm);
        assertEq(factory.swapRouter(), launch.router);
        assertEq(factory.lpLocker(), address(launch.locker));
        assertEq(factory.bpsSource(), bpsSource);
        assertEq(factory.poolFee(), launch.fee);
        assertEq(factory.tickSpacing(), launch.tickSpacing);
        assertGt(factory.launchVirtualQuote(), 0);
        assertTrue(factory.treasury() != address(0));

        for (uint256 i; i < dexes.length; i++) {
            Dex memory d = dexes[i];
            // the DEX
            assertEq(ILiveV3Factory(d.uniFactory).owner(), address(0), "v3 factory owner is renounced");
            assertEq(ILiveV3Factory(d.uniFactory).feeAmountTickSpacing(d.fee), d.tickSpacing);
            assertEq(ILivePeriphery(d.npm).factory(), d.uniFactory);
            assertEq(ILivePeriphery(d.npm).WETH9(), weth);
            assertEq(ILivePeriphery(d.router).factory(), d.uniFactory);
            assertEq(ILivePeriphery(d.router).WETH9(), weth);
            assertEq(ILiveRouter(d.router).positionManager(), d.npm);

            // its locker
            assertEq(address(d.locker.POSITION_MANAGER()), d.npm);
            assertEq(d.locker.stamper(), address(factory), "only the pad stamps locks");
            assertGe(
                d.locker.defaultLockDuration(), 100 * 365 days, "the site says launch liquidity is locked 100 years"
            );
            assertTrue(d.locker.defaultBeneficiary() != address(0));
        }

        // the fee split for new launches: the creator's share and the staker share, the platform keeps 15%
        uint16 creatorBps = ArcBpsSource(bpsSource).lpMemeCreatorBps();
        uint16 stakerBps = ArcBpsSource(bpsSource).lpMemeStakerBps();
        if (dexes.length == 1) {
            assertEq(creatorBps, 7000);
            assertEq(stakerBps, 0);
        } else {
            assertTrue(creatorBps == 7000 || creatorBps == 8000, "creator share");
            assertEq(10_000 - uint256(creatorBps) - stakerBps, 1500, "platform keeps 15%");
            assertTrue(factory.stakingPool().code.length > 0, "the staker share goes to a contract");
        }
    }

    function test_live_every_launch_is_locked_and_stamped() public onlyLive {
        uint256 n = factory.allTokensLength();
        uint256 locks;
        for (uint256 i; i < dexes.length; i++) {
            locks += dexes[i].locker.lockedCount();
        }
        assertEq(locks, n, "one lock per launch, across the lockers");

        for (uint256 i; i < n; i++) {
            address token = factory.allTokens(i);
            InstantErc20QuoteFactory.InstantQuotePool memory pool = factory.getPool(token);
            Dex memory d = _dexOf(token);
            MonLock locker = d.locker;
            assertEq(ILiveV3Factory(d.uniFactory).getPool(token, weth, d.fee), pool.uniPool);
            assertEq(ILiveV3Pool(pool.uniPool).fee(), d.fee);
            assertEq(ILiveNpm(d.npm).ownerOf(pool.positionId), address(locker));

            (address beneficiary, uint64 unlockTime, bool withdrawn,, uint16 backingBps) = locker.locks(pool.positionId);
            assertTrue(beneficiary != address(0));
            assertGt(unlockTime, block.timestamp + 99 * 365 days, "the site says launch liquidity is locked 100 years");
            assertFalse(withdrawn);
            assertEq(locker.launchTokens(pool.positionId), token);
            assertEq(locker.quoteTokens(pool.positionId), weth);
            (address creatorWallet, uint16 creatorBps) = locker.creatorSplits(pool.positionId);
            (address stakerWallet, uint16 stakerBps) = locker.stakerSplits(pool.positionId);
            assertEq(creatorWallet, pool.creator);

            if (d.uniFactory == dexes[0].uniFactory) {
                // first DEX: 70% creator, 30% platform
                assertTrue(locker.memeMode(pool.positionId));
                assertEq(creatorBps, 7000);
                assertEq(stakerBps, 0);
                assertEq(backingBps, 0);
            } else {
                // later DEXes: whatever the creator's share, the platform keeps 15% and the staker share goes to
                // the pad's staking pool (the flywheel, or what replaced it)
                assertTrue(creatorBps == 7000 || creatorBps == 8000, "creator share");
                assertEq(10_000 - uint256(creatorBps) - stakerBps - backingBps, 1500, "platform keeps 15%");
                assertEq(stakerWallet, factory.stakingPool());
            }
        }
    }

    function test_live_unclaimed_fees_reach_creators() public onlyLive {
        uint256 n = factory.allTokensLength();
        for (uint256 i; i < n; i++) {
            address token = factory.allTokens(i);
            InstantErc20QuoteFactory.InstantQuotePool memory pool = factory.getPool(token);
            MonLock locker = _dexOf(token).locker;
            (address beneficiary,,,, uint16 backingBps) = locker.locks(pool.positionId);
            (, uint16 creatorBps) = locker.creatorSplits(pool.positionId);
            (, uint16 stakerBps) = locker.stakerSplits(pool.positionId);
            uint256 creatorBefore = IERC20(weth).balanceOf(pool.creator);
            uint256 platformBefore = IERC20(weth).balanceOf(beneficiary);

            (uint256 a0, uint256 a1) = locker.collectFees(pool.positionId);
            uint256 wethFee = uint160(weth) < uint160(token) ? a0 : a1;
            uint256 creatorCut = (wethFee * creatorBps) / 10_000;
            uint256 platformCut =
                wethFee - creatorCut - (wethFee * stakerBps) / 10_000 - (wethFee * backingBps) / 10_000;

            if (pool.creator == beneficiary) {
                assertEq(IERC20(weth).balanceOf(pool.creator) - creatorBefore, creatorCut + platformCut);
            } else {
                assertEq(IERC20(weth).balanceOf(pool.creator) - creatorBefore, creatorCut);
                assertEq(IERC20(weth).balanceOf(beneficiary) - platformBefore, platformCut);
            }
        }
    }

    /// @dev The sale the site sends: swap into the router, unwrap, pay ETH, all in one transaction. On the newest
    ///      coin, so on the DEX new coins launch on.
    function test_live_sell_pays_eth_in_one_transaction() public onlyLive {
        address trader = makeAddr("live seller");
        vm.deal(trader, 1 ether);
        address token = factory.allTokens(factory.allTokensLength() - 1);
        Dex memory d = _dexOf(token);
        uint256 keep = 1_000_000 - uint256(d.fee);
        uint256 minOut = (0.1 ether * keep * keep) / 1e12;

        vm.startPrank(trader);
        uint256 bought = ILiveRouter(d.router).exactInputSingle{value: 0.1 ether}(
            ILiveRouter.ExactInputSingleParams(weth, token, d.fee, trader, 0.1 ether, 0, 0)
        );
        uint256 ethBefore = trader.balance;
        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(
            ILiveRouter.exactInputSingle,
            (ILiveRouter.ExactInputSingleParams(token, weth, d.fee, address(2), bought, minOut, 0))
        );
        calls[1] = abi.encodeCall(ILiveRouter.unwrapWETH9, (minOut, trader));
        IERC20(token).approve(d.router, bought);
        ILiveRouter(d.router).multicall(block.timestamp + 1200, calls);
        vm.stopPrank();

        _checkRoundTrip(trader.balance - ethBefore, d.fee);
        assertEq(IERC20(weth).balanceOf(trader), 0);
        assertEq(IERC20(weth).balanceOf(d.router), 0);
        assertEq(IERC20(token).balanceOf(trader), 0);
    }

    function test_live_launch_trade_and_sweep() public onlyLive {
        address creator = makeAddr("live creator");
        address trader = makeAddr("live trader");
        vm.deal(creator, 1 ether);
        vm.deal(trader, 1 ether);
        Dex memory d = _launchDex();

        uint256 fee = factory.creationFeeDue(creator);
        vm.prank(creator);
        address token = factory.createTokenMemeInstantQuoteWithEth{value: fee + 0.01 ether}("Fork Coin", "FORK");
        InstantErc20QuoteFactory.InstantQuotePool memory pool = factory.getPool(token);
        assertEq(ILiveV3Pool(pool.uniPool).factory(), d.uniFactory, "launched on the last DEX");
        assertEq(ILiveNpm(d.npm).ownerOf(pool.positionId), address(d.locker));
        assertGt(IERC20(token).balanceOf(creator), 0, "first buy landed");

        vm.startPrank(trader);
        uint256 bought = ILiveRouter(d.router).exactInputSingle{value: 0.1 ether}(
            ILiveRouter.ExactInputSingleParams(weth, token, d.fee, trader, 0.1 ether, 0, 0)
        );
        IERC20(token).approve(d.router, bought);
        uint256 back = ILiveRouter(d.router)
            .exactInputSingle(ILiveRouter.ExactInputSingleParams(token, weth, d.fee, trader, bought, 0, 0));
        vm.stopPrank();
        _checkRoundTrip(back, d.fee);

        (address beneficiary,,,,) = d.locker.locks(pool.positionId);
        (, uint16 creatorBps) = d.locker.creatorSplits(pool.positionId);
        (, uint16 stakerBps) = d.locker.stakerSplits(pool.positionId);
        uint256 platformBefore = IERC20(weth).balanceOf(beneficiary);
        d.locker.collectFees(pool.positionId);
        // the pool's fee on the 0.01 first buy and the 0.1 buy, shared as stamped on the lock
        uint256 wethFee = (0.11 ether * uint256(d.fee)) / 1e6;
        uint256 toCreator = (wethFee * creatorBps) / 10_000;
        uint256 toPlatform = wethFee - toCreator - (wethFee * stakerBps) / 10_000;
        assertApproxEqAbs(IERC20(weth).balanceOf(creator), toCreator, 10);
        assertApproxEqAbs(IERC20(weth).balanceOf(beneficiary) - platformBefore, toPlatform, 10);
    }
}
