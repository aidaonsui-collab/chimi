// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ArcBpsSource} from "../src/ArcBpsSource.sol";
import {ChimiBurner} from "../src/ChimiBurner.sol";
import {ChimiPadV3} from "../src/ChimiPadV3.sol";
import {ChimiCreatorLock} from "../src/ChimiCreatorLock.sol";
import {ChimiTips} from "../src/ChimiTips.sol";
import {MonLock} from "../src/MonLock.sol";
import {ChimiFeeChoice} from "./ChimiFeeChoice.sol";
import {ChimiMainnet, IUniV3FactoryMain} from "./ChimiMainnet.sol";

/// @notice Chimi on a new chain (GIWA mainnet) in one run: DEX, pad, locker, CHIMI, burner, tips (see ChimiMainnet).
///         Writes the app's deployment file for that chain, `web/public/deployments.<chain id>.json`; the live site
///         keeps using `deployments.json` until that file is copied over it (docs/MAINNET.md).
///
///         Run from contracts/ with the deploy profile, signed by the wallet that will own everything:
///           EXPECTED_CHAIN_ID=… PLATFORM=0x… KEEPER=0x… LAUNCH_VIRTUAL_QUOTE=… PRIVATE_KEY=0x… \
///             FOUNDRY_PROFILE=deploy forge script script/DeployChimiMainnet.s.sol --rpc-url <RPC> --broadcast --slow
///         Without PRIVATE_KEY it broadcasts as `--sender` (a rehearsal on a local chain with `--unlocked`).
///
///         Required env:
///           EXPECTED_CHAIN_ID     the chain id from GIWA's official docs; the run stops on any other chain
///           PLATFORM              the platform wallet: creation fees, the 15% fee share, tips' 10%
///           KEEPER                the server's keeper wallet (KEEPER_PRIVATE_KEY on Vercel); spends the burns
///           LAUNCH_VIRTUAL_QUOTE  opening price of every coin, in wei (see docs/MAINNET.md for the sum)
///         CHIMI, one of:
///           (unset)               launch CHIMI here from the signer: CHIMI_NAME (Chimi), CHIMI_SYMBOL (CHIMI),
///                                 CHIMI_FIRST_BUY_WEI (0)
///           CHIMI=0x…             a token that already has a WETH pool: CHIMI_ROUTER (a SwapRouter02) and
///                                 CHIMI_POOL_FEE (that pool's fee) say where the burner buys it. A coin launched on
///                                 this pad by another wallet: resume with RESUME=1 (below); router and fee default
///                                 to the pad's own.
///         Two runs, for CHIMI launched by a wallet other than the signer:
///           STACK_ONLY=1          stop after the stack (step 1) and write the file without burner or tips
///           RESUME=1 CHIMI=0x…    read the stack from that file and do the rest
///         Optional: WETH (0x4200…0006), CREATION_FEE_WEI (0), LOCK_DURATION seconds (100 years), OUT (the file).
contract DeployChimiMainnet is Script {
    address internal constant OP_STACK_WETH = 0x4200000000000000000000000000000000000006;
    uint256 internal constant GIWA_SEPOLIA = 91342;

    function run() external {
        uint256 expected = vm.envUint("EXPECTED_CHAIN_ID");
        require(block.chainid == expected, "connected to a different chain than EXPECTED_CHAIN_ID");
        require(block.chainid != GIWA_SEPOLIA, "this is GIWA Sepolia: Chimi there is already deployed");

        uint256 pk = vm.envOr("PRIVATE_KEY", uint256(0));
        address owner = pk == 0 ? msg.sender : vm.addr(pk);
        address platform = vm.envAddress("PLATFORM");
        address keeper = vm.envAddress("KEEPER");
        string memory out = vm.envOr(
            "OUT", string.concat("./../web/public/deployments.", vm.toString(block.chainid), ".json")
        );
        bool stackOnly = vm.envOr("STACK_ONLY", false);
        bool resume = vm.envOr("RESUME", false);
        require(!(stackOnly && resume), "STACK_ONLY and RESUME together");

        ChimiMainnet.Params memory p = ChimiMainnet.Params({
            owner: owner,
            platform: platform,
            weth: vm.envOr("WETH", OP_STACK_WETH),
            lockDuration: uint64(vm.envOr("LOCK_DURATION", uint256(100 * 365 days))),
            creationFee: vm.envOr("CREATION_FEE_WEI", uint256(0)),
            launchVirtualQuote: resume ? 0 : vm.envUint("LAUNCH_VIRTUAL_QUOTE")
        });
        require(p.weth.code.length > 0, "no WETH contract at WETH");
        require(platform != address(0) && keeper != address(0), "PLATFORM and KEEPER");

        ChimiMainnet.Stack memory s;
        if (resume) s = _readStack(vm.readFile(out));

        if (pk == 0) vm.startBroadcast();
        else vm.startBroadcast(pk);

        if (!resume) s = ChimiMainnet.deployStack(p);

        address chimi;
        address chimiRouter;
        uint24 chimiPoolFee;
        uint256 moved;
        ChimiMainnet.Burns memory b;
        address tips;
        if (!stackOnly) {
            (chimi, chimiRouter, chimiPoolFee) = _chimi(s, p);
            b = ChimiMainnet.deployBurns(s, p.weth, chimi, chimiRouter, chimiPoolFee, keeper, owner);
            moved = ChimiMainnet.wireBurns(s, b, platform);
            tips = ChimiMainnet.deployTips(s, platform, owner);
        }
        vm.stopBroadcast();

        _check(s, b, p, keeper, stackOnly);
        console2.log("pad", s.pad);
        console2.log("uniFactory", s.uniFactory);
        console2.log("locker", s.locker);
        if (!stackOnly) {
            console2.log("CHIMI", chimi);
            console2.log("burner", b.burner);
            console2.log("creatorLock", b.creatorLock);
            console2.log("tips", tips);
            console2.log("launches pointed at the burner", moved);
        }
        console2.log("block", block.number);
        vm.writeFile(out, _json(s, p.weth, b, chimi, keeper, tips));
        console2.log("wrote", out);
    }

    /// @dev Which CHIMI, and where the burner buys it.
    function _chimi(ChimiMainnet.Stack memory s, ChimiMainnet.Params memory p)
        internal
        returns (address chimi, address router, uint24 fee)
    {
        chimi = vm.envOr("CHIMI", address(0));
        if (chimi == address(0)) {
            uint256 firstBuy = vm.envOr("CHIMI_FIRST_BUY_WEI", uint256(0));
            chimi = ChimiMainnet.launchChimi(
                s, vm.envOr("CHIMI_NAME", string("Chimi")), vm.envOr("CHIMI_SYMBOL", string("CHIMI")), p.creationFee + firstBuy
            );
            return (chimi, s.swapRouter02, ChimiMainnet.POOL_FEE);
        }
        require(chimi.code.length > 0, "CHIMI has no code");
        // A coin on this pad trades on the pad's DEX; anything else says where its pool is.
        bool onPad = ChimiPadV3(payable(s.pad)).getPool(chimi).uniPool != address(0);
        router = vm.envOr("CHIMI_ROUTER", onPad ? s.swapRouter02 : address(0));
        fee = uint24(vm.envOr("CHIMI_POOL_FEE", onPad ? uint256(ChimiMainnet.POOL_FEE) : uint256(0)));
        require(router != address(0) && fee != 0, "CHIMI_ROUTER and CHIMI_POOL_FEE for a CHIMI that isn't on this pad");
    }

    /// @dev What the run should have left behind.
    function _check(
        ChimiMainnet.Stack memory s,
        ChimiMainnet.Burns memory b,
        ChimiMainnet.Params memory p,
        address keeper,
        bool stackOnly
    ) internal view {
        ChimiPadV3 pad = ChimiPadV3(payable(s.pad));
        require(pad.owner() == p.owner, "pad owner");
        require(pad.poolFee() == ChimiMainnet.POOL_FEE && pad.lpLocker() == s.locker, "pad DEX");
        require(pad.swapRouter() == s.swapRouter02 && pad.positionManager() == s.nfpm, "pad DEX");
        require(IUniV3FactoryMain(s.uniFactory).owner() == address(0), "DEX owner given up");
        ArcBpsSource bps = ArcBpsSource(s.bpsSource);
        require(bps.lpMemeCreatorBps() == 8_000 && bps.lpMemeStakerBps() == 500, "plain split");
        require(bps.lpBackingBps() == 1_000 && bps.lpStakerBps() == 500 && bps.lpCreatorBps() == 7_000, "burning split");
        require(MonLock(payable(s.locker)).owner() == p.owner, "locker owner");
        if (stackOnly) return;
        require(address(pad.BURNER()) == b.burner, "pad not upgraded");
        require(address(pad.CREATOR_LOCK()) == b.creatorLock, "creator lock");
        require(ChimiCreatorLock(b.creatorLock).pad() == s.pad, "creator lock's pad");
        require(pad.stakingPool() == b.burner, "staker leg");
        require(ChimiBurner(payable(b.burner)).keeper() == keeper, "keeper");
        require(ChimiBurner(payable(b.burner)).owner() == p.owner, "burner owner");
        uint256[] memory ids = MonLock(payable(s.locker)).allLockedPositions();
        for (uint256 i = 0; i < ids.length; i++) {
            (address wallet,) = MonLock(payable(s.locker)).stakerSplits(ids[i]);
            require(wallet == b.burner, "a launch's 5% isn't going to the burner");
        }
    }

    function _readStack(string memory json) internal pure returns (ChimiMainnet.Stack memory s) {
        s.uniFactory = vm.parseJsonAddress(json, ".uniFactory");
        s.nfpm = vm.parseJsonAddress(json, ".positionManager");
        s.swapRouter02 = vm.parseJsonAddress(json, ".swapRouter");
        s.bpsSource = vm.parseJsonAddress(json, ".bpsSource");
        s.locker = vm.parseJsonAddress(json, ".locker");
        s.pad = vm.parseJsonAddress(json, ".factory");
    }

    /// @dev The app's deployment file (web/src/lib/chimi/chain.ts `Deployment`): one DEX, the burner, the creator lock,
    ///      tips.
    function _json(
        ChimiMainnet.Stack memory s,
        address weth,
        ChimiMainnet.Burns memory b,
        address chimi,
        address keeper,
        address tips
    ) internal returns (string memory) {
        string memory dex = "dex";
        vm.serializeUint(dex, "fee", ChimiMainnet.POOL_FEE);
        vm.serializeInt(dex, "tickSpacing", ChimiMainnet.TICK_SPACING);
        vm.serializeAddress(dex, "uniFactory", s.uniFactory);
        vm.serializeAddress(dex, "positionManager", s.nfpm);
        vm.serializeAddress(dex, "swapRouter", s.swapRouter02);
        string memory dexJson = vm.serializeAddress(dex, "locker", s.locker);

        string memory root = "deployment";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeString(root, "name", "Chimi");
        vm.serializeAddress(root, "weth", weth);
        vm.serializeAddress(root, "uniFactory", s.uniFactory);
        vm.serializeAddress(root, "positionManager", s.nfpm);
        vm.serializeAddress(root, "swapRouter", s.swapRouter02);
        vm.serializeAddress(root, "bpsSource", s.bpsSource);
        vm.serializeAddress(root, "locker", s.locker);
        vm.serializeAddress(root, "factory", s.pad);
        // serializeString nests a value that is a JSON object (burner, tips below) but keeps an array as a string, so the
        // DEX list goes in as a string and is put back as an array at the end.
        string memory dexes = string.concat("[", dexJson, "]");
        string memory json = vm.serializeString(root, "dexes", dexes);
        if (b.burner != address(0)) {
            string memory burner = "burner";
            vm.serializeAddress(burner, "address", b.burner);
            vm.serializeAddress(burner, "chimi", chimi);
            vm.serializeAddress(burner, "keeper", keeper);
            vm.serializeString(root, "burner", vm.serializeUint(burner, "block", block.number));
            string memory cl = "creatorLock";
            vm.serializeAddress(cl, "address", b.creatorLock);
            vm.serializeString(root, "creatorLock", vm.serializeUint(cl, "block", block.number));
            string memory t = "tips";
            vm.serializeAddress(t, "address", tips);
            json = vm.serializeString(root, "tips", vm.serializeUint(t, "block", block.number));
        }
        string memory asString = string.concat('"dexes":"', vm.replace(dexes, '"', '\\"'), '"');
        string memory out = vm.replace(json, asString, string.concat('"dexes":', dexes));
        require(keccak256(bytes(out)) != keccak256(bytes(json)), "couldn't write dexes as a list");
        return out;
    }
}
