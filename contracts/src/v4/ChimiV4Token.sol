// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IHolderPayer {
    function payHolder(address recipient, uint256 amount) external;
}

/// @title ChimiV4Token
/// @notice A Chimi v4 launch's ERC-20: 18 decimals and a fixed 1,000,000,000 supply, minted once to the launcher,
///         which puts all of it into the token's v4 pool in the same transaction. No owner, no mint, no transfer
///         tax: the pool's hook takes the tax in ETH.
///
///         Holder rewards. The hook credits holders' share of each trade's tax here, and each holder earns it pro
///         rata to their balance at that moment. The ETH stays with the hook until a holder claims. The PoolManager,
///         the hook, the launcher, the locker and the burn address earn nothing.
///
///         The launch window: the launcher may start it once, right after the first buy, and while it runs no wallet
///         can end up holding more than `maxWallet`. Chimi leaves the window off unless the launcher owner turns it
///         on. Kleos's HyperEVM inbox alias is not used: GIWA is an OP Stack chain, and the sender is `msg.sender`.
contract ChimiV4Token is ERC20 {
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;
    /// @notice Below this many earning tokens, credits wait. It also bounds the reward index.
    uint256 public constant MIN_EARNING = 1 ether;
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 internal constant MAGNITUDE = 2 ** 128;

    address public immutable launcher;
    address public immutable hook;
    address public immutable poolManager;
    address public immutable locker;

    uint64 public guardEndsAt;
    uint256 public maxWallet;

    /// @notice ETH per token credited to holders, ever, times 2^128.
    uint256 public rewardPerToken;
    mapping(address => int256) internal _corrections;
    /// @notice ETH each holder has claimed.
    mapping(address => uint256) public rewardsClaimed;
    /// @notice Tokens held by the accounts that earn nothing.
    uint256 public excludedSupply;
    /// @notice ETH credited while too few tokens could earn it, added to the next credit.
    uint256 public pendingRewards;
    /// @notice ETH credited to holders, ever.
    uint256 public totalRewards;

    error OnlyHook();
    error LaunchWindowNotStartable();
    error MaxWalletExceeded();
    error NothingToClaim();

    event RewardsCredited(uint256 amount);
    event RewardsClaimed(address indexed holder, address indexed recipient, uint256 amount);
    event LaunchWindowStarted(uint64 endsAt, uint256 maxWallet);

    constructor(
        string memory name_,
        string memory symbol_,
        address launcher_,
        address hook_,
        address poolManager_,
        address locker_
    ) ERC20(name_, symbol_) {
        launcher = launcher_;
        hook = hook_;
        poolManager = poolManager_;
        locker = locker_;
        _mint(launcher_, TOTAL_SUPPLY);
    }

    /// @notice Whether `account` holds without earning.
    function isExcluded(address account) public view returns (bool) {
        return account == poolManager || account == hook || account == launcher || account == locker || account == DEAD;
    }

    /// @notice Tokens that earn holder rewards.
    function earningSupply() public view returns (uint256) {
        return TOTAL_SUPPLY - excludedSupply;
    }

    /// @notice ETH `holder` can claim now.
    function rewardsOf(address holder) public view returns (uint256) {
        if (isExcluded(holder)) return 0;
        uint256 earned = uint256(int256(rewardPerToken * balanceOf(holder)) + _corrections[holder]) / MAGNITUDE;
        return earned - rewardsClaimed[holder];
    }

    /// @notice Credit `amount` of ETH, which the hook holds, to everyone holding the token now. Hook only.
    function creditRewards(uint256 amount) external {
        if (msg.sender != hook) revert OnlyHook();
        amount += pendingRewards;
        uint256 earning = earningSupply();
        if (earning < MIN_EARNING) {
            pendingRewards = amount;
            return;
        }
        pendingRewards = 0;
        rewardPerToken += (amount * MAGNITUDE) / earning;
        totalRewards += amount;
        emit RewardsCredited(amount);
    }

    /// @notice Claim your holder rewards in ETH, to `recipient` (or yourself, for the zero address).
    function claimRewards(address recipient) external returns (uint256 amount) {
        address holder = msg.sender;
        amount = rewardsOf(holder);
        if (amount == 0) revert NothingToClaim();
        if (recipient == address(0)) recipient = holder;
        rewardsClaimed[holder] += amount;
        IHolderPayer(hook).payHolder(recipient, amount);
        emit RewardsClaimed(holder, recipient, amount);
    }

    /// @notice Start the launch window. Launcher only, once.
    function startLaunchWindow(uint64 endsAt, uint256 maxWallet_) external {
        if (!(msg.sender == launcher && guardEndsAt == 0 && endsAt > block.timestamp)) revert LaunchWindowNotStartable();
        guardEndsAt = endsAt;
        maxWallet = maxWallet_;
        emit LaunchWindowStarted(endsAt, maxWallet_);
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        int256 shift = int256(rewardPerToken * value);
        bool fromEarns = from != address(0) && !isExcluded(from);
        bool toEarns = to != address(0) && !isExcluded(to);
        if (fromEarns) _corrections[from] += shift;
        if (toEarns) _corrections[to] -= shift;
        if (fromEarns && !toEarns) excludedSupply += value;
        else if (!fromEarns && toEarns && from != address(0)) excludedSupply -= value;
        else if (from == address(0) && !toEarns) excludedSupply += value;
        if (toEarns && block.timestamp < guardEndsAt && balanceOf(to) > maxWallet) revert MaxWalletExceeded();
    }
}
