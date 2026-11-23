// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, Vm} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ChimiMainnet} from "../script/ChimiMainnet.sol";
import {ChimiCreatorLockUpgrade} from "../script/ChimiCreatorLockUpgrade.sol";
import {WETH9} from "../script/testnet/WETH9.sol";
import {ChimiBurner} from "../src/ChimiBurner.sol";
import {ChimiCreatorLock} from "../src/ChimiCreatorLock.sol";
import {ChimiPadV2} from "../src/ChimiPadV2.sol";
import {ChimiPadV3} from "../src/ChimiPadV3.sol";
import {MonLock} from "../src/MonLock.sol";

/// @notice The creator first-buy lock: ChimiPadV3.createTokenWithEthLocked and ChimiCreatorLock, on a stack built the
///         mainnet way (script/ChimiMainnet.sol), plus the upgrade the live GIWA Sepolia pad gets
///         (script/ChimiCreatorLockUpgrade.sol) from V2.
contract ChimiCreatorLockTest is Test {
    address internal constant WETH = 0x4200000000000000000000000000000000000006;
    uint24 internal constant FEE = 20_000;
    uint256 internal constant SUPPLY = 1_000_000_000e18;
    uint64 internal constant DAY = 1 days;

    address internal platform = makeAddr("platform");
    address internal keeper = makeAddr("keeper");
    address internal creator = makeAddr("creator");
    address internal stranger = makeAddr("stranger");

    ChimiMainnet.Stack internal s;
    ChimiMainnet.Burns internal b;
    ChimiPadV3 internal pad;
    ChimiCreatorLock internal lock;
    address internal chimi;

    function setUp() public {
        vm.etch(WETH, address(new WETH9()).code);
        vm.deal(creator, 1_000 ether);
        vm.deal(stranger, 100 ether);
        s = ChimiMainnet.deployStack(_params());
        chimi = ChimiMainnet.launchChimi(s, "Chimi", "CHIMI", 0);
        b = ChimiMainnet.deployBurns(s, WETH, chimi, s.swapRouter02, FEE, keeper, address(this));
        ChimiMainnet.wireBurns(s, b, platform);
        pad = ChimiPadV3(payable(s.pad));
        lock = ChimiCreatorLock(b.creatorLock);
    }

    function _params() internal view returns (ChimiMainnet.Params memory) {
        return ChimiMainnet.Params({
            owner: address(this),
            platform: platform,
            weth: WETH,
            lockDuration: uint64(100 * 365 days),
            creationFee: 0,
            launchVirtualQuote: 1_180_308_761_395_051_186
        });
    }

    function _locked(uint256 ethIn, bool burnOwn, uint64 cliff, uint64 vesting) internal returns (address token, uint256 id) {
        vm.prank(creator);
        (token, id) = pad.createTokenWithEthLocked{value: ethIn}("Locked", "LOCK", burnOwn, cliff, vesting);
    }

    function _now() internal view returns (uint256) {
        // via_ir can reuse a block.timestamp read from before a vm.warp; this asks the VM.
        return vm.getBlockTimestamp();
    }

    // ─── the launch ───────────────────────────────────────────────────────────────────────────────────────────

    function test_the_pad_and_the_lock_point_at_each_other() public view {
        assertEq(address(pad.CREATOR_LOCK()), b.creatorLock);
        assertEq(lock.pad(), s.pad);
        assertEq(lock.lockCount(), 0);
    }

    function test_a_locked_first_buy_lands_in_the_lock_not_with_the_creator() public {
        vm.recordLogs();
        (address token, uint256 id) = _locked(1 ether, false, 90 * DAY, 0);
        ChimiCreatorLock.Lock memory l = lock.getLock(id);
        assertEq(IERC20(token).balanceOf(creator), 0, "creator holds nothing");
        assertEq(IERC20(token).balanceOf(address(lock)), l.amount, "all of it is in the lock");
        assertGt(l.amount, 0);
        assertEq(l.token, token);
        assertEq(l.creator, creator);
        assertEq(l.claimed, 0);
        assertEq(l.start, _now());
        assertEq(l.cliffEnd, _now() + 90 * DAY);
        assertEq(l.vestEnd, l.cliffEnd, "no vesting: all at the cliff");
        // The pad says so too, and still names the creator as the buyer.
        bool sawLocked;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] == ChimiPadV3.FirstBuyLocked.selector) {
                sawLocked = true;
                assertEq(address(uint160(uint256(logs[i].topics[1]))), token);
                assertEq(address(uint160(uint256(logs[i].topics[2]))), creator);
            }
        }
        assertTrue(sawLocked, "FirstBuyLocked");
        assertEq(pad.getPool(token).creator, creator, "the coin's creator is the launcher, not the lock");
    }

    function test_an_unlocked_first_buy_still_goes_to_the_creator() public {
        vm.prank(creator);
        address token = pad.createTokenWithEth{value: 1 ether}("Plain", "PLN", false);
        assertGt(IERC20(token).balanceOf(creator), 0);
        assertEq(lock.lockCount(), 0);
    }

    function test_a_big_locked_first_buy_has_no_cap() public {
        (address token, uint256 id) = _locked(20 ether, false, 30 * DAY, 0);
        uint256 amount = lock.getLock(id).amount;
        assertEq(IERC20(token).balanceOf(address(lock)), amount);
        assertGt(amount, SUPPLY / 10, "more than 10% of supply, locked");
    }

    function test_a_locked_launch_keeps_the_burn_choice() public {
        (address token,) = _locked(1 ether, true, 30 * DAY, 30 * DAY);
        assertTrue(pad.burnerOf(token) != address(0), "the coin burns itself");
        uint256 positionId = pad.getPool(token).positionId;
        (address w,) = MonLock(payable(s.locker)).stakerSplits(positionId);
        assertEq(w, b.burner, "5% to the CHIMI burn");
    }

    function test_a_locked_launch_needs_a_schedule_a_first_buy_and_at_most_four_years() public {
        vm.startPrank(creator);
        vm.expectRevert("no lock");
        pad.createTokenWithEthLocked{value: 1 ether}("A", "A", false, 0, 0);
        vm.expectRevert("lock too long");
        pad.createTokenWithEthLocked{value: 1 ether}("A", "A", false, 365 * DAY, 3 * 365 * DAY + 1);
        vm.expectRevert("no first buy");
        pad.createTokenWithEthLocked{value: 0}("A", "A", false, 30 * DAY, 0);
        // Exactly four years is fine.
        (address token,) = pad.createTokenWithEthLocked{value: 1 ether}("A", "A", false, 365 * DAY, 3 * 365 * DAY);
        vm.stopPrank();
        assertTrue(token != address(0));
    }

    // ─── schedules and claims ─────────────────────────────────────────────────────────────────────────────────

    function test_a_cliff_releases_everything_at_once() public {
        (address token, uint256 id) = _locked(1 ether, false, 90 * DAY, 0);
        uint256 amount = lock.getLock(id).amount;
        vm.warp(_now() + 90 * DAY - 1);
        assertEq(lock.claimable(id), 0);
        vm.prank(creator);
        vm.expectRevert(ChimiCreatorLock.NothingToClaim.selector);
        lock.claim(id);
        vm.warp(_now() + 1);
        assertEq(lock.claimable(id), amount);
        vm.prank(creator);
        lock.claim(id);
        assertEq(IERC20(token).balanceOf(creator), amount);
        assertEq(lock.stillLocked(id), 0);
        vm.prank(creator);
        vm.expectRevert(ChimiCreatorLock.NothingToClaim.selector);
        lock.claim(id);
    }

    function test_a_cliff_then_vesting_releases_in_a_straight_line() public {
        (address token, uint256 id) = _locked(2 ether, false, 30 * DAY, 100 * DAY);
        uint256 amount = lock.getLock(id).amount;
        vm.warp(_now() + 30 * DAY);
        assertEq(lock.unlocked(id), 0, "nothing at the cliff itself");
        vm.warp(_now() + 50 * DAY);
        assertEq(lock.unlocked(id), amount / 2, "half way through the vesting");
        vm.prank(creator);
        uint256 first = lock.claim(id);
        assertEq(first, amount / 2);
        vm.warp(_now() + 25 * DAY);
        vm.prank(creator);
        uint256 second = lock.claim(id);
        assertEq(first + second, (amount * 75) / 100);
        vm.warp(_now() + 365 * DAY);
        vm.prank(creator);
        lock.claim(id);
        assertEq(IERC20(token).balanceOf(creator), amount, "all of it in the end");
        assertEq(IERC20(token).balanceOf(address(lock)), 0);
    }

    function test_vesting_without_a_cliff_starts_at_launch() public {
        (, uint256 id) = _locked(1 ether, false, 0, 100 * DAY);
        uint256 amount = lock.getLock(id).amount;
        vm.warp(_now() + 10 * DAY);
        assertEq(lock.unlocked(id), amount / 10);
    }

    function test_only_the_creator_claims_and_only_to_themselves() public {
        (address token, uint256 id) = _locked(1 ether, false, 30 * DAY, 0);
        vm.warp(_now() + 31 * DAY);
        vm.prank(stranger);
        vm.expectRevert(ChimiCreatorLock.OnlyCreator.selector);
        lock.claim(id);
        assertEq(IERC20(token).balanceOf(stranger), 0);
    }

    function test_only_the_pad_opens_a_lock() public {
        vm.prank(stranger);
        vm.expectRevert(ChimiCreatorLock.OnlyPad.selector);
        lock.lock(chimi, stranger, 1, 0, 1);
    }

    function test_a_lock_can_be_pushed_later_never_earlier() public {
        (, uint256 id) = _locked(1 ether, false, 30 * DAY, 30 * DAY);
        ChimiCreatorLock.Lock memory l = lock.getLock(id);
        vm.prank(stranger);
        vm.expectRevert(ChimiCreatorLock.OnlyCreator.selector);
        lock.extend(id, l.cliffEnd + 1, l.vestEnd + 1);
        vm.startPrank(creator);
        vm.expectRevert(ChimiCreatorLock.CannotShorten.selector);
        lock.extend(id, l.cliffEnd - 1, l.vestEnd);
        vm.expectRevert(ChimiCreatorLock.CannotShorten.selector);
        lock.extend(id, l.cliffEnd, l.vestEnd - 1);
        lock.extend(id, l.cliffEnd + 10 * DAY, l.vestEnd + 20 * DAY);
        vm.stopPrank();
        ChimiCreatorLock.Lock memory after_ = lock.getLock(id);
        assertEq(after_.cliffEnd, l.cliffEnd + 10 * DAY);
        assertEq(after_.vestEnd, l.vestEnd + 20 * DAY);
    }

    function test_every_lock_is_public_by_coin_by_creator_and_by_page() public {
        (address one, uint256 a) = _locked(1 ether, false, 30 * DAY, 0);
        (address two, uint256 c) = _locked(1 ether, false, 60 * DAY, 30 * DAY);
        assertEq(lock.lockCount(), 2);
        assertEq(lock.locksOfToken(one)[0], a);
        assertEq(lock.locksOfToken(two)[0], c);
        uint256[] memory mine = lock.locksOfCreator(creator);
        assertEq(mine.length, 2);
        ChimiCreatorLock.Lock[] memory page = lock.locksPage(0, 10);
        assertEq(page.length, 2);
        assertEq(page[1].token, two);
        assertEq(lock.locksPage(5, 10).length, 0);
        vm.expectRevert(ChimiCreatorLock.UnknownLock.selector);
        lock.getLock(9);
    }

    // ─── the live pad's upgrade, from V2 ──────────────────────────────────────────────────────────────────────

    function test_the_upgrade_from_v2_keeps_coins_settings_and_adds_the_lock() public {
        // A second chain where the pad is on V2 with a coin launched, as GIWA Sepolia is now.
        ChimiMainnet.Stack memory s2 = ChimiMainnet.deployStack(_params());
        address chimi2 = ChimiMainnet.launchChimi(s2, "Chimi", "CHIMI", 0);
        ChimiBurner burner2 = new ChimiBurner(WETH, chimi2, s2.swapRouter02, FEE, s2.pad, keeper, address(this));
        ChimiMainnet.Burns memory v2Burns;
        v2Burns.burner = address(burner2);
        v2Burns.padImpl = address(new ChimiPadV2(WETH, 18, WETH, address(burner2)));
        ChimiMainnet.wireBurns(s2, v2Burns, platform);
        ChimiPadV2 v2 = ChimiPadV2(payable(s2.pad));
        vm.prank(creator);
        address before = v2.createTokenWithEth{value: 1 ether}("Before", "BFR", true);
        uint256 coins = v2.allTokensLength();
        address owner_ = v2.owner();
        address staking = v2.stakingPool();
        address beforeBurner = v2.burnerOf(before);

        ChimiCreatorLockUpgrade.Addresses memory a = ChimiCreatorLockUpgrade.deploy(s2.pad, address(burner2));
        ChimiCreatorLockUpgrade.wire(a, s2.pad);

        ChimiPadV3 v3 = ChimiPadV3(payable(s2.pad));
        assertEq(address(v3.CREATOR_LOCK()), a.creatorLock);
        assertEq(ChimiCreatorLock(a.creatorLock).pad(), s2.pad);
        assertEq(address(v3.BURNER()), address(burner2));
        assertEq(v3.allTokensLength(), coins);
        assertEq(v3.owner(), owner_);
        assertEq(v3.stakingPool(), staking);
        assertEq(v3.getPool(before).creator, creator, "the coin from before is still there");
        assertEq(v3.burnerOf(before), beforeBurner);

        vm.prank(creator);
        (address token, uint256 id) = v3.createTokenWithEthLocked{value: 1 ether}("After", "AFT", true, 30 * DAY, 0);
        assertEq(IERC20(token).balanceOf(address(a.creatorLock)), ChimiCreatorLock(a.creatorLock).getLock(id).amount);
        assertTrue(v3.burnerOf(token) != address(0));
        // The V1 entry point still launches.
        vm.prank(creator);
        address plain = v3.createTokenMemeInstantQuoteWithEth{value: 0}("Plain", "PLN");
        assertTrue(plain != address(0));
    }
}
