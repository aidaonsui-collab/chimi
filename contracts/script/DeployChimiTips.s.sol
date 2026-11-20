// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ChimiTips, IChimiPadPools} from "../src/ChimiTips.sol";

/// @notice The tips contract for live streams, on the live Chimi pad on GIWA Sepolia (chain 91342).
///         A tip goes 90% to the coin's creator and 10% to TREASURY.
///
///         Run from contracts/:
///           PRIVATE_KEY=0x… forge script script/DeployChimiTips.s.sol --rpc-url https://sepolia-rpc.giwa.io --broadcast
///         Without PRIVATE_KEY it broadcasts as `--sender` (for a fork with `--unlocked`).
///
///         Optional env: TREASURY (default: the signer), OWNER (default: the signer).
///         It prints the address and block; those go into web/public/deployments.json as "tips".
contract DeployChimiTips is Script {
    uint256 internal constant CHAIN_GIWA_SEPOLIA = 91342;
    address internal constant LIVE_CHIMI = 0xceF368d0509602704799bd80BcC33AeF352b9667;
    string internal constant DEPLOYMENTS = "./../web/public/deployments.json";

    function run() external {
        require(block.chainid == CHAIN_GIWA_SEPOLIA, "chain");
        address pad = vm.parseJsonAddress(vm.readFile(DEPLOYMENTS), ".factory");
        // The pad must be the one that launched $CHIMI, so creators are looked up in the right place.
        require(IChimiPadPools(pad).getPool(LIVE_CHIMI).creator != address(0), "pad has no CHIMI");

        uint256 pk = vm.envOr("PRIVATE_KEY", uint256(0));
        address sender = pk == 0 ? msg.sender : vm.addr(pk);
        address treasury = vm.envOr("TREASURY", sender);
        address owner = vm.envOr("OWNER", sender);

        if (pk == 0) vm.startBroadcast();
        else vm.startBroadcast(pk);
        ChimiTips tips = new ChimiTips(pad, treasury, owner);
        vm.stopBroadcast();

        console2.log("tips", address(tips));
        console2.log("block", block.number);
        console2.log("pad", pad);
        console2.log("treasury", treasury);
        console2.log("owner", owner);
    }
}
