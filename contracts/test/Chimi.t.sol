// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ChimiStack} from "../script/ChimiStack.sol";
import {InstantErc20QuoteFactory} from "../src/InstantErc20QuoteFactory.sol";

interface IUniV3FactoryAdmin {
    function owner() external view returns (address);
    function setOwner(address _owner) external;
    function feeAmountTickSpacing(uint24 fee) external view returns (int24);
}

interface IPoolView {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function liquidity() external view returns (uint128);
    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );
}

interface IPositionNft {
    function ownerOf(uint256 tokenId) external view returns (address);
}

interface ISwapRouter {
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
}

interface ILockView {
    function locks(uint256 tokenId)
        external
        view
        returns (address beneficiary, uint64 unlockTime, bool withdrawn, address backingWallet, uint16 backingBps);
}

contract ChimiTest is Test {
    ChimiStack.Addresses internal a;
    InstantErc20QuoteFactory internal factory;

    function setUp() public {
        a = ChimiStack.deploy(address(this));
        factory = InstantErc20QuoteFactory(payable(a.factory));

        IUniV3FactoryAdmin uni = IUniV3FactoryAdmin(a.uniFactory);
        assertEq(uni.feeAmountTickSpacing(10_000), 200);
        uni.setOwner(address(0));
        assertEq(uni.owner(), address(0));
    }

    function test_launch_locks_full_supply_and_trades() public {
        address creator = makeAddr("creator");
        address buyer = makeAddr("buyer");
        vm.deal(creator, 1 ether);
        vm.deal(buyer, 1 ether);

        vm.prank(creator);
        address token = factory.createTokenMemeInstantQuoteWithEth{value: 0}("Chimi Coin", "CHIMI");

        assertEq(IERC20(token).totalSupply(), 1_000_000_000 ether);
        assertEq(factory.allTokensLength(), 1);
        assertEq(address(factory.QUOTE()), a.weth);
        assertEq(address(factory.WETH()), a.weth);

        InstantErc20QuoteFactory.InstantQuotePool memory pool = factory.getPool(token);
        assertEq(pool.creator, creator);
        assertGt(pool.liquidity, 0);
        assertEq(IPositionNft(a.nfpm).ownerOf(pool.positionId), a.locker);

        // Mint pulled no quote. The whole supply sits in the pool (dust, if any, went to treasury).
        assertEq(IERC20(a.weth).balanceOf(pool.uniPool), 0);
        assertGt(IERC20(token).balanceOf(pool.uniPool), 999_000_000 ether);
        assertEq(IERC20(token).balanceOf(creator), 0);

        (address beneficiary, uint64 unlockTime,,,) = ILockView(a.locker).locks(pool.positionId);
        assertEq(beneficiary, address(this));
        assertGt(unlockTime, block.timestamp + 99 * 365 days);

        IPoolView uniPool = IPoolView(pool.uniPool);
        assertTrue(uniPool.token0() == token || uniPool.token1() == token);
        assertTrue(uniPool.token0() == a.weth || uniPool.token1() == a.weth);
        (,,,,, uint8 feeProtocol,) = uniPool.slot0();
        assertEq(feeProtocol, 0);

        vm.prank(buyer);
        uint256 bought = ISwapRouter(a.swapRouter02).exactInputSingle{value: 0.01 ether}(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: a.weth,
                tokenOut: token,
                fee: 10_000,
                recipient: buyer,
                amountIn: 0.01 ether,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );
        assertGt(bought, 0);
        assertEq(IERC20(token).balanceOf(buyer), bought);
        assertGt(IERC20(a.weth).balanceOf(pool.uniPool), 0);

        uint256 sellAmt = bought / 2;
        vm.startPrank(buyer);
        IERC20(token).approve(a.swapRouter02, sellAmt);
        uint256 wethOut = ISwapRouter(a.swapRouter02).exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: token,
                tokenOut: a.weth,
                fee: 10_000,
                recipient: buyer,
                amountIn: sellAmt,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );
        vm.stopPrank();
        assertGt(wethOut, 0);
        assertEq(IERC20(a.weth).balanceOf(buyer), wethOut);
    }

    function test_eth_first_buy_wraps_straight_into_the_pool() public {
        address creator = makeAddr("creator");
        vm.deal(creator, 1 ether);
        vm.prank(creator);
        address token = factory.createTokenMemeInstantQuoteWithEth{value: 0.05 ether}("First", "FRST");
        assertGt(IERC20(token).balanceOf(creator), 0);
        assertGt(IERC20(a.weth).balanceOf(factory.getPool(token).uniPool), 0);
    }
}
