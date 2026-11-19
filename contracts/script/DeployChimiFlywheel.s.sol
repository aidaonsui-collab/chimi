// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ChimiDexV2} from "./ChimiDexV2.sol";

interface IOwned {
    function owner() external view returns (address);
}

interface IV3PoolInfo {
    function fee() external view returns (uint24);
    function factory() external view returns (address);
}

interface IPadInfo {
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

/// @notice The second DEX and the fee flywheel, on the live Chimi pad on GIWA Sepolia (chain 91342).
///         Deploys a 2%/3% copy of Uniswap v3 with its position manager, router and locker, and the flywheel;
///         points new launches at it (70% creator / 15% flywheel / 15% platform, 2% pools); gives up the new
///         DEX's owner; and adds the new addresses to web/public/deployments.json. Coins already launched are
///         not touched.
///
///         Run from contracts/, signed by the pad's owner:
///           KEEPER=0x… PRIVATE_KEY=0x… forge script script/DeployChimiFlywheel.s.sol \
///             --rpc-url https://sepolia-rpc.giwa.io --broadcast
///         Without PRIVATE_KEY it broadcasts as `--sender` (for a fork with `--unlocked`).
///
///         Required env: KEEPER (the address the daily keeper sends from).
///         Optional: CHIMI (default: the live $CHIMI), LOCK_DURATION (seconds, default 100 years).
contract DeployChimiFlywheel is Script {
    uint256 internal constant CHAIN_GIWA_SEPOLIA = 91342;
    address internal constant LIVE_CHIMI = 0xceF368d0509602704799bd80BcC33AeF352b9667;
    string internal constant DEPLOYMENTS = "./../web/public/deployments.json";

    function run() external {
        require(block.chainid == CHAIN_GIWA_SEPOLIA, "chain");
        string memory json = vm.readFile(DEPLOYMENTS);
        address weth = vm.parseJsonAddress(json, ".weth");
        address pad = vm.parseJsonAddress(json, ".factory");
        address bpsSource = vm.parseJsonAddress(json, ".bpsSource");
        address oldFactory = vm.parseJsonAddress(json, ".uniFactory");
        address oldNfpm = vm.parseJsonAddress(json, ".positionManager");
        address oldRouter = vm.parseJsonAddress(json, ".swapRouter");
        address oldLocker = vm.parseJsonAddress(json, ".locker");

        address keeper = vm.envAddress("KEEPER");
        address chimi = vm.envOr("CHIMI", LIVE_CHIMI);
        uint64 lockDuration = uint64(vm.envOr("LOCK_DURATION", uint256(100 * 365 days)));

        uint256 pk = vm.envOr("PRIVATE_KEY", uint256(0));
        address sender = pk == 0 ? msg.sender : vm.addr(pk);

        // Checks before anything is sent: the signer owns the pad and the fee settings, and CHIMI's pool is
        // the 1% pool on the first DEX that the flywheel will buy in.
        require(IOwned(pad).owner() == sender, "signer doesn't own the pad");
        require(IOwned(bpsSource).owner() == sender, "signer doesn't own the fee settings");
        IPadInfo.InstantQuotePool memory chimiPool = IPadInfo(pad).getPool(chimi);
        require(chimiPool.uniPool != address(0), "CHIMI isn't a Chimi coin");
        require(IV3PoolInfo(chimiPool.uniPool).factory() == oldFactory, "CHIMI isn't on the first DEX");
        uint24 chimiFee = IV3PoolInfo(chimiPool.uniPool).fee();
        require(chimiFee == 10_000, "CHIMI's pool isn't 1%");
        require(keeper != address(0), "KEEPER");

        if (pk == 0) vm.startBroadcast();
        else vm.startBroadcast(pk);
        ChimiDexV2.Addresses memory a = ChimiDexV2.deploy(
            ChimiDexV2.Params({
                owner: sender,
                platform: sender,
                weth: weth,
                lockDuration: lockDuration,
                chimi: chimi,
                chimiRouter: oldRouter,
                chimiPoolFee: chimiFee,
                keeper: keeper
            })
        );
        ChimiDexV2.wire(a, pad, bpsSource);
        ChimiDexV2.renounce(a);
        vm.stopBroadcast();

        console2.log("uniFactory (2%/3%)", a.uniFactory);
        console2.log("positionManager", a.nfpm);
        console2.log("swapRouter", a.swapRouter02);
        console2.log("locker", a.locker);
        console2.log("lockerImpl", a.lockerImpl);
        console2.log("flywheel", a.flywheel);
        console2.log("keeper", keeper);

        string memory out = string.concat(
            "{\n",
            '  "chainId": 91342,\n',
            '  "name": "Chimi",\n',
            _field("weth", weth),
            _field("uniFactory", oldFactory),
            _field("positionManager", oldNfpm),
            _field("swapRouter", oldRouter),
            _field("bpsSource", bpsSource),
            _field("locker", oldLocker),
            _field("factory", pad),
            '  "dexes": [\n',
            _dex(10_000, 200, oldFactory, oldNfpm, oldRouter, oldLocker, false),
            _dex(ChimiDexV2.POOL_FEE, ChimiDexV2.TICK_SPACING, a.uniFactory, a.nfpm, a.swapRouter02, a.locker, true),
            "  ],\n",
            '  "flywheel": {\n',
            '    "address": "',
            vm.toString(a.flywheel),
            '",\n',
            '    "chimi": "',
            vm.toString(chimi),
            '",\n',
            '    "keeper": "',
            vm.toString(keeper),
            '",\n',
            '    "minHold": "10000"\n',
            "  }\n",
            "}\n"
        );
        vm.writeFile(DEPLOYMENTS, out);
    }

    function _field(string memory key, address value) internal pure returns (string memory) {
        return string.concat('  "', key, '": "', vm.toString(value), '",\n');
    }

    function _dex(
        uint24 fee,
        int24 tickSpacing,
        address uniFactory,
        address nfpm,
        address router,
        address locker,
        bool last
    ) internal pure returns (string memory) {
        return string.concat(
            '    { "fee": ',
            vm.toString(uint256(fee)),
            ', "tickSpacing": ',
            vm.toString(int256(tickSpacing)),
            ', "uniFactory": "',
            vm.toString(uniFactory),
            '", "positionManager": "',
            vm.toString(nfpm),
            '", "swapRouter": "',
            vm.toString(router),
            '", "locker": "',
            vm.toString(locker),
            last ? '" }\n' : '" },\n'
        );
    }
}
