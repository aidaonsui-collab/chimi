// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {V4LaunchMath} from "./libraries/V4LaunchMath.sol";
import {ChimiV4Token} from "./ChimiV4Token.sol";
import {ChimiV4TokenFactory} from "./ChimiV4TokenFactory.sol";
import {ChimiTaxHook} from "./ChimiTaxHook.sol";
import {ChimiV4Locker} from "./ChimiV4Locker.sol";

interface IChimiBpsSource {
    function lpMemeCreatorBps() external view returns (uint16);
    function lpMemeStakerBps() external view returns (uint16);
}

/// @title ChimiV4Launcher
/// @notice Chimi v4 launches: one transaction deploys a 1B token, opens a native-ETH Uniswap v4 pool with a buy and
///         sell tax, locks the whole supply in one single-sided position, and can buy for the creator before anyone
///         else trades. There is no bonding curve. v3 launches on `InstantErc20QuoteFactory` are unchanged.
///
///         Choices that do not carry straight over from Kleos:
///         - The quote is native ETH (currency0 = address(0)), not WETH. v3 uses WETH because v3 has no native
///           currency. v4's native currency is ETH, which is what traders already pay with. The tax hook settles
///           ERC-6909 claims on that native currency, the same way Kleos settles HYPE.
///         - Pictures and descriptions stay off-chain (the blob and KV profile). Kleos stored an image URL on the
///           launcher; this launcher does not.
///         - GIWA is OP Stack, not HyperEVM. There is no inbox alias. The creator is `msg.sender`, and the block
///           stamped on a launch is `block.number`.
///         - The platform and staker cuts are stamped from Chimi's `ArcBpsSource` when one is set (today: creator
///           70%, staker 0%, platform 30% of the ETH tax). Kleos defaulted the platform to 20% and let it float up
///           to 30%. The creator still chooses how the remainder splits between themselves, holders and buybacks;
///           the app sends all of it to the creator. The pool LP fee is 0, so there is no token-side fee to burn
///           the way MonLock burns the token side of a v3 fee.
///         - Liquidity is locked in `ChimiV4Locker` for `lockDuration` (100 years on the GIWA deploy), then only the
///           beneficiary can withdraw it. Kleos locked forever, with no withdrawal function. The v3 proxy-admin
///           gap does not apply: this locker is not a proxy.
///         - A first buy cannot take more than `maxFirstBuyBps` of the supply (5% unless the owner raises it, and
///           never more than 10%). v3 still has no such cap.
///         - The opening fully-diluted price matches a v3 launch at the default virtual quote (~1.106 ETH), not
///           Kleos's 30 HYPE. The owner can set another market cap.
///         - The contract owner pays no creation fee, same as the v3 factory. Everyone else pays `creationFee`.
contract ChimiV4Launcher is Ownable2Step, ReentrancyGuard, IUnlockCallback {
    using SafeERC20 for IERC20;
    using StateLibrary for IPoolManager;

    uint256 public constant VERSION = 1;
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;
    uint256 public constant BPS = 10_000;
    /// @dev v3's opening FDV at the default virtual quote: quote * supply / VIRTUAL_TOKEN_INIT.
    uint256 public constant OPENING_MARKET_CAP = 1_106_539_463_807_860_486;
    int24 public constant TICK_SPACING = V4LaunchMath.TICK_SPACING;
    uint256 public constant MAX_CREATION_FEE = 1 ether;
    uint256 public constant MIN_START_MARKET_CAP = 1 ether;
    uint256 public constant MAX_START_MARKET_CAP = 100_000 ether;
    uint16 public constant MAX_FIRST_BUY_BPS = 1_000;
    uint32 public constant MAX_LAUNCH_WINDOW = 30 minutes;
    uint16 public constant MIN_WINDOW_MAX_WALLET_BPS = 10;
    uint16 public constant MAX_WINDOW_MAX_WALLET_BPS = 1_000;
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;
    Currency internal constant NATIVE = CurrencyLibrary.ADDRESS_ZERO;

    IPoolManager public immutable poolManager;
    ChimiV4TokenFactory public immutable tokenFactory;
    ChimiV4Locker public immutable locker;
    ChimiTaxHook public hook;

    address public treasury;
    /// @notice Staker-leg recipient. Chimi's deploy points this at the treasury, and the bps source's staker cut is 0.
    address public stakingPool;
    /// @notice When set, each launch stamps platform and staker bps from here instead of `platformBps`.
    address public bpsSource;
    /// @notice Platform share used when `bpsSource` is unset. 30% matches today's ArcBpsSource remainder.
    uint16 public platformBps = 3_000;
    uint256 public startMarketCap = OPENING_MARKET_CAP;
    uint256 public creationFee;
    bool public createPaused;
    uint16 public maxFirstBuyBps = 500;
    /// @notice Off unless the owner sets it. v3 launches have anti-snipe disabled; this defaults the same way.
    uint32 public launchWindow = 0;
    uint16 public windowMaxWalletBps = 100;

    struct Launch {
        address creator;
        uint64 createdAt;
        uint64 createdBlock;
        uint64 windowEndsAt;
        uint64 unlocksAt;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        bytes32 poolId;
        uint256 startMarketCap;
    }

    mapping(address => Launch) internal _launches;
    address[] public allTokens;
    mapping(address => uint256) public launchNonce;
    uint256 public creationFees;

    error CreationFeeUnpaid();
    error FirstBuyCap();
    error FirstBuySlippage();
    error HookAlreadySet();
    error HookUnset();
    error EthSide();
    error EthTransferFailed();
    error LaunchWindowOutOfRange();
    error LaunchesPaused();
    error MarketCapOutOfRange();
    error NameOrSymbolLength();
    error NothingToClaim();
    error OnlyPoolManager();
    error PlatformShareOutOfRange();
    error BpsOutOfRange();
    error FeeTooHigh();
    error ZeroAddress();

    event TokenLaunched(
        address indexed token,
        address indexed creator,
        string name,
        string symbol,
        bytes32 poolId,
        uint256 startMarketCap,
        uint16 buyTaxBps,
        uint16 sellTaxBps,
        uint16 platformBps,
        uint16 stakerBps,
        uint16 creatorBps,
        uint16 holdersBps,
        uint16 buybackBps,
        uint64 unlocksAt,
        bool antiSnipe
    );
    event FirstBuy(address indexed token, address indexed buyer, uint256 ethIn, uint256 tokensOut);
    event HookSet(address hook);
    event CreationFeesClaimed(address indexed treasury, uint256 amount);
    event TreasuryUpdated(address treasury);
    event StakingPoolUpdated(address stakingPool);
    event BpsSourceUpdated(address bpsSource);
    event PlatformShareUpdated(uint16 platformBps);
    event StartMarketCapUpdated(uint256 startMarketCap);
    event CreationFeeUpdated(uint256 fee);
    event CreatePausedSet(bool paused);
    event MaxFirstBuyUpdated(uint16 maxFirstBuyBps);
    event LaunchWindowUpdated(uint32 launchWindow, uint16 windowMaxWalletBps);

    struct LaunchParams {
        string name;
        string symbol;
        uint256 minTokensOut;
        uint16 buyTaxBps;
        uint16 sellTaxBps;
        uint16 creatorBps;
        uint16 holdersBps;
        uint16 buybackBps;
        bool antiSnipe;
    }

    constructor(
        IPoolManager poolManager_,
        address treasury_,
        address stakingPool_,
        address bpsSource_,
        address owner_,
        uint64 lockDuration_
    ) Ownable(owner_) {
        if (address(poolManager_) == address(0) || treasury_ == address(0) || stakingPool_ == address(0)) {
            revert ZeroAddress();
        }
        poolManager = poolManager_;
        treasury = treasury_;
        stakingPool = stakingPool_;
        bpsSource = bpsSource_;
        tokenFactory = new ChimiV4TokenFactory();
        locker = new ChimiV4Locker(poolManager_, treasury_, lockDuration_);
    }

    /// @notice Launch a taxed token into its v4 pool. Anything sent beyond the creation fee is a first buy for the
    ///         creator, in the same transaction, before anyone else can trade. It pays the buy tax like any buy.
    function launch(LaunchParams calldata p) external payable nonReentrant returns (address token, uint256 tokensOut) {
        if (createPaused) revert LaunchesPaused();
        if (address(hook) == address(0)) revert HookUnset();
        address creator = msg.sender;
        uint256 fee = creationFeeDue(creator);
        if (msg.value < fee) revert CreationFeeUnpaid();
        token = _deploy(p.name, p.symbol, creator);

        (uint16 plat, uint16 stakerBps) = _feeShares();
        PoolKey memory key = PoolKey(NATIVE, Currency.wrap(token), 0, TICK_SPACING, IHooks(address(hook)));
        hook.register(
            key,
            ChimiTaxHook.Tax({
                token: token,
                creator: creator,
                buyBps: p.buyTaxBps,
                sellBps: p.sellTaxBps,
                platformBps: plat,
                stakerBps: stakerBps,
                creatorBps: p.creatorBps,
                holdersBps: p.holdersBps,
                buybackBps: p.buybackBps
            })
        );
        uint256 mcap = startMarketCap;
        (int24 tickLower, int24 tickUpper, uint160 start) = V4LaunchMath.range(mcap, TOTAL_SUPPLY);
        uint128 liq = V4LaunchMath.liquidity(tickLower, tickUpper, TOTAL_SUPPLY);
        poolManager.initialize(key, start);

        IERC20(token).safeTransfer(address(locker), IERC20(token).balanceOf(address(this)));
        uint64 unlocksAt = locker.lock(token, tickLower, tickUpper, liq);

        Launch storage l = _launches[token];
        l.creator = creator;
        l.createdAt = uint64(block.timestamp);
        l.createdBlock = uint64(block.number);
        l.unlocksAt = unlocksAt;
        l.tickLower = tickLower;
        l.tickUpper = tickUpper;
        l.liquidity = liq;
        l.poolId = PoolId.unwrap(key.toId());
        l.startMarketCap = mcap;
        allTokens.push(token);
        emit TokenLaunched(
            token,
            creator,
            p.name,
            p.symbol,
            l.poolId,
            mcap,
            p.buyTaxBps,
            p.sellTaxBps,
            plat,
            stakerBps,
            p.creatorBps,
            p.holdersBps,
            p.buybackBps,
            unlocksAt,
            p.antiSnipe
        );

        if (fee > 0) creationFees += fee;
        uint256 buy = msg.value - fee;
        tokensOut = abi.decode(poolManager.unlock(abi.encode(key, buy, creator)), (uint256));
        if (buy > 0) {
            if (tokensOut < p.minTokensOut) revert FirstBuySlippage();
            if (tokensOut > (TOTAL_SUPPLY * maxFirstBuyBps) / BPS) revert FirstBuyCap();
            emit FirstBuy(token, creator, buy, tokensOut);
        }
        uint256 left = IERC20(token).balanceOf(address(this));
        if (left > 0) IERC20(token).safeTransfer(DEAD, left);
        if (p.antiSnipe && launchWindow > 0) {
            uint64 endsAt = uint64(block.timestamp + launchWindow);
            l.windowEndsAt = endsAt;
            ChimiV4Token(token).startLaunchWindow(endsAt, (TOTAL_SUPPLY * windowMaxWalletBps) / BPS);
        }
    }

    /// @dev The first buy. Liquidity was already minted by the locker in its own unlock.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        (PoolKey memory key, uint256 buy, address creator) = abi.decode(data, (PoolKey, uint256, address));
        if (buy == 0) return abi.encode(uint256(0));
        poolManager.settle{value: buy}();
        BalanceDelta bought = poolManager.swap(
            key,
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(buy), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            ""
        );
        uint256 tokensOut = uint256(int256(bought.amount1()));
        uint256 unspent = buy - uint256(int256(-bought.amount0()));
        if (unspent > 0) poolManager.take(NATIVE, creator, unspent);
        poolManager.take(key.currency1, creator, tokensOut);
        return abi.encode(tokensOut);
    }

    function _deploy(string calldata name, string calldata symbol, address creator) internal returns (address token) {
        uint256 nameLen = bytes(name).length;
        uint256 symbolLen = bytes(symbol).length;
        if (!(nameLen > 0 && nameLen <= 32 && symbolLen > 0 && symbolLen <= 12)) revert NameOrSymbolLength();
        bytes32 salt = keccak256(abi.encode(creator, launchNonce[creator]++));
        token = tokenFactory.deploy(salt, name, symbol, address(hook), address(poolManager), address(locker));
    }

    /// @notice Platform and staker bps for a launch happening now.
    function _feeShares() internal view returns (uint16 plat, uint16 stakerBps) {
        if (bpsSource == address(0)) return (platformBps, 0);
        uint16 creatorCut = IChimiBpsSource(bpsSource).lpMemeCreatorBps();
        stakerBps = IChimiBpsSource(bpsSource).lpMemeStakerBps();
        if (uint256(creatorCut) + stakerBps > BPS) revert BpsOutOfRange();
        plat = uint16(BPS - creatorCut - stakerBps);
        if (plat > 3_000) revert PlatformShareOutOfRange();
    }

    /// @notice Creation fee due for `creator`. The owner launches free, same as the v3 factory.
    function creationFeeDue(address creator) public view returns (uint256) {
        if (creator == owner()) return 0;
        return creationFee;
    }

    function claimCreationFees() external nonReentrant returns (uint256 amount) {
        amount = creationFees;
        if (amount == 0) revert NothingToClaim();
        creationFees = 0;
        (bool ok,) = payable(treasury).call{value: amount}("");
        if (!ok) revert EthTransferFailed();
        emit CreationFeesClaimed(treasury, amount);
    }

    function setHook(ChimiTaxHook hook_) external onlyOwner {
        if (address(hook) != address(0)) revert HookAlreadySet();
        if (!(hook_.launcher() == address(this) && hook_.poolManager() == poolManager)) revert ZeroAddress();
        hook = hook_;
        locker.setHook(address(hook_));
        emit HookSet(address(hook_));
    }

    function setTreasury(address t) external onlyOwner {
        if (t == address(0)) revert ZeroAddress();
        treasury = t;
        emit TreasuryUpdated(t);
    }

    function setStakingPool(address s) external onlyOwner {
        if (s == address(0)) revert ZeroAddress();
        stakingPool = s;
        emit StakingPoolUpdated(s);
    }

    /// @notice Point launches at Chimi's bps source. Pass the zero address to use `platformBps` instead.
    function setBpsSource(address src) external onlyOwner {
        bpsSource = src;
        emit BpsSourceUpdated(src);
    }

    function setPlatformShare(uint16 bps) external onlyOwner {
        if (bps > 3_000) revert PlatformShareOutOfRange();
        platformBps = bps;
        emit PlatformShareUpdated(bps);
    }

    function setStartMarketCap(uint256 mcap) external onlyOwner {
        if (!(mcap >= MIN_START_MARKET_CAP && mcap <= MAX_START_MARKET_CAP)) revert MarketCapOutOfRange();
        startMarketCap = mcap;
        emit StartMarketCapUpdated(mcap);
    }

    function setCreationFee(uint256 fee) external onlyOwner {
        if (fee > MAX_CREATION_FEE) revert FeeTooHigh();
        creationFee = fee;
        emit CreationFeeUpdated(fee);
    }

    function setCreatePaused(bool paused) external onlyOwner {
        createPaused = paused;
        emit CreatePausedSet(paused);
    }

    function setMaxFirstBuy(uint16 bps) external onlyOwner {
        if (bps > MAX_FIRST_BUY_BPS) revert BpsOutOfRange();
        maxFirstBuyBps = bps;
        emit MaxFirstBuyUpdated(bps);
    }

    function setLaunchWindow(uint32 window, uint16 maxWalletBps) external onlyOwner {
        if (!(window <= MAX_LAUNCH_WINDOW && maxWalletBps >= MIN_WINDOW_MAX_WALLET_BPS && maxWalletBps <= MAX_WINDOW_MAX_WALLET_BPS)) {
            revert LaunchWindowOutOfRange();
        }
        launchWindow = window;
        windowMaxWalletBps = maxWalletBps;
        emit LaunchWindowUpdated(window, maxWalletBps);
    }

    /// @notice Term for launches from now on. Locks already stamped do not move.
    function setLockDuration(uint64 next) external onlyOwner {
        locker.setLockDuration(next);
    }

    function getLaunch(address token) external view returns (Launch memory) {
        return _launches[token];
    }

    function allTokensLength() external view returns (uint256) {
        return allTokens.length;
    }

    function tokensPage(uint256 offset, uint256 limit) external view returns (address[] memory page) {
        uint256 n = allTokens.length;
        if (offset >= n) return new address[](0);
        uint256 count = Math.min(limit, n - offset);
        page = new address[](count);
        for (uint256 i; i < count; ++i) {
            page[i] = allTokens[n - 1 - offset - i];
        }
    }

    function predictToken(address creator, string calldata name, string calldata symbol) external view returns (address) {
        if (address(hook) == address(0)) revert HookUnset();
        bytes32 salt = keccak256(abi.encode(creator, launchNonce[creator]));
        return tokenFactory.predict(salt, name, symbol, address(hook), address(poolManager), address(locker));
    }

    function quoteLaunch(uint256 ethIn, uint16 buyTaxBps) external view returns (uint256 tokensOut) {
        (int24 tickLower, int24 tickUpper, uint160 start) = V4LaunchMath.range(startMarketCap, TOTAL_SUPPLY);
        uint128 liq = V4LaunchMath.liquidity(tickLower, tickUpper, TOTAL_SUPPLY);
        tokensOut = V4LaunchMath.quoteBuy(start, liq, ethIn - (ethIn * buyTaxBps) / BPS);
    }

    function spotPrice(address token) external view returns (uint256) {
        bytes32 id = _launches[token].poolId;
        if (id == bytes32(0)) return 0;
        (uint160 sqrtPrice,,,) = poolManager.getSlot0(PoolId.wrap(id));
        return V4LaunchMath.spot(sqrtPrice);
    }

    /// @notice ETH and tokens in the launch position right now. Zero after the beneficiary withdraws it.
    function reserves(address token) external view returns (uint256 ethAmount, uint256 tokenAmount, uint160 sqrtPriceX96) {
        Launch memory l = _launches[token];
        if (l.poolId == bytes32(0)) return (0, 0, 0);
        (sqrtPriceX96,,,) = poolManager.getSlot0(PoolId.wrap(l.poolId));
        (,,,, bool withdrawn) = locker.positions(token);
        if (withdrawn) return (0, 0, sqrtPriceX96);
        (ethAmount, tokenAmount) = V4LaunchMath.amounts(sqrtPriceX96, l.tickLower, l.tickUpper, l.liquidity);
    }
}
