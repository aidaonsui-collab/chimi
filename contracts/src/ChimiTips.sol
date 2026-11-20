// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IChimiPadPools {
    struct InstantQuotePool {
        address creator;
        address uniPool;
        uint256 positionId;
        uint128 liquidity;
        int24 tickLower;
        int24 tickUpper;
    }

    function getPool(address token) external view returns (InstantQuotePool memory);
}

/// @title ChimiTips
/// @notice Tips in ETH to the creator of a Chimi coin, with a short message, usually sent while they stream.
///         90% goes to the wallet that launched the coin (as the pad records it) and 10% to the platform.
///         Each tip is one `Tipped` event: the coin's page and the creator's stream alerts read those.
///
///         Both shares are sent at once. A wallet that won't take ETH (or burns gas) doesn't block the tip:
///         its share is kept here for it, and it can `withdraw` it.
///
///         What the owner can do: change where the platform's share goes. Nothing else. The split, the pad,
///         the minimum tip and the message limit are fixed at deployment.
contract ChimiTips is Ownable2Step, ReentrancyGuard {
    /// @notice The platform's share of each tip.
    uint16 public constant FEE_BPS = 1_000;
    uint16 internal constant BPS = 10_000;
    /// @notice The smallest tip, so the alerts can't be flooded for nothing.
    uint256 public constant MIN_TIP = 0.0001 ether;
    /// @notice The longest message, in bytes (a Korean character is 3 bytes).
    uint256 public constant MAX_MESSAGE_BYTES = 280;
    /// @notice Gas each send may use. Plenty for a smart-account wallet; a wallet that needs more is paid on `withdraw`.
    uint256 public constant SEND_GAS = 100_000;

    IChimiPadPools public immutable PAD;
    /// @notice Where the platform's share goes.
    address public treasury;

    /// @notice ETH kept for a wallet whose send failed, until it withdraws it.
    mapping(address => uint256) public owed;
    /// @notice All ETH tipped, both shares.
    uint256 public totalTipped;
    /// @notice ETH each creator has received from tips (sent or kept for them), all time.
    mapping(address => uint256) public receivedBy;

    event Tipped(
        address indexed token, address indexed from, address indexed creator, uint256 amount, uint256 fee, string message
    );
    event Owed(address indexed to, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event TreasurySet(address indexed treasury);

    error NotAChimiCoin();
    error TipTooSmall();
    error MessageTooLong();
    error NothingOwed();
    error SendFailed();
    error ZeroAddress();

    constructor(address pad, address treasury_, address owner_) Ownable(owner_) {
        if (pad == address(0) || treasury_ == address(0)) revert ZeroAddress();
        PAD = IChimiPadPools(pad);
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    /// @notice Tips the creator of `token`. 90% to them, 10% to the platform.
    function tip(address token, string calldata message) external payable nonReentrant {
        if (msg.value < MIN_TIP) revert TipTooSmall();
        if (bytes(message).length > MAX_MESSAGE_BYTES) revert MessageTooLong();
        address creator = PAD.getPool(token).creator;
        if (creator == address(0)) revert NotAChimiCoin();

        uint256 fee = msg.value * FEE_BPS / BPS;
        uint256 toCreator = msg.value - fee;
        totalTipped += msg.value;
        receivedBy[creator] += toCreator;
        emit Tipped(token, msg.sender, creator, msg.value, fee, message);

        _send(creator, toCreator);
        _send(treasury, fee);
    }

    /// @notice Sends the caller what was kept for them when a send to them failed.
    function withdraw() external nonReentrant {
        uint256 amount = owed[msg.sender];
        if (amount == 0) revert NothingOwed();
        owed[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert SendFailed();
        emit Withdrawn(msg.sender, amount);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    function _send(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount, gas: SEND_GAS}("");
        if (!ok) {
            owed[to] += amount;
            emit Owed(to, amount);
        }
    }
}
