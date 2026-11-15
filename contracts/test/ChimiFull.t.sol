// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {ITransparentUpgradeableProxy} from
    "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {ChimiStack} from "../script/ChimiStack.sol";
import {WETH9} from "../script/testnet/WETH9.sol";
import {InstantErc20QuoteFactory} from "../src/InstantErc20QuoteFactory.sol";
import {InstantErc20QuoteFactoryProxyInit} from "../src/InstantErc20QuoteFactoryProxyInit.sol";
import {MonLock} from "../src/MonLock.sol";
import {MonLockProxyInit} from "../src/MonLockProxyInit.sol";
import {PriceMath} from "../src/PriceMath.sol";

interface IV3Factory {
    function createPool(address tokenA, address tokenB, uint24 fee) external returns (address pool);
    function owner() external view returns (address);
    function setOwner(address owner) external;
}

interface IV3Pool {
    function initialize(uint160 sqrtPriceX96) external;
    function token0() external view returns (address);
    function liquidity() external view returns (uint128);
    function slot0()
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8 feeProtocol, bool unlocked);
}

interface INpm {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    struct DecreaseLiquidityParams {
        uint256 tokenId;
        uint128 liquidity;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }

    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
    function decreaseLiquidity(DecreaseLiquidityParams calldata params)
        external
        payable
        returns (uint256 amount0, uint256 amount1);
    function collect(CollectParams calldata params) external payable returns (uint256 amount0, uint256 amount1);
    function ownerOf(uint256 tokenId) external view returns (address);
    function transferFrom(address from, address to, uint256 tokenId) external;
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
    function positions(uint256 tokenId)
        external
        view
        returns (
            uint96 nonce,
            address operator,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            uint256 feeGrowthInside0LastX128,
            uint256 feeGrowthInside1LastX128,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        );
}

interface IRouter {
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
    function unwrapWETH9(uint256 amountMinimum, address recipient) external payable;
    function multicall(uint256 deadline, bytes[] calldata data) external payable returns (bytes[] memory results);
}

/// @dev A replacement locker implementation with a way out. Used to show what the proxy admin can do.
contract LockerThatLetsGo {
    function release(address npm, uint256 tokenId, address to) external {
        INpm(npm).transferFrom(address(this), to, tokenId);
    }
}

/// @dev Stands in for a factory that answers `getCreatorRewards` with whatever wallet it was given.
contract AnyCreatorSource {
    address internal immutable wallet;

    constructor(address wallet_) {
        wallet = wallet_;
    }

    function getCreatorRewards(address) external view returns (address) {
        return wallet;
    }
}

/// @notice The pad (factory), the DEX (Chimi's own v3 factory, position manager, router) and the
///         locker, exercised together. Two full stacks are deployed so both currency orders run:
///         `lo` has WETH at a low address, so every launch token is currency1 (the order both coins
///         on GIWA Sepolia have); `hi` has WETH at a high address, so the token is currency0.
contract ChimiFullTest is Test {
    address internal constant WETH_LOW = address(0x1000);
    address internal constant WETH_HIGH = 0xFFFFFfFfFffffFFfFFffFFFffFfFffFfFFFffFF0;
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 internal constant SUPPLY = 1_000_000_000 ether;
    uint24 internal constant FEE = 10_000;

    struct Stack {
        ChimiStack.Addresses a;
        InstantErc20QuoteFactory factory;
        MonLock locker;
        bool tokenIs0;
    }

    Stack internal lo;
    Stack internal hi;

    address internal treasury = makeAddr("treasury");
    address internal platform = makeAddr("platform");
    address internal staking = makeAddr("staking");
    address internal creator = makeAddr("creator");
    address internal trader = makeAddr("trader");
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        bytes memory wethCode = address(new WETH9()).code;
        vm.etch(WETH_LOW, wethCode);
        vm.etch(WETH_HIGH, wethCode);
        _deploy(lo, WETH_LOW, false);
        _deploy(hi, WETH_HIGH, true);
        vm.deal(creator, 1_000 ether);
        vm.deal(trader, 1_000 ether);
        vm.deal(stranger, 1_000 ether);
    }

    function _deploy(Stack storage s, address weth, bool tokenIs0) internal {
        ChimiStack.DeployParams memory p = ChimiStack.defaultParams(address(this));
        p.weth = weth;
        p.treasury = treasury;
        p.lpRecipient = platform;
        p.stakingPool = staking;
        s.a = ChimiStack.deploy(p);
        s.factory = InstantErc20QuoteFactory(payable(s.a.factory));
        s.locker = MonLock(payable(s.a.locker));
        s.tokenIs0 = tokenIs0;
        IV3Factory(s.a.uniFactory).setOwner(address(0));
    }

    // ─── helpers ──────────────────────────────────────────────────────────────────────────

    function _launch(Stack storage s, address who, uint256 firstBuy)
        internal
        returns (address token, InstantErc20QuoteFactory.InstantQuotePool memory pool)
    {
        uint256 fee = s.factory.creationFeeDue(who);
        vm.prank(who);
        token = s.factory.createTokenMemeInstantQuoteWithEth{value: fee + firstBuy}("Coin", "COIN");
        pool = s.factory.getPool(token);
    }

    function _buy(Stack storage s, address token, address who, uint256 ethIn) internal returns (uint256 out) {
        vm.prank(who);
        out = IRouter(s.a.swapRouter02).exactInputSingle{value: ethIn}(
            IRouter.ExactInputSingleParams(s.a.weth, token, FEE, who, ethIn, 0, 0)
        );
    }

    function _sell(Stack storage s, address token, address who, uint256 amount) internal returns (uint256 out) {
        vm.startPrank(who);
        IERC20(token).approve(s.a.swapRouter02, amount);
        out = IRouter(s.a.swapRouter02).exactInputSingle(
            IRouter.ExactInputSingleParams(token, s.a.weth, FEE, who, amount, 0, 0)
        );
        vm.stopPrank();
    }

    function _sqrt(address pool) internal view returns (uint160 sqrtPriceX96) {
        (sqrtPriceX96,,,,,,) = IV3Pool(pool).slot0();
    }

    function _positionLiquidity(Stack storage s, uint256 id) internal view returns (uint128 liquidity) {
        (,,,,,,, liquidity,,,,) = INpm(s.a.nfpm).positions(id);
    }

    function _adminOf(address proxy) internal view returns (ProxyAdmin) {
        bytes32 slot = bytes32(uint256(keccak256("eip1967.proxy.admin")) - 1);
        return ProxyAdmin(address(uint160(uint256(vm.load(proxy, slot)))));
    }

    /// @dev The token's price can only have moved up from `start` when this holds.
    function _atOrAbove(Stack storage s, uint160 nowSqrt, uint160 startSqrt) internal view returns (bool) {
        return s.tokenIs0 ? nowSqrt >= startSqrt : nowSqrt <= startSqrt;
    }

    // ─── launch ───────────────────────────────────────────────────────────────────────────

    function test_stacks_cover_both_currency_orders() public {
        (address t1, InstantErc20QuoteFactory.InstantQuotePool memory p1) = _launch(lo, creator, 0);
        (address t0, InstantErc20QuoteFactory.InstantQuotePool memory p0) = _launch(hi, creator, 0);
        assertEq(IV3Pool(p1.uniPool).token0(), WETH_LOW, "lo: weth is currency0");
        assertEq(IV3Pool(p0.uniPool).token0(), t0, "hi: token is currency0");
        assertGt(uint160(t1), uint160(WETH_LOW));
        assertLt(uint160(t0), uint160(WETH_HIGH));
    }

    function test_launch_token_is_currency1() public {
        _checkLaunch(lo);
    }

    function test_launch_token_is_currency0() public {
        _checkLaunch(hi);
    }

    function _checkLaunch(Stack storage s) internal {
        (address token, InstantErc20QuoteFactory.InstantQuotePool memory pool) = _launch(s, creator, 0);

        // The whole supply is in the pool. Rounding dust goes to the treasury.
        assertEq(IERC20(token).totalSupply(), SUPPLY);
        uint256 dust = IERC20(token).balanceOf(treasury);
        assertLt(dust, 1e9, "dust");
        assertEq(IERC20(token).balanceOf(pool.uniPool), SUPPLY - dust);
        assertEq(IERC20(token).balanceOf(address(s.factory)), 0);
        assertEq(IERC20(token).balanceOf(creator), 0);
        assertEq(IERC20(s.a.weth).balanceOf(pool.uniPool), 0, "no quote at launch");

        // Registry.
        assertEq(pool.creator, creator);
        assertEq(s.factory.allTokens(s.factory.allTokensLength() - 1), token);
        assertEq(_positionLiquidity(s, pool.positionId), pool.liquidity);
        if (s.tokenIs0) {
            assertEq(pool.tickUpper, int24(887200));
        } else {
            assertEq(pool.tickLower, int24(-887200));
        }

        // The position belongs to the locker and is stamped for 100 years.
        assertEq(INpm(s.a.nfpm).ownerOf(pool.positionId), address(s.locker));
        (address beneficiary, uint64 unlockTime, bool withdrawn, address backingWallet, uint16 backingBps) =
            s.locker.locks(pool.positionId);
        assertEq(beneficiary, platform);
        assertEq(unlockTime, block.timestamp + 100 * 365 days);
        assertFalse(withdrawn);
        assertEq(backingWallet, address(0));
        assertEq(backingBps, 0);

        // Fee routing: launch-token side burns, quote side 70% creator, the rest to the platform.
        assertTrue(s.locker.memeMode(pool.positionId));
        assertEq(s.locker.launchTokens(pool.positionId), token);
        assertEq(s.locker.quoteTokens(pool.positionId), s.a.weth);
        (address creatorWallet, uint16 creatorBps) = s.locker.creatorSplits(pool.positionId);
        assertEq(creatorWallet, creator);
        assertEq(creatorBps, 7000);
        (address stakerWallet, uint16 stakerBps) = s.locker.stakerSplits(pool.positionId);
        assertEq(stakerWallet, staking);
        assertEq(stakerBps, 0);

        // Uniswap's protocol fee is off and nobody can turn it on.
        (,,,,, uint8 feeProtocol,) = IV3Pool(pool.uniPool).slot0();
        assertEq(feeProtocol, 0);
        assertEq(IV3Factory(s.a.uniFactory).owner(), address(0));

        _checkStartPrice(s, pool.uniPool, s.factory.launchVirtualQuote());
    }

    /// @dev Start price sits at the target or up to one tick spacing (2%) below it. Never above
    ///      by more than a single tick (0.01%).
    function _checkStartPrice(Stack storage s, address pool, uint256 virtualQuote) internal view {
        uint256 ideal = PriceMath.sqrtPriceX96(s.tokenIs0, virtualQuote, s.factory.VIRTUAL_TOKEN_INIT());
        uint256 start = _sqrt(pool);
        if (s.tokenIs0) {
            // price = quote per token: lower is cheaper
            assertLe(start, ideal, "token0: at or below target");
            assertGe(start * 10_000, ideal * 9_900, "token0: within one spacing");
        } else {
            // price = token per quote: higher is cheaper
            assertGe(start * 100_000, ideal * 99_995, "token1: at or below target");
            assertLe(start * 10_000, ideal * 10_100, "token1: within one spacing");
        }
    }

    function testFuzz_start_price_token_is_currency1(uint256 virtualQuote) public {
        _fuzzStart(lo, virtualQuote);
    }

    function testFuzz_start_price_token_is_currency0(uint256 virtualQuote) public {
        _fuzzStart(hi, virtualQuote);
    }

    function _fuzzStart(Stack storage s, uint256 virtualQuote) internal {
        // 0.001 ETH to 1,000,000 ETH of opening market cap
        virtualQuote = bound(virtualQuote, 1e15, 1e24);
        s.factory.setLaunchVirtualQuote(virtualQuote);
        (address token, InstantErc20QuoteFactory.InstantQuotePool memory pool) = _launch(s, creator, 0);
        assertEq(IERC20(s.a.weth).balanceOf(pool.uniPool), 0);
        assertLt(IERC20(token).balanceOf(treasury), 1e12);
        _checkStartPrice(s, pool.uniPool, virtualQuote);
        // and it trades from the first block
        assertGt(_buy(s, token, trader, 0.01 ether), 0);
    }

    function test_predicted_address_matches_the_launch() public {
        bytes32 salt = keccak256(
            abi.encode(creator, "Coin", "COIN", lo.factory.allTokensLength(), lo.factory.launchVirtualQuote())
        );
        address predicted = lo.factory.predictTokenAddress(salt, "Coin", "COIN", creator);
        (address token,) = _launch(lo, creator, 0);
        assertEq(token, predicted);
    }

    // ─── trading on the DEX ───────────────────────────────────────────────────────────────

    function test_trade_token_is_currency1() public {
        _checkTrade(lo);
    }

    function test_trade_token_is_currency0() public {
        _checkTrade(hi);
    }

    function _checkTrade(Stack storage s) internal {
        (address token, InstantErc20QuoteFactory.InstantQuotePool memory pool) = _launch(s, creator, 0);
        uint160 start = _sqrt(pool.uniPool);

        uint256 ethIn = 1 ether;
        uint256 bought = _buy(s, token, trader, ethIn);
        assertGt(bought, 0);
        assertEq(IERC20(token).balanceOf(trader), bought);
        assertEq(IERC20(s.a.weth).balanceOf(pool.uniPool), ethIn, "the pool holds what was paid");
        uint160 afterBuy = _sqrt(pool.uniPool);
        assertTrue(_atOrAbove(s, afterBuy, start) && afterBuy != start, "a buy moves the price up");

        // Selling everything back pays 1% on the way in and 1% on the way out.
        uint256 back = _sell(s, token, trader, bought);
        assertGt(back, (ethIn * 9801) / 10_000);
        assertLt(back, (ethIn * 99) / 100);
        assertEq(IERC20(s.a.weth).balanceOf(trader), back);

        // The price never ends below where the coin opened.
        assertTrue(_atOrAbove(s, _sqrt(pool.uniPool), start), "not below the opening price");
        assertEq(_positionLiquidity(s, pool.positionId), pool.liquidity, "launch liquidity untouched");
    }

    // ─── selling for ETH in one transaction (what the site sends) ─────────────────────────

    function test_sell_pays_eth_in_one_transaction_token_is_currency1() public {
        _checkSellForEth(lo);
    }

    function test_sell_pays_eth_in_one_transaction_token_is_currency0() public {
        _checkSellForEth(hi);
    }

    /// @dev The swap is addressed to the router (address 2 means "this contract" to SwapRouter02),
    ///      which unwraps the pool's WETH and pays the seller in ETH.
    function _sellForEthCalls(Stack storage s, address token, address who, uint256 amount, uint256 minOut)
        internal
        view
        returns (bytes[] memory calls)
    {
        calls = new bytes[](2);
        calls[0] = abi.encodeCall(
            IRouter.exactInputSingle,
            (IRouter.ExactInputSingleParams(token, s.a.weth, FEE, address(2), amount, minOut, 0))
        );
        calls[1] = abi.encodeCall(IRouter.unwrapWETH9, (minOut, who));
    }

    function _checkSellForEth(Stack storage s) internal {
        (address token, InstantErc20QuoteFactory.InstantQuotePool memory pool) = _launch(s, creator, 0);
        IRouter router = IRouter(s.a.swapRouter02);
        uint256 bought = _buy(s, token, trader, 1 ether);
        uint256 ethBefore = trader.balance;

        vm.recordLogs();
        vm.startPrank(trader);
        IERC20(token).approve(address(router), bought);
        router.multicall(block.timestamp + 1200, _sellForEthCalls(s, token, trader, bought, 0.98 ether));
        vm.stopPrank();

        uint256 got = trader.balance - ethBefore;
        assertGt(got, 0.98 ether);
        assertLt(got, 0.99 ether);
        assertEq(IERC20(token).balanceOf(trader), 0);
        assertEq(IERC20(s.a.weth).balanceOf(trader), 0, "nothing left wrapped with the seller");
        assertEq(IERC20(s.a.weth).balanceOf(address(router)), 0, "nothing left in the router");
        assertEq(address(router).balance, 0);
        assertEq(IERC20(token).allowance(trader, address(router)), 0);

        // The pool's Swap log names the router on both sides. The coin's Transfer into the pool, in
        // the same transaction and for the same amount, names the seller. The site reads the seller there.
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool sawSwap;
        bool sawSeller;
        for (uint256 i; i < logs.length; i++) {
            bytes32 topic = logs[i].topics[0];
            if (
                logs[i].emitter == pool.uniPool
                    && topic == keccak256("Swap(address,address,int256,int256,uint160,uint128,int24)")
            ) {
                assertEq(address(uint160(uint256(logs[i].topics[1]))), address(router), "sender");
                assertEq(address(uint160(uint256(logs[i].topics[2]))), address(router), "recipient");
                sawSwap = true;
            }
            if (
                logs[i].emitter == token && topic == keccak256("Transfer(address,address,uint256)")
                    && address(uint160(uint256(logs[i].topics[2]))) == pool.uniPool
            ) {
                assertEq(address(uint160(uint256(logs[i].topics[1]))), trader, "seller");
                assertEq(abi.decode(logs[i].data, (uint256)), bought);
                sawSeller = true;
            }
        }
        assertTrue(sawSwap && sawSeller);
    }

    function test_sell_for_eth_is_all_or_nothing() public {
        (address token,) = _launch(lo, creator, 0);
        IRouter router = IRouter(lo.a.swapRouter02);
        uint256 bought = _buy(lo, token, trader, 1 ether);
        uint256 ethBefore = trader.balance;

        vm.startPrank(trader);
        IERC20(token).approve(address(router), bought);

        // asking for more than the pool will pay
        bytes[] memory greedy = _sellForEthCalls(lo, token, trader, bought, 1 ether);
        vm.expectRevert(bytes("Too little received"));
        router.multicall(block.timestamp + 1200, greedy);

        // a sale that arrives after its deadline
        bytes[] memory late = _sellForEthCalls(lo, token, trader, bought, 0.98 ether);
        vm.expectRevert(bytes("Transaction too old"));
        router.multicall(block.timestamp - 1, late);
        vm.stopPrank();

        assertEq(IERC20(token).balanceOf(trader), bought, "the coins never left");
        assertEq(trader.balance, ethBefore);
    }

    // ─── fees ─────────────────────────────────────────────────────────────────────────────

    function test_fees_token_is_currency1() public {
        _checkFees(lo);
    }

    function test_fees_token_is_currency0() public {
        _checkFees(hi);
    }

    function _checkFees(Stack storage s) internal {
        (address token, InstantErc20QuoteFactory.InstantQuotePool memory pool) = _launch(s, creator, 0);
        IERC20 weth = IERC20(s.a.weth);

        uint256 ethIn = 1 ether;
        uint256 bought = _buy(s, token, trader, ethIn);
        _sell(s, token, trader, bought);

        // Anyone can trigger the sweep. The money still goes where the lock says.
        vm.prank(stranger);
        (uint256 a0, uint256 a1) = s.locker.collectFees(pool.positionId);
        (uint256 wethFee, uint256 tokenFee) = s.tokenIs0 ? (a1, a0) : (a0, a1);

        assertApproxEqAbs(wethFee, ethIn / 100, 10, "1% of the buy");
        assertApproxEqAbs(tokenFee, bought / 100, 1e6, "1% of the sell");

        uint256 creatorCut = (wethFee * 7000) / 10_000;
        assertEq(weth.balanceOf(creator), creatorCut, "creator gets 70%");
        assertEq(weth.balanceOf(platform), wethFee - creatorCut, "platform gets the rest");
        assertEq(weth.balanceOf(staking), 0);
        assertEq(staking.balance, 0);
        assertEq(weth.balanceOf(stranger), 0);
        assertEq(IERC20(token).balanceOf(DEAD), tokenFee, "launch-token fees burn");
        assertEq(weth.balanceOf(address(s.locker)), 0);
        assertEq(IERC20(token).balanceOf(address(s.locker)), 0);

        // Fees only. The position keeps all of its liquidity.
        assertEq(_positionLiquidity(s, pool.positionId), pool.liquidity);
        assertEq(INpm(s.a.nfpm).ownerOf(pool.positionId), address(s.locker));

        // Nothing is left to sweep a second time.
        (a0, a1) = s.locker.collectFees(pool.positionId);
        assertEq(a0, 0);
        assertEq(a1, 0);
        assertEq(weth.balanceOf(creator), creatorCut);
    }

    function test_fees_batch_sweep() public {
        (address tokenA, InstantErc20QuoteFactory.InstantQuotePool memory a) = _launch(lo, creator, 0);
        (address tokenB, InstantErc20QuoteFactory.InstantQuotePool memory b) = _launch(lo, stranger, 0);
        _buy(lo, tokenA, trader, 1 ether);
        _buy(lo, tokenB, trader, 2 ether);

        uint256[] memory ids = new uint256[](2);
        ids[0] = a.positionId;
        ids[1] = b.positionId;
        lo.locker.collectFeesBatch(ids);

        IERC20 weth = IERC20(lo.a.weth);
        assertApproxEqAbs(weth.balanceOf(creator), 0.007 ether, 10);
        assertApproxEqAbs(weth.balanceOf(stranger), 0.014 ether, 10);
        assertApproxEqAbs(weth.balanceOf(platform), 0.009 ether, 10);
    }

    function test_fee_share_follows_the_bps_source_for_new_launches_only() public {
        (address tokenA, InstantErc20QuoteFactory.InstantQuotePool memory a) = _launch(lo, creator, 0);
        // owner moves the default to 50%
        (bool ok,) = lo.a.bpsSource.call(abi.encodeWithSignature("setMemeBps(uint16,uint16)", 5000, 0));
        assertTrue(ok);
        (, InstantErc20QuoteFactory.InstantQuotePool memory b) = _launch(lo, stranger, 0);

        (, uint16 bpsA) = lo.locker.creatorSplits(a.positionId);
        (, uint16 bpsB) = lo.locker.creatorSplits(b.positionId);
        assertEq(bpsA, 7000, "an existing launch keeps its share");
        assertEq(bpsB, 5000);
        tokenA;
    }

    // ─── the lock ─────────────────────────────────────────────────────────────────────────

    function test_lock_holds_until_the_term_ends() public {
        (, InstantErc20QuoteFactory.InstantQuotePool memory pool) = _launch(lo, creator, 0);
        uint256 id = pool.positionId;
        INpm npm = INpm(lo.a.nfpm);
        (, uint64 unlockTime,,,) = lo.locker.locks(id);

        // Nobody can take the position out early: not the platform, not the owner, not the creator.
        vm.prank(platform);
        vm.expectRevert(MonLock.StillLocked.selector);
        lo.locker.withdraw(id);

        vm.expectRevert(MonLock.NotBeneficiary.selector);
        lo.locker.withdraw(id);

        vm.prank(creator);
        vm.expectRevert(MonLock.NotBeneficiary.selector);
        lo.locker.withdraw(id);

        vm.prank(platform);
        vm.expectRevert();
        npm.transferFrom(address(lo.locker), platform, id);

        vm.prank(platform);
        vm.expectRevert();
        npm.decreaseLiquidity(INpm.DecreaseLiquidityParams(id, pool.liquidity, 0, 0, block.timestamp));

        // The term only moves out.
        vm.prank(platform);
        vm.expectRevert(MonLock.MustExtend.selector);
        lo.locker.extendLock(id, unlockTime - 1);

        vm.prank(stranger);
        vm.expectRevert(MonLock.NotBeneficiary.selector);
        lo.locker.extendLock(id, unlockTime + 1);

        // New defaults shape future locks only, and can't go under 30 days.
        vm.expectRevert(MonLock.DurationTooShort.selector);
        lo.locker.setDefaults(platform, 29 days);
        lo.locker.setDefaults(stranger, 30 days);
        (address beneficiary, uint64 sameUnlock,,,) = lo.locker.locks(id);
        assertEq(beneficiary, platform);
        assertEq(sameUnlock, unlockTime);

        // One second before the end it is still locked. At the end the platform can take it.
        vm.warp(unlockTime - 1);
        vm.prank(platform);
        vm.expectRevert(MonLock.StillLocked.selector);
        lo.locker.withdraw(id);

        vm.warp(unlockTime);
        vm.prank(platform);
        lo.locker.withdraw(id);
        assertEq(npm.ownerOf(id), platform);

        vm.expectRevert(MonLock.AlreadyWithdrawn.selector);
        lo.locker.collectFees(id);
    }

    function test_lock_only_the_factory_can_stamp_a_split() public {
        (address token, InstantErc20QuoteFactory.InstantQuotePool memory pool) = _launch(lo, creator, 0);

        vm.startPrank(stranger);
        vm.expectRevert(MonLock.NotStamper.selector);
        lo.locker.lockPositionMeme(pool.positionId, token, lo.a.weth, stranger, 0, stranger, 10_000);
        vm.expectRevert(MonLock.NotStamper.selector);
        lo.locker.lockPositionWithBacking(pool.positionId, stranger, 10_000);
        vm.expectRevert(MonLock.NotStamper.selector);
        lo.locker.lockPositionWithSplit(pool.positionId, stranger, 5000, stranger, 5000);
        vm.expectRevert(MonLock.AlreadyLocked.selector);
        lo.locker.lockPosition(pool.positionId);
        vm.expectRevert(MonLock.NotOwner.selector);
        lo.locker.setStamper(stranger);
        vm.expectRevert(MonLock.NotOwner.selector);
        lo.locker.setFactory(stranger);
        vm.expectRevert(MonLock.NotOwner.selector);
        lo.locker.setDefaults(stranger, 365 days);
        vm.expectRevert(MonLock.NotOwner.selector);
        lo.locker.retargetFeeRecipients(pool.positionId, stranger, stranger);
        vm.expectRevert(MonLock.NotOwner.selector);
        lo.locker.transferOwnership(stranger);
        vm.stopPrank();
    }

    function test_proxies_cannot_be_initialized_twice() public {
        vm.expectRevert(bytes("initialized"));
        InstantErc20QuoteFactoryProxyInit(payable(lo.a.factory)).initialize(stranger, stranger, stranger, stranger, 1);
        vm.expectRevert(bytes("initialized"));
        MonLockProxyInit(payable(lo.a.locker)).initialize(stranger, stranger, 365 days);
    }

    // ─── creation paths and the creation fee ──────────────────────────────────────────────

    function test_creation_fee_and_eth_first_buy() public {
        lo.factory.setCreationFee(0.01 ether);
        assertEq(lo.factory.creationFeeDue(creator), 0.01 ether);
        assertEq(lo.factory.creationFeeDue(address(this)), 0, "the owner launches free");

        vm.prank(creator);
        vm.expectRevert(bytes("fee"));
        lo.factory.createTokenMemeInstantQuoteWithEth{value: 0.009 ether}("Coin", "COIN");

        uint256 before = creator.balance;
        vm.prank(creator);
        address token = lo.factory.createTokenMemeInstantQuoteWithEth{value: 0.06 ether}("Coin", "COIN");
        assertEq(treasury.balance, 0.01 ether, "fee to the treasury");
        assertEq(before - creator.balance, 0.06 ether);
        assertGt(IERC20(token).balanceOf(creator), 0, "the rest was the first buy");
        assertEq(IERC20(lo.a.weth).balanceOf(lo.factory.getPool(token).uniPool), 0.05 ether);
        assertEq(address(lo.factory).balance, 0);
        assertEq(IERC20(lo.a.weth).balanceOf(address(lo.factory)), 0);

        // the owner pays nothing
        address free = lo.factory.createTokenMemeInstantQuoteWithEth("Free", "FREE");
        assertEq(lo.factory.getPool(free).creator, address(this));
        assertEq(treasury.balance, 0.01 ether);
    }

    function test_first_buy_paid_in_weth_refunds_spare_eth() public {
        lo.factory.setCreationFee(0.01 ether);
        vm.startPrank(creator);
        WETH9(payable(lo.a.weth)).deposit{value: 0.05 ether}();
        IERC20(lo.a.weth).approve(address(lo.factory), 0.05 ether);
        uint256 before = creator.balance;
        address token = lo.factory.createTokenMemeInstantQuote{value: 0.5 ether}("Coin", "COIN", 0.05 ether);
        vm.stopPrank();

        assertEq(before - creator.balance, 0.01 ether, "only the fee is kept");
        assertEq(IERC20(lo.a.weth).balanceOf(creator), 0);
        assertGt(IERC20(token).balanceOf(creator), 0);
        assertEq(address(lo.factory).balance, 0);
    }

    function test_creator_rewards_can_be_sent_to_another_wallet() public {
        vm.prank(creator);
        address token = lo.factory.createTokenMemeInstantQuoteTo("Coin", "COIN", 0, stranger);
        InstantErc20QuoteFactory.InstantQuotePool memory pool = lo.factory.getPool(token);
        assertEq(pool.creator, creator, "the launch is still the sender's");
        (address wallet,) = lo.locker.creatorSplits(pool.positionId);
        assertEq(wallet, stranger);

        _buy(lo, token, trader, 1 ether);
        lo.locker.collectFees(pool.positionId);
        assertApproxEqAbs(IERC20(lo.a.weth).balanceOf(stranger), 0.007 ether, 10);
        assertEq(IERC20(lo.a.weth).balanceOf(creator), 0);
    }

    function test_owner_only_settings() public {
        vm.startPrank(stranger);
        bytes memory denied = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger);
        vm.expectRevert(denied);
        lo.factory.setTreasury(stranger);
        vm.expectRevert(denied);
        lo.factory.setStakingPool(stranger);
        vm.expectRevert(denied);
        lo.factory.setBpsSource(stranger);
        vm.expectRevert(denied);
        lo.factory.setLaunchVirtualQuote(1);
        vm.expectRevert(denied);
        lo.factory.setCreationFee(1);
        vm.expectRevert(denied);
        lo.factory.setUniV3Config(stranger, FEE, 200, stranger, stranger);
        vm.expectRevert(denied);
        lo.factory.setQuoteAcquisitionFee(500);
        vm.expectRevert(denied);
        lo.factory.setLaunchLimits(0, 0);
        vm.stopPrank();

        // launch limits exist in the interface only
        vm.expectRevert(bytes("InstantQuote: anti-snipe disabled"));
        lo.factory.setLaunchLimits(100, 0);
    }

    function test_unwired_factory_refuses_to_launch() public {
        ChimiStack.DeployParams memory p = ChimiStack.defaultParams(address(this));
        p.weth = WETH_LOW;
        p.wireOwner = false;
        ChimiStack.Addresses memory a = ChimiStack.deploy(p);
        vm.prank(creator);
        vm.expectRevert(bytes("unwired"));
        InstantErc20QuoteFactory(payable(a.factory)).createTokenMemeInstantQuoteWithEth("Coin", "COIN");
    }

    // ─── pools: anyone can add liquidity beside the locked position ───────────────────────

    function test_pools_outside_liquidity_earns_and_leaves() public {
        (address token, InstantErc20QuoteFactory.InstantQuotePool memory pool) = _launch(lo, creator, 0);
        INpm npm = INpm(lo.a.nfpm);
        IERC20 weth = IERC20(lo.a.weth);
        uint256 tokens = _buy(lo, token, stranger, 2 ether);

        // full-range position: WETH is currency0 on this stack
        vm.startPrank(stranger);
        WETH9(payable(lo.a.weth)).deposit{value: 1 ether}();
        weth.approve(address(npm), 1 ether);
        IERC20(token).approve(address(npm), tokens);
        (uint256 id, uint128 liquidity, uint256 used0, uint256 used1) = npm.mint(
            INpm.MintParams(lo.a.weth, token, FEE, -887200, 887200, 1 ether, tokens, 0, 0, stranger, block.timestamp)
        );
        vm.stopPrank();
        assertEq(npm.ownerOf(id), stranger);
        assertGt(liquidity, 0);

        // trades now pay both positions
        uint256 bought = _buy(lo, token, trader, 1 ether);
        _sell(lo, token, trader, bought);

        vm.startPrank(stranger);
        npm.decreaseLiquidity(INpm.DecreaseLiquidityParams(id, liquidity, 0, 0, block.timestamp));
        (uint256 out0, uint256 out1) =
            npm.collect(INpm.CollectParams(id, stranger, type(uint128).max, type(uint128).max));
        vm.stopPrank();
        // After a full round trip the 1% of tokens kept as fee is exactly what the curve is short,
        // so the token side comes back whole and the gain shows up in WETH.
        assertGt(out0, used0 + 0.001 ether, "principal back plus WETH fees");
        assertApproxEqAbs(out1, used1, 10, "token side comes back whole");

        // the locked position is where it was, and earned less than the full 1%
        assertEq(npm.ownerOf(pool.positionId), address(lo.locker));
        assertEq(_positionLiquidity(lo, pool.positionId), pool.liquidity);
        (uint256 a0,) = lo.locker.collectFees(pool.positionId);
        // 2 ETH was bought before the outside position existed (0.02 in fees), then 1 ETH was shared
        assertGt(a0, 0.02 ether);
        assertLt(a0, 0.03 ether - 1e12, "the launch position shares the fee with outside liquidity");
    }

    function test_pools_position_sent_to_the_locker_is_locked_for_the_platform() public {
        (address token,) = _launch(lo, creator, 0);
        INpm npm = INpm(lo.a.nfpm);
        uint256 tokens = _buy(lo, token, stranger, 1 ether);
        vm.startPrank(stranger);
        IERC20(token).approve(address(npm), tokens);
        // a token-only range: on this stack the token is currency1, so it sits below the current tick
        (, int24 tick,,,,,) = IV3Pool(lo.factory.getPool(token).uniPool).slot0();
        int24 upper = ((tick / 200) - 1) * 200;
        (uint256 id,,,) = npm.mint(
            INpm.MintParams(lo.a.weth, token, FEE, upper - 200, upper, 0, tokens, 0, 0, stranger, block.timestamp)
        );
        npm.safeTransferFrom(stranger, address(lo.locker), id);
        vm.stopPrank();

        (address beneficiary, uint64 unlockTime,,,) = lo.locker.locks(id);
        assertEq(beneficiary, platform, "a position sent in by hand belongs to the platform");
        assertEq(unlockTime, block.timestamp + 100 * 365 days);
    }

    // ─── what the contracts allow today (described, not endorsed) ─────────────────────────

    /// @dev There is no cap on the creator's first buy and no launch window. One transaction can
    ///      open a coin and take most of its supply at the opening price.
    function test_gap_first_buy_has_no_cap() public {
        (address token,) = _launch(lo, creator, 5 ether);
        assertGt(IERC20(token).balanceOf(creator), (SUPPLY * 80) / 100, "5 ETH takes over 80% of the supply");
    }

    /// @dev The locker sits behind an upgradeable proxy. Whoever owns its admin can swap the code
    ///      and move every locked position out, so the 100-year lock rests on that one key.
    function test_gap_proxy_admin_can_replace_the_locker_and_take_the_liquidity() public {
        (address token, InstantErc20QuoteFactory.InstantQuotePool memory pool) = _launch(lo, creator, 0);
        INpm npm = INpm(lo.a.nfpm);
        ProxyAdmin admin = _adminOf(lo.a.locker);
        assertEq(admin.owner(), address(this));

        admin.upgradeAndCall(ITransparentUpgradeableProxy(lo.a.locker), address(new LockerThatLetsGo()), "");
        LockerThatLetsGo(lo.a.locker).release(lo.a.nfpm, pool.positionId, stranger);
        assertEq(npm.ownerOf(pool.positionId), stranger);

        vm.startPrank(stranger);
        npm.decreaseLiquidity(INpm.DecreaseLiquidityParams(pool.positionId, pool.liquidity, 0, 0, block.timestamp));
        npm.collect(INpm.CollectParams(pool.positionId, stranger, type(uint128).max, type(uint128).max));
        vm.stopPrank();
        assertGt(IERC20(token).balanceOf(stranger), (SUPPLY * 999) / 1000, "the whole supply left the pool");
    }

    /// @dev Giving up the admin's ownership closes that door for good.
    function test_gap_closed_once_the_proxy_admin_is_renounced() public {
        _launch(lo, creator, 0);
        ProxyAdmin admin = _adminOf(lo.a.locker);
        address evil = address(new LockerThatLetsGo());
        admin.renounceOwnership();
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        admin.upgradeAndCall(ITransparentUpgradeableProxy(lo.a.locker), evil, "");
    }

    /// @dev `syncCreatorSplit` copies the creator wallet from whatever the locker calls its factory.
    ///      Chimi never sets one (the call reverts today), but the locker's owner can point it at
    ///      any contract and move a creator's 70% to another wallet.
    function test_gap_locker_owner_can_redirect_the_creator_share() public {
        (address token, InstantErc20QuoteFactory.InstantQuotePool memory pool) = _launch(lo, creator, 0);

        vm.expectRevert();
        lo.locker.syncCreatorSplit(pool.positionId);

        lo.locker.setFactory(address(new AnyCreatorSource(stranger)));
        vm.prank(stranger);
        lo.locker.syncCreatorSplit(pool.positionId);

        _buy(lo, token, trader, 1 ether);
        lo.locker.collectFees(pool.positionId);
        assertEq(IERC20(lo.a.weth).balanceOf(creator), 0);
        assertApproxEqAbs(IERC20(lo.a.weth).balanceOf(stranger), 0.007 ether, 10);
    }

    /// @dev v3 lets anyone open a pool for an address that has no token yet. Opened inside the
    ///      launch range, it makes that exact launch revert. It needs the pending transaction to be
    ///      visible first, and a retry under another name goes through.
    function test_gap_pool_opened_ahead_of_a_launch_blocks_it() public {
        bytes32 salt = keccak256(
            abi.encode(creator, "Coin", "COIN", lo.factory.allTokensLength(), lo.factory.launchVirtualQuote())
        );
        address predicted = lo.factory.predictTokenAddress(salt, "Coin", "COIN", creator);

        vm.startPrank(stranger);
        address pool = IV3Factory(lo.a.uniFactory).createPool(predicted, WETH_LOW, FEE);
        IV3Pool(pool).initialize(TickMath.getSqrtPriceAtTick(0));
        vm.stopPrank();

        vm.prank(creator);
        vm.expectRevert();
        lo.factory.createTokenMemeInstantQuoteWithEth("Coin", "COIN");

        vm.prank(creator);
        address token = lo.factory.createTokenMemeInstantQuoteWithEth("Coin 2", "COIN");
        assertTrue(token != predicted);
        assertEq(INpm(lo.a.nfpm).ownerOf(lo.factory.getPool(token).positionId), address(lo.locker));
    }

    /// @dev Opened outside the launch range, the same trick changes nothing: there is no liquidity
    ///      at the fake price, so the first buyer pays exactly what they would have paid anyway.
    function test_pool_opened_ahead_outside_the_range_gives_no_cheap_tokens() public {
        uint256 snap = vm.snapshotState();
        (address token,) = _launch(lo, creator, 0);
        uint256 honest = _buy(lo, token, trader, 0.1 ether);
        vm.revertToState(snap);

        bytes32 salt = keccak256(
            abi.encode(creator, "Coin", "COIN", lo.factory.allTokensLength(), lo.factory.launchVirtualQuote())
        );
        address predicted = lo.factory.predictTokenAddress(salt, "Coin", "COIN", creator);
        vm.startPrank(stranger);
        address pool = IV3Factory(lo.a.uniFactory).createPool(predicted, WETH_LOW, FEE);
        // token per WETH far above the range: the coin looks almost free
        IV3Pool(pool).initialize(TickMath.getSqrtPriceAtTick(800_000));
        vm.stopPrank();

        (address same,) = _launch(lo, creator, 0);
        assertEq(same, predicted);
        assertEq(_buy(lo, same, trader, 0.1 ether), honest);
    }
}
