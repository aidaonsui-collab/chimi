// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";

/// @notice A plain v4 router for tests: any swap shape, settling after the swap, plus a flash borrow of the pool's tokens.
/// @dev Ported from Kleos's test Swapper. The native currency here is ETH.
contract Swapper is IUnlockCallback {
    IPoolManager public immutable pm;

    struct Job {
        PoolKey key;
        bool zeroForOne;
        int256 amountSpecified;
        address account;
        uint256 borrow;
        address claimToken;
    }

    constructor(IPoolManager pm_) {
        pm = pm_;
    }

    receive() external payable {}

    function swap(PoolKey memory key, bool zeroForOne, int256 amountSpecified) external payable returns (BalanceDelta) {
        return abi.decode(pm.unlock(abi.encode(Job(key, zeroForOne, amountSpecified, msg.sender, 0, address(0)))), (BalanceDelta));
    }

    function flashSwap(PoolKey memory key, uint256 borrow, int256 ethIn) external payable returns (BalanceDelta) {
        return abi.decode(
            pm.unlock(abi.encode(Job(key, true, ethIn, msg.sender, borrow, Currency.unwrap(key.currency1)))), (BalanceDelta)
        );
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        Job memory j = abi.decode(data, (Job));
        if (j.borrow > 0) pm.take(j.key.currency1, address(this), j.borrow);
        BalanceDelta d = pm.swap(
            j.key,
            SwapParams({
                zeroForOne: j.zeroForOne,
                amountSpecified: j.amountSpecified,
                sqrtPriceLimitX96: j.zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );
        if (j.claimToken != address(0)) {
            (bool ok,) = j.claimToken.call(abi.encodeWithSignature("claimRewards(address)", j.account));
            ok;
        }
        _settle(j.key.currency0, d.amount0(), j.account);
        _settle(j.key.currency1, d.amount1(), j.account);
        if (j.borrow > 0) {
            pm.sync(j.key.currency1);
            IERC20(Currency.unwrap(j.key.currency1)).transfer(address(pm), j.borrow);
            pm.settle();
        }
        return abi.encode(d);
    }

    function _settle(Currency c, int128 amount, address account) internal {
        if (amount < 0) {
            uint256 owed = uint256(int256(-amount));
            if (c.isAddressZero()) {
                pm.settle{value: owed}();
            } else {
                pm.sync(c);
                IERC20(Currency.unwrap(c)).transferFrom(account, address(pm), owed);
                pm.settle();
            }
        } else if (amount > 0) {
            pm.take(c, account, uint256(int256(amount)));
        }
    }
}
