// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";

/// @title ChimiV4Locker
/// @notice Holds a Chimi v4 launch's single-sided position. Kleos keeps that position on the launcher with no
///         withdrawal path at all. Chimi's v3 locker (MonLock) locks the LP NFT for a term — 100 years on GIWA —
///         and only the beneficiary can take the principal back after that, while nobody can take it before.
///         This locker is that rule for a v4 position: the position is owned by this contract (v4 positions are
///         keyed by the modifying address, not an NFT), principal cannot move until `unlocksAt`, and after that
///         only `beneficiary` can withdraw it.
///
///         The pool's LP fee is zero. Trading fees are the hook's ETH tax, claimed on the hook, not collected
///         here. There is nothing to sweep off the position the way MonLock sweeps a v3 NFT.
contract ChimiV4Locker is IUnlockCallback {
    using SafeERC20 for IERC20;

    uint64 public constant MIN_LOCK_DURATION = 30 days;
    int24 public constant TICK_SPACING = 200;
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;
    Currency internal constant ETH_CURRENCY = CurrencyLibrary.ADDRESS_ZERO;

    IPoolManager public immutable poolManager;
    /// @notice The launcher. Set to whoever deployed this locker (the launcher, from its constructor).
    address public immutable launcher;

    /// @notice Who may withdraw principal once a lock is over, and who may hand that right on. One address for
    ///         every lock: Chimi has one platform beneficiary, where MonLock stores one per position.
    address public beneficiary;
    address public hook;
    /// @notice Term applied to locks created from now on. Locks already stamped keep their own `unlocksAt`.
    uint64 public lockDuration;

    struct Position {
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint64 unlocksAt;
        bool withdrawn;
    }

    mapping(address => Position) public positions;

    error AlreadyLocked();
    error DurationTooShort();
    error HookUnset();
    error NotBeneficiary();
    error NotLauncher();
    error NotLocked();
    error OnlyPoolManager();
    error QuoteSide();
    error StillLocked();
    error ZeroAddress();

    event Locked(address indexed token, uint64 unlocksAt, uint128 liquidity);
    event Withdrawn(address indexed token, address indexed to);
    event BeneficiarySet(address indexed beneficiary);
    event LockDurationSet(uint64 duration);

    modifier onlyLauncher() {
        if (msg.sender != launcher) revert NotLauncher();
        _;
    }

    constructor(IPoolManager poolManager_, address beneficiary_, uint64 lockDuration_) {
        if (address(poolManager_) == address(0) || beneficiary_ == address(0)) revert ZeroAddress();
        if (lockDuration_ < MIN_LOCK_DURATION) revert DurationTooShort();
        poolManager = poolManager_;
        launcher = msg.sender;
        beneficiary = beneficiary_;
        lockDuration = lockDuration_;
    }

    function setHook(address hook_) external onlyLauncher {
        if (hook != address(0) || hook_ == address(0)) revert HookUnset();
        hook = hook_;
    }

    /// @notice Term for future locks. Launcher owner only, via the launcher. Never shortens a lock already stamped.
    function setLockDuration(uint64 next) external onlyLauncher {
        if (next < MIN_LOCK_DURATION) revert DurationTooShort();
        lockDuration = next;
        emit LockDurationSet(next);
    }

    /// @notice Hand the right to withdraw, after each lock ends, to another address. Current beneficiary only.
    function setBeneficiary(address next) external {
        if (msg.sender != beneficiary || next == address(0)) revert NotBeneficiary();
        beneficiary = next;
        emit BeneficiarySet(next);
    }

    /// @notice Mint the launch position. The launcher has already sent this contract the token supply. Launcher only.
    function lock(address token, int24 tickLower, int24 tickUpper, uint128 liquidity) external onlyLauncher returns (uint64 unlocksAt) {
        if (hook == address(0)) revert HookUnset();
        if (positions[token].liquidity != 0) revert AlreadyLocked();
        unlocksAt = uint64(block.timestamp + lockDuration);
        positions[token] = Position({
            tickLower: tickLower, tickUpper: tickUpper, liquidity: liquidity, unlocksAt: unlocksAt, withdrawn: false
        });
        poolManager.unlock(abi.encode(uint8(0), token, tickLower, tickUpper, liquidity));
        uint256 left = IERC20(token).balanceOf(address(this));
        if (left > 0) IERC20(token).safeTransfer(DEAD, left);
        emit Locked(token, unlocksAt, liquidity);
    }

    /// @notice Take the position back. Beneficiary only, and only once `unlocksAt` has passed.
    function withdraw(address token) external {
        if (msg.sender != beneficiary) revert NotBeneficiary();
        Position storage p = positions[token];
        if (p.liquidity == 0 || p.withdrawn) revert NotLocked();
        if (block.timestamp < p.unlocksAt) revert StillLocked();
        int24 tickLower = p.tickLower;
        int24 tickUpper = p.tickUpper;
        uint128 liquidity = p.liquidity;
        p.withdrawn = true;
        poolManager.unlock(abi.encode(uint8(1), token, tickLower, tickUpper, liquidity));
        emit Withdrawn(token, beneficiary);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        (uint8 action, address token, int24 tickLower, int24 tickUpper, uint128 liquidity) =
            abi.decode(data, (uint8, address, int24, int24, uint128));
        PoolKey memory key = PoolKey({
            currency0: ETH_CURRENCY,
            currency1: Currency.wrap(token),
            fee: 0,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(hook)
        });
        if (action == 0) {
            (BalanceDelta added,) = poolManager.modifyLiquidity(
                key,
                ModifyLiquidityParams({
                    tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: int256(uint256(liquidity)), salt: bytes32(0)
                }),
                ""
            );
            // Single-sided: the position is entirely tokens. Any ETH leg means the price was wrong.
            if (added.amount0() != 0) revert QuoteSide();
            poolManager.sync(key.currency1);
            IERC20(token).safeTransfer(address(poolManager), uint256(int256(-added.amount1())));
            poolManager.settle();
            return "";
        }
        (BalanceDelta removed,) = poolManager.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: -int256(uint256(liquidity)),
                salt: bytes32(0)
            }),
            ""
        );
        if (removed.amount0() > 0) {
            poolManager.take(key.currency0, beneficiary, uint256(int256(removed.amount0())));
        }
        if (removed.amount1() > 0) {
            poolManager.take(key.currency1, beneficiary, uint256(int256(removed.amount1())));
        }
        return "";
    }
}
