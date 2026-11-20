// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, Vm} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ChimiStack} from "../script/ChimiStack.sol";
import {ChimiDexV2} from "../script/ChimiDexV2.sol";
import {ChimiFeeChoice} from "../script/ChimiFeeChoice.sol";
import {WETH9} from "../script/testnet/WETH9.sol";
import {InstantErc20QuoteFactory} from "../src/InstantErc20QuoteFactory.sol";
import {InstantErc20QuoteFactoryProxyInit} from "../src/InstantErc20QuoteFactoryProxyInit.sol";
import {ArcBpsSource} from "../src/ArcBpsSource.sol";
import {MonLock} from "../src/MonLock.sol";
import {ChimiFlywheel} from "../src/ChimiFlywheel.sol";
import {ChimiBurner, CoinBurner} from "../src/ChimiBurner.sol";
import {ChimiPadV2} from "../src/ChimiPadV2.sol";

interface IV3FactoryFC {
    function setOwner(address owner) external;
}

interface IRouterFC {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

/// @dev Launches a burning coin and then a coin through the first version's function in one transaction, to show the
///      choice doesn't carry over from one launch to the next.
contract TwoLaunches {
    function run(ChimiPadV2 pad) external returns (address burning, address plain) {
        burning = pad.createTokenWithEth("One", "ONE", true);
        plain = pad.createTokenMemeInstantQuoteWithEth("Two", "TWO");
    }
}

/// @notice The launch fee choice on top of the stack as it stands on GIWA Sepolia: CHIMI on the first DEX, the 2% DEX
///         and the flywheel, and one coin already launched at 70/15/15. Two worlds so both currency orders run: `lo`
///         has WETH at a low address (every launch token is currency1, like the live coins), `hi` at a high one.
contract ChimiFeeChoiceTest is Test {
    address internal constant WETH_LOW = address(0x1000);
    address internal constant WETH_HIGH = 0xFFFFFfFfFffffFFfFFffFFFffFfFffFfFFFffFF0;
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint24 internal constant OLD_FEE = 10_000;
    uint24 internal constant NEW_FEE = 20_000;

    struct World {
        ChimiStack.Addresses v1;
        ChimiDexV2.Addresses v2;
        ChimiFeeChoice.Addresses fc;
        ChimiPadV2 pad;
        MonLock locker;
        ChimiFlywheel fly;
        ChimiBurner burner;
        address weth;
        address chimi;
        /// A coin launched at 70/15/15 before the fee choice.
        address before;
        uint256 beforePosition;
        bool tokenIs0;
    }

    World internal lo;
    World internal hi;

    address internal treasury = makeAddr("treasury");
    address internal platform = makeAddr("platform");
    address internal keeper = makeAddr("keeper");
    address internal chimiCreator = makeAddr("chimiCreator");
    address internal creator = makeAddr("creator");
    address internal trader = makeAddr("trader");
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        bytes memory wethCode = address(new WETH9()).code;
        vm.etch(WETH_LOW, wethCode);
        vm.etch(WETH_HIGH, wethCode);
        vm.deal(chimiCreator, 100 ether);
        vm.deal(creator, 100 ether);
        vm.deal(trader, 1_000 ether);
        vm.deal(stranger, 100 ether);
        _deploy(lo, WETH_LOW, false);
        _deploy(hi, WETH_HIGH, true);
    }

    function _deploy(World storage w, address weth, bool tokenIs0) internal {
        ChimiStack.DeployParams memory p = ChimiStack.defaultParams(address(this));
        p.weth = weth;
        p.treasury = treasury;
        p.lpRecipient = platform;
        p.stakingPool = platform;
        w.v1 = ChimiStack.deploy(p);
        IV3FactoryFC(w.v1.uniFactory).setOwner(address(0));
        w.weth = weth;
        w.tokenIs0 = tokenIs0;
        InstantErc20QuoteFactory pad = InstantErc20QuoteFactory(payable(w.v1.factory));

        vm.prank(chimiCreator);
        w.chimi = pad.createTokenMemeInstantQuoteWithEth{value: 0}("chimi", "CHIMI");

        w.v2 = ChimiDexV2.deploy(
            ChimiDexV2.Params({
                owner: address(this),
                platform: platform,
                weth: weth,
                lockDuration: uint64(100 * 365 days),
                chimi: w.chimi,
                chimiRouter: w.v1.swapRouter02,
                chimiPoolFee: OLD_FEE,
                keeper: keeper
            })
        );
        ChimiDexV2.wire(w.v2, w.v1.factory, w.v1.bpsSource);
        ChimiDexV2.renounce(w.v2);
        w.locker = MonLock(payable(w.v2.locker));
        w.fly = ChimiFlywheel(payable(w.v2.flywheel));

        // A coin from before the change, as $FLYT on GIWA.
        vm.prank(creator);
        w.before = pad.createTokenMemeInstantQuoteWithEth{value: 0}("Before", "BEFORE");
        w.beforePosition = pad.getPool(w.before).positionId;

        w.fc = ChimiFeeChoice.deploy(
            ChimiFeeChoice.Params({
                owner: address(this),
                pad: w.v1.factory,
                chimi: w.chimi,
                chimiRouter: w.v1.swapRouter02,
                chimiPoolFee: OLD_FEE,
                keeper: keeper
            })
        );
        ChimiFeeChoice.wire(w.fc, w.v1.factory, w.v1.bpsSource);
        w.pad = ChimiPadV2(payable(w.v1.factory));
        w.burner = ChimiBurner(payable(w.fc.burner));
    }

    // ─── helpers ──────────────────────────────────────────────────────────────────────────

    function _launch(World storage w, bool burnOwnCoin, uint256 firstBuy)
        internal
        returns (address token, InstantErc20QuoteFactory.InstantQuotePool memory pool)
    {
        vm.prank(creator);
        token = w.pad.createTokenWithEth{value: firstBuy}("Coin", "COIN", burnOwnCoin);
        pool = w.pad.getPool(token);
    }

    function _buy(World storage w, address token, uint256 ethIn) internal returns (uint256 out) {
        vm.prank(trader);
        out = IRouterFC(w.v2.swapRouter02).exactInputSingle{value: ethIn}(
            IRouterFC.ExactInputSingleParams(w.weth, token, NEW_FEE, trader, ethIn, 0, 0)
        );
    }

    function _sell(World storage w, address token, uint256 amount) internal returns (uint256 out) {
        vm.startPrank(trader);
        IERC20(token).approve(w.v2.swapRouter02, amount);
        out = IRouterFC(w.v2.swapRouter02)
            .exactInputSingle(IRouterFC.ExactInputSingleParams(token, w.weth, NEW_FEE, trader, amount, 0, 0));
        vm.stopPrank();
    }

    /// @dev A 1 ETH buy and a sale of it, then the sweep. Returns the ETH-side fee and the coin-side fee.
    function _tradeAndSweep(World storage w, address token, uint256 positionId)
        internal
        returns (uint256 wethFee, uint256 tokenFee)
    {
        uint256 bought = _buy(w, token, 1 ether);
        _sell(w, token, bought);
        vm.prank(stranger);
        (uint256 a0, uint256 a1) = w.locker.collectFees(positionId);
        (wethFee, tokenFee) = w.tokenIs0 ? (a1, a0) : (a0, a1);
    }

    // ─── the upgrade ──────────────────────────────────────────────────────────────────────

    function test_upgrade_keeps_every_setting_and_coin() public view {
        _checkUpgrade(lo);
        _checkUpgrade(hi);
    }

    function _checkUpgrade(World storage w) internal view {
        assertEq(w.pad.owner(), address(this));
        assertEq(w.pad.treasury(), treasury);
        assertEq(w.pad.bpsSource(), w.v1.bpsSource);
        assertEq(w.pad.positionManager(), w.v2.nfpm);
        assertEq(w.pad.lpLocker(), w.v2.locker);
        assertEq(w.pad.swapRouter(), w.v2.swapRouter02);
        assertEq(w.pad.poolFee(), NEW_FEE);
        assertEq(w.pad.tickSpacing(), 400);
        assertEq(w.pad.allTokensLength(), 2);
        assertEq(w.pad.allTokens(0), w.chimi);
        assertEq(w.pad.allTokens(1), w.before);
        assertEq(w.pad.getPool(w.chimi).creator, chimiCreator);
        assertEq(w.pad.getPool(w.before).creator, creator);
        assertEq(address(w.pad.QUOTE()), w.weth);
        assertEq(address(w.pad.WETH()), w.weth);
        assertEq(w.pad.quoteDecimals(), 18);
        assertEq(w.pad.stakingPool(), address(w.burner));
        assertEq(address(w.pad.BURNER()), address(w.burner));
    }

    function test_nobody_can_initialize_the_upgraded_pad_again() public {
        vm.prank(stranger);
        vm.expectRevert(bytes("initialized"));
        lo.pad.initialize(stranger, stranger, stranger, stranger, 1);
    }

    function test_the_upgrade_is_owner_only() public {
        address admin = ChimiFeeChoice.proxyAdmin(address(lo.pad));
        assertEq(Ownable(admin).owner(), address(this));
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        (bool ok,) =
            admin.call(abi.encodeWithSignature("upgradeAndCall(address,address,bytes)", address(lo.pad), stranger, ""));
        ok;
    }

    // ─── launches ─────────────────────────────────────────────────────────────────────────

    function test_a_burning_coin_is_stamped_70_10_5() public {
        (address token, InstantErc20QuoteFactory.InstantQuotePool memory pool) = _launch(lo, true, 0);
        address coinBurner = lo.burner.burnerOf(token);
        assertTrue(coinBurner != address(0), "it has a burner");
        assertEq(lo.pad.burnerOf(token), coinBurner);

        (address cWallet, uint16 cBps) = lo.locker.creatorSplits(pool.positionId);
        (address sWallet, uint16 sBps) = lo.locker.stakerSplits(pool.positionId);
        (,,, address bWallet, uint16 bBps) = lo.locker.locks(pool.positionId);
        assertEq(cWallet, creator);
        assertEq(cBps, 7_000);
        assertEq(bWallet, coinBurner);
        assertEq(bBps, 1_000);
        assertEq(sWallet, address(lo.burner));
        assertEq(sBps, 500);
        assertEq(lo.locker.launchTokens(pool.positionId), token);
        assertEq(lo.locker.quoteTokens(pool.positionId), lo.weth);
    }

    function test_a_plain_coin_is_stamped_80_5() public {
        (address token, InstantErc20QuoteFactory.InstantQuotePool memory pool) = _launch(lo, false, 0);
        assertEq(lo.burner.burnerOf(token), address(0), "no burner");
        (address cWallet, uint16 cBps) = lo.locker.creatorSplits(pool.positionId);
        (address sWallet, uint16 sBps) = lo.locker.stakerSplits(pool.positionId);
        (,,, address bWallet, uint16 bBps) = lo.locker.locks(pool.positionId);
        assertEq(cWallet, creator);
        assertEq(cBps, 8_000);
        assertEq(sWallet, address(lo.burner));
        assertEq(sBps, 500);
        assertEq(bWallet, address(0));
        assertEq(bBps, 0);
    }

    function test_the_first_versions_launch_is_a_plain_coin() public {
        vm.prank(creator);
        address token = lo.pad.createTokenMemeInstantQuoteWithEth{value: 0}("Old way", "OLD");
        uint256 id = lo.pad.getPool(token).positionId;
        (, uint16 cBps) = lo.locker.creatorSplits(id);
        (address sWallet, uint16 sBps) = lo.locker.stakerSplits(id);
        assertEq(cBps, 8_000);
        assertEq(sWallet, address(lo.burner));
        assertEq(sBps, 500);
        assertEq(lo.burner.burnerOf(token), address(0));
    }

    function test_the_launch_event_says_which() public {
        vm.recordLogs();
        (address token,) = _launch(lo, true, 0);
        (address plain,) = _launch(lo, false, 0);
        bytes32 sig = keccak256("FeeChoice(address,bool,address)");
        uint256 seen;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics.length == 0 || logs[i].topics[0] != sig) continue;
            address t = address(uint160(uint256(logs[i].topics[1])));
            (bool burns, address b) = abi.decode(logs[i].data, (bool, address));
            if (t == token) {
                assertTrue(burns);
                assertEq(b, lo.burner.burnerOf(token));
            } else {
                assertEq(t, plain);
                assertFalse(burns);
                assertEq(b, address(0));
            }
            seen++;
        }
        assertEq(seen, 2);
    }

    function test_the_choice_doesnt_carry_over_to_the_next_launch() public {
        TwoLaunches two = new TwoLaunches();
        (address burning, address plain) = two.run(lo.pad);
        assertTrue(lo.burner.burnerOf(burning) != address(0));
        assertEq(lo.burner.burnerOf(plain), address(0));
        (, uint16 cBps) = lo.locker.creatorSplits(lo.pad.getPool(plain).positionId);
        assertEq(cBps, 8_000);
    }

    function test_first_buy_at_launch_works_both_ways() public {
        (address a,) = _launch(lo, true, 0.1 ether);
        assertGt(IERC20(a).balanceOf(creator), 0);
        (address b,) = _launch(lo, false, 0.1 ether);
        assertGt(IERC20(b).balanceOf(creator), 0);
    }

    function test_a_burning_launch_waits_for_its_settings() public {
        ArcBpsSource(lo.v1.bpsSource).setBackedBps(1_000, 500, 0);
        vm.prank(creator);
        vm.expectRevert(bytes("burn bps unset"));
        lo.pad.createTokenWithEth("Coin", "COIN", true);
    }

    // ─── the split ────────────────────────────────────────────────────────────────────────

    function test_burning_coin_fees_split_70_10_5_15_token_is_currency1() public {
        _checkBurningSplit(lo);
    }

    function test_burning_coin_fees_split_70_10_5_15_token_is_currency0() public {
        _checkBurningSplit(hi);
    }

    function _checkBurningSplit(World storage w) internal {
        (address token, InstantErc20QuoteFactory.InstantQuotePool memory pool) = _launch(w, true, 0);
        address coinBurner = w.burner.burnerOf(token);
        (uint256 wethFee, uint256 tokenFee) = _tradeAndSweep(w, token, pool.positionId);
        assertApproxEqAbs(wethFee, 0.02 ether, 10, "2% of the buy");

        uint256 toOwnBurn = (wethFee * 1_000) / 10_000;
        uint256 toChimiBurn = (wethFee * 500) / 10_000;
        uint256 toCreator = (wethFee * 7_000) / 10_000;
        IERC20 weth = IERC20(w.weth);
        assertEq(weth.balanceOf(coinBurner), toOwnBurn, "own burn 10%, in WETH");
        assertEq(address(w.burner).balance, toChimiBurn, "CHIMI burn 5%, as ETH");
        assertEq(weth.balanceOf(creator), toCreator, "creator 70%, in WETH");
        assertEq(weth.balanceOf(platform), wethFee - toOwnBurn - toChimiBurn - toCreator, "platform the other 15%");
        assertApproxEqAbs(weth.balanceOf(platform), (wethFee * 1_500) / 10_000, 3);
        assertEq(IERC20(token).balanceOf(DEAD), tokenFee, "the coin side still burns");
        assertEq(address(w.fly).balance, 0, "nothing to the flywheel");
    }

    function test_plain_coin_fees_split_80_5_15_token_is_currency1() public {
        _checkPlainSplit(lo);
    }

    function test_plain_coin_fees_split_80_5_15_token_is_currency0() public {
        _checkPlainSplit(hi);
    }

    function _checkPlainSplit(World storage w) internal {
        (address token, InstantErc20QuoteFactory.InstantQuotePool memory pool) = _launch(w, false, 0);
        (uint256 wethFee, uint256 tokenFee) = _tradeAndSweep(w, token, pool.positionId);
        uint256 toChimiBurn = (wethFee * 500) / 10_000;
        uint256 toCreator = (wethFee * 8_000) / 10_000;
        IERC20 weth = IERC20(w.weth);
        assertEq(address(w.burner).balance, toChimiBurn, "CHIMI burn 5%, as ETH");
        assertEq(weth.balanceOf(creator), toCreator, "creator 80%, in WETH");
        assertEq(weth.balanceOf(platform), wethFee - toChimiBurn - toCreator, "platform the other 15%");
        assertApproxEqAbs(weth.balanceOf(platform), (wethFee * 1_500) / 10_000, 3);
        assertEq(IERC20(token).balanceOf(DEAD), tokenFee);
    }

    function test_a_coin_from_before_keeps_70_15_15() public {
        (address sWallet, uint16 sBps) = lo.locker.stakerSplits(lo.beforePosition);
        (, uint16 cBps) = lo.locker.creatorSplits(lo.beforePosition);
        assertEq(sWallet, address(lo.fly), "until it's retargeted");
        assertEq(sBps, 1_500);
        assertEq(cBps, 7_000);
        _tradeAndSweep(lo, lo.before, lo.beforePosition);
        assertGt(address(lo.fly).balance, 0, "its 15% still reaches the flywheel");
        assertEq(address(lo.burner).balance, 0);
    }

    function test_retarget_sends_a_coin_from_befores_15_percent_to_the_chimi_burn() public {
        uint256 moved = ChimiFeeChoice.retarget(address(lo.locker), address(lo.fly), address(lo.burner));
        assertEq(moved, 1);
        (address sWallet, uint16 sBps) = lo.locker.stakerSplits(lo.beforePosition);
        assertEq(sWallet, address(lo.burner));
        assertEq(sBps, 1_500, "the percentage stays");
        (uint256 wethFee,) = _tradeAndSweep(lo, lo.before, lo.beforePosition);
        assertEq(address(lo.burner).balance, (wethFee * 1_500) / 10_000);
        assertEq(address(lo.fly).balance, 0);
        assertEq(ChimiFeeChoice.retarget(address(lo.locker), address(lo.fly), address(lo.burner)), 0, "once");
    }

    // ─── the coin's own burn ──────────────────────────────────────────────────────────────

    function _burningCoinWithFees(World storage w) internal returns (address token, CoinBurner coinBurner) {
        InstantErc20QuoteFactory.InstantQuotePool memory pool;
        (token, pool) = _launch(w, true, 0);
        coinBurner = CoinBurner(payable(w.burner.burnerOf(token)));
        _tradeAndSweep(w, token, pool.positionId);
    }

    function test_the_keeper_buys_the_coin_and_burns_all_of_it() public {
        _checkCoinBurn(lo);
        _checkCoinBurn(hi);
    }

    function _checkCoinBurn(World storage w) internal {
        (address token, CoinBurner coinBurner) = _burningCoinWithFees(w);
        uint256 held = IERC20(w.weth).balanceOf(address(coinBurner));
        assertEq(coinBurner.pending(), held);
        uint256 deadBefore = IERC20(token).balanceOf(DEAD);

        vm.prank(keeper);
        (uint256 spent, uint256 out) = w.burner.burnCoin(token, type(uint256).max, 1);

        assertEq(spent, held);
        assertGt(out, 0);
        assertEq(IERC20(token).balanceOf(DEAD) - deadBefore, out, "every coin bought went to the burn address");
        assertEq(IERC20(token).balanceOf(address(coinBurner)), 0);
        assertEq(IERC20(w.weth).balanceOf(address(coinBurner)), 0);
        assertEq(coinBurner.totalSpent(), held);
        assertEq(coinBurner.totalBurned(), out);
    }

    function test_the_coin_burn_spends_no_more_than_asked_and_respects_its_minimum() public {
        (address token, CoinBurner coinBurner) = _burningCoinWithFees(lo);
        uint256 held = IERC20(lo.weth).balanceOf(address(coinBurner));

        vm.prank(keeper);
        vm.expectRevert(bytes("Too little received"));
        lo.burner.burnCoin(token, held / 2, type(uint256).max);

        vm.prank(keeper);
        (uint256 spent,) = lo.burner.burnCoin(token, held / 2, 1);
        assertEq(spent, held / 2);
        assertEq(IERC20(lo.weth).balanceOf(address(coinBurner)), held - held / 2);
    }

    function test_eth_sent_to_a_coin_burner_is_spent_too() public {
        (address token, CoinBurner coinBurner) = _burningCoinWithFees(lo);
        uint256 held = IERC20(lo.weth).balanceOf(address(coinBurner));
        vm.prank(stranger);
        (bool ok,) = address(coinBurner).call{value: 0.001 ether}("");
        assertTrue(ok);
        vm.prank(keeper);
        (uint256 spent,) = lo.burner.burnCoin(token, type(uint256).max, 1);
        assertEq(spent, held + 0.001 ether);
    }

    function test_only_the_keeper_spends_a_coin_burner() public {
        (address token, CoinBurner coinBurner) = _burningCoinWithFees(lo);
        vm.prank(stranger);
        vm.expectRevert(ChimiBurner.NotKeeper.selector);
        lo.burner.burnCoin(token, 1, 0);

        vm.expectRevert(ChimiBurner.NotKeeper.selector);
        lo.burner.burnCoin(token, 1, 0); // the owner can't either

        vm.prank(keeper);
        vm.expectRevert(CoinBurner.NotHub.selector);
        coinBurner.buyAndBurn(1, 0);

        vm.prank(keeper);
        vm.expectRevert(ChimiBurner.NoBurner.selector);
        lo.burner.burnCoin(lo.chimi, 1, 0);
    }

    function test_a_coin_burner_knows_its_coin_router_and_fee() public {
        (address token, CoinBurner coinBurner) = _burningCoinWithFees(lo);
        (address c, address router, uint24 fee) = coinBurner.config();
        assertEq(c, token);
        assertEq(router, lo.v2.swapRouter02);
        assertEq(fee, NEW_FEE);
        assertEq(coinBurner.coin(), token);
        assertEq(coinBurner.HUB(), address(lo.burner));
        assertEq(
            address(coinBurner),
            Clones.predictDeterministicAddressWithImmutableArgs(
                lo.burner.COIN_BURNER_IMPL(),
                abi.encode(token, router, fee),
                bytes32(uint256(uint160(token))),
                address(lo.burner)
            )
        );
        assertEq(lo.burner.burningCoinsLength(), 1);
        assertEq(lo.burner.burningCoins(0), token);
    }

    function test_only_the_pad_creates_a_coin_burner_and_only_once() public {
        vm.prank(stranger);
        vm.expectRevert(ChimiBurner.NotPad.selector);
        lo.burner.createCoinBurner(stranger, lo.v2.swapRouter02, NEW_FEE);

        (address token,) = _launch(lo, true, 0);
        address first = lo.burner.burnerOf(token);
        vm.prank(address(lo.pad));
        assertEq(lo.burner.createCoinBurner(token, stranger, 1), first, "the existing one, unchanged");
        assertEq(lo.burner.burningCoinsLength(), 1);
    }

    // ─── the CHIMI burn ───────────────────────────────────────────────────────────────────

    function test_the_keeper_buys_chimi_and_burns_all_of_it() public {
        _checkChimiBurn(lo);
        _checkChimiBurn(hi);
    }

    function _checkChimiBurn(World storage w) internal {
        _burningCoinWithFees(w);
        uint256 held = address(w.burner).balance;
        assertGt(held, 0);
        assertEq(w.burner.pendingChimi(), held);
        uint256 deadBefore = IERC20(w.chimi).balanceOf(DEAD);

        vm.prank(keeper);
        uint256 out = w.burner.burnChimi(type(uint256).max, 1);

        assertGt(out, 0);
        assertEq(IERC20(w.chimi).balanceOf(DEAD) - deadBefore, out);
        assertEq(IERC20(w.chimi).balanceOf(address(w.burner)), 0);
        assertEq(address(w.burner).balance, 0);
        assertEq(w.burner.totalSpentOnChimi(), held);
        assertEq(w.burner.totalChimiBurned(), out);
    }

    function test_the_chimi_burn_unwraps_weth_that_arrives() public {
        vm.deal(stranger, 1 ether);
        vm.startPrank(stranger);
        WETH9(payable(lo.weth)).deposit{value: 0.01 ether}();
        IERC20(lo.weth).transfer(address(lo.burner), 0.01 ether);
        vm.stopPrank();
        assertEq(lo.burner.pendingChimi(), 0.01 ether);
        vm.prank(keeper);
        lo.burner.burnChimi(type(uint256).max, 1);
        assertEq(lo.burner.totalSpentOnChimi(), 0.01 ether);
        assertEq(IERC20(lo.weth).balanceOf(address(lo.burner)), 0);
    }

    function test_the_chimi_burn_respects_its_minimum_and_keeper() public {
        _burningCoinWithFees(lo);
        vm.prank(keeper);
        vm.expectRevert(bytes("Too little received"));
        lo.burner.burnChimi(type(uint256).max, type(uint256).max);

        vm.prank(stranger);
        vm.expectRevert(ChimiBurner.NotKeeper.selector);
        lo.burner.burnChimi(1, 0);

        vm.prank(keeper);
        assertEq(lo.burner.burnChimi(0, 0), 0, "nothing asked, nothing spent");
    }

    // ─── the owner ────────────────────────────────────────────────────────────────────────

    function test_the_owner_can_only_change_the_keeper() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        lo.burner.setKeeper(stranger);

        lo.burner.setKeeper(stranger);
        assertEq(lo.burner.keeper(), stranger);
        vm.expectRevert(ChimiBurner.ZeroAddress.selector);
        lo.burner.setKeeper(address(0));
    }

    function test_settings_are_as_planned() public view {
        ArcBpsSource bps = ArcBpsSource(lo.v1.bpsSource);
        assertEq(bps.lpMemeCreatorBps(), 8_000);
        assertEq(bps.lpMemeStakerBps(), 500);
        assertEq(bps.lpBackingBps(), 1_000);
        assertEq(bps.lpStakerBps(), 500);
        assertEq(bps.lpCreatorBps(), 7_000);
        assertEq(lo.burner.CHIMI(), lo.chimi);
        assertEq(address(lo.burner.CHIMI_ROUTER()), lo.v1.swapRouter02);
        assertEq(lo.burner.CHIMI_POOL_FEE(), OLD_FEE);
        assertEq(lo.burner.PAD(), address(lo.pad));
        assertEq(lo.burner.keeper(), keeper);
        assertEq(lo.burner.owner(), address(this));
    }
}
