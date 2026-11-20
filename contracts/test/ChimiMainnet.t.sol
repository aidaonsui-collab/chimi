// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ChimiMainnet, IUniV3FactoryMain} from "../script/ChimiMainnet.sol";
import {ChimiStack} from "../script/ChimiStack.sol";
import {ChimiFeeChoice} from "../script/ChimiFeeChoice.sol";
import {WETH9} from "../script/testnet/WETH9.sol";
import {ArcBpsSource} from "../src/ArcBpsSource.sol";
import {ChimiBurner} from "../src/ChimiBurner.sol";
import {ChimiPadV2} from "../src/ChimiPadV2.sol";
import {ChimiTips} from "../src/ChimiTips.sol";
import {InstantErc20QuoteFactory} from "../src/InstantErc20QuoteFactory.sol";
import {InstantErc20QuoteFactoryProxyInit} from "../src/InstantErc20QuoteFactoryProxyInit.sol";
import {MonLock} from "../src/MonLock.sol";

interface IRouterMain {
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

/// @notice Chimi on a fresh chain in the mainnet order (script/ChimiMainnet.sol): the stack, CHIMI launched on it, the
///         burns, tips. WETH sits where GIWA has it, 0x4200…0006.
contract ChimiMainnetTest is Test {
    address internal constant WETH = 0x4200000000000000000000000000000000000006;
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint24 internal constant FEE = 20_000;

    address internal platform = makeAddr("platform");
    address internal keeper = makeAddr("keeper");
    address internal creator = makeAddr("creator");
    address internal trader = makeAddr("trader");
    address internal stranger = makeAddr("stranger");

    ChimiMainnet.Stack internal s;
    ChimiMainnet.Burns internal b;
    ChimiPadV2 internal pad;
    MonLock internal locker;
    ChimiBurner internal burner;
    address internal chimi;
    uint256 internal moved;
    address internal tips;

    function setUp() public {
        vm.etch(WETH, address(new WETH9()).code);
        vm.deal(address(this), 10 ether);
        vm.deal(creator, 100 ether);
        vm.deal(trader, 1_000 ether);
        vm.deal(stranger, 100 ether);

        s = ChimiMainnet.deployStack(_params());
        chimi = ChimiMainnet.launchChimi(s, "Chimi", "CHIMI", 0);
        b = ChimiMainnet.deployBurns(s, WETH, chimi, s.swapRouter02, FEE, keeper, address(this));
        moved = ChimiMainnet.wireBurns(s, b, platform);
        tips = ChimiMainnet.deployTips(s, platform, address(this));
        pad = ChimiPadV2(payable(s.pad));
        locker = MonLock(payable(s.locker));
        burner = ChimiBurner(payable(b.burner));
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

    // ─── helpers ──────────────────────────────────────────────────────────────────────────────────────────────

    function _launch(bool burnOwnCoin) internal returns (address token, uint256 positionId) {
        vm.prank(creator);
        token = pad.createTokenWithEth{value: 0}("Coin", "COIN", burnOwnCoin);
        positionId = pad.getPool(token).positionId;
    }

    function _buy(address router, uint24 fee, address token, uint256 ethIn) internal returns (uint256 out) {
        vm.prank(trader);
        out = IRouterMain(router).exactInputSingle{value: ethIn}(
            IRouterMain.ExactInputSingleParams(WETH, token, fee, trader, ethIn, 0, 0)
        );
    }

    function _sell(address router, uint24 fee, address token, uint256 amount) internal {
        vm.startPrank(trader);
        IERC20(token).approve(router, amount);
        IRouterMain(router).exactInputSingle(IRouterMain.ExactInputSingleParams(token, WETH, fee, trader, amount, 0, 0));
        vm.stopPrank();
    }

    /// @dev A 1 ETH buy and its sale, then anyone sweeps the fees. Returns the ETH-side fee.
    function _tradeAndSweep(address token, uint256 positionId) internal returns (uint256 wethFee) {
        _sell(s.swapRouter02, FEE, token, _buy(s.swapRouter02, FEE, token, 1 ether));
        vm.prank(stranger);
        (uint256 a0, uint256 a1) = locker.collectFees(positionId);
        wethFee = token < WETH ? a1 : a0;
    }

    // ─── the shape ────────────────────────────────────────────────────────────────────────────────────────────

    function test_one_dex_at_2pct_with_its_owner_given_up() public view {
        IUniV3FactoryMain uni = IUniV3FactoryMain(s.uniFactory);
        assertEq(uni.owner(), address(0));
        assertEq(uni.feeAmountTickSpacing(20_000), 400);
        assertEq(uni.feeAmountTickSpacing(30_000), 600);
        assertEq(pad.poolFee(), FEE);
        assertEq(pad.swapRouter(), s.swapRouter02);
        assertEq(pad.positionManager(), s.nfpm);
        assertEq(pad.lpLocker(), s.locker);
    }

    function test_the_pad_offers_the_choice_and_its_5pct_feeds_the_burner() public view {
        assertEq(address(pad.BURNER()), b.burner);
        assertEq(pad.stakingPool(), b.burner);
        assertEq(pad.treasury(), platform);
        assertEq(pad.owner(), address(this));
        ArcBpsSource bps = ArcBpsSource(s.bpsSource);
        assertEq(bps.lpMemeCreatorBps(), 8_000);
        assertEq(bps.lpMemeStakerBps(), 500);
        assertEq(bps.lpCreatorBps(), 7_000);
        assertEq(bps.lpBackingBps(), 1_000);
        assertEq(bps.lpStakerBps(), 500);
    }

    function test_the_burner_is_fixed_to_chimi_on_the_pads_dex() public view {
        assertEq(burner.CHIMI(), chimi);
        assertEq(address(burner.CHIMI_ROUTER()), s.swapRouter02);
        assertEq(burner.CHIMI_POOL_FEE(), FEE);
        assertEq(burner.PAD(), s.pad);
        assertEq(burner.keeper(), keeper);
        assertEq(burner.owner(), address(this));
    }

    function test_chimis_own_launch_feeds_the_burner_too() public view {
        assertEq(moved, 1, "CHIMI's lock was the one launch before the burner");
        uint256 id = pad.getPool(chimi).positionId;
        (address wallet, uint16 bps) = locker.stakerSplits(id);
        assertEq(wallet, b.burner);
        assertEq(bps, 500);
        (address c, uint16 cBps) = locker.creatorSplits(id);
        assertEq(c, address(this), "the signer launched CHIMI");
        assertEq(cBps, 8_000);
    }

    function test_tips_pay_the_creator_of_a_coin_on_this_pad() public {
        (address token,) = _launch(false);
        address fan = makeAddr("fan");
        vm.deal(fan, 1 ether);
        vm.prank(fan);
        ChimiTips(payable(tips)).tip{value: 0.01 ether}(token, "gm");
        assertEq(creator.balance, 100 ether + 0.009 ether, "90% to the creator");
        assertEq(platform.balance, 0.001 ether, "10% to the platform");
    }

    // ─── the money ────────────────────────────────────────────────────────────────────────────────────────────

    function test_a_plain_coin_splits_80_5_15() public {
        (address token, uint256 id) = _launch(false);
        uint256 wethFee = _tradeAndSweep(token, id);
        assertApproxEqAbs(wethFee, 0.02 ether, 10, "2% of the buy");
        assertEq(address(burner).balance, (wethFee * 500) / 10_000, "CHIMI burn 5%");
        assertEq(IERC20(WETH).balanceOf(creator), (wethFee * 8_000) / 10_000, "creator 80%");
        assertApproxEqAbs(IERC20(WETH).balanceOf(platform), (wethFee * 1_500) / 10_000, 3, "platform 15%");
    }

    function test_a_burning_coin_splits_70_10_5_15() public {
        (address token, uint256 id) = _launch(true);
        address coinBurner = burner.burnerOf(token);
        assertTrue(coinBurner != address(0));
        uint256 wethFee = _tradeAndSweep(token, id);
        assertEq(IERC20(WETH).balanceOf(coinBurner), (wethFee * 1_000) / 10_000, "own burn 10%");
        assertEq(address(burner).balance, (wethFee * 500) / 10_000, "CHIMI burn 5%");
        assertEq(IERC20(WETH).balanceOf(creator), (wethFee * 7_000) / 10_000, "creator 70%");
        assertApproxEqAbs(IERC20(WETH).balanceOf(platform), (wethFee * 1_500) / 10_000, 3, "platform 15%");
    }

    function test_the_keeper_burns_chimi_and_a_burning_coin() public {
        (address token, uint256 id) = _launch(true);
        _tradeAndSweep(token, id);
        // CHIMI needs a little liquidity on the buy side for the burn to buy from.
        _buy(s.swapRouter02, FEE, chimi, 0.1 ether);

        uint256 waiting = burner.pendingChimi();
        assertGt(waiting, 0);
        vm.prank(keeper);
        uint256 chimiBurned = burner.burnChimi(waiting, 1);
        assertGt(chimiBurned, 0);
        assertGe(IERC20(chimi).balanceOf(DEAD), chimiBurned, "CHIMI to the burn address");

        address coinBurner = burner.burnerOf(token);
        uint256 coinWaiting = IERC20(WETH).balanceOf(coinBurner);
        uint256 deadBefore = IERC20(token).balanceOf(DEAD);
        vm.prank(keeper);
        burner.burnCoin(token, coinWaiting, 1);
        assertGt(IERC20(token).balanceOf(DEAD), deadBefore, "the coin to the burn address");
    }

    function test_only_the_keeper_spends_the_burns() public {
        vm.expectRevert(ChimiBurner.NotKeeper.selector);
        vm.prank(stranger);
        burner.burnChimi(1, 0);
    }

    // ─── a CHIMI from elsewhere ───────────────────────────────────────────────────────────────────────────────

    function test_a_chimi_that_already_has_a_pool_elsewhere() public {
        // A second, unrelated 1% Uniswap v3 copy, with a coin on it standing in for a CHIMI deployed some other way.
        ChimiStack.DeployParams memory other = ChimiStack.defaultParams(address(this));
        other.weth = WETH;
        ChimiStack.Addresses memory o = ChimiStack.deploy(other);
        vm.prank(creator);
        address external_ = InstantErc20QuoteFactory(payable(o.factory)).createTokenMemeInstantQuoteWithEth("Chimi", "CHIMI");

        ChimiMainnet.Stack memory s2 = ChimiMainnet.deployStack(_params());
        ChimiMainnet.Burns memory b2 = ChimiMainnet.deployBurns(s2, WETH, external_, o.swapRouter02, 10_000, keeper, address(this));
        assertEq(ChimiMainnet.wireBurns(s2, b2, platform), 0, "nothing launched before");
        ChimiBurner burner2 = ChimiBurner(payable(b2.burner));
        assertEq(burner2.CHIMI(), external_);
        assertEq(address(burner2.CHIMI_ROUTER()), o.swapRouter02);

        // Fees from a coin on the new pad buy the CHIMI on the other DEX.
        ChimiPadV2 pad2 = ChimiPadV2(payable(s2.pad));
        vm.prank(creator);
        address token = pad2.createTokenWithEth("Coin", "COIN", false);
        _sell(s2.swapRouter02, FEE, token, _buy(s2.swapRouter02, FEE, token, 1 ether));
        MonLock(payable(s2.locker)).collectFees(pad2.getPool(token).positionId);
        _buy(o.swapRouter02, 10_000, external_, 0.1 ether);
        uint256 waiting = burner2.pendingChimi();
        vm.prank(keeper);
        assertGt(burner2.burnChimi(waiting, 1), 0);
    }

    function test_the_burner_wont_deploy_without_a_chimi_pool_there() public {
        ChimiMainnet.Stack memory s2 = ChimiMainnet.deployStack(_params());
        vm.expectRevert(bytes("no CHIMI pool on that router at that fee"));
        this.deployBurnsExternal(s2, chimi, s2.swapRouter02, FEE);
    }

    /// @dev External so expectRevert can see the library's revert.
    function deployBurnsExternal(ChimiMainnet.Stack memory s2, address c, address router, uint24 fee) external {
        ChimiMainnet.deployBurns(s2, WETH, c, router, fee, keeper, address(this));
    }

    function test_the_stack_wont_deploy_without_weth_there() public {
        ChimiMainnet.Params memory p = _params();
        p.weth = makeAddr("nothing here");
        vm.expectRevert(bytes("no WETH at that address"));
        this.deployStackExternal(p);
    }

    function deployStackExternal(ChimiMainnet.Params memory p) external {
        ChimiMainnet.deployStack(p);
    }

    // ─── two runs: CHIMI launched by another wallet in between ────────────────────────────────────────────────

    function test_launches_between_the_two_runs_are_pointed_at_the_burner() public {
        ChimiMainnet.Stack memory s2 = ChimiMainnet.deployStack(_params());
        InstantErc20QuoteFactoryProxyInit pad2 = InstantErc20QuoteFactoryProxyInit(payable(s2.pad));
        address chimiCreator = makeAddr("chimiCreator");
        vm.prank(chimiCreator);
        address chimi2 = pad2.createTokenMemeInstantQuoteWithEth("Chimi", "CHIMI");
        vm.prank(creator);
        address early = pad2.createTokenMemeInstantQuoteWithEth("Early", "EARLY");
        (address before,) = MonLock(payable(s2.locker)).stakerSplits(pad2.getPool(early).positionId);
        assertEq(before, platform, "the platform holds the 5% until the burner exists");

        ChimiMainnet.Burns memory b2 = ChimiMainnet.deployBurns(s2, WETH, chimi2, s2.swapRouter02, FEE, keeper, address(this));
        assertEq(ChimiMainnet.wireBurns(s2, b2, platform), 2);
        (address after_,) = MonLock(payable(s2.locker)).stakerSplits(pad2.getPool(early).positionId);
        assertEq(after_, b2.burner);
        assertEq(address(ChimiPadV2(payable(s2.pad)).BURNER()), b2.burner);
    }
}
