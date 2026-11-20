// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {InstantErc20QuoteFactoryProxyInit} from "./InstantErc20QuoteFactoryProxyInit.sol";
import {ILpLocker} from "./UniV3Interfaces.sol";

/// @notice The fee settings a launch reads. The "meme" pair is a coin that doesn't burn itself; the "backed" trio is a
///         coin that does (backing = the coin's own burn).
interface IBpsSourceV2 {
    function lpMemeCreatorBps() external view returns (uint16);
    function lpMemeStakerBps() external view returns (uint16);
    function lpBackingBps() external view returns (uint16);
    function lpStakerBps() external view returns (uint16);
    function lpCreatorBps() external view returns (uint16);
}

interface IChimiBurnerPad {
    function createCoinBurner(address coin, address router, uint24 poolFee) external returns (address burner);
    function burnerOf(address coin) external view returns (address);
}

/**
 * @title ChimiPadV2
 * @notice The Chimi pad with a choice at launch: whether part of the coin's trading fees buys the coin back and burns
 *         it. An upgrade of the live pad's implementation; it adds no storage, so the proxy's existing slots (owner,
 *         settings, every launched coin, the initialized flag) stay where they are.
 *
 *         How the ETH side of a new coin's fees is shared (the coin side always burns, in the locker):
 *           • doesn't burn itself: creator `lpMemeCreatorBps` (80%), CHIMI burn `lpMemeStakerBps` (5%), platform the
 *             rest (15%);
 *           • burns itself: creator `lpCreatorBps` (70%), the coin's own burn `lpBackingBps` (10%), CHIMI burn
 *             `lpStakerBps` (5%), platform the rest (15%).
 *         The percentages are read from the fee settings at launch and fixed on the coin's lock from then on. The
 *         CHIMI burn is `stakingPool` (the ChimiBurner); a coin's own burn is a CoinBurner the ChimiBurner creates.
 *
 *         `createTokenWithEth(name, symbol, burnOwnCoin)` is the launch with the choice. The launches inherited from
 *         the first version don't burn the coin.
 */
contract ChimiPadV2 is InstantErc20QuoteFactoryProxyInit {
    /// @notice Creates each burning coin's CoinBurner.
    IChimiBurnerPad public immutable BURNER;

    /// @dev Transient flag for the launch in progress: does it burn its own coin. Set and cleared inside one call.
    bytes32 private constant BURN_OWN_SLOT = keccak256("chimi.pad.v2.burnOwnCoin");

    event FeeChoice(address indexed token, bool burnsOwnCoin, address burner);

    constructor(address quote_, uint8 quoteDecimals_, address weth_, address burner_)
        InstantErc20QuoteFactoryProxyInit(quote_, quoteDecimals_, weth_)
    {
        require(burner_ != address(0), "burner");
        BURNER = IChimiBurnerPad(burner_);
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
        require(positionManager != address(0) && lpLocker != address(0) && bpsSource != address(0), "unwired");
        uint256 feeDue = creationFeeDue(msg.sender);
        require(msg.value >= feeDue, "fee");
        uint256 firstBuyEthWei = msg.value - feeDue;

        _setBurnOwn(burnOwnCoin);
        token = _createCore(name, symbol, feeDue, msg.sender);
        _setBurnOwn(false);

        if (firstBuyEthWei > 0) {
            require(swapRouter != address(0), "no router");
            (uint256 quoteBought, uint256 tokensOut) = _buyTokenWithEth(token, firstBuyEthWei, msg.sender);
            emit InstantQuoteFirstBuyEth(token, msg.sender, firstBuyEthWei, quoteBought, tokensOut);
            emit InstantQuoteFirstBuy(token, msg.sender, quoteBought, tokensOut);
        }
    }

    /// @notice Whether `token` burns itself with part of its fees, and its burner.
    function burnerOf(address token) external view returns (address) {
        return BURNER.burnerOf(token);
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
