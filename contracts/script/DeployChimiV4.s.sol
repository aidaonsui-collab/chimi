// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {ChimiV4Deployer} from "./ChimiV4Deployer.sol";

/// @notice Deploy Chimi's taxed v4 launch stack on GIWA Sepolia (chain 91342).
///         Does not touch the v3 factory. Deploys a PoolManager from the pinned v4-core package unless
///         POOL_MANAGER is set to one that is already on the chain. See contracts/V4_RUNBOOK.md.
///
///         forge script script/DeployChimiV4.s.sol --rpc-url https://sepolia-rpc.giwa.io --broadcast
///
///         Required: PRIVATE_KEY is read by forge (`--private-key` / the `PRIVATE_KEY` env foundry uses
///         for `--broadcast`). This script does not call `vm.envUint("PRIVATE_KEY")` itself.
///         Optional:
///           TREASURY                 platform beneficiary and creation-fee recipient (default: broadcaster)
///           STAKING_POOL             staker-leg recipient (default: treasury)
///           BPS_SOURCE               ArcBpsSource (default: `.bpsSource` in web/public/deployments.json)
///           OWNER                    owns the PoolManager and, when different, is offered the launcher
///           POOL_MANAGER             use this PoolManager instead of deploying one
///           LOCK_DURATION            seconds (default: 100 years)
///           CREATION_FEE_WEI         wei (default: 0)
///           START_MARKET_CAP_WEI     wei FDV the pool opens at (default: the v3 opening FDV)
///           UPDATE_DEPLOYMENTS       write web/public/deployments.json (only honoured on a real broadcast)
contract DeployChimiV4 is Script, ChimiV4Deployer {
    uint256 internal constant CHAIN_GIWA_SEPOLIA = 91342;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    function run() external returns (V4Deployment memory d) {
        require(block.chainid == CHAIN_GIWA_SEPOLIA, "chain");
        address treasury = vm.envOr("TREASURY", msg.sender);
        address staking = vm.envOr("STAKING_POOL", treasury);
        address bps = _bpsSource();
        address owner = vm.envOr("OWNER", msg.sender);
        address existingPm = vm.envOr("POOL_MANAGER", address(0));
        uint64 lockDuration = uint64(vm.envOr("LOCK_DURATION", uint256(100 * 365 days)));
        uint256 creationFee = vm.envOr("CREATION_FEE_WEI", uint256(0));
        uint256 mcap = vm.envOr("START_MARKET_CAP_WEI", uint256(0));

        vm.startBroadcast();
        d = _deployChimiV4(owner, treasury, staking, bps, msg.sender, lockDuration, existingPm);
        if (creationFee > 0) d.launcher.setCreationFee(creationFee);
        if (mcap > 0) d.launcher.setStartMarketCap(mcap);
        vm.stopBroadcast();

        console2.log("poolManager ", address(d.poolManager));
        console2.log("launcher    ", address(d.launcher));
        console2.log("tokenFactory", address(d.launcher.tokenFactory()));
        console2.log("locker      ", address(d.launcher.locker()));
        console2.log("hook        ", address(d.hook));
        console2.log("router      ", address(d.router));
        console2.log("treasury    ", treasury);
        console2.log("stakingPool ", staking);
        console2.log("bpsSource   ", bps);
        console2.log("owner       ", owner);

        if (vm.envOr("UPDATE_DEPLOYMENTS", false) && vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) {
            _writeDeployments(d, treasury);
        }
    }

    function _bpsSource() internal view returns (address) {
        address fromEnv = vm.envOr("BPS_SOURCE", address(0));
        if (fromEnv != address(0)) return fromEnv;
        string memory json = vm.readFile("./../web/public/deployments.json");
        return vm.parseJsonAddress(json, ".bpsSource");
    }

    function _writeDeployments(V4Deployment memory d, address treasury) internal {
        string memory prev = vm.readFile("./../web/public/deployments.json");
        string memory json = _line("{\n  \"chainId\": 91342,\n  \"name\": \"Chimi\",\n", "");
        json = _line(json, _addr("weth", vm.parseJsonAddress(prev, ".weth")));
        json = _line(json, _addr("uniFactory", vm.parseJsonAddress(prev, ".uniFactory")));
        json = _line(json, _addr("positionManager", vm.parseJsonAddress(prev, ".positionManager")));
        json = _line(json, _addr("swapRouter", vm.parseJsonAddress(prev, ".swapRouter")));
        json = _line(json, _addr("bpsSource", vm.parseJsonAddress(prev, ".bpsSource")));
        json = _line(json, _addr("locker", vm.parseJsonAddress(prev, ".locker")));
        json = _line(json, _addr("factory", vm.parseJsonAddress(prev, ".factory")));
        json = _line(json, "  \"v4\": {\n");
        json = _line(json, _addr4("poolManager", address(d.poolManager)));
        json = _line(json, _addr4("permit2", PERMIT2));
        json = _line(json, "    \"positionManager\": \"0x0000000000000000000000000000000000000000\",\n");
        json = _line(json, "    \"stateView\": \"0x0000000000000000000000000000000000000000\",\n");
        json = _line(json, "    \"quoter\": \"0x0000000000000000000000000000000000000000\",\n");
        json = _line(json, "    \"universalRouter\": \"0x0000000000000000000000000000000000000000\",\n");
        json = _line(json, _addr4("launcher", address(d.launcher)));
        json = _line(json, _addr4("tokenFactory", address(d.launcher.tokenFactory())));
        json = _line(json, _addr4("locker", address(d.launcher.locker())));
        json = _line(json, _addr4("hook", address(d.hook)));
        json = _line(json, _addr4("router", address(d.router)));
        json = _line(json, string.concat("    \"treasury\": \"", vm.toString(treasury), "\"\n  }\n}\n"));
        vm.writeFile("./../web/public/deployments.json", json);
    }

    function _line(string memory a, string memory b) private pure returns (string memory) {
        return string.concat(a, b);
    }

    function _addr(string memory key, address value) private view returns (string memory) {
        return string.concat("  \"", key, "\": \"", vm.toString(value), "\",\n");
    }

    function _addr4(string memory key, address value) private view returns (string memory) {
        return string.concat("    \"", key, "\": \"", vm.toString(value), "\",\n");
    }

}
