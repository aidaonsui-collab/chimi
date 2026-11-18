// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ChimiV4Deployer} from "../script/ChimiV4Deployer.sol";
import {ChimiV4Launcher} from "../src/v4/ChimiV4Launcher.sol";
import {ChimiV4Locker} from "../src/v4/ChimiV4Locker.sol";
import {ChimiV4Token} from "../src/v4/ChimiV4Token.sol";

/// @notice Deploys the v4 stack on a fork of GIWA Sepolia and launches, trades and claims. Nothing is broadcast.
///         Skipped unless GIWA_RPC is set, so `forge test` needs no network.
///
///         GIWA_RPC=https://sepolia-rpc.giwa.io forge test --match-contract ChimiV4ForkTest
contract ChimiV4ForkTest is Test, ChimiV4Deployer {
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal constant CREATE2 = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address internal constant WETH = 0x4200000000000000000000000000000000000006;
    /// @dev Uniswap's published PoolManager addresses. None of these chains is GIWA; all are empty there.
    address internal constant PM_ETHEREUM = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address internal constant PM_SEPOLIA = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address internal constant PM_BASE_SEPOLIA = 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408;
    address internal constant STATEVIEW_ETHEREUM = 0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227;
    address internal constant POSM_ETHEREUM = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;
    address internal constant UR_ETHEREUM = 0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af;

    bool internal live;
    V4Deployment internal d;
    address internal creator = makeAddr("fork-creator");
    address internal trader = makeAddr("fork-trader");
    address internal treasury = makeAddr("fork-treasury");

    function setUp() public {
        string memory rpc = vm.envOr("GIWA_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        assertEq(block.chainid, 91342);
        live = true;
    }

    modifier onlyFork() {
        if (!live) vm.skip(true);
        _;
    }

    function test_officialV4CoreIsNotOnGiwa() public onlyFork {
        assertGt(PERMIT2.code.length, 0, "Permit2 is a GIWA preinstall");
        assertGt(CREATE2.code.length, 0, "Arachnid CREATE2 deployer is a GIWA preinstall");
        assertGt(WETH.code.length, 0, "WETH is a GIWA preinstall");
        assertEq(PM_ETHEREUM.code.length, 0, "Ethereum PoolManager");
        assertEq(PM_SEPOLIA.code.length, 0, "Sepolia PoolManager");
        assertEq(PM_BASE_SEPOLIA.code.length, 0, "Base Sepolia PoolManager");
        assertEq(STATEVIEW_ETHEREUM.code.length, 0, "Ethereum StateView");
        assertEq(POSM_ETHEREUM.code.length, 0, "Ethereum PositionManager");
        assertEq(UR_ETHEREUM.code.length, 0, "Ethereum Universal Router");
    }

    function test_launchTradeClaimAndLockOnGiwaFork() public onlyFork {
        d = _deployChimiV4(address(this), treasury, treasury, address(0), address(this), 100 * 365 days, address(0));
        d.launcher.setStartMarketCap(30 ether);
        assertEq(uint160(address(d.hook)) & 0x3fff, HOOK_FLAGS, "hook address carries its permissions");

        vm.deal(creator, 10 ether);
        vm.deal(trader, 10 ether);
        vm.prank(creator);
        (address token, uint256 first) = d.launcher.launch{value: 0.5 ether}(
            ChimiV4Launcher.LaunchParams({
                name: "Fork Ridge",
                symbol: "RIDGE",
                minTokensOut: 0,
                buyTaxBps: 500,
                sellTaxBps: 500,
                creatorBps: 10_000,
                holdersBps: 0,
                buybackBps: 0,
                antiSnipe: false
            })
        );
        ChimiV4Token t = ChimiV4Token(token);
        assertEq(t.balanceOf(creator), first);
        assertEq(d.launcher.getLaunch(token).creator, creator);
        assertGt(d.launcher.getLaunch(token).unlocksAt, uint64(block.timestamp + 99 * 365 days));

        vm.prank(trader);
        uint256 bought = d.router.buy{value: 1 ether}(token, d.router.quoteBuy(token, 1 ether), trader, block.timestamp);
        vm.startPrank(trader);
        t.approve(address(d.router), bought);
        uint256 ethOut = d.router.sell(token, bought, 0, trader, block.timestamp);
        vm.stopPrank();
        assertGt(ethOut, 0.8 ether, "round trip pays two 5% taxes and some price impact");

        uint256 owed = d.hook.creatorFees(creator);
        uint256 before = creator.balance;
        vm.prank(creator);
        d.hook.claimCreatorFees();
        assertEq(creator.balance - before, owed);
        d.hook.claimProtocolFees();
        assertGt(treasury.balance, 0);

        vm.expectRevert(ChimiV4Locker.StillLocked.selector);
        d.launcher.locker().withdraw(token);
    }
}
