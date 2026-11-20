// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ChimiTips, IChimiPadPools} from "../src/ChimiTips.sol";

/// @dev The pad's pool records, as much of them as tips read.
contract MockPad {
    mapping(address => address) public creatorOf;

    function setCreator(address token, address creator) external {
        creatorOf[token] = creator;
    }

    function getPool(address token) external view returns (IChimiPadPools.InstantQuotePool memory pool) {
        pool.creator = creatorOf[token];
    }
}

/// @dev A wallet that won't take ETH until told to.
contract Picky {
    bool public open;

    function setOpen(bool v) external {
        open = v;
    }

    function withdrawFrom(ChimiTips tips) external {
        tips.withdraw();
    }

    receive() external payable {
        require(open, "no");
    }
}

/// @dev A creator wallet that tries to tip again from inside the payment it receives.
contract Reenters {
    ChimiTips public tips;
    address public token;

    constructor(ChimiTips tips_) {
        tips = tips_;
    }

    function setToken(address token_) external {
        token = token_;
    }

    receive() external payable {
        tips.tip{value: 0.0001 ether}(token, "again");
    }
}

/// @dev A wallet that spends all the gas it's given.
contract Burner {
    receive() external payable {
        while (true) {}
    }
}

contract ChimiTipsTest is Test {
    MockPad pad;
    ChimiTips tips;
    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");
    address creator = makeAddr("creator");
    address fan = makeAddr("fan");
    address coin = makeAddr("coin");

    event Tipped(
        address indexed token, address indexed from, address indexed creator, uint256 amount, uint256 fee, string message
    );
    event Owed(address indexed to, uint256 amount);

    function setUp() public {
        pad = new MockPad();
        pad.setCreator(coin, creator);
        tips = new ChimiTips(address(pad), treasury, owner);
        vm.deal(fan, 10 ether);
    }

    function test_a_tip_goes_90_percent_to_the_creator_and_10_to_the_platform() public {
        vm.expectEmit(true, true, true, true, address(tips));
        emit Tipped(coin, fan, creator, 1 ether, 0.1 ether, unicode"화이팅!");
        vm.prank(fan);
        tips.tip{value: 1 ether}(coin, unicode"화이팅!");
        assertEq(creator.balance, 0.9 ether);
        assertEq(treasury.balance, 0.1 ether);
        assertEq(address(tips).balance, 0);
        assertEq(tips.totalTipped(), 1 ether);
        assertEq(tips.receivedBy(creator), 0.9 ether);
    }

    function testFuzz_the_split_always_adds_up(uint96 amount) public {
        uint256 value = bound(uint256(amount), tips.MIN_TIP(), 5 ether);
        vm.prank(fan);
        tips.tip{value: value}(coin, "");
        assertEq(creator.balance + treasury.balance, value);
        assertEq(treasury.balance, value * 1_000 / 10_000);
    }

    function test_a_tip_below_the_minimum_is_refused() public {
        vm.prank(fan);
        vm.expectRevert(ChimiTips.TipTooSmall.selector);
        tips.tip{value: 0.0001 ether - 1}(coin, "");
    }

    function test_messages_up_to_280_bytes() public {
        bytes memory longest = new bytes(280);
        for (uint256 i; i < 280; i++) {
            longest[i] = "a";
        }
        vm.prank(fan);
        tips.tip{value: 0.001 ether}(coin, string(longest));
        bytes memory tooLong = bytes.concat(longest, "a");
        vm.prank(fan);
        vm.expectRevert(ChimiTips.MessageTooLong.selector);
        tips.tip{value: 0.001 ether}(coin, string(tooLong));
    }

    function test_a_coin_the_pad_didnt_launch_is_refused() public {
        vm.prank(fan);
        vm.expectRevert(ChimiTips.NotAChimiCoin.selector);
        tips.tip{value: 0.001 ether}(makeAddr("stranger"), "");
    }

    function test_a_creator_that_refuses_eth_is_kept_its_share_and_withdraws_later() public {
        Picky picky = new Picky();
        address coin2 = makeAddr("coin2");
        pad.setCreator(coin2, address(picky));
        vm.expectEmit(true, false, false, true, address(tips));
        emit Owed(address(picky), 0.9 ether);
        vm.prank(fan);
        tips.tip{value: 1 ether}(coin2, "");
        assertEq(tips.owed(address(picky)), 0.9 ether);
        assertEq(treasury.balance, 0.1 ether, "the platform's share still went");
        assertEq(address(tips).balance, 0.9 ether);

        vm.expectRevert(ChimiTips.SendFailed.selector);
        picky.withdrawFrom(tips);
        picky.setOpen(true);
        picky.withdrawFrom(tips);
        assertEq(address(picky).balance, 0.9 ether);
        assertEq(tips.owed(address(picky)), 0);
        vm.expectRevert(ChimiTips.NothingOwed.selector);
        picky.withdrawFrom(tips);
    }

    function test_a_creator_that_burns_gas_is_kept_its_share() public {
        Burner burner = new Burner();
        address coin2 = makeAddr("coin2");
        pad.setCreator(coin2, address(burner));
        vm.prank(fan);
        tips.tip{value: 1 ether, gas: 1_000_000}(coin2, "");
        assertEq(tips.owed(address(burner)), 0.9 ether);
        assertEq(treasury.balance, 0.1 ether);
    }

    function test_a_creator_cant_tip_again_from_inside_its_payment() public {
        Reenters bad = new Reenters(tips);
        address coin2 = makeAddr("coin2");
        bad.setToken(coin2);
        pad.setCreator(coin2, address(bad));
        vm.deal(address(bad), 1 ether);
        vm.prank(fan);
        tips.tip{value: 1 ether}(coin2, "");
        // The nested tip reverts, so the payment to it fails and is kept for it instead.
        assertEq(tips.owed(address(bad)), 0.9 ether);
        assertEq(tips.totalTipped(), 1 ether);
    }

    function test_a_treasury_that_refuses_eth_is_kept_its_share() public {
        Picky picky = new Picky();
        vm.prank(owner);
        tips.setTreasury(address(picky));
        vm.prank(fan);
        tips.tip{value: 1 ether}(coin, "");
        assertEq(creator.balance, 0.9 ether);
        assertEq(tips.owed(address(picky)), 0.1 ether);
    }

    function test_only_the_owner_moves_the_platform_share_and_never_to_nowhere() public {
        address next = makeAddr("next");
        vm.prank(fan);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, fan));
        tips.setTreasury(next);
        vm.prank(owner);
        vm.expectRevert(ChimiTips.ZeroAddress.selector);
        tips.setTreasury(address(0));
        vm.prank(owner);
        tips.setTreasury(next);
        assertEq(tips.treasury(), next);
    }

    function test_ownership_moves_in_two_steps() public {
        address next = makeAddr("nextOwner");
        vm.prank(owner);
        tips.transferOwnership(next);
        assertEq(tips.owner(), owner);
        vm.prank(next);
        tips.acceptOwnership();
        assertEq(tips.owner(), next);
    }

    function test_the_settings_are_fixed() public view {
        assertEq(tips.FEE_BPS(), 1_000);
        assertEq(tips.MIN_TIP(), 0.0001 ether);
        assertEq(tips.MAX_MESSAGE_BYTES(), 280);
        assertEq(address(tips.PAD()), address(pad));
    }

    function test_constructor_refuses_empty_addresses() public {
        vm.expectRevert(ChimiTips.ZeroAddress.selector);
        new ChimiTips(address(0), treasury, owner);
        vm.expectRevert(ChimiTips.ZeroAddress.selector);
        new ChimiTips(address(pad), address(0), owner);
    }
}
