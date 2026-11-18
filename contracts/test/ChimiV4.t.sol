// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {ChimiV4Launcher} from "../src/v4/ChimiV4Launcher.sol";
import {ChimiTaxHook} from "../src/v4/ChimiTaxHook.sol";
import {ChimiV4Router} from "../src/v4/ChimiV4Router.sol";
import {ChimiV4Token} from "../src/v4/ChimiV4Token.sol";
import {ChimiV4Locker} from "../src/v4/ChimiV4Locker.sol";
import {ArcBpsSource} from "../src/ArcBpsSource.sol";
import {Swapper} from "./utils/Swapper.sol";

/// @notice Port of KleosV4.t.sol, plus the Chimi-specific fee stamp and the 100-year lock.
///         The opening market cap is set to 30 ETH in setUp so the ported price and first-buy-cap
///         cases keep their numbers. A real deploy opens at Chimi's v3 FDV instead.
contract ChimiV4Test is Test {
    using StateLibrary for IPoolManager;

    uint160 constant FLAGS = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
        | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 constant SUPPLY = 1_000_000_000 ether;

    IPoolManager pm;
    ChimiV4Launcher launcher;
    ChimiTaxHook hook;
    ChimiV4Router router;
    Swapper swapper;

    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");
    address creator = makeAddr("creator");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        pm = IPoolManager(address(new PoolManager(owner)));
        launcher = new ChimiV4Launcher(pm, treasury, treasury, address(0), owner, 100 * 365 days);
        address at = address((uint160(uint256(keccak256("chimi.v4.hook"))) & ~Hooks.ALL_HOOK_MASK) | FLAGS);
        deployCodeTo("ChimiTaxHook.sol:ChimiTaxHook", abi.encode(pm, address(launcher)), at);
        hook = ChimiTaxHook(at);
        vm.prank(owner);
        launcher.setHook(hook);
        vm.prank(owner);
        launcher.setStartMarketCap(30 ether);
        router = new ChimiV4Router(pm, hook);
        swapper = new Swapper(pm);
        for (uint256 i; i < 5; ++i) {
            vm.deal([creator, alice, bob, address(this), makeAddr("eve")][i], 10_000 ether);
        }
    }

    function _params(uint16 buyTax, uint16 sellTax, uint16 creatorBps, uint16 holdersBps, uint16 buybackBps)
        internal
        pure
        returns (ChimiV4Launcher.LaunchParams memory)
    {
        return ChimiV4Launcher.LaunchParams({
            name: "Hoplite",
            symbol: "HOP",
            minTokensOut: 0,
            buyTaxBps: buyTax,
            sellTaxBps: sellTax,
            creatorBps: creatorBps,
            holdersBps: holdersBps,
            buybackBps: buybackBps,
            antiSnipe: false
        });
    }

    function _launch(ChimiV4Launcher.LaunchParams memory p, uint256 firstBuy) internal returns (ChimiV4Token t) {
        vm.prank(creator);
        (address token,) = launcher.launch{value: firstBuy}(p);
        t = ChimiV4Token(token);
    }

    function _launchBasic() internal returns (ChimiV4Token) {
        return _launch(_params(500, 500, 10_000, 0, 0), 0);
    }

    function _buy(address who, ChimiV4Token t, uint256 ethIn) internal returns (uint256 out) {
        vm.prank(who);
        out = router.buy{value: ethIn}(address(t), 0, who, block.timestamp);
    }

    function _sell(address who, ChimiV4Token t, uint256 amount) internal returns (uint256 out) {
        vm.startPrank(who);
        t.approve(address(router), amount);
        out = router.sell(address(t), amount, 0, who, block.timestamp);
        vm.stopPrank();
    }

    function _key(ChimiV4Token t) internal view returns (PoolKey memory) {
        return hook.poolKeyOf(address(t));
    }

    function _claims() internal view returns (uint256) {
        return pm.balanceOf(address(hook), 0);
    }

    function _assertBacked(ChimiV4Token t) internal view {
        uint256 owed = hook.protocolFees() + hook.stakerFees() + hook.creatorFees(creator) + hook.buybackPending(address(t))
            + hook.holderFunds();
        assertGe(_claims(), owed, "claims back what the hook owes");
        assertLe(_claims() - owed, 10, "and nothing more than rounding");
    }

    function test_launchLocksTheSupplyInThePool() public {
        ChimiV4Token t = _launchBasic();
        assertEq(t.totalSupply(), SUPPLY);
        assertEq(t.balanceOf(address(launcher)), 0, "launcher keeps nothing");
        assertGe(t.balanceOf(address(pm)), SUPPLY - 1e6, "the pool holds the supply");
        PoolKey memory key = _key(t);
        assertEq(Currency.unwrap(key.currency0), address(0), "paired with native ETH");
        assertEq(Currency.unwrap(key.currency1), address(t));
        assertEq(key.fee, 0, "no LP fee: the tax is what trades pay");
        ChimiV4Launcher.Launch memory l = launcher.getLaunch(address(t));
        assertEq(l.creator, creator);
        assertEq(l.poolId, PoolId.unwrap(key.toId()));
        assertGt(l.unlocksAt, uint64(block.timestamp + 99 * 365 days));
        uint256 spot = launcher.spotPrice(address(t));
        uint256 ideal = (30 ether * 1e18) / SUPPLY;
        assertLe(spot, ideal);
        assertGe(spot, (ideal * 97) / 100);
    }

    function test_predictTokenMatches() public {
        address predicted = launcher.predictToken(creator, "Hoplite", "HOP");
        ChimiV4Token t = _launchBasic();
        assertEq(address(t), predicted);
    }

    function test_firstBuyMatchesQuoteAndPaysTax() public {
        uint256 quote = launcher.quoteLaunch(1 ether, 500);
        ChimiV4Token t = _launch(_params(500, 500, 10_000, 0, 0), 1 ether);
        uint256 got = t.balanceOf(creator);
        assertApproxEqAbs(got, quote, 1e6, "first buy matches quoteLaunch");
        // 5% of 1 ETH. Chimi's platform cut is 30% (Kleos defaulted to 20%); the rest is the creator's.
        assertEq(hook.protocolFees(), 0.015 ether);
        assertEq(hook.creatorFees(creator), 0.035 ether);
        assertEq(hook.creatorFeesOf(address(t), creator), 0.035 ether);
        _assertBacked(t);
    }

    function test_firstBuyCapAndSlippage() public {
        vm.expectRevert(ChimiV4Launcher.FirstBuyCap.selector);
        _launch(_params(100, 100, 10_000, 0, 0), 5 ether);
        ChimiV4Launcher.LaunchParams memory p = _params(100, 100, 10_000, 0, 0);
        p.minTokensOut = launcher.quoteLaunch(0.5 ether, 100) * 2;
        vm.expectRevert(ChimiV4Launcher.FirstBuySlippage.selector);
        _launch(p, 0.5 ether);
    }

    function test_taxAndSplitLimits() public {
        vm.startPrank(creator);
        vm.expectRevert(ChimiTaxHook.TaxOutOfRange.selector);
        launcher.launch(_params(1_001, 500, 10_000, 0, 0));
        vm.expectRevert(ChimiTaxHook.TaxOutOfRange.selector);
        launcher.launch(_params(500, 99, 10_000, 0, 0));
        vm.expectRevert(ChimiTaxHook.SplitOutOfRange.selector);
        launcher.launch(_params(500, 500, 5_000, 4_000, 0));
        vm.stopPrank();
    }

    function test_onlyTheLauncherOpensPoolsOnTheHook() public {
        PoolKey memory key =
            PoolKey(CurrencyLibrary.ADDRESS_ZERO, Currency.wrap(address(0xBEEF)), 0, 200, IHooks(address(hook)));
        vm.expectRevert();
        pm.initialize(key, 2 ** 96);
    }

    function test_buyExactInPaysTaxOnEthSpent() public {
        ChimiV4Token t = _launch(_params(300, 700, 10_000, 0, 0), 0);
        uint256 quote = router.quoteBuy(address(t), 2 ether);
        uint256 before = alice.balance;
        uint256 out = _buy(alice, t, 2 ether);
        assertEq(out, quote, "quote is exact");
        assertEq(before - alice.balance, 2 ether);
        assertEq(hook.protocolFees() + hook.creatorFees(creator), 0.06 ether, "3% of 2 ETH");
        _assertBacked(t);
    }

    function test_sellExactInPaysTaxOnEthReceived() public {
        ChimiV4Token t = _launch(_params(300, 700, 10_000, 0, 0), 0);
        uint256 tokens = _buy(alice, t, 2 ether);
        uint256 taxBefore = hook.protocolFees() + hook.creatorFees(creator);
        uint256 quote = router.quoteSell(address(t), tokens);
        uint256 before = alice.balance;
        uint256 out = _sell(alice, t, tokens);
        assertEq(out, quote, "quote is exact");
        assertEq(alice.balance - before, out);
        uint256 tax = hook.protocolFees() + hook.creatorFees(creator) - taxBefore;
        assertApproxEqAbs(tax, ((out + tax) * 700) / 10_000, 1);
        _assertBacked(t);
    }

    function test_exactOutputSwapsAreTaxedToo() public {
        ChimiV4Token t = _launch(_params(500, 500, 10_000, 0, 0), 0);
        PoolKey memory key = _key(t);
        uint256 taxBefore = hook.protocolFees() + hook.creatorFees(creator);
        vm.prank(alice);
        BalanceDelta d = swapper.swap{value: 1 ether}(key, true, int256(1_000_000 ether));
        assertEq(d.amount1(), int128(int256(1_000_000 ether)));
        uint256 paid = uint256(int256(-d.amount0()));
        uint256 tax = hook.protocolFees() + hook.creatorFees(creator) - taxBefore;
        assertApproxEqAbs(tax, (paid * 500) / 10_000, 1, "5% of what the buyer paid");
        vm.prank(alice);
        t.approve(address(swapper), type(uint256).max);
        taxBefore = hook.protocolFees() + hook.creatorFees(creator);
        vm.prank(alice);
        d = swapper.swap(key, false, int256(0.01 ether));
        assertEq(d.amount0(), int128(int256(0.01 ether)), "seller gets exactly what they asked");
        tax = hook.protocolFees() + hook.creatorFees(creator) - taxBefore;
        assertApproxEqAbs(tax, ((0.01 ether + tax) * 500) / 10_000, 1, "5% of the pool's payout");
        _assertBacked(t);
    }

    function test_splitFollowsTheCreatorsChoice() public {
        ChimiV4Token t = _launch(_params(1_000, 1_000, 5_000, 3_000, 2_000), 0);
        uint256 dust = t.balanceOf(DEAD);
        _buy(alice, t, 1 ether); // 0.1 ETH tax: 30% platform, the 0.07 remainder split 50/30/20
        assertEq(hook.protocolFees(), 0.03 ether);
        assertEq(hook.creatorFees(creator), 0.035 ether);
        assertEq(hook.holderFunds(), 0.021 ether);
        assertEq(hook.buybackPending(address(t)), 0);
        assertGt(t.balanceOf(DEAD), dust);
        _assertBacked(t);
    }

    function test_creatorAndPlatformClaim() public {
        ChimiV4Token t = _launchBasic();
        _buy(alice, t, 10 ether);
        uint256 c = hook.creatorFees(creator);
        uint256 before = creator.balance;
        vm.prank(creator);
        hook.claimCreatorFees();
        assertEq(creator.balance - before, c);
        assertEq(hook.creatorFeesOf(address(t), creator), 0);
        uint256 p = hook.protocolFees();
        hook.claimProtocolFees();
        assertEq(treasury.balance, p, "the platform's share goes to the treasury");
        vm.expectRevert(ChimiTaxHook.NothingToClaim.selector);
        vm.prank(creator);
        hook.claimCreatorFees();
        _assertBacked(t);
    }

    function test_holdersEarnProRataAndTransfersMoveNoRewards() public {
        ChimiV4Token t = _launch(_params(1_000, 1_000, 0, 10_000, 0), 0);
        uint256 a = _buy(alice, t, 1 ether);
        uint256 b = _buy(bob, t, 1 ether);
        uint256 aliceR = t.rewardsOf(alice);
        assertGt(aliceR, 0, "alice earned from bob's buy");
        vm.prank(alice);
        t.transfer(bob, a / 2);
        assertEq(t.rewardsOf(alice), aliceR, "a transfer moves no rewards");
        _buy(makeAddr("eve"), t, 1 ether);
        uint256 da = t.rewardsOf(alice) - aliceR;
        uint256 db = t.rewardsOf(bob);
        assertApproxEqRel(da * (b + a / 2), db * (a - a / 2), 1e12, "pro rata to balances at the credit");
        uint256 before = alice.balance;
        vm.prank(alice);
        t.claimRewards(address(0));
        assertEq(alice.balance - before, aliceR + da);
        assertEq(t.rewardsOf(alice), 0);
        _assertBacked(t);
    }

    function test_excludedAccountsEarnNothing() public {
        ChimiV4Token t = _launch(_params(1_000, 1_000, 0, 10_000, 0), 0);
        _buy(alice, t, 1 ether);
        _buy(bob, t, 1 ether);
        assertEq(t.rewardsOf(address(pm)), 0);
        assertEq(t.rewardsOf(DEAD), 0);
        assertEq(t.rewardsOf(address(launcher.locker())), 0);
        assertEq(t.earningSupply(), t.balanceOf(alice) + t.balanceOf(bob), "only holders outside the pool earn");
        assertApproxEqAbs(t.rewardsOf(alice) + t.rewardsOf(bob) + t.pendingRewards(), t.totalRewards() + t.pendingRewards(), 10);
    }

    function test_creditsWaitUntilSomeoneHolds() public {
        ChimiV4Token t = _launch(_params(1_000, 1_000, 0, 10_000, 0), 0);
        uint256 first = _buy(alice, t, 1 ether);
        assertGt(t.pendingRewards(), 0);
        assertEq(t.rewardsOf(alice), 0);
        _buy(bob, t, 1 ether);
        assertApproxEqAbs(t.rewardsOf(alice), hook.holderFunds(), 10);
        assertGt(first, 0);
    }

    function test_flashBorrowingTheSupplyLosesMoney() public {
        ChimiV4Token t = _launch(_params(1_000, 1_000, 0, 10_000, 0), 0);
        _buy(alice, t, 1 ether);
        _buy(bob, t, 1 ether);
        address eve = makeAddr("eve");
        uint256 before = eve.balance;
        uint256 claimsBefore = hook.holderFunds();
        PoolKey memory key = _key(t);
        vm.prank(eve);
        swapper.flashSwap{value: 1 ether}(key, 500_000_000 ether, -int256(1 ether));
        uint256 earned = t.rewardsOf(address(swapper));
        vm.prank(address(swapper));
        if (earned > 0) t.claimRewards(eve);
        uint256 tokens = t.balanceOf(eve);
        uint256 back = _sell(eve, t, tokens);
        assertLt(eve.balance, before, "the attack costs more than it earns");
        assertLe(earned, hook.holderFunds() + earned - claimsBefore, "never more than its own trade's credit");
        assertGt(back, 0);
        _assertBacked(t);
    }

    function test_buyThenSellRightAwayLosesMoney() public {
        ChimiV4Token t = _launch(_params(500, 500, 0, 10_000, 0), 0);
        _buy(alice, t, 5 ether);
        address eve = makeAddr("eve");
        uint256 before = eve.balance;
        uint256 got = _buy(eve, t, 50 ether);
        _sell(eve, t, got);
        if (t.rewardsOf(eve) > 0) {
            vm.prank(eve);
            t.claimRewards(address(0));
        }
        assertLt(eve.balance, before);
    }

    function test_buybackRunsInsideATradeAndBurns() public {
        ChimiV4Token t = _launch(_params(1_000, 1_000, 0, 0, 10_000), 0);
        PoolId id = _key(t).toId();
        uint256 dust = t.balanceOf(DEAD);
        _buy(alice, t, 0.01 ether);
        assertEq(t.balanceOf(DEAD), dust);
        (uint160 before,,,) = pm.getSlot0(id);
        _buy(bob, t, 1 ether);
        assertGt(t.balanceOf(DEAD), dust, "bought back and burned");
        (uint160 afterBuy,,,) = pm.getSlot0(id);
        assertLt(afterBuy, before);
        _assertBacked(t);
    }

    function test_buybackMovesThePriceAtMostOneStep() public {
        ChimiV4Token t = _launch(_params(1_000, 1_000, 0, 0, 10_000), 0);
        _buy(alice, t, 50 ether);
        uint256 left = hook.buybackPending(address(t));
        assertGt(left, 0, "the price limit leaves some for later");
        PoolId id = _key(t).toId();
        (uint160 p0,,,) = pm.getSlot0(id);
        (uint256 ethIn,) = hook.buyback(address(t));
        (uint160 p1,,,) = pm.getSlot0(id);
        assertGt(ethIn, 0);
        assertGe(uint256(p1) * (10_000 + 25), uint256(p0) * 10_000 - uint256(p0), "within one 25 bps sqrt-price step");
        _assertBacked(t);
    }

    function test_taxesOnlyGoDown() public {
        ChimiV4Token t = _launch(_params(800, 800, 10_000, 0, 0), 0);
        vm.prank(alice);
        vm.expectRevert(ChimiTaxHook.NotCreator.selector);
        hook.lowerTaxes(address(t), 500, 500);
        vm.startPrank(creator);
        hook.lowerTaxes(address(t), 500, 200);
        vm.expectRevert(ChimiTaxHook.TaxOutOfRange.selector);
        hook.lowerTaxes(address(t), 600, 200);
        vm.expectRevert(ChimiTaxHook.TaxOutOfRange.selector);
        hook.lowerTaxes(address(t), 50, 200);
        vm.stopPrank();
        ChimiTaxHook.Tax memory tax = hook.taxOf(address(t));
        assertEq(tax.buyBps, 500);
        assertEq(tax.sellBps, 200);
        _buy(alice, t, 1 ether);
        assertEq(hook.protocolFees() + hook.creatorFees(creator), 0.05 ether, "the lower tax applies at once");
    }

    function test_transferCreator() public {
        ChimiV4Token t = _launchBasic();
        vm.prank(creator);
        hook.transferCreator(address(t), bob);
        _buy(alice, t, 1 ether);
        assertGt(hook.creatorFees(bob), 0, "future fees go to the new creator");
        vm.prank(bob);
        hook.lowerTaxes(address(t), 100, 100);
    }

    function test_antiSnipeCapsWalletsDuringTheWindow() public {
        vm.prank(owner);
        launcher.setLaunchWindow(1 minutes, 100);
        ChimiV4Launcher.LaunchParams memory p = _params(100, 100, 10_000, 0, 0);
        p.antiSnipe = true;
        ChimiV4Token t = _launch(p, 0.5 ether);
        assertGt(t.balanceOf(creator), SUPPLY / 100, "the creator's first buy is before the window");
        vm.prank(alice);
        vm.expectRevert();
        router.buy{value: 1 ether}(address(t), 0, alice, block.timestamp);
        _buy(alice, t, 0.05 ether);
        vm.warp(block.timestamp + 61);
        _buy(alice, t, 1 ether);
    }

    function test_withoutAntiSnipeThereIsNoWindow() public {
        ChimiV4Token t = _launchBasic();
        assertEq(t.guardEndsAt(), 0);
        _buy(alice, t, 1 ether);
    }

    function test_routerSlippageAndDeadline() public {
        ChimiV4Token t = _launchBasic();
        uint256 q = router.quoteBuy(address(t), 1 ether);
        vm.prank(alice);
        vm.expectRevert(ChimiV4Router.TooLittleReceived.selector);
        router.buy{value: 1 ether}(address(t), q + 1, alice, block.timestamp);
        vm.prank(alice);
        vm.expectRevert(ChimiV4Router.Expired.selector);
        router.buy{value: 1 ether}(address(t), 0, alice, block.timestamp - 1);
        vm.expectRevert(ChimiV4Router.UnknownToken.selector);
        router.quoteBuy(address(0xBEEF), 1 ether);
    }

    function test_buyForAnotherRecipient() public {
        ChimiV4Token t = _launchBasic();
        vm.prank(alice);
        uint256 out = router.buy{value: 1 ether}(address(t), 0, bob, block.timestamp);
        assertEq(t.balanceOf(bob), out);
        assertEq(t.balanceOf(alice), 0);
    }

    function test_bpsSourceStampsTheChimiSplit() public {
        ArcBpsSource src = new ArcBpsSource(owner);
        vm.prank(owner);
        launcher.setBpsSource(address(src));
        ChimiV4Token t = _launch(_params(1_000, 1_000, 10_000, 0, 0), 0);
        _buy(alice, t, 1 ether);
        ChimiTaxHook.Tax memory tax = hook.taxOf(address(t));
        assertEq(tax.platformBps, 3_000, "30% platform, the remainder of creator 70% and staker 0%");
        assertEq(tax.stakerBps, 0);
        assertEq(hook.protocolFees(), 0.03 ether);
        assertEq(hook.creatorFees(creator), 0.07 ether);

        vm.prank(owner);
        src.setMemeBps(6_000, 1_000);
        ChimiV4Launcher.LaunchParams memory p = _params(1_000, 1_000, 10_000, 0, 0);
        p.name = "Second";
        p.symbol = "TWO";
        ChimiV4Token t2 = _launch(p, 0);
        _buy(alice, t2, 1 ether);
        assertEq(hook.taxOf(address(t2)).platformBps, 3_000);
        assertEq(hook.taxOf(address(t2)).stakerBps, 1_000);
        assertEq(hook.stakerFees(), 0.01 ether);
        hook.claimStakerFees();
        assertEq(treasury.balance, 0.01 ether, "the staker leg pays the staking pool");

        vm.prank(owner);
        src.setMemeBps(5_000, 0);
        p.name = "Third";
        p.symbol = "THREE";
        vm.expectRevert(ChimiV4Launcher.PlatformShareOutOfRange.selector);
        _launch(p, 0);
    }

    function test_ownerLaunchesFree() public {
        vm.prank(owner);
        launcher.setCreationFee(0.2 ether);
        vm.prank(creator);
        vm.expectRevert(ChimiV4Launcher.CreationFeeUnpaid.selector);
        launcher.launch(_params(100, 100, 10_000, 0, 0));
        vm.prank(owner);
        launcher.launch{value: 0}(_params(100, 100, 10_000, 0, 0));
        vm.prank(creator);
        launcher.launch{value: 0.2 ether}(_params(100, 100, 10_000, 0, 0));
        assertEq(launcher.creationFees(), 0.2 ether);
        launcher.claimCreationFees();
        assertEq(treasury.balance, 0.2 ether);
    }

    function test_liquidityStaysLockedForACentury() public {
        ChimiV4Token t = _launchBasic();
        ChimiV4Locker box = launcher.locker();
        vm.expectRevert(ChimiV4Locker.StillLocked.selector);
        vm.prank(treasury);
        box.withdraw(address(t));
        vm.prank(alice);
        vm.expectRevert(ChimiV4Locker.NotBeneficiary.selector);
        box.withdraw(address(t));
        vm.warp(launcher.getLaunch(address(t)).unlocksAt);
        uint256 supplyInPool = t.balanceOf(address(pm));
        vm.prank(treasury);
        box.withdraw(address(t));
        // The position's token amount rounds 1 wei short of the PoolManager's balance.
        assertApproxEqAbs(t.balanceOf(treasury), supplyInPool, 2);
        assertLt(t.balanceOf(address(pm)), 10);
        (uint256 ethAmount, uint256 tokenAmount,) = launcher.reserves(address(t));
        assertEq(ethAmount, 0);
        assertEq(tokenAmount, 0);
    }

    /// forge-config: default.fuzz.runs = 32
    function testFuzz_quotesMatchTrades(uint96 ethIn, uint16 buyTax, uint16 sellTax) public {
        uint256 amount = bound(uint256(ethIn), 0.0001 ether, 500 ether);
        buyTax = uint16(bound(buyTax, 100, 1_000));
        sellTax = uint16(bound(sellTax, 100, 1_000));
        ChimiV4Token t = _launch(_params(buyTax, sellTax, 6_000, 2_000, 2_000), 0);
        _buy(bob, t, 1 ether);
        uint256 q = router.quoteBuy(address(t), amount);
        uint256 out = _buy(alice, t, amount);
        assertEq(out, q);
        uint256 qs = router.quoteSell(address(t), out);
        assertEq(_sell(alice, t, out), qs);
        _assertBacked(t);
    }
}
