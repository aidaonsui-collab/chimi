// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {InstantErc20QuoteFactoryProxyInit} from "./InstantErc20QuoteFactoryProxyInit.sol";
import {ILpLocker} from "./UniV3Interfaces.sol";
import {IBpsSourceV2, IChimiBurnerPad} from "./ChimiPadV2.sol";

interface IChimiCreatorLock {
    function pad() external view returns (address);
    function lock(address token, address creator, uint256 amount, uint64 cliff, uint64 vesting)
        external
        returns (uint256 id);
}

/**
 * @title ChimiPadV3
 * @notice The Chimi pad with ChimiPadV2's fee choice, plus the creator's first-buy lock: a creator can lock their first
 *         buy at launch in the public ChimiCreatorLock, with a cliff (nothing unlocks before it) and then optional
 *         straight-line vesting. A locked first buy goes straight from the pool into the lock in the launch
 *         transaction, so the creator never holds it unlocked. An upgrade of the live pad's implementation; like V2
 *         it adds no storage, so the proxy's existing slots stay where they are.
 *
 *         `createTokenWithEth(name, symbol, burnOwnCoin)` is unchanged from V2.
 *         `createTokenWithEthLocked(name, symbol, burnOwnCoin, lockCliff, lockVesting)` is the same launch with the
 *         first buy locked; it needs a first buy and a schedule of at most MAX_LOCK_DURATION.
 */
contract ChimiPadV3 is InstantErc20QuoteFactoryProxyInit {
    /// @notice Creates each burning coin's CoinBurner.
    IChimiBurnerPad public immutable BURNER;
    /// @notice Where locked first buys are held.
    IChimiCreatorLock public immutable CREATOR_LOCK;

    /// @notice Longest first-buy lock, cliff plus vesting.
    uint64 public constant MAX_LOCK_DURATION = 4 * 365 days;

    /// @dev Transient flag for the launch in progress: does it burn its own coin. Set and cleared inside one call.
    ///      The same slot as V2's.
    bytes32 private constant BURN_OWN_SLOT = keccak256("chimi.pad.v2.burnOwnCoin");

    event FeeChoice(address indexed token, bool burnsOwnCoin, address burner);
    event FirstBuyLocked(address indexed token, address indexed creator, uint256 lockId, uint256 amount, uint64 cliff, uint64 vesting);

    constructor(address quote_, uint8 quoteDecimals_, address weth_, address burner_, address creatorLock_)
        InstantErc20QuoteFactoryProxyInit(quote_, quoteDecimals_, weth_)
    {
        require(burner_ != address(0), "burner");
        require(creatorLock_ != address(0), "creator lock");
        BURNER = IChimiBurnerPad(burner_);
        CREATOR_LOCK = IChimiCreatorLock(creatorLock_);
    }

    /**
     * @notice Launch a coin, with an optional first buy paid in native ETH (msg.value = creation fee + first buy).
     * @param burnOwnCoin true: 10% of the coin's ETH fees buy the coin back and burn it, and the creator's share is
     *        70%. false: the creator's share is 80%. Fixed for the life of the coin.
     */
    function createTokenWithEth(string calldata name, string calldata symbol, bool burnOwnCoin)
        external
        payable
        nonReentrant
        returns (address token)
    {
        (token,) = _launch(name, symbol, burnOwnCoin, msg.sender);
    }

    /**
     * @notice Launch a coin with the first buy locked for the creator (msg.value = creation fee + first buy).
     * @param lockCliff seconds before anything unlocks.
     * @param lockVesting seconds of straight-line release after the cliff; 0 = everything at the cliff.
     */
    function createTokenWithEthLocked(
        string calldata name,
        string calldata symbol,
        bool burnOwnCoin,
        uint64 lockCliff,
        uint64 lockVesting
    ) external payable nonReentrant returns (address token, uint256 lockId) {
        require(uint256(lockCliff) + lockVesting > 0, "no lock");
        require(uint256(lockCliff) + lockVesting <= MAX_LOCK_DURATION, "lock too long");
        require(CREATOR_LOCK.pad() == address(this), "lock pad");
        uint256 tokensOut;
        (token, tokensOut) = _launch(name, symbol, burnOwnCoin, address(CREATOR_LOCK));
        require(tokensOut > 0, "no first buy");
        lockId = CREATOR_LOCK.lock(token, msg.sender, tokensOut, lockCliff, lockVesting);
        emit FirstBuyLocked(token, msg.sender, lockId, tokensOut, lockCliff, lockVesting);
    }

    /// @notice Whether `token` burns itself with part of its fees, and its burner.
    function burnerOf(address token) external view returns (address) {
        return BURNER.burnerOf(token);
    }

    /// @dev The launch (V2's), with the first buy sent to `firstBuyTo`: the creator, or the creator lock.
    function _launch(string calldata name, string calldata symbol, bool burnOwnCoin, address firstBuyTo)
        private
        returns (address token, uint256 tokensOut)
    {
        require(positionManager != address(0) && lpLocker != address(0) && bpsSource != address(0), "unwired");
        uint256 feeDue = creationFeeDue(msg.sender);
        require(msg.value >= feeDue, "fee");
        uint256 firstBuyEthWei = msg.value - feeDue;

        _setBurnOwn(burnOwnCoin);
        token = _createCore(name, symbol, feeDue, msg.sender);
        _setBurnOwn(false);

        if (firstBuyEthWei > 0) {
            require(swapRouter != address(0), "no router");
            uint256 quoteBought;
            (quoteBought, tokensOut) = _buyTokenWithEth(token, firstBuyEthWei, firstBuyTo);
            // The buyer is the creator either way; a locked buy just lands in the lock.
            emit InstantQuoteFirstBuyEth(token, msg.sender, firstBuyEthWei, quoteBought, tokensOut);
            emit InstantQuoteFirstBuy(token, msg.sender, quoteBought, tokensOut);
        }
    }

    function _stampLock(address token, uint256 positionId, address creator) internal override {
        if (!_burnOwn()) {
            super._stampLock(token, positionId, creator);
            emit FeeChoice(token, false, address(0));
            return;
        }
        IBpsSourceV2 src = IBpsSourceV2(bpsSource);
        uint16 burnBps = src.lpBackingBps();
        uint16 chimiBps = src.lpStakerBps();
        uint16 creatorBps = src.lpCreatorBps();
        // Guards against launching before the settings for burning coins are in place.
        require(burnBps > 0 && creatorBps > 0, "burn bps unset");
        address burner = BURNER.createCoinBurner(token, swapRouter, poolFee);
        ILpLocker(lpLocker)
            .lockPositionWithSplitLaunch(
                positionId, token, address(QUOTE), burner, burnBps, stakingPool, chimiBps, creator, creatorBps
            );
        emit FeeChoice(token, true, burner);
    }

    function _setBurnOwn(bool on) private {
        bytes32 slot = BURN_OWN_SLOT;
        assembly {
            tstore(slot, on)
        }
    }

    function _burnOwn() private view returns (bool on) {
        bytes32 slot = BURN_OWN_SLOT;
        assembly {
            on := tload(slot)
        }
    }
}
