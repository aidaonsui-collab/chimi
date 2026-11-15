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
///         GIWA_RPC=https://sepolia-rpc.giwa.io forge test --match-contract ChimiLiveForkTest
///
///         Without GIWA_RPC every test here is skipped, so a plain `forge test` needs no network.
contract ChimiLiveForkTest is Test {
    address internal constant GIWA_WETH = 0x4200000000000000000000000000000000000006;
    uint24 internal constant FEE = 10_000;

    bool internal live;
    InstantErc20QuoteFactory internal factory;
    MonLock internal locker;
    address internal uniFactory;
    address internal npm;
    address internal router;
    address internal bpsSource;
    address internal weth;

    function setUp() public {
        string memory rpc = vm.envOr("GIWA_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        string memory json = vm.readFile("./../web/public/deployments.json");
        assertEq(vm.parseJsonUint(json, ".chainId"), block.chainid, "deployments.json is for another chain");
        factory = InstantErc20QuoteFactory(payable(vm.parseJsonAddress(json, ".factory")));
        locker = MonLock(payable(vm.parseJsonAddress(json, ".locker")));
        uniFactory = vm.parseJsonAddress(json, ".uniFactory");
        npm = vm.parseJsonAddress(json, ".positionManager");
        router = vm.parseJsonAddress(json, ".swapRouter");
        bpsSource = vm.parseJsonAddress(json, ".bpsSource");
        weth = vm.parseJsonAddress(json, ".weth");
        live = true;
    }

    modifier onlyLive() {
        if (!live) vm.skip(true);
        _;
    }

    function test_live_everything_points_at_everything_else() public onlyLive {
        assertEq(weth, GIWA_WETH);

        // the pad
        assertEq(address(factory.QUOTE()), weth);
        assertEq(address(factory.WETH()), weth);
        assertEq(factory.quoteDecimals(), 18);
        assertEq(factory.positionManager(), npm);
        assertEq(factory.swapRouter(), router);
        assertEq(factory.lpLocker(), address(locker));
        assertEq(factory.bpsSource(), bpsSource);
        assertEq(factory.poolFee(), FEE);
        assertEq(factory.tickSpacing(), int24(200));
        assertGt(factory.launchVirtualQuote(), 0);
        assertTrue(factory.treasury() != address(0));

        // the DEX
        assertEq(ILiveV3Factory(uniFactory).owner(), address(0), "v3 factory owner is renounced");
        assertEq(ILiveV3Factory(uniFactory).feeAmountTickSpacing(FEE), int24(200));
        assertEq(ILivePeriphery(npm).factory(), uniFactory);
        assertEq(ILivePeriphery(npm).WETH9(), weth);
        assertEq(ILivePeriphery(router).factory(), uniFactory);
        assertEq(ILivePeriphery(router).WETH9(), weth);
        assertEq(ILiveRouter(router).positionManager(), npm);

        // the locker
        assertEq(address(locker.POSITION_MANAGER()), npm);
        assertEq(locker.stamper(), address(factory), "only the factory stamps locks");
        assertGe(locker.defaultLockDuration(), 100 * 365 days);
        assertTrue(locker.defaultBeneficiary() != address(0));

        // the fee split for new launches
        assertEq(ArcBpsSource(bpsSource).lpMemeCreatorBps(), 7000);
        assertEq(ArcBpsSource(bpsSource).lpMemeStakerBps(), 0);
    }

    function test_live_every_launch_is_locked_and_stamped() public onlyLive {
        uint256 n = factory.allTokensLength();
        assertEq(locker.lockedCount(), n, "one lock per launch");
        for (uint256 i; i < n; i++) {
            address token = factory.allTokens(i);
            InstantErc20QuoteFactory.InstantQuotePool memory pool = factory.getPool(token);
            assertEq(ILiveV3Factory(uniFactory).getPool(token, weth, FEE), pool.uniPool);
            assertEq(ILiveNpm(npm).ownerOf(pool.positionId), address(locker));

            (address beneficiary, uint64 unlockTime, bool withdrawn,,) = locker.locks(pool.positionId);
            assertTrue(beneficiary != address(0));
            assertGt(unlockTime, block.timestamp + 99 * 365 days);
            assertFalse(withdrawn);
            assertTrue(locker.memeMode(pool.positionId));
            assertEq(locker.launchTokens(pool.positionId), token);
            assertEq(locker.quoteTokens(pool.positionId), weth);
            (address creatorWallet, uint16 creatorBps) = locker.creatorSplits(pool.positionId);
            assertEq(creatorWallet, pool.creator);
            assertEq(creatorBps, 7000);
        }
    }

    function test_live_unclaimed_fees_reach_creators() public onlyLive {
        uint256 n = factory.allTokensLength();
        for (uint256 i; i < n; i++) {
            InstantErc20QuoteFactory.InstantQuotePool memory pool = factory.getPool(factory.allTokens(i));
            (address beneficiary,,,,) = locker.locks(pool.positionId);
            uint256 creatorBefore = IERC20(weth).balanceOf(pool.creator);
            uint256 platformBefore = IERC20(weth).balanceOf(beneficiary);

            (uint256 a0, uint256 a1) = locker.collectFees(pool.positionId);
            uint256 wethFee = uint160(weth) < uint160(factory.allTokens(i)) ? a0 : a1;
            uint256 creatorCut = (wethFee * 7000) / 10_000;

            if (pool.creator == beneficiary) {
                assertEq(IERC20(weth).balanceOf(pool.creator) - creatorBefore, wethFee);
            } else {
                assertEq(IERC20(weth).balanceOf(pool.creator) - creatorBefore, creatorCut);
                assertEq(IERC20(weth).balanceOf(beneficiary) - platformBefore, wethFee - creatorCut);
            }
        }
    }

    /// @dev The sale the site sends: swap into the router, unwrap, pay ETH, all in one transaction.
    function test_live_sell_pays_eth_in_one_transaction() public onlyLive {
        address trader = makeAddr("live seller");
        vm.deal(trader, 1 ether);
        address token = factory.allTokens(factory.allTokensLength() - 1);

        vm.startPrank(trader);
        uint256 bought = ILiveRouter(router).exactInputSingle{value: 0.1 ether}(
            ILiveRouter.ExactInputSingleParams(weth, token, FEE, trader, 0.1 ether, 0, 0)
        );
        uint256 ethBefore = trader.balance;
        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(
            ILiveRouter.exactInputSingle,
            (ILiveRouter.ExactInputSingleParams(token, weth, FEE, address(2), bought, 0.098 ether, 0))
        );
        calls[1] = abi.encodeCall(ILiveRouter.unwrapWETH9, (0.098 ether, trader));
        IERC20(token).approve(router, bought);
        ILiveRouter(router).multicall(block.timestamp + 1200, calls);
        vm.stopPrank();

        assertGt(trader.balance - ethBefore, 0.098 ether);
        assertLt(trader.balance - ethBefore, 0.099 ether);
        assertEq(IERC20(weth).balanceOf(trader), 0);
        assertEq(IERC20(weth).balanceOf(router), 0);
        assertEq(IERC20(token).balanceOf(trader), 0);
    }

    function test_live_launch_trade_and_sweep() public onlyLive {
        address creator = makeAddr("live creator");
        address trader = makeAddr("live trader");
        vm.deal(creator, 1 ether);
        vm.deal(trader, 1 ether);

        uint256 fee = factory.creationFeeDue(creator);
        vm.prank(creator);
        address token = factory.createTokenMemeInstantQuoteWithEth{value: fee + 0.01 ether}("Fork Coin", "FORK");
        InstantErc20QuoteFactory.InstantQuotePool memory pool = factory.getPool(token);
        assertEq(ILiveNpm(npm).ownerOf(pool.positionId), address(locker));
        assertGt(IERC20(token).balanceOf(creator), 0, "first buy landed");

        vm.startPrank(trader);
        uint256 bought = ILiveRouter(router).exactInputSingle{value: 0.1 ether}(
            ILiveRouter.ExactInputSingleParams(weth, token, FEE, trader, 0.1 ether, 0, 0)
        );
        IERC20(token).approve(router, bought);
        uint256 back = ILiveRouter(router).exactInputSingle(
            ILiveRouter.ExactInputSingleParams(token, weth, FEE, trader, bought, 0, 0)
        );
        vm.stopPrank();
        assertGt(back, 0.098 ether);
        assertLt(back, 0.099 ether);

        (address beneficiary,,,,) = locker.locks(pool.positionId);
        uint256 platformBefore = IERC20(weth).balanceOf(beneficiary);
        locker.collectFees(pool.positionId);
        // 1% of the 0.01 first buy and of the 0.1 buy, 70% of it to the creator
        assertApproxEqAbs(IERC20(weth).balanceOf(creator), 0.00077 ether, 10);
        assertApproxEqAbs(IERC20(weth).balanceOf(beneficiary) - platformBefore, 0.00033 ether, 10);
    }
}
