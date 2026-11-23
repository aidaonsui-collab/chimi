// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title ChimiCreatorLock
 * @notice Holds a creator's locked first buy, chosen at launch: nothing unlocks before the cliff, then the coins
 *         release in a straight line until the vesting end (all at once at the cliff if there is no vesting).
 * @dev The pad (its proxy address, fixed here) is the only address that can open a lock, in the launch transaction,
 *      with the coins already delivered here. There is no owner and no admin. Only the creator can claim, only what
 *      has unlocked, and only to themselves. A creator can push their own lock later, never earlier. Every lock is
 *      public: events plus views by id, by coin and by creator. The same design as nil.city's NilCreatorLock.
 */
contract ChimiCreatorLock {
    using SafeERC20 for IERC20;

    error OnlyPad();
    error OnlyCreator();
    error NothingToClaim();
    error CannotShorten();
    error UnknownLock();

    struct Lock {
        address token;
        address creator;
        uint128 amount;
        uint128 claimed;
        uint64 start;
        /// nothing unlocks before this
        uint64 cliffEnd;
        /// everything is unlocked at this; equal to cliffEnd when there is no vesting
        uint64 vestEnd;
    }

    /// @notice The Chimi pad (proxy) whose launches can lock a first buy here.
    address public immutable pad;

    Lock[] internal _locks;
    mapping(address token => uint256[]) internal _byToken;
    mapping(address creator => uint256[]) internal _byCreator;

    event Locked(
        uint256 indexed id,
        address indexed token,
        address indexed creator,
        uint256 amount,
        uint64 start,
        uint64 cliffEnd,
        uint64 vestEnd
    );
    event Claimed(uint256 indexed id, address indexed creator, uint256 amount);
    event Extended(uint256 indexed id, uint64 cliffEnd, uint64 vestEnd);

    constructor(address pad_) {
        require(pad_ != address(0), "pad");
        pad = pad_;
    }

    /// @notice Open a lock over `amount` of `token`, already sitting in this contract.
    function lock(address token, address creator, uint256 amount, uint64 cliff, uint64 vesting)
        external
        returns (uint256 id)
    {
        if (msg.sender != pad) revert OnlyPad();
        uint64 start = uint64(block.timestamp);
        uint64 cliffEnd = start + cliff;
        uint64 vestEnd = cliffEnd + vesting;
        id = _locks.length;
        // forge-lint: disable-next-line(unsafe-typecast) amount <= a coin's fixed supply (1e27) < 2^128
        _locks.push(Lock(token, creator, uint128(amount), 0, start, cliffEnd, vestEnd));
        _byToken[token].push(id);
        _byCreator[creator].push(id);
        emit Locked(id, token, creator, amount, start, cliffEnd, vestEnd);
    }

    /// @notice Send the creator everything that has unlocked and not been claimed yet.
    function claim(uint256 id) external returns (uint256 amount) {
        Lock storage l = _lock(id);
        if (msg.sender != l.creator) revert OnlyCreator();
        amount = claimable(id);
        if (amount == 0) revert NothingToClaim();
        // forge-lint: disable-next-line(unsafe-typecast) amount <= l.amount < 2^128
        l.claimed += uint128(amount);
        emit Claimed(id, l.creator, amount);
        IERC20(l.token).safeTransfer(l.creator, amount);
    }

    /// @notice Push a lock later. Both dates can only move out, so at every moment at least as much stays locked.
    function extend(uint256 id, uint64 newCliffEnd, uint64 newVestEnd) external {
        Lock storage l = _lock(id);
        if (msg.sender != l.creator) revert OnlyCreator();
        if (newCliffEnd < l.cliffEnd || newVestEnd < l.vestEnd || newVestEnd < newCliffEnd) revert CannotShorten();
        l.cliffEnd = newCliffEnd;
        l.vestEnd = newVestEnd;
        emit Extended(id, newCliffEnd, newVestEnd);
    }

    // ─── views ──────────────────────────────────────────────────────────────────────────────────────────────────

    /// @notice Unlocked so far under the schedule (claimed or not).
    function unlocked(uint256 id) public view returns (uint256) {
        Lock storage l = _lock(id);
        if (block.timestamp < l.cliffEnd) return 0;
        if (block.timestamp >= l.vestEnd) return l.amount;
        return (uint256(l.amount) * (block.timestamp - l.cliffEnd)) / (l.vestEnd - l.cliffEnd);
    }

    function claimable(uint256 id) public view returns (uint256) {
        uint256 u = unlocked(id);
        uint256 c = _lock(id).claimed;
        return u > c ? u - c : 0;
    }

    /// @notice Still locked (not yet unlocked) right now.
    function stillLocked(uint256 id) external view returns (uint256) {
        return _lock(id).amount - unlocked(id);
    }

    function getLock(uint256 id) external view returns (Lock memory) {
        return _lock(id);
    }

    function lockCount() external view returns (uint256) {
        return _locks.length;
    }

    function locksOfToken(address token) external view returns (uint256[] memory) {
        return _byToken[token];
    }

    function locksOfCreator(address creator) external view returns (uint256[] memory) {
        return _byCreator[creator];
    }

    /// @notice Locks `start`..`start+count` (newest last), for listing every lock.
    function locksPage(uint256 start, uint256 count) external view returns (Lock[] memory page) {
        uint256 len = _locks.length;
        if (start >= len) return page;
        if (count > len - start) count = len - start;
        page = new Lock[](count);
        for (uint256 i; i < count; ++i) {
            page[i] = _locks[start + i];
        }
    }

    function _lock(uint256 id) internal view returns (Lock storage) {
        if (id >= _locks.length) revert UnknownLock();
        return _locks[id];
    }
}
