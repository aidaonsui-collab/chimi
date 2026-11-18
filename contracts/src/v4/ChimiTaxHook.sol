// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary, toBeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {ChimiV4Token} from "./ChimiV4Token.sol";

interface IChimiLauncher {
    function treasury() external view returns (address);
    function stakingPool() external view returns (address);
}

/// @title ChimiTaxHook
/// @notice The Uniswap v4 hook on every Chimi v4 pool. Ported from KleosTaxHook. Each trade pays the buy or sell
///         tax set at launch, on its ETH side: a buy pays it on the ETH it spends, a sell on the ETH it receives.
///         The ETH never moves during a trade. The hook takes its cut as the PoolManager's ERC-6909 claims on
///         native ETH.
///
///         Where Kleos lets the creator aim the post-platform remainder at themselves, holders and buybacks, Chimi
///         keeps that machinery (the tests cover it) and the launcher stamps the platform and staker cuts from
///         Chimi's existing bps source: creator 70%, staker 0%, platform the remaining 30%, matching MonLock's
///         quote-side split. There is no token-side fee to burn, because the pool LP fee is zero — the tax is the
///         fee, and it is taken in ETH only. A creator who launches through the app sends their whole remainder
///         to themselves; holders and buybacks stay available on the contract.
///
///         Only the launcher can open a pool on this hook.
contract ChimiTaxHook is IHooks, IUnlockCallback {
    using StateLibrary for IPoolManager;

    uint256 public constant BPS = 10_000;
    uint16 public constant MIN_TAX_BPS = 100; // 1%: what every trade paid on v3 (the pool fee)
    uint16 public constant MAX_TAX_BPS = 1_000; // 10%
    uint16 public constant MAX_PLATFORM_BPS = 3_000;
    /// @notice A buyback's price limit, in bps of the square-root price: 25 bps of √price is about 0.5% of price.
    uint16 public constant BUYBACK_SQRT_STEP_BPS = 25;
    /// @notice Waiting buyback ETH below this rides along until a later trade.
    uint256 public constant BUYBACK_MIN = 0.005 ether;
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;
    Currency internal constant NATIVE = CurrencyLibrary.ADDRESS_ZERO;
    uint256 internal constant NATIVE_ID = 0; // address(0).toId()

    IPoolManager public immutable poolManager;
    /// @notice The launcher: the only account that can open pools here. Its treasury and staking pool take those cuts.
    address public immutable launcher;

    /// @notice A pool's tax, set at launch. `creatorBps + holdersBps + buybackBps` is the split of what is left
    ///         after the platform and staker cuts, and adds up to `BPS`.
    struct Tax {
        address token;
        address creator;
        uint16 buyBps;
        uint16 sellBps;
        uint16 platformBps;
        uint16 stakerBps;
        uint16 creatorBps;
        uint16 holdersBps;
        uint16 buybackBps;
    }

    mapping(PoolId => Tax) internal _taxes;
    mapping(address => PoolKey) internal _keys;
    mapping(address => bool) public isToken;
    /// @notice Claimable ETH per creator.
    mapping(address => uint256) public creatorFees;
    /// @notice Claimable ETH of one token still owed to one creator. A claim zeros that creator's tokens.
    mapping(address => mapping(address => uint256)) public creatorFeesOf;
    mapping(address => address[]) internal _tokensOf;
    mapping(address => mapping(address => bool)) internal _listed;
    /// @notice Claimable ETH for the treasury.
    uint256 public protocolFees;
    /// @notice Claimable ETH for the staking pool (Chimi's staker leg; 0 with today's bps source).
    uint256 public stakerFees;
    /// @notice ETH per token waiting to be spent on buybacks.
    mapping(address => uint256) public buybackPending;
    /// @notice ETH owed to holders, credited on the tokens and not yet claimed.
    uint256 public holderFunds;

    error OnlyLauncher();
    error OnlyPoolManager();
    error OnlySelf();
    error NotCreator();
    error UnknownToken();
    error TaxOutOfRange();
    error SplitOutOfRange();
    error NothingToClaim();
    error HookNotImplemented();

    event Taxed(address indexed token, bool buy, uint256 tax);
    event TaxesLowered(address indexed token, uint16 buyBps, uint16 sellBps);
    event BuybackBurned(address indexed token, uint256 ethIn, uint256 tokensBurned);
    event CreatorFeesClaimed(address indexed creator, uint256 amount);
    event ProtocolFeesClaimed(address indexed treasury, uint256 amount);
    event StakerFeesClaimed(address indexed stakingPool, uint256 amount);
    event CreatorTransferred(address indexed token, address indexed from, address indexed to);

    constructor(IPoolManager poolManager_, address launcher_) {
        poolManager = poolManager_;
        launcher = launcher_;
        Hooks.validateHookPermissions(
            IHooks(address(this)),
            Hooks.Permissions({
                beforeInitialize: true,
                afterInitialize: false,
                beforeAddLiquidity: false,
                afterAddLiquidity: false,
                beforeRemoveLiquidity: false,
                afterRemoveLiquidity: false,
                beforeSwap: true,
                afterSwap: true,
                beforeDonate: false,
                afterDonate: false,
                beforeSwapReturnDelta: true,
                afterSwapReturnDelta: true,
                afterAddLiquidityReturnDelta: false,
                afterRemoveLiquidityReturnDelta: false
            })
        );
    }

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        _;
    }

    /// @notice Set a new pool's tax, before the launcher opens it. Launcher only.
    function register(PoolKey calldata key, Tax calldata t) external {
        if (msg.sender != launcher) revert OnlyLauncher();
        if (!(t.buyBps >= MIN_TAX_BPS && t.buyBps <= MAX_TAX_BPS && t.sellBps >= MIN_TAX_BPS && t.sellBps <= MAX_TAX_BPS)) {
            revert TaxOutOfRange();
        }
        if (t.platformBps > MAX_PLATFORM_BPS || uint256(t.platformBps) + t.stakerBps > BPS) revert SplitOutOfRange();
        if (uint256(t.creatorBps) + t.holdersBps + t.buybackBps != BPS) revert SplitOutOfRange();
        _taxes[key.toId()] = t;
        _keys[t.token] = key;
        isToken[t.token] = true;
    }

    function beforeInitialize(address sender, PoolKey calldata, uint160) external view onlyPoolManager returns (bytes4) {
        if (sender != launcher) revert OnlyLauncher();
        return IHooks.beforeInitialize.selector;
    }

    /// @dev Where ETH is the amount the trader named (a buy of exact ETH, or a sell for exact ETH), the tax goes on
    ///      before the swap.
    function beforeSwap(address, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        external
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        Tax storage t = _taxes[key.toId()];
        bool buy = params.zeroForOne;
        bool exactIn = params.amountSpecified < 0;
        if (buy != exactIn) return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        uint256 amount = uint256(exactIn ? -params.amountSpecified : params.amountSpecified);
        uint256 rate = buy ? t.buyBps : t.sellBps;
        uint256 tax = exactIn ? (amount * rate) / BPS : (amount * rate) / (BPS - rate);
        if (tax == 0) return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        _take(key, t, buy, tax);
        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(int128(int256(tax)), 0), 0);
    }

    /// @dev Where ETH is the other side (a buy of exact tokens, or a sell of exact tokens), the tax comes off the
    ///      ETH the swap worked out. Then, if enough is waiting, the buyback.
    function afterSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata
    ) external onlyPoolManager returns (bytes4, int128 hookDelta) {
        Tax storage t = _taxes[key.toId()];
        bool buy = params.zeroForOne;
        if (buy != (params.amountSpecified < 0)) {
            int128 eth = delta.amount0();
            uint256 amount = uint256(int256(eth < 0 ? -eth : eth));
            uint256 rate = buy ? t.buyBps : t.sellBps;
            uint256 tax = buy ? (amount * rate) / (BPS - rate) : (amount * rate) / BPS;
            if (tax > 0) {
                _take(key, t, buy, tax);
                hookDelta = int128(int256(tax));
            }
        }
        if (buybackPending[t.token] >= BUYBACK_MIN) {
            try this.buybackInSwap(key) {} catch {}
        }
        return (IHooks.afterSwap.selector, hookDelta);
    }

    function _take(PoolKey calldata key, Tax storage t, bool buy, uint256 tax) internal {
        poolManager.mint(address(this), NATIVE_ID, tax);
        uint256 toPlatform = (tax * t.platformBps) / BPS;
        uint256 toStaker = (tax * t.stakerBps) / BPS;
        uint256 rest = tax - toPlatform - toStaker;
        uint256 toHolders = (rest * t.holdersBps) / BPS;
        uint256 toBuyback = (rest * t.buybackBps) / BPS;
        uint256 toCreator = rest - toHolders - toBuyback;
        protocolFees += toPlatform;
        stakerFees += toStaker;
        if (toCreator > 0) _creditCreator(t.creator, t.token, toCreator);
        if (toBuyback > 0) buybackPending[t.token] += toBuyback;
        if (toHolders > 0) {
            holderFunds += toHolders;
            ChimiV4Token(t.token).creditRewards(toHolders);
        }
        emit Taxed(Currency.unwrap(key.currency1), buy, tax);
    }

    function _creditCreator(address creator, address token, uint256 amount) internal {
        creatorFees[creator] += amount;
        creatorFeesOf[token][creator] += amount;
        if (!_listed[creator][token]) {
            _listed[creator][token] = true;
            _tokensOf[creator].push(token);
        }
    }

    function buybackInSwap(PoolKey calldata key) external {
        if (msg.sender != address(this)) revert OnlySelf();
        _buyback(key);
    }

    /// @notice Spend what's waiting on a buyback now. Permissionless.
    function buyback(address token) external returns (uint256 ethIn, uint256 tokensBurned) {
        if (!isToken[token]) revert UnknownToken();
        (ethIn, tokensBurned) = abi.decode(poolManager.unlock(abi.encode(uint8(0), token, address(0), 0)), (uint256, uint256));
    }

    function _buyback(PoolKey memory key) internal returns (uint256 ethIn, uint256 tokensBurned) {
        address token = Currency.unwrap(key.currency1);
        uint256 pending = buybackPending[token];
        if (pending == 0) return (0, 0);
        (uint160 sqrtPrice,,,) = poolManager.getSlot0(key.toId());
        uint256 limit = (uint256(sqrtPrice) * BPS) / (BPS + BUYBACK_SQRT_STEP_BPS);
        if (limit <= TickMath.MIN_SQRT_PRICE) limit = TickMath.MIN_SQRT_PRICE + 1;
        BalanceDelta d = poolManager.swap(
            key,
            SwapParams({zeroForOne: true, amountSpecified: -int256(pending), sqrtPriceLimitX96: uint160(limit)}),
            ""
        );
        ethIn = uint256(int256(-d.amount0()));
        tokensBurned = uint256(int256(d.amount1()));
        if (ethIn > 0) poolManager.burn(address(this), NATIVE_ID, ethIn);
        if (tokensBurned > 0) poolManager.take(key.currency1, DEAD, tokensBurned);
        buybackPending[token] = pending - ethIn;
        emit BuybackBurned(token, ethIn, tokensBurned);
    }

    /// @notice Pay a holder's claimed rewards. The token only.
    function payHolder(address recipient, uint256 amount) external {
        if (!isToken[msg.sender]) revert UnknownToken();
        holderFunds -= amount;
        _pay(recipient, amount);
    }

    function claimCreatorFees() external returns (uint256 amount) {
        address creator = msg.sender;
        amount = creatorFees[creator];
        if (amount == 0) revert NothingToClaim();
        creatorFees[creator] = 0;
        address[] storage tokens = _tokensOf[creator];
        for (uint256 i; i < tokens.length; ++i) {
            creatorFeesOf[tokens[i]][creator] = 0;
        }
        _pay(creator, amount);
        emit CreatorFeesClaimed(creator, amount);
    }

    /// @notice Send accrued platform fees to the launcher's treasury. Permissionless.
    function claimProtocolFees() external returns (uint256 amount) {
        amount = protocolFees;
        if (amount == 0) revert NothingToClaim();
        protocolFees = 0;
        address to = IChimiLauncher(launcher).treasury();
        _pay(to, amount);
        emit ProtocolFeesClaimed(to, amount);
    }

    /// @notice Send accrued staker fees to the launcher's staking pool. Permissionless.
    function claimStakerFees() external returns (uint256 amount) {
        amount = stakerFees;
        if (amount == 0) revert NothingToClaim();
        stakerFees = 0;
        address to = IChimiLauncher(launcher).stakingPool();
        _pay(to, amount);
        emit StakerFeesClaimed(to, amount);
    }

    function _pay(address to, uint256 amount) internal {
        poolManager.unlock(abi.encode(uint8(1), address(0), to, amount));
    }

    function unlockCallback(bytes calldata data) external onlyPoolManager returns (bytes memory) {
        (uint8 action, address token, address to, uint256 amount) = abi.decode(data, (uint8, address, address, uint256));
        if (action == 0) {
            (uint256 ethIn, uint256 tokensBurned) = _buyback(_keys[token]);
            return abi.encode(ethIn, tokensBurned);
        }
        poolManager.burn(address(this), NATIVE_ID, amount);
        poolManager.take(NATIVE, to, amount);
        return "";
    }

    /// @notice Lower a coin's buy or sell tax. Current creator only; never below `MIN_TAX_BPS`, never back up.
    function lowerTaxes(address token, uint16 buyBps, uint16 sellBps) external {
        if (!isToken[token]) revert UnknownToken();
        Tax storage t = _taxes[_keys[token].toId()];
        if (msg.sender != t.creator) revert NotCreator();
        if (!(buyBps <= t.buyBps && sellBps <= t.sellBps && buyBps >= MIN_TAX_BPS && sellBps >= MIN_TAX_BPS)) {
            revert TaxOutOfRange();
        }
        t.buyBps = buyBps;
        t.sellBps = sellBps;
        emit TaxesLowered(token, buyBps, sellBps);
    }

    /// @notice Hand a coin's creator rights (its future share of the tax, and lowering it) to another address.
    function transferCreator(address token, address newCreator) external {
        if (!isToken[token]) revert UnknownToken();
        Tax storage t = _taxes[_keys[token].toId()];
        address creator = msg.sender;
        if (!(creator == t.creator && newCreator != address(0))) revert NotCreator();
        t.creator = newCreator;
        emit CreatorTransferred(token, creator, newCreator);
    }

    function taxOf(address token) external view returns (Tax memory) {
        return _taxes[_keys[token].toId()];
    }

    function poolKeyOf(address token) external view returns (PoolKey memory) {
        return _keys[token];
    }

    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function beforeAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function beforeRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert HookNotImplemented();
    }
}
