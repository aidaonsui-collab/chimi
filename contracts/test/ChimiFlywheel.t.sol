// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ChimiStack} from "../script/ChimiStack.sol";
import {ChimiDexV2} from "../script/ChimiDexV2.sol";
import {WETH9} from "../script/testnet/WETH9.sol";
import {InstantErc20QuoteFactory} from "../src/InstantErc20QuoteFactory.sol";
import {MonLock} from "../src/MonLock.sol";
import {ChimiFlywheel} from "../src/ChimiFlywheel.sol";
import {PriceMath} from "../src/PriceMath.sol";

interface IV3FactoryT {
    function owner() external view returns (address);
    function setOwner(address owner) external;
    function feeAmountTickSpacing(uint24 fee) external view returns (int24);
}

interface IV3PoolT {
    function fee() external view returns (uint24);
    function tickSpacing() external view returns (int24);
    function factory() external view returns (address);
}

interface IV3PoolSlot0 {
    function slot0()
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8 feeProtocol, bool unlocked);
}

interface INpmT {
    function ownerOf(uint256 tokenId) external view returns (address);
}

interface IRouterT {
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

/// @dev A wallet that won't take ETH.
contract RefusesEth {
    receive() external payable {
        revert("no");
    }
}

/// @notice The second DEX and the flywheel, on top of a first stack with CHIMI already launched on it (as on
///         GIWA Sepolia). Two worlds so both currency orders run: `lo` has WETH at a low address (every
///         launch token is currency1, like the live coins), `hi` at a high one.
contract ChimiFlywheelTest is Test {
    address internal constant WETH_LOW = address(0x1000);
    address internal constant WETH_HIGH = 0xFFFFFfFfFffffFFfFFffFFFffFfFffFfFFFffFF0;
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint24 internal constant OLD_FEE = 10_000;
    uint24 internal constant NEW_FEE = 20_000;

    struct World {
        ChimiStack.Addresses v1;
        ChimiDexV2.Addresses v2;
        InstantErc20QuoteFactory pad;
        MonLock oldLocker;
        MonLock newLocker;
        ChimiFlywheel fly;
        address weth;
        address chimi;
        uint256 chimiPosition;
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
    address internal holderA = makeAddr("holderA");
    address internal holderB = makeAddr("holderB");

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
        IV3FactoryT(w.v1.uniFactory).setOwner(address(0));
        w.pad = InstantErc20QuoteFactory(payable(w.v1.factory));
        w.oldLocker = MonLock(payable(w.v1.locker));
        w.weth = weth;
        w.tokenIs0 = tokenIs0;

        // CHIMI launched on the first DEX, as it did on GIWA.
        vm.prank(chimiCreator);
        w.chimi = w.pad.createTokenMemeInstantQuoteWithEth{value: 0}("chimi", "CHIMI");
        w.chimiPosition = w.pad.getPool(w.chimi).positionId;

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
        w.newLocker = MonLock(payable(w.v2.locker));
        w.fly = ChimiFlywheel(payable(w.v2.flywheel));
    }

    // ─── helpers ──────────────────────────────────────────────────────────────────────────

    function _launch(World storage w, address who, uint256 firstBuy)
        internal
        returns (address token, InstantErc20QuoteFactory.InstantQuotePool memory pool)
    {
        uint256 fee = w.pad.creationFeeDue(who);
        vm.prank(who);
        token = w.pad.createTokenMemeInstantQuoteWithEth{value: fee + firstBuy}("Coin", "COIN");
        pool = w.pad.getPool(token);
    }

    function _buy(address router, address weth, address token, uint24 fee, address who, uint256 ethIn)
        internal
        returns (uint256 out)
    {
        vm.prank(who);
        out = IRouterT(router).exactInputSingle{value: ethIn}(
            IRouterT.ExactInputSingleParams(weth, token, fee, who, ethIn, 0, 0)
        );
    }

    function _sell(address router, address weth, address token, uint24 fee, address who, uint256 amount)
        internal
        returns (uint256 out)
    {
        vm.startPrank(who);
        IERC20(token).approve(router, amount);
        out = IRouterT(router).exactInputSingle(IRouterT.ExactInputSingleParams(token, weth, fee, who, amount, 0, 0));
        vm.stopPrank();
    }

    /// @dev A new coin, a 1 ETH buy and a sale of it, and the sweep: what the flywheel got.
    function _tradeAndSweep(World storage w) internal returns (uint256 wethFee, uint256 toFlywheel) {
        (address token, InstantErc20QuoteFactory.InstantQuotePool memory pool) = _launch(w, creator, 0);
        uint256 bought = _buy(w.v2.swapRouter02, w.weth, token, NEW_FEE, trader, 1 ether);
        _sell(w.v2.swapRouter02, w.weth, token, NEW_FEE, trader, bought);
        uint256 before = address(w.fly).balance;
        vm.prank(stranger);
        (uint256 a0, uint256 a1) = w.newLocker.collectFees(pool.positionId);
        wethFee = w.tokenIs0 ? a1 : a0;
        toFlywheel = address(w.fly).balance - before;
    }

    // ─── the new DEX ──────────────────────────────────────────────────────────────────────

    function test_new_dex_has_the_2_and_3_percent_tiers_and_no_owner() public view {
        IV3FactoryT uni = IV3FactoryT(lo.v2.uniFactory);
        assertEq(uni.feeAmountTickSpacing(20_000), 400);
        assertEq(uni.feeAmountTickSpacing(30_000), 600);
        assertEq(uni.feeAmountTickSpacing(10_000), 200, "the default 1% tier is still there");
        assertEq(uni.owner(), address(0), "renounced");
    }

    function test_new_launches_go_to_a_2_percent_pool_on_the_new_dex() public {
        (address token, InstantErc20QuoteFactory.InstantQuotePool memory pool) = _launch(lo, creator, 0);
        assertEq(IV3PoolT(pool.uniPool).fee(), NEW_FEE);
        assertEq(IV3PoolT(pool.uniPool).tickSpacing(), 400);
        assertEq(IV3PoolT(pool.uniPool).factory(), lo.v2.uniFactory);
        assertEq(INpmT(lo.v2.nfpm).ownerOf(pool.positionId), address(lo.newLocker), "locked in the new locker");

        (address cWallet, uint16 cBps) = lo.newLocker.creatorSplits(pool.positionId);
        (address sWallet, uint16 sBps) = lo.newLocker.stakerSplits(pool.positionId);
        assertEq(cWallet, creator);
        assertEq(cBps, 7_000);
        assertEq(sWallet, address(lo.fly));
        assertEq(sBps, 1_500);
        token;
    }

    function test_coins_launched_before_keep_their_pool_and_split() public view {
        InstantErc20QuoteFactory.InstantQuotePool memory pool = lo.pad.getPool(lo.chimi);
        assertEq(IV3PoolT(pool.uniPool).fee(), OLD_FEE);
        assertEq(IV3PoolT(pool.uniPool).factory(), lo.v1.uniFactory);
        (, uint16 cBps) = lo.oldLocker.creatorSplits(lo.chimiPosition);
        (, uint16 sBps) = lo.oldLocker.stakerSplits(lo.chimiPosition);
        assertEq(cBps, 7_000);
        assertEq(sBps, 0, "no flywheel share on the old coins");
    }

    function test_old_coins_fees_still_go_70_30_and_nothing_to_the_flywheel() public {
        uint256 bought = _buy(lo.v1.swapRouter02, lo.weth, lo.chimi, OLD_FEE, trader, 1 ether);
        bought;
        lo.oldLocker.collectFees(lo.chimiPosition);
        assertApproxEqAbs(IERC20(lo.weth).balanceOf(chimiCreator), 0.007 ether, 10);
        assertApproxEqAbs(IERC20(lo.weth).balanceOf(platform), 0.003 ether, 10);
        assertEq(address(lo.fly).balance, 0);
    }

    /// @dev With 400-tick spacing the opening price sits at the target or up to one spacing (about 4%) below it,
    ///      never above by more than a tick.
    function _checkStartPrice(World storage w, address pool, uint256 virtualQuote) internal view {
        uint256 ideal = PriceMath.sqrtPriceX96(w.tokenIs0, virtualQuote, w.pad.VIRTUAL_TOKEN_INIT());
        (uint160 sqrtNow,,,,,,) = IV3PoolSlot0(pool).slot0();
        uint256 start = sqrtNow;
        if (w.tokenIs0) {
            assertLe(start, ideal, "token0: at or below target");
            assertGe(start * 10_000, ideal * 9_800, "token0: within one spacing");
        } else {
            assertGe(start * 100_000, ideal * 99_995, "token1: at or below target");
            assertLe(start * 10_000, ideal * 10_203, "token1: within one spacing (1.0001^200 = 1.0202)");
        }
    }

    function testFuzz_new_pool_opens_near_the_target_token_is_currency1(uint256 virtualQuote) public {
        _fuzzStart(lo, virtualQuote);
    }

    function testFuzz_new_pool_opens_near_the_target_token_is_currency0(uint256 virtualQuote) public {
        _fuzzStart(hi, virtualQuote);
    }

    function _fuzzStart(World storage w, uint256 virtualQuote) internal {
        virtualQuote = bound(virtualQuote, 1e15, 1e24);
        w.pad.setLaunchVirtualQuote(virtualQuote);
        (address token, InstantErc20QuoteFactory.InstantQuotePool memory pool) = _launch(w, creator, 0);
        assertEq(IERC20(w.weth).balanceOf(pool.uniPool), 0, "no quote at launch");
        _checkStartPrice(w, pool.uniPool, virtualQuote);
        assertGt(_buy(w.v2.swapRouter02, w.weth, token, NEW_FEE, trader, 0.01 ether), 0, "trades from the first block");
    }

    function test_first_buy_at_launch_goes_through_the_new_pool() public {
        (address token,) = _launch(lo, creator, 0.1 ether);
        assertGt(IERC20(token).balanceOf(creator), 0, "the creator got their first buy");
    }

    // ─── the split ────────────────────────────────────────────────────────────────────────

    function test_fees_split_70_15_15_token_is_currency1() public {
        _checkSplit(lo);
    }

    function test_fees_split_70_15_15_token_is_currency0() public {
        _checkSplit(hi);
    }

    function _checkSplit(World storage w) internal {
        (address token, InstantErc20QuoteFactory.InstantQuotePool memory pool) = _launch(w, creator, 0);
        uint256 bought = _buy(w.v2.swapRouter02, w.weth, token, NEW_FEE, trader, 1 ether);
        _sell(w.v2.swapRouter02, w.weth, token, NEW_FEE, trader, bought);

        vm.prank(stranger);
        (uint256 a0, uint256 a1) = w.newLocker.collectFees(pool.positionId);
        (uint256 wethFee, uint256 tokenFee) = w.tokenIs0 ? (a1, a0) : (a0, a1);
        assertApproxEqAbs(wethFee, 0.02 ether, 10, "2% of the buy");
        assertApproxEqAbs(tokenFee, (bought * 2) / 100, 1e6, "2% of the sale");

        uint256 toCreator = (wethFee * 7_000) / 10_000;
        uint256 toFlywheel = (wethFee * 1_500) / 10_000;
        IERC20 weth = IERC20(w.weth);
        assertEq(weth.balanceOf(creator), toCreator, "creator 70%, in WETH");
        assertEq(address(w.fly).balance, toFlywheel, "flywheel 15%, as ETH");
        assertEq(weth.balanceOf(address(w.fly)), 0);
        assertEq(weth.balanceOf(platform), wethFee - toCreator - toFlywheel, "platform the other 15%");
        assertEq(IERC20(token).balanceOf(DEAD), tokenFee, "the coin side still burns");
        assertEq(weth.balanceOf(address(w.newLocker)), 0);
        assertEq(address(w.newLocker).balance, 0);
    }

    // ─── the flywheel ─────────────────────────────────────────────────────────────────────

    function test_arrivals_split_in_half() public {
        (, uint256 toFlywheel) = _tradeAndSweep(lo);
        (uint256 b, uint256 h) = lo.fly.pending();
        assertEq(b, toFlywheel / 2);
        assertEq(h, toFlywheel - toFlywheel / 2);
        lo.fly.sync();
        assertEq(lo.fly.burnBucket(), b);
        assertEq(lo.fly.holderBucket(), h);
        assertEq(lo.fly.totalIn(), toFlywheel);
    }

    function test_buyback_buys_chimi_and_burns_all_of_it() public {
        _tradeAndSweep(lo);
        (uint256 b, uint256 h) = lo.fly.pending();
        uint256 deadBefore = IERC20(lo.chimi).balanceOf(DEAD);

        vm.prank(keeper);
        uint256 out = lo.fly.buybackAndBurn(type(uint256).max, 1);

        assertGt(out, 0);
        assertEq(IERC20(lo.chimi).balanceOf(DEAD) - deadBefore, out, "every CHIMI bought went to the burn address");
        assertEq(IERC20(lo.chimi).balanceOf(address(lo.fly)), 0);
        assertEq(lo.fly.burnBucket(), 0);
        assertEq(lo.fly.holderBucket(), h, "the holders' half is untouched");
        assertEq(lo.fly.totalSpentOnBurns(), b);
        assertEq(lo.fly.totalChimiBurned(), out);
        assertEq(address(lo.fly).balance, h);
    }

    function test_buyback_can_spend_part_and_keep_the_rest() public {
        _tradeAndSweep(lo);
        (uint256 b,) = lo.fly.pending();
        vm.prank(keeper);
        lo.fly.buybackAndBurn(b / 4, 0);
        assertEq(lo.fly.burnBucket(), b - b / 4);
    }

    function test_buyback_reverts_below_the_minimum_and_changes_nothing() public {
        _tradeAndSweep(lo);
        lo.fly.sync();
        uint256 b = lo.fly.burnBucket();
        vm.prank(keeper);
        vm.expectRevert();
        lo.fly.buybackAndBurn(b, type(uint256).max);
        assertEq(lo.fly.burnBucket(), b);
    }

    function test_distribute_pays_holders_in_eth() public {
        _tradeAndSweep(lo);
        (uint256 b, uint256 h) = lo.fly.pending();
        address[] memory to = new address[](2);
        uint256[] memory amounts = new uint256[](2);
        to[0] = holderA;
        to[1] = holderB;
        amounts[0] = (h * 2) / 3;
        amounts[1] = h - amounts[0];

        vm.prank(keeper);
        uint256 sent = lo.fly.distribute(20_000, 0, to, amounts);

        assertEq(sent, h);
        assertEq(holderA.balance, amounts[0]);
        assertEq(holderB.balance, amounts[1]);
        assertEq(lo.fly.paidTo(holderA), amounts[0]);
        assertEq(lo.fly.totalPaid(), h);
        assertEq(lo.fly.holderBucket(), 0);
        assertEq(lo.fly.burnBucket(), b, "the burn half is untouched");
    }

    function test_distribute_cannot_pay_more_than_the_holder_half() public {
        _tradeAndSweep(lo);
        (, uint256 h) = lo.fly.pending();
        address[] memory to = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        to[0] = holderA;
        amounts[0] = h + 1; // the contract holds more (the burn half), but that isn't the holders'
        vm.prank(keeper);
        vm.expectRevert(ChimiFlywheel.MoreThanHolderBucket.selector);
        lo.fly.distribute(1, 0, to, amounts);
    }

    function test_a_batch_pays_only_once() public {
        _tradeAndSweep(lo);
        (, uint256 h) = lo.fly.pending();
        address[] memory to = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        to[0] = holderA;
        amounts[0] = h / 4;
        vm.startPrank(keeper);
        lo.fly.distribute(7, 0, to, amounts);
        vm.expectRevert(ChimiFlywheel.BatchDone.selector);
        lo.fly.distribute(7, 0, to, amounts);
        lo.fly.distribute(7, 1, to, amounts); // the next batch of the same day
        vm.stopPrank();
        assertEq(holderA.balance, (h / 4) * 2);
    }

    function test_a_wallet_that_refuses_eth_is_skipped_and_its_share_stays() public {
        _tradeAndSweep(lo);
        (, uint256 h) = lo.fly.pending();
        address refuses = address(new RefusesEth());
        address[] memory to = new address[](2);
        uint256[] memory amounts = new uint256[](2);
        to[0] = refuses;
        to[1] = holderA;
        amounts[0] = h / 2;
        amounts[1] = h / 4;
        vm.prank(keeper);
        uint256 sent = lo.fly.distribute(1, 0, to, amounts);
        assertEq(sent, h / 4);
        assertEq(refuses.balance, 0);
        assertEq(holderA.balance, h / 4);
        assertEq(lo.fly.holderBucket(), h - h / 4);
    }

    function test_weth_sent_here_is_unwrapped_and_split() public {
        vm.startPrank(stranger);
        WETH9(payable(lo.weth)).deposit{value: 1 ether}();
        IERC20(lo.weth).transfer(address(lo.fly), 1 ether);
        vm.stopPrank();
        lo.fly.sync();
        assertEq(IERC20(lo.weth).balanceOf(address(lo.fly)), 0);
        assertEq(address(lo.fly).balance, 1 ether);
        assertEq(lo.fly.burnBucket(), 0.5 ether);
        assertEq(lo.fly.holderBucket(), 0.5 ether);
    }

    function test_eth_sent_here_is_split_the_same_way() public {
        vm.prank(stranger);
        (bool ok,) = address(lo.fly).call{value: 0.3 ether}("");
        assertTrue(ok);
        (uint256 b, uint256 h) = lo.fly.pending();
        assertEq(b, 0.15 ether);
        assertEq(h, 0.15 ether);
    }

    // ─── who can do what ──────────────────────────────────────────────────────────────────

    function test_only_the_keeper_spends_and_only_the_owner_changes_the_keeper() public {
        _tradeAndSweep(lo);
        address[] memory to = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        to[0] = stranger;
        amounts[0] = 1;

        vm.startPrank(stranger);
        vm.expectRevert(ChimiFlywheel.NotKeeper.selector);
        lo.fly.buybackAndBurn(1, 0);
        vm.expectRevert(ChimiFlywheel.NotKeeper.selector);
        lo.fly.distribute(1, 0, to, amounts);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        lo.fly.setKeeper(stranger);
        vm.stopPrank();

        address next = makeAddr("nextKeeper");
        lo.fly.setKeeper(next);
        assertEq(lo.fly.keeper(), next);
        vm.prank(keeper);
        vm.expectRevert(ChimiFlywheel.NotKeeper.selector);
        lo.fly.buybackAndBurn(1, 0);
        vm.prank(next);
        lo.fly.buybackAndBurn(1, 0);
    }

    function test_the_flywheel_settings_are_fixed() public view {
        assertEq(lo.fly.CHIMI(), lo.chimi);
        assertEq(address(lo.fly.ROUTER()), lo.v1.swapRouter02);
        assertEq(lo.fly.CHIMI_POOL_FEE(), OLD_FEE);
        assertEq(address(lo.fly.WETH()), lo.weth);
        assertEq(lo.fly.BURN_BPS(), 5_000);
        assertEq(lo.fly.owner(), address(this));
    }

    function test_constructor_refuses_empty_addresses() public {
        vm.expectRevert(ChimiFlywheel.ZeroAddress.selector);
        new ChimiFlywheel(lo.weth, address(0), lo.v1.swapRouter02, OLD_FEE, keeper, address(this));
        vm.expectRevert(ChimiFlywheel.ZeroAddress.selector);
        new ChimiFlywheel(lo.weth, lo.chimi, lo.v1.swapRouter02, OLD_FEE, address(0), address(this));
    }
}
