// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

interface IWETH9Burner {
    function deposit() external payable;
    function withdraw(uint256 wad) external;
    function balanceOf(address who) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface ISwapRouter02Burner {
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

/// @title CoinBurner
/// @notice One per Chimi coin whose creator chose, at launch, to have part of the coin's trading fees buy the coin
///         back and burn it. The locker sends that part here as WETH. When the keeper asks (through the
///         ChimiBurner), it buys the coin in the coin's own pool and sends every coin it gets to the burn address.
///         Nothing else can move its money.
///
///         Deployed once as an implementation; each coin gets a minimal clone with the coin, its router and its pool
///         fee appended to the clone's code, so they can't change.
contract CoinBurner {
    address public constant BURN = 0x000000000000000000000000000000000000dEaD;

    /// @notice The ChimiBurner that created this burner; the only caller allowed to spend it.
    address public immutable HUB;
    IWETH9Burner public immutable WETH;

    /// @notice WETH spent on buys, and coins bought and burned, all time.
    uint256 public totalSpent;
    uint256 public totalBurned;

    event BoughtAndBurned(uint256 wethIn, uint256 coinsBurned);

    error NotHub();

    constructor(address weth) {
        HUB = msg.sender;
        WETH = IWETH9Burner(weth);
    }

    /// @notice ETH sent here (rather than WETH) is wrapped on the next buy.
    receive() external payable {}

    /// @notice The coin this burner buys, the router it buys through and the pool fee, fixed when it was created.
    function config() public view returns (address token, address router, uint24 poolFee) {
        return abi.decode(Clones.fetchCloneArgs(address(this)), (address, address, uint24));
    }

    function coin() external view returns (address c) {
        (c,,) = config();
    }

    /// @notice WETH (and any ETH) waiting to buy the coin.
    function pending() external view returns (uint256) {
        return WETH.balanceOf(address(this)) + address(this).balance;
    }

    /// @notice Spends up to `amountIn` WETH on the coin and sends all of it to the burn address. Reverts if the buy
    ///         would get less than `minOut`. Only the hub calls this, for its keeper.
    function buyAndBurn(uint256 amountIn, uint256 minOut) external returns (uint256 spent, uint256 out) {
        if (msg.sender != HUB) revert NotHub();
        uint256 eth = address(this).balance;
        if (eth > 0) WETH.deposit{value: eth}();
        uint256 balance = WETH.balanceOf(address(this));
        if (amountIn > balance) amountIn = balance;
        if (amountIn == 0) return (0, 0);
        (address c, address router, uint24 poolFee) = config();
        WETH.approve(router, amountIn);
        out = ISwapRouter02Burner(router)
            .exactInputSingle(
                ISwapRouter02Burner.ExactInputSingleParams({
                tokenIn: address(WETH),
                tokenOut: c,
                fee: poolFee,
                recipient: BURN,
                amountIn: amountIn,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0
            })
            );
        spent = amountIn;
        totalSpent += amountIn;
        totalBurned += out;
        emit BoughtAndBurned(amountIn, out);
    }
}

/// @title ChimiBurner
/// @notice The burns in Chimi's launch fees. Every coin launched on the pad after it sends 5% of its ETH trading fees
///         here (the locker's "staker" leg, pushed as native ETH); the keeper spends it on CHIMI in CHIMI's pool and
///         the CHIMI goes to the burn address. A coin whose creator ticked "burn my coin" also gets its own
///         CoinBurner, created here by the pad at launch, which takes 10% of that coin's ETH fees and spends it on
///         the coin itself.
///
///         What the owner can do: change the keeper. Nothing else. CHIMI, its router and pool fee, the pad and the
///         burner code are fixed at deployment, and ETH only leaves as a buy whose coins go to the burn address.
///         What the keeper can do: choose when and how much to spend, and the least it accepts for it.
contract ChimiBurner is Ownable2Step, ReentrancyGuard {
    address public constant BURN = 0x000000000000000000000000000000000000dEaD;

    IWETH9Burner public immutable WETH;
    address public immutable CHIMI;
    ISwapRouter02Burner public immutable CHIMI_ROUTER;
    uint24 public immutable CHIMI_POOL_FEE;
    /// @notice The only caller allowed to create a coin's burner: the Chimi pad.
    address public immutable PAD;
    /// @notice The code every coin's burner runs.
    address public immutable COIN_BURNER_IMPL;

    address public keeper;

    uint256 public totalSpentOnChimi;
    uint256 public totalChimiBurned;

    /// @notice Each coin's burner; zero for a coin that doesn't burn itself.
    mapping(address => address) public burnerOf;
    /// @notice Every coin with a burner, in launch order.
    address[] public burningCoins;

    event ChimiBoughtAndBurned(uint256 ethIn, uint256 chimiBurned);
    event CoinBurnerCreated(address indexed coin, address burner, address router, uint24 poolFee);
    event CoinBoughtAndBurned(address indexed coin, uint256 wethIn, uint256 coinsBurned);
    event KeeperSet(address indexed keeper);

    error NotKeeper();
    error NotPad();
    error ZeroAddress();
    error NoBurner();

    modifier onlyKeeper() {
        if (msg.sender != keeper) revert NotKeeper();
        _;
    }

    constructor(
        address weth,
        address chimi,
        address chimiRouter,
        uint24 chimiPoolFee,
        address pad,
        address keeper_,
        address owner_
    ) Ownable(owner_) {
        if (
            weth == address(0) || chimi == address(0) || chimiRouter == address(0) || pad == address(0)
                || keeper_ == address(0)
        ) revert ZeroAddress();
        WETH = IWETH9Burner(weth);
        CHIMI = chimi;
        CHIMI_ROUTER = ISwapRouter02Burner(chimiRouter);
        CHIMI_POOL_FEE = chimiPoolFee;
        PAD = pad;
        COIN_BURNER_IMPL = address(new CoinBurner(weth));
        keeper = keeper_;
        emit KeeperSet(keeper_);
    }

    /// @dev Kept empty: the locker's push should cost no more than a transfer.
    receive() external payable {}

    // ─── CHIMI ────────────────────────────────────────────────────────────────────────────────

    /// @notice ETH (and WETH) waiting to buy CHIMI.
    function pendingChimi() external view returns (uint256) {
        return address(this).balance + WETH.balanceOf(address(this));
    }

    /// @notice Spends up to `amountIn` on CHIMI and sends all of it to the burn address. Reverts if the buy would get
    ///         less than `minOut` CHIMI.
    function burnChimi(uint256 amountIn, uint256 minOut) external onlyKeeper nonReentrant returns (uint256 out) {
        // The locker pays in WETH when its ETH push fails; unwrap it so it's spent the same way.
        uint256 wrapped = WETH.balanceOf(address(this));
        if (wrapped > 0) WETH.withdraw(wrapped);
        uint256 balance = address(this).balance;
        if (amountIn > balance) amountIn = balance;
        if (amountIn == 0) return 0;
        out = CHIMI_ROUTER.exactInputSingle{value: amountIn}(
            ISwapRouter02Burner.ExactInputSingleParams({
                tokenIn: address(WETH),
                tokenOut: CHIMI,
                fee: CHIMI_POOL_FEE,
                recipient: BURN,
                amountIn: amountIn,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0
            })
        );
        totalSpentOnChimi += amountIn;
        totalChimiBurned += out;
        emit ChimiBoughtAndBurned(amountIn, out);
    }

    // ─── Coins that burn themselves ───────────────────────────────────────────────────────────

    /// @notice The pad calls this while launching a coin whose creator ticked "burn my coin". Returns the coin's
    ///         burner, creating it the first time.
    function createCoinBurner(address coin, address router, uint24 poolFee) external returns (address burner) {
        if (msg.sender != PAD) revert NotPad();
        if (coin == address(0) || router == address(0)) revert ZeroAddress();
        burner = burnerOf[coin];
        if (burner != address(0)) return burner;
        burner = Clones.cloneDeterministicWithImmutableArgs(
            COIN_BURNER_IMPL, abi.encode(coin, router, poolFee), bytes32(uint256(uint160(coin)))
        );
        burnerOf[coin] = burner;
        burningCoins.push(coin);
        emit CoinBurnerCreated(coin, burner, router, poolFee);
    }

    /// @notice Spends up to `amountIn` of `coin`'s burner on the coin and burns what it buys. Reverts if the buy
    ///         would get less than `minOut` coins.
    function burnCoin(address coin, uint256 amountIn, uint256 minOut)
        external
        onlyKeeper
        nonReentrant
        returns (uint256 spent, uint256 out)
    {
        address burner = burnerOf[coin];
        if (burner == address(0)) revert NoBurner();
        (spent, out) = CoinBurner(payable(burner)).buyAndBurn(amountIn, minOut);
        if (spent > 0) emit CoinBoughtAndBurned(coin, spent, out);
    }

    function burningCoinsLength() external view returns (uint256) {
        return burningCoins.length;
    }

    // ─── Owner ────────────────────────────────────────────────────────────────────────────────

    function setKeeper(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        keeper = next;
        emit KeeperSet(next);
    }
}
