// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ChimiCreatorLockUpgrade} from "./ChimiCreatorLockUpgrade.sol";
import {ChimiFeeChoice} from "./ChimiFeeChoice.sol";
import {ChimiCreatorLock} from "../src/ChimiCreatorLock.sol";
import {ChimiPadV2} from "../src/ChimiPadV2.sol";
import {ChimiPadV3} from "../src/ChimiPadV3.sol";

interface IOwnedCL {
    function owner() external view returns (address);
}

/// @notice The creator first-buy lock, on the live Chimi pad on GIWA Sepolia (chain 91342). Deploys the
///         ChimiCreatorLock and the pad's new implementation (ChimiPadV3: V2's fee choice plus a locked first buy),
///         upgrades the pad, checks what it left behind, and adds "creatorLock" to web/public/deployments.json. Coins
///         already launched, the fee settings and the burner are untouched.
///
///         Run from contracts/, signed by the owner of the pad's ProxyAdmin:
///           PRIVATE_KEY=0x… FOUNDRY_PROFILE=deploy forge script script/DeployChimiCreatorLock.s.sol \
///             --rpc-url https://sepolia-rpc.giwa.io --broadcast --slow
///         Without PRIVATE_KEY it broadcasts as `--sender` (for a fork with `--unlocked`).
contract DeployChimiCreatorLock is Script {
    uint256 internal constant CHAIN_GIWA_SEPOLIA = 91342;
    string internal constant DEPLOYMENTS = "./../web/public/deployments.json";

    function run() external {
        require(block.chainid == CHAIN_GIWA_SEPOLIA, "chain");
        string memory json = vm.readFile(DEPLOYMENTS);
        require(!vm.keyExistsJson(json, ".creatorLock"), "deployments.json already has a creatorLock");
        address pad = vm.parseJsonAddress(json, ".factory");
        address burner = vm.parseJsonAddress(json, ".burner.address");

        uint256 pk = vm.envOr("PRIVATE_KEY", uint256(0));
        address sender = pk == 0 ? msg.sender : vm.addr(pk);

        // Checks before anything is sent.
        address admin = ChimiFeeChoice.proxyAdmin(pad);
        require(IOwnedCL(admin).owner() == sender, "signer doesn't own the pad's ProxyAdmin");
        ChimiPadV2 v2 = ChimiPadV2(payable(pad));
        require(address(v2.BURNER()) == burner, "the pad isn't on V2 with this burner");
        address padOwner = v2.owner();
        address stakingPool = v2.stakingPool();
        uint256 coinsBefore = v2.allTokensLength();

        if (pk == 0) vm.startBroadcast();
        else vm.startBroadcast(pk);
        ChimiCreatorLockUpgrade.Addresses memory a = ChimiCreatorLockUpgrade.deploy(pad, burner);
        ChimiCreatorLockUpgrade.wire(a, pad);
        vm.stopBroadcast();

        // What it should have left behind.
        ChimiPadV3 v3 = ChimiPadV3(payable(pad));
        require(address(v3.CREATOR_LOCK()) == a.creatorLock, "pad not upgraded");
        require(ChimiCreatorLock(a.creatorLock).pad() == pad, "lock's pad");
        require(ChimiCreatorLock(a.creatorLock).lockCount() == 0, "lock not empty");
        require(address(v3.BURNER()) == burner, "burner");
        require(v3.owner() == padOwner, "owner");
        require(v3.stakingPool() == stakingPool, "staker leg");
        require(v3.allTokensLength() == coinsBefore, "coins");

        console2.log("creatorLock", a.creatorLock);
        console2.log("padImpl", a.padImpl);
        console2.log("block", block.number);

        string memory entry = string.concat(
            '"creatorLock": {\n',
            '    "address": "',
            vm.toString(a.creatorLock),
            '",\n',
            '    "block": ',
            vm.toString(block.number),
            "\n",
            "  },\n",
            '  "tips": {'
        );
        string memory out = vm.replace(json, '"tips": {', entry);
        require(keccak256(bytes(out)) != keccak256(bytes(json)), "couldn't place creatorLock in deployments.json");
        vm.writeFile(DEPLOYMENTS, out);
    }
}
