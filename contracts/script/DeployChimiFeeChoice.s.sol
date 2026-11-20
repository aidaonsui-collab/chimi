// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ChimiFeeChoice} from "./ChimiFeeChoice.sol";
import {ChimiPadV2} from "../src/ChimiPadV2.sol";
import {ChimiBurner} from "../src/ChimiBurner.sol";
import {ArcBpsSource} from "../src/ArcBpsSource.sol";

interface IOwnedFC {
    function owner() external view returns (address);
}

interface IV3PoolInfoFC {
    function fee() external view returns (uint24);
    function factory() external view returns (address);
}

interface IPadInfoFC {
    struct InstantQuotePool {
        address creator;
        address uniPool;
        uint256 positionId;
        uint128 liquidity;
        int24 tickLower;
        int24 tickUpper;
    }

    function getPool(address token) external view returns (InstantQuotePool memory);
    function allTokensLength() external view returns (uint256);
    function stakingPool() external view returns (address);
}

/// @notice The launch fee choice, on the live Chimi pad on GIWA Sepolia (chain 91342). Deploys the ChimiBurner (the 5%
///         CHIMI burn every new coin pays, and each burning coin's own burner) and the pad's new implementation; sets
///         the two splits (80/5/15, and 70/10/5/15 for a coin that burns itself); upgrades the pad; points the
///         flywheel share of coins already on the 2% locker at the CHIMI burn; and adds "burner" to
///         web/public/deployments.json. Coins keep the percentages already on their locks.
///
///         Run from contracts/, signed by the owner of the pad, its ProxyAdmin, the fee settings and the 2% locker:
///           PRIVATE_KEY=0x… forge script script/DeployChimiFeeChoice.s.sol \
///             --rpc-url https://sepolia-rpc.giwa.io --broadcast
///         Without PRIVATE_KEY it broadcasts as `--sender` (for a fork with `--unlocked`).
///
///         Optional env: KEEPER (default: the flywheel's keeper in deployments.json), RETARGET (default true).
contract DeployChimiFeeChoice is Script {
    uint256 internal constant CHAIN_GIWA_SEPOLIA = 91342;
    string internal constant DEPLOYMENTS = "./../web/public/deployments.json";

    function run() external {
        require(block.chainid == CHAIN_GIWA_SEPOLIA, "chain");
        string memory json = vm.readFile(DEPLOYMENTS);
        require(!vm.keyExistsJson(json, ".burner"), "deployments.json already has a burner");
        address pad = vm.parseJsonAddress(json, ".factory");
        address bpsSource = vm.parseJsonAddress(json, ".bpsSource");
        address oldFactory = vm.parseJsonAddress(json, ".uniFactory");
        address oldRouter = vm.parseJsonAddress(json, ".swapRouter");
        address locker = vm.parseJsonAddress(json, ".dexes[1].locker");
        address flywheel = vm.parseJsonAddress(json, ".flywheel.address");
        address chimi = vm.parseJsonAddress(json, ".flywheel.chimi");
        address keeper = vm.envOr("KEEPER", vm.parseJsonAddress(json, ".flywheel.keeper"));
        bool retarget = vm.envOr("RETARGET", true);

        uint256 pk = vm.envOr("PRIVATE_KEY", uint256(0));
        address sender = pk == 0 ? msg.sender : vm.addr(pk);

        // Checks before anything is sent.
        address admin = ChimiFeeChoice.proxyAdmin(pad);
        require(IOwnedFC(pad).owner() == sender, "signer doesn't own the pad");
        require(IOwnedFC(admin).owner() == sender, "signer doesn't own the pad's ProxyAdmin");
        require(IOwnedFC(bpsSource).owner() == sender, "signer doesn't own the fee settings");
        require(!retarget || IOwnedFC(locker).owner() == sender, "signer doesn't own the 2% locker");
        require(IPadInfoFC(pad).stakingPool() == flywheel, "the pad's staker leg isn't the flywheel");
        IPadInfoFC.InstantQuotePool memory chimiPool = IPadInfoFC(pad).getPool(chimi);
        require(chimiPool.uniPool != address(0), "CHIMI isn't a Chimi coin");
        require(IV3PoolInfoFC(chimiPool.uniPool).factory() == oldFactory, "CHIMI isn't on the first DEX");
        uint24 chimiFee = IV3PoolInfoFC(chimiPool.uniPool).fee();
        require(chimiFee == 10_000, "CHIMI's pool isn't 1%");
        uint256 coinsBefore = IPadInfoFC(pad).allTokensLength();

        if (pk == 0) vm.startBroadcast();
        else vm.startBroadcast(pk);
        ChimiFeeChoice.Addresses memory a = ChimiFeeChoice.deploy(
            ChimiFeeChoice.Params({
                owner: sender, pad: pad, chimi: chimi, chimiRouter: oldRouter, chimiPoolFee: chimiFee, keeper: keeper
            })
        );
        ChimiFeeChoice.wire(a, pad, bpsSource);
        uint256 moved = retarget ? ChimiFeeChoice.retarget(locker, flywheel, a.burner) : 0;
        vm.stopBroadcast();

        // What it should have left behind.
        ChimiPadV2 v2 = ChimiPadV2(payable(pad));
        require(address(v2.BURNER()) == a.burner, "pad not upgraded");
        require(v2.stakingPool() == a.burner, "staker leg");
        require(v2.allTokensLength() == coinsBefore, "coins");
        require(v2.owner() == sender, "owner");
        ArcBpsSource bps = ArcBpsSource(bpsSource);
        require(bps.lpMemeCreatorBps() == 8_000 && bps.lpMemeStakerBps() == 500, "plain split");
        require(bps.lpBackingBps() == 1_000 && bps.lpStakerBps() == 500 && bps.lpCreatorBps() == 7_000, "burning split");
        require(ChimiBurner(payable(a.burner)).keeper() == keeper, "keeper");

        console2.log("burner", a.burner);
        console2.log("coinBurnerImpl", a.coinBurnerImpl);
        console2.log("padImpl", a.padImpl);
        console2.log("keeper", keeper);
        console2.log("locks retargeted", moved);
        console2.log("block", block.number);

        string memory entry = string.concat(
            '"burner": {\n',
            '    "address": "',
            vm.toString(a.burner),
            '",\n',
            '    "chimi": "',
            vm.toString(chimi),
            '",\n',
            '    "keeper": "',
            vm.toString(keeper),
            '",\n',
            '    "block": ',
            vm.toString(block.number),
            "\n",
            "  },\n",
            '  "flywheel": {'
        );
        string memory out = vm.replace(json, '"flywheel": {', entry);
        require(keccak256(bytes(out)) != keccak256(bytes(json)), "couldn't place burner in deployments.json");
        vm.writeFile(DEPLOYMENTS, out);
    }
}
