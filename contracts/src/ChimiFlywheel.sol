// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IWETH9Like {
    function withdraw(uint256 wad) external;
    function balanceOf(address who) external view returns (uint256);
}

interface ISwapRouter02Like {
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

/// @title ChimiFlywheel
/// @notice Takes the flywheel share of every new Chimi coin's trading fees and splits each arrival in half.
///         One half buys CHIMI in its pool and sends it to the burn address. The other half is paid out in
///         ETH to CHIMI holders: each day a keeper works out who held at least the minimum and in what
///         share, and calls `distribute`.
///
///         The share arrives as the locker's "staker" leg: 15% of the ETH side of a coin's fees, pushed here
///         as native ETH (or as WETH if that push fails; WETH is unwrapped here). Accounting is lazy, so the
///         locker's push stays a plain transfer: whatever ETH is not yet in a bucket is split on the next
///         call (`_sync`). ETH sent here directly is split the same way.
///
///         What the owner can do: change the keeper. Nothing else. CHIMI, the router, CHIMI's pool fee and
///         the 50/50 split are fixed at deployment, and ETH only leaves as a CHIMI buy that burns or as a
///         payout to holders.
///         What the keeper can do: spend the burn half on CHIMI at a minimum it names, and pay the holder
///         half to the wallets it names, never more than the holder half holds. Each (day, batch) pays once.
contract ChimiFlywheel is Ownable2Step, ReentrancyGuard {
    address public constant BURN = 0x000000000000000000000000000000000000dEaD;
    /// @notice The part of each arrival that buys and burns CHIMI. The rest is for holders.
    uint16 public constant BURN_BPS = 5_000;
    uint16 internal constant BPS = 10_000;
    /// @notice Gas each payout may use, so a wallet that refuses ETH or burns gas can't stall the rest.
    uint256 public constant PAYOUT_GAS = 50_000;

    IWETH9Like public immutable WETH;
    address public immutable CHIMI;
    ISwapRouter02Like public immutable ROUTER;
    uint24 public immutable CHIMI_POOL_FEE;

    address public keeper;

    /// @notice ETH set aside for buying and burning CHIMI.
    uint256 public burnBucket;
    /// @notice ETH set aside for CHIMI holders.
    uint256 public holderBucket;

    /// @notice Everything that has come in, split or not yet split.
    uint256 public totalIn;
    uint256 public totalSpentOnBurns;
    uint256 public totalChimiBurned;
    uint256 public totalPaid;
    /// @notice ETH paid to each wallet, all time.
    mapping(address => uint256) public paidTo;
    /// @notice day => batch => paid. A batch can't be paid twice, so a retried run is harmless.
    mapping(uint256 => mapping(uint256 => bool)) public batchDone;

    event Split(uint256 amount, uint256 toBurn, uint256 toHolders);
    event BoughtAndBurned(uint256 ethIn, uint256 chimiBurned);
    event Paid(uint256 indexed period, address indexed to, uint256 amount);
    event PayoutFailed(uint256 indexed period, address indexed to, uint256 amount);
    event Distributed(uint256 indexed period, uint256 indexed batch, uint256 sent, uint256 recipients);
    event KeeperSet(address indexed keeper);

    error NotKeeper();
    error ZeroAddress();
    error LengthMismatch();
    error BatchDone();
    error MoreThanHolderBucket();

    modifier onlyKeeper() {
        if (msg.sender != keeper) revert NotKeeper();
        _;
    }

    constructor(address weth, address chimi, address router, uint24 chimiPoolFee, address keeper_, address owner_)
        Ownable(owner_)
    {
        if (weth == address(0) || chimi == address(0) || router == address(0) || keeper_ == address(0)) {
            revert ZeroAddress();
        }
        WETH = IWETH9Like(weth);
        CHIMI = chimi;
        ROUTER = ISwapRouter02Like(router);
        CHIMI_POOL_FEE = chimiPoolFee;
        keeper = keeper_;
        emit KeeperSet(keeper_);
    }

    /// @dev Kept empty: the locker's push should cost no more than a transfer. `_sync` does the split.
    receive() external payable {}

    // ─── Accounting ───────────────────────────────────────────────────────────────────────────

    /// @notice Splits whatever has arrived since the last split. Anyone may call it; the keeper's calls do.
    function sync() external nonReentrant {
        _sync();
    }

    function _sync() internal {
        uint256 wrapped = WETH.balanceOf(address(this));
        if (wrapped > 0) WETH.withdraw(wrapped);
        uint256 fresh = address(this).balance - burnBucket - holderBucket;
        if (fresh == 0) return;
        uint256 toBurn = (fresh * BURN_BPS) / BPS;
        burnBucket += toBurn;
        holderBucket += fresh - toBurn;
        totalIn += fresh;
        emit Split(fresh, toBurn, fresh - toBurn);
    }

    /// @notice The two halves as they would stand after a split now.
    function pending() external view returns (uint256 toBurn, uint256 toHolders) {
        uint256 fresh = address(this).balance + WETH.balanceOf(address(this)) - burnBucket - holderBucket;
        uint256 b = (fresh * BURN_BPS) / BPS;
        return (burnBucket + b, holderBucket + fresh - b);
    }

    // ─── Keeper ───────────────────────────────────────────────────────────────────────────────

    /// @notice Spends up to `amountIn` of the burn half on CHIMI and sends all of it to the burn address.
    ///         Reverts if the buy would get less than `minOut` CHIMI.
    function buybackAndBurn(uint256 amountIn, uint256 minOut) external onlyKeeper nonReentrant returns (uint256 out) {
        _sync();
        if (amountIn > burnBucket) amountIn = burnBucket;
        if (amountIn == 0) return 0;
        burnBucket -= amountIn;
        out = ROUTER.exactInputSingle{value: amountIn}(
            ISwapRouter02Like.ExactInputSingleParams({
                tokenIn: address(WETH),
                tokenOut: CHIMI,
                fee: CHIMI_POOL_FEE,
                recipient: BURN,
                amountIn: amountIn,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0
            })
        );
        totalSpentOnBurns += amountIn;
        totalChimiBurned += out;
        emit BoughtAndBurned(amountIn, out);
    }

    /// @notice Pays one batch of a day's holder rewards in ETH. A wallet that won't take ETH is skipped and
    ///         its amount stays in the holder half for another day.
    function distribute(uint256 period, uint256 batch, address[] calldata to, uint256[] calldata amounts)
        external
        onlyKeeper
        nonReentrant
        returns (uint256 sent)
    {
        if (to.length != amounts.length) revert LengthMismatch();
        if (batchDone[period][batch]) revert BatchDone();
        batchDone[period][batch] = true;
        _sync();

        uint256 total;
        for (uint256 i = 0; i < amounts.length; i++) {
            total += amounts[i];
        }
        if (total > holderBucket) revert MoreThanHolderBucket();

        for (uint256 i = 0; i < to.length; i++) {
            uint256 amount = amounts[i];
            address wallet = to[i];
            if (amount == 0 || wallet == address(0)) continue;
            (bool ok,) = payable(wallet).call{value: amount, gas: PAYOUT_GAS}("");
            if (ok) {
                sent += amount;
                paidTo[wallet] += amount;
                emit Paid(period, wallet, amount);
            } else {
                emit PayoutFailed(period, wallet, amount);
            }
        }
        holderBucket -= sent;
        totalPaid += sent;
        emit Distributed(period, batch, sent, to.length);
    }

    // ─── Owner ────────────────────────────────────────────────────────────────────────────────

    function setKeeper(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        keeper = next;
        emit KeeperSet(next);
    }
}
