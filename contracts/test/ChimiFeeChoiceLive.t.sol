// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ChimiFeeChoice} from "../script/ChimiFeeChoice.sol";
import {InstantErc20QuoteFactory} from "../src/InstantErc20QuoteFactory.sol";
import {MonLock} from "../src/MonLock.sol";
import {ChimiBurner, CoinBurner} from "../src/ChimiBurner.sol";
import {ChimiPadV2} from "../src/ChimiPadV2.sol";

interface IRouterLiveFC {
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

/// @notice The fee choice on the contracts live on GIWA Sepolia, on a fork. Once deployments.json has `burner` (it was
///         deployed 2026-11-19), this checks the deployed contracts and that their code is this build; before that,
///         the deployer runs the same steps as script/DeployChimiFeeChoice.s.sol first. Then coins launch both ways
///         through the pad, trade, and the keeper burns. Nothing is sent to the real chain.
///
///         GIWA_RPC=https://sepolia-rpc.giwa.io forge test --match-contract ChimiFeeChoiceLiveForkTest
///
///         Without GIWA_RPC every test here is skipped.
contract ChimiFeeChoiceLiveForkTest is Test {
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint24 internal constant NEW_FEE = 20_000;

    bool internal live;
    ChimiPadV2 internal pad;
    MonLock internal locker;
    MonLock internal oldLocker;
    ChimiBurner internal burner;
    address internal weth;
    address internal router;
    address internal oldRouter;
    address internal flywheel;
    address internal chimi;
    address internal keeper;
    address internal deployer;
    address internal bpsSource;
    address internal padImplBefore;
    uint256 internal coinsBefore;
    uint256 internal moved;
    /// True when the fee choice is already live (deployments.json has `burner`); false when this run deployed it.
    bool internal deployed;

    // Fresh addresses: some of anvil's default accounts carry an EIP-7702 sweeper on GIWA Sepolia.
    address internal creator = makeAddr("fc-creator");
    address internal trader = makeAddr("fc-trader");

    function setUp() public {
        string memory rpc = vm.envOr("GIWA_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        string memory json = vm.readFile("./../web/public/deployments.json");
        assertEq(vm.parseJsonUint(json, ".chainId"), block.chainid);
        pad = ChimiPadV2(payable(vm.parseJsonAddress(json, ".factory")));
        bpsSource = vm.parseJsonAddress(json, ".bpsSource");
        oldRouter = vm.parseJsonAddress(json, ".swapRouter");
        oldLocker = MonLock(payable(vm.parseJsonAddress(json, ".locker")));
        locker = MonLock(payable(vm.parseJsonAddress(json, ".dexes[1].locker")));
        router = vm.parseJsonAddress(json, ".dexes[1].swapRouter");
        weth = vm.parseJsonAddress(json, ".weth");
        flywheel = vm.parseJsonAddress(json, ".flywheel.address");
        chimi = vm.parseJsonAddress(json, ".flywheel.chimi");
        keeper = vm.parseJsonAddress(json, ".flywheel.keeper");
        deployer = pad.owner();
        coinsBefore = pad.allTokensLength();
        padImplBefore = _implementation();

        if (vm.keyExistsJson(json, ".burner")) {
            deployed = true;
            burner = ChimiBurner(payable(vm.parseJsonAddress(json, ".burner.address")));
        } else {
            vm.startPrank(deployer);
            ChimiFeeChoice.Addresses memory a = ChimiFeeChoice.deploy(
                ChimiFeeChoice.Params({
                    owner: deployer,
                    pad: address(pad),
                    chimi: chimi,
                    chimiRouter: oldRouter,
                    chimiPoolFee: 10_000,
                    keeper: keeper
                })
            );
            ChimiFeeChoice.wire(a, address(pad), bpsSource);
            moved = ChimiFeeChoice.retarget(address(locker), flywheel, a.burner);
            vm.stopPrank();
            burner = ChimiBurner(payable(a.burner));
        }

        vm.deal(creator, 10 ether);
        vm.deal(trader, 10 ether);
        live = true;
    }

    modifier onlyLive() {
        if (!live) vm.skip(true);
        _;
    }

    function _implementation() internal view returns (address) {
        return address(
            uint160(uint256(vm.load(address(pad), bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1))))
        );
    }

    function test_live_pad_is_upgraded_with_every_coin_and_setting_kept() public onlyLive {
        if (!deployed) assertTrue(_implementation() != padImplBefore, "new implementation");
        assertEq(address(pad.BURNER()), address(burner));
        assertEq(pad.stakingPool(), address(burner), "the 5% goes to the CHIMI burn");
        assertEq(burner.PAD(), address(pad));
        assertEq(burner.CHIMI(), chimi);
        assertEq(address(burner.CHIMI_ROUTER()), oldRouter);
        assertEq(burner.CHIMI_POOL_FEE(), 10_000);
        assertEq(burner.keeper(), keeper);
        assertEq(burner.owner(), deployer);
        assertEq(pad.owner(), deployer);
        assertEq(pad.allTokensLength(), coinsBefore);
        assertEq(pad.lpLocker(), address(locker));
        assertEq(pad.swapRouter(), router);
        assertEq(pad.poolFee(), NEW_FEE);
        assertEq(address(pad.QUOTE()), weth);
        assertEq(address(pad.WETH()), weth);
        assertEq(pad.quoteDecimals(), 18);
        assertEq(pad.getPool(chimi).creator != address(0), true, "CHIMI is still on the pad");
        vm.expectRevert(bytes("initialized"));
        pad.initialize(creator, creator, creator, creator, 1);
    }

    /// @dev The deployed code is this build: the same contracts with the same constructor arguments give the same bytes.
    function test_live_deployed_code_is_this_build() public onlyLive {
        assertEq(
            keccak256(address(new ChimiPadV2(weth, 18, weth, address(burner))).code),
            keccak256(_implementation().code),
            "pad implementation"
        );
        vm.prank(address(burner));
        CoinBurner impl = new CoinBurner(weth);
        assertEq(keccak256(address(impl).code), keccak256(burner.COIN_BURNER_IMPL().code), "coin burner");
    }

    function test_live_coins_from_before_keep_their_percentages() public onlyLive {
        // $CHIMI and the other first-DEX coins: 70/30, no staker leg.
        uint256 chimiId = pad.getPool(chimi).positionId;
        (, uint16 cBps) = oldLocker.creatorSplits(chimiId);
        (, uint16 sBps) = oldLocker.stakerSplits(chimiId);
        assertEq(cBps, 7_000);
        assertEq(sBps, 0);
        // Coins on the 2% locker from before kept their percentages (70/15/15) and their 15% now goes to the CHIMI
        // burn; coins launched since pay it 5%.
        uint256[] memory ids = locker.allLockedPositions();
        if (!deployed) assertEq(moved, ids.length, "every 2% coin was on the flywheel");
        for (uint256 i = 0; i < ids.length; i++) {
            (address w, uint16 bps) = locker.stakerSplits(ids[i]);
            (, uint16 c) = locker.creatorSplits(ids[i]);
            assertEq(w, address(burner));
            if (bps == 1_500) {
                assertEq(c, 7_000);
            } else {
                assertEq(bps, 500);
                assertTrue(c == 7_000 || c == 8_000);
            }
        }
    }

    function _trade(address token, uint256 positionId) internal returns (uint256 wethFee) {
        vm.prank(trader);
        uint256 bought = IRouterLiveFC(router).exactInputSingle{value: 0.1 ether}(
            IRouterLiveFC.ExactInputSingleParams(weth, token, NEW_FEE, trader, 0.1 ether, 0, 0)
        );
        vm.startPrank(trader);
        IERC20(token).approve(router, bought);
        IRouterLiveFC(router)
            .exactInputSingle(IRouterLiveFC.ExactInputSingleParams(token, weth, NEW_FEE, trader, bought, 0, 0));
        vm.stopPrank();
        bool tokenIs0 = token < weth;
        (uint256 a0, uint256 a1) = locker.collectFees(positionId);
        wethFee = tokenIs0 ? a1 : a0;
    }

    function test_live_burning_launch_splits_70_10_5_15_and_the_keeper_burns() public onlyLive {
        address platform = pad.treasury();
        vm.prank(creator);
        address token = pad.createTokenWithEth{value: 0.01 ether}("Fork Burn", "FBURN", true);
        InstantErc20QuoteFactory.InstantQuotePool memory pool = pad.getPool(token);
        assertEq(pool.creator, creator);
        assertGt(IERC20(token).balanceOf(creator), 0, "first buy");
        address coinBurner = burner.burnerOf(token);
        assertTrue(coinBurner != address(0));

        uint256 creatorBefore = IERC20(weth).balanceOf(creator);
        uint256 platformBefore = IERC20(weth).balanceOf(platform);
        uint256 burnerBefore = address(burner).balance;
        uint256 ownBefore = IERC20(weth).balanceOf(coinBurner);
        uint256 wethFee = _trade(token, pool.positionId);
        assertApproxEqAbs(wethFee, 0.0022 ether, 10, "2% of the 0.01 first buy and the 0.1 buy");

        uint256 own = IERC20(weth).balanceOf(coinBurner) - ownBefore;
        uint256 toChimi = address(burner).balance - burnerBefore;
        uint256 toCreator = IERC20(weth).balanceOf(creator) - creatorBefore;
        uint256 toPlatform = IERC20(weth).balanceOf(platform) - platformBefore;
        assertEq(own, (wethFee * 1_000) / 10_000, "10% own burn");
        assertEq(toChimi, (wethFee * 500) / 10_000, "5% CHIMI burn");
        assertEq(toCreator, (wethFee * 7_000) / 10_000, "70% creator");
        assertEq(toPlatform, wethFee - own - toChimi - toCreator, "15% platform");

        uint256 dead = IERC20(token).balanceOf(DEAD);
        vm.prank(keeper);
        (uint256 spent, uint256 out) = burner.burnCoin(token, type(uint256).max, 1);
        assertGt(spent, 0);
        assertEq(IERC20(weth).balanceOf(coinBurner), 0, "all of it");
        assertGt(out, 0);
        assertEq(IERC20(token).balanceOf(DEAD) - dead, out);
        assertEq(CoinBurner(payable(coinBurner)).totalBurned(), out);

        uint256 chimiDead = IERC20(chimi).balanceOf(DEAD);
        vm.prank(keeper);
        uint256 chimiOut = burner.burnChimi(type(uint256).max, 1);
        assertGt(chimiOut, 0);
        assertEq(IERC20(chimi).balanceOf(DEAD) - chimiDead, chimiOut);
        assertEq(address(burner).balance, 0);
    }

    function test_live_plain_launch_splits_80_5_15() public onlyLive {
        address platform = pad.treasury();
        vm.prank(creator);
        address token = pad.createTokenWithEth{value: 0}("Fork Plain", "FPLAIN", false);
        uint256 positionId = pad.getPool(token).positionId;
        assertEq(burner.burnerOf(token), address(0));

        uint256 creatorBefore = IERC20(weth).balanceOf(creator);
        uint256 platformBefore = IERC20(weth).balanceOf(platform);
        uint256 burnerBefore = address(burner).balance;
        uint256 wethFee = _trade(token, positionId);
        uint256 toChimi = address(burner).balance - burnerBefore;
        uint256 toCreator = IERC20(weth).balanceOf(creator) - creatorBefore;
        uint256 toPlatform = IERC20(weth).balanceOf(platform) - platformBefore;
        assertEq(toChimi, (wethFee * 500) / 10_000, "5% CHIMI burn");
        assertEq(toCreator, (wethFee * 8_000) / 10_000, "80% creator");
        assertEq(toPlatform, wethFee - toChimi - toCreator, "15% platform");
    }

    function test_live_the_old_launch_function_is_a_plain_coin() public onlyLive {
        vm.prank(creator);
        address token = pad.createTokenMemeInstantQuoteWithEth{value: 0}("Fork Old", "FOLD");
        (, uint16 cBps) = locker.creatorSplits(pad.getPool(token).positionId);
        assertEq(cBps, 8_000);
        assertEq(burner.burnerOf(token), address(0));
    }
}
