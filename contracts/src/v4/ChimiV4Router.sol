// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ChimiTaxHook} from "./ChimiTaxHook.sol";

/// @title ChimiV4Router
/// @notice Buys and sells on Chimi v4 pools, in native ETH, exact in. Quotes run the real swap, tax included, and
///         revert with the result so `eth_call` can read it. The router never holds tokens.
/// @dev Ported from KleosV4Router. Kleos named the native currency HYPE and accepted HyperEVM inbox tickets. Here the
///      native currency is ETH, and the payer is `msg.sender`.
contract ChimiV4Router is IUnlockCallback {
    using SafeERC20 for IERC20;

    Currency internal constant NATIVE = CurrencyLibrary.ADDRESS_ZERO;
    uint8 internal constant BUY = 0;
    uint8 internal constant SELL = 1;

    IPoolManager public immutable poolManager;
    ChimiTaxHook public immutable hook;

    error Expired();
    error TooLittleReceived();
    error UnknownToken();
    error OnlyPoolManager();
    /// @dev How a quote returns its result: the swap ran and was rolled back.
    error Quote(uint256 amountOut);

    constructor(IPoolManager poolManager_, ChimiTaxHook hook_) {
        poolManager = poolManager_;
        hook = hook_;
    }

    /// @notice Buy `token` with exactly `msg.value` ETH.
    function buy(address token, uint256 minOut, address recipient, uint256 deadline) external payable returns (uint256 out) {
        if (block.timestamp > deadline) revert Expired();
        out = _run(BUY, token, msg.value, msg.sender, recipient, false);
        if (out < minOut) revert TooLittleReceived();
    }

    /// @notice Sell exactly `amountIn` of `token` for ETH. The seller approves this router first.
    function sell(address token, uint256 amountIn, uint256 minOut, address recipient, uint256 deadline)
        external
        returns (uint256 out)
    {
        if (block.timestamp > deadline) revert Expired();
        out = _run(SELL, token, amountIn, msg.sender, recipient, false);
        if (out < minOut) revert TooLittleReceived();
    }

    /// @notice Tokens a buy of `ethIn` would get now, after tax. Not a view: use eth_call.
    function quoteBuy(address token, uint256 ethIn) external returns (uint256) {
        return _quote(BUY, token, ethIn);
    }

    /// @notice ETH a sell of `amountIn` would get now, after tax. Not a view: use eth_call.
    function quoteSell(address token, uint256 amountIn) external returns (uint256) {
        return _quote(SELL, token, amountIn);
    }

    function _quote(uint8 side, address token, uint256 amount) internal returns (uint256) {
        try this.quoteRun(side, token, amount) {}
        catch (bytes memory reason) {
            if (reason.length == 36 && bytes4(reason) == Quote.selector) {
                uint256 out;
                assembly ("memory-safe") {
                    out := mload(add(reason, 36))
                }
                return out;
            }
            assembly ("memory-safe") {
                revert(add(reason, 32), mload(reason))
            }
        }
        revert();
    }

    /// @dev External so `_quote` can catch its revert. Always reverts.
    function quoteRun(uint8 side, address token, uint256 amount) external {
        _run(side, token, amount, address(0), address(0), true);
    }

    function _run(uint8 side, address token, uint256 amount, address payer, address recipient, bool quote)
        internal
        returns (uint256)
    {
        PoolKey memory key = hook.poolKeyOf(token);
        if (Currency.unwrap(key.currency1) != token || token == address(0)) revert UnknownToken();
        return abi.decode(poolManager.unlock(abi.encode(side, key, amount, payer, recipient, quote)), (uint256));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        (uint8 side, PoolKey memory key, uint256 amount, address payer, address recipient, bool quote) =
            abi.decode(data, (uint8, PoolKey, uint256, address, address, bool));
        bool buying = side == BUY;
        if (buying && !quote) poolManager.settle{value: amount}();
        BalanceDelta d = poolManager.swap(
            key,
            SwapParams({
                zeroForOne: buying,
                amountSpecified: -int256(amount),
                sqrtPriceLimitX96: buying ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );
        uint256 out = uint256(int256(buying ? d.amount1() : d.amount0()));
        if (quote) revert Quote(out);
        if (buying) {
            uint256 unspent = amount - uint256(int256(-d.amount0()));
            if (unspent > 0) poolManager.take(NATIVE, payer, unspent);
            poolManager.take(key.currency1, recipient, out);
        } else {
            poolManager.sync(key.currency1);
            IERC20(Currency.unwrap(key.currency1)).safeTransferFrom(payer, address(poolManager), uint256(int256(-d.amount1())));
            poolManager.settle();
            poolManager.take(NATIVE, recipient, out);
        }
        return abi.encode(out);
    }
}
