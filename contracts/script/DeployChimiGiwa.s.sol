// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ChimiStack} from "./ChimiStack.sol";

interface IUniV3FactoryAdmin {
    function owner() external view returns (address);
    function setOwner(address _owner) external;
    function feeAmountTickSpacing(uint24 fee) external view returns (int24);
}

/// @notice Deploy Chimi on GIWA Sepolia (chain id 91342).
///         Uses the canonical WETH preinstall. Deploys a fresh Uniswap v3 factory, position
///         manager, and router, then renounces the v3 factory owner so the protocol fee stays off.
///
///         forge script script/DeployChimiGiwa.s.sol --rpc-url https://sepolia-rpc.giwa.io --broadcast
///
///         Required env: PRIVATE_KEY
///         Optional: TREASURY, LOCK_DURATION (seconds), CREATION_FEE_WEI, LAUNCH_VIRTUAL_QUOTE (wei)
contract DeployChimiGiwa is Script {
    uint256 internal constant CHAIN_GIWA_SEPOLIA = 91342;
    address internal constant GIWA_WETH = 0x4200000000000000000000000000000000000006;

    function run() external {
        require(block.chainid == CHAIN_GIWA_SEPOLIA, "chain");
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        ChimiStack.DeployParams memory p = ChimiStack.defaultParams(deployer);
        p.weth = GIWA_WETH;
        p.treasury = vm.envOr("TREASURY", deployer);
        p.lpRecipient = p.treasury;
        p.stakingPool = p.treasury;
        p.lockDuration = uint64(vm.envOr("LOCK_DURATION", uint256(100 * 365 days)));
        p.creationFee = vm.envOr("CREATION_FEE_WEI", uint256(0));
        p.launchVirtualQuote = vm.envOr("LAUNCH_VIRTUAL_QUOTE", uint256(1_180_308_761_395_051_186));

        vm.startBroadcast(pk);
        ChimiStack.Addresses memory a = ChimiStack.deploy(p);
        IUniV3FactoryAdmin uni = IUniV3FactoryAdmin(a.uniFactory);
        require(uni.feeAmountTickSpacing(10_000) == 200, "fee tier");
        uni.setOwner(address(0));
        vm.stopBroadcast();

        console2.log("weth", a.weth);
        console2.log("uniFactory", a.uniFactory);
        console2.log("positionManager", a.nfpm);
        console2.log("swapRouter", a.swapRouter02);
        console2.log("bpsSource", a.bpsSource);
        console2.log("locker", a.locker);
        console2.log("factory", a.factory);

        string memory json = string.concat(
            "{\n",
            '  "chainId": 91342,\n',
            '  "name": "Chimi",\n',
            '  "weth": "',
            vm.toString(a.weth),
            '",\n',
            '  "uniFactory": "',
            vm.toString(a.uniFactory),
            '",\n',
            '  "positionManager": "',
            vm.toString(a.nfpm),
            '",\n',
            '  "swapRouter": "',
            vm.toString(a.swapRouter02),
            '",\n',
            '  "bpsSource": "',
            vm.toString(a.bpsSource),
            '",\n',
            '  "locker": "',
            vm.toString(a.locker),
            '",\n',
            '  "factory": "',
            vm.toString(a.factory),
            '"\n',
            "}\n"
        );
        vm.writeFile("./../web/public/deployments.json", json);
    }
}
