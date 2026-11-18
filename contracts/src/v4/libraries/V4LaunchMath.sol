// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

/// @title V4LaunchMath
/// @notice Price, range and quote math for a v4 launch's single-sided position. Native ETH sorts first
///         (its currency is address(0)), so ETH is always currency0 and the token currency1. The whole
///         supply sits in one position below the start price, and the pool opens at the position's upper
///         tick: it holds no ETH, and buys walk the price down into it.
/// @dev Ported from Kleos `V4LaunchMath`. Rounding to the tick spacing only ever lowers the start price,
///      by under one spacing (about 2%).
library V4LaunchMath {
    uint256 internal constant Q96 = 1 << 96;
    int24 internal constant TICK_SPACING = 200;
    int24 internal constant MIN_TICK = -887_200; // TickMath.MIN_TICK rounded in to the spacing

    /// @notice sqrt(token/ETH) in Q64.96 for a fully diluted value of `mcap` ETH over `supply` tokens.
    function sqrtPriceX96(uint256 mcap, uint256 supply) internal pure returns (uint160) {
        return uint160(Math.sqrt(Math.mulDiv(supply, 1 << 192, mcap)));
    }

    /// @notice The position's ticks and the price the pool opens at.
    function range(uint256 mcap, uint256 supply)
        internal
        pure
        returns (int24 tickLower, int24 tickUpper, uint160 startSqrtPriceX96)
    {
        int24 ideal = TickMath.getTickAtSqrtPrice(sqrtPriceX96(mcap, supply));
        int24 c = ideal / TICK_SPACING;
        if (ideal > 0 && ideal % TICK_SPACING != 0) c++;
        tickLower = MIN_TICK;
        tickUpper = c * TICK_SPACING;
        startSqrtPriceX96 = TickMath.getSqrtPriceAtTick(tickUpper);
    }

    /// @notice The liquidity that `supply` tokens make over that range. The PoolManager asks for at most `supply`.
    function liquidity(int24 tickLower, int24 tickUpper, uint256 supply) internal pure returns (uint128) {
        uint256 a = TickMath.getSqrtPriceAtTick(tickLower);
        uint256 b = TickMath.getSqrtPriceAtTick(tickUpper);
        uint256 l = Math.mulDiv(supply, Q96, b - a);
        require(l <= type(uint128).max, "liquidity");
        return uint128(l);
    }

    /// @notice Tokens out for `ethIn` that actually reaches the pool (after tax; the pool itself charges no fee),
    ///         from the start price, while the price stays inside the one range.
    function quoteBuy(uint160 startSqrtPriceX96, uint128 liq, uint256 ethIn) internal pure returns (uint256 tokensOut) {
        if (ethIn == 0 || liq == 0) return 0;
        uint256 p = startSqrtPriceX96;
        uint256 numerator = uint256(liq) << 96;
        uint256 next;
        unchecked {
            uint256 product = ethIn * p;
            if (product / ethIn == p && numerator + product >= numerator) {
                next = Math.mulDiv(numerator, p, numerator + product, Math.Rounding.Ceil);
            } else {
                next = Math.ceilDiv(numerator, numerator / p + ethIn);
            }
        }
        tokensOut = Math.mulDiv(liq, p - next, Q96);
    }

    /// @notice ETH per whole token, scaled by 1e18, at `sqrtPrice`.
    function spot(uint160 sqrtPrice) internal pure returns (uint256) {
        if (sqrtPrice == 0) return 0;
        return Math.mulDiv(Math.mulDiv(1e18, Q96, sqrtPrice), Q96, sqrtPrice);
    }

    /// @notice ETH (currency0) and token (currency1) currently in a position, from its liquidity and the price.
    function amounts(uint160 sqrtPrice, int24 tickLower, int24 tickUpper, uint128 liq)
        internal
        pure
        returns (uint256 amount0, uint256 amount1)
    {
        if (liq == 0) return (0, 0);
        uint160 lower = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 upper = TickMath.getSqrtPriceAtTick(tickUpper);
        if (sqrtPrice <= lower) {
            amount0 = _amount0(lower, upper, liq);
        } else if (sqrtPrice >= upper) {
            amount1 = _amount1(lower, upper, liq);
        } else {
            amount0 = _amount0(sqrtPrice, upper, liq);
            amount1 = _amount1(lower, sqrtPrice, liq);
        }
    }

    function _amount0(uint160 sqrtA, uint160 sqrtB, uint128 liq) private pure returns (uint256) {
        return Math.mulDiv(uint256(liq) << 96, uint256(sqrtB - sqrtA), uint256(sqrtB)) / sqrtA;
    }

    function _amount1(uint160 sqrtA, uint160 sqrtB, uint128 liq) private pure returns (uint256) {
        return Math.mulDiv(liq, uint256(sqrtB - sqrtA), Q96);
    }
}
