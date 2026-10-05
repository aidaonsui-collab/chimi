// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vm} from "forge-std/Vm.sol";
import {TransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {InstantErc20QuoteFactoryProxyInit} from "../src/InstantErc20QuoteFactoryProxyInit.sol";
import {MonLockProxyInit} from "../src/MonLockProxyInit.sol";
import {ArcBpsSource} from "../src/ArcBpsSource.sol";
import {WETH9} from "./testnet/WETH9.sol";
import {DummyNFTDescriptor} from "./testnet/DummyNFTDescriptor.sol";

/// @notice Deploys Chimi's own Uniswap v3 stack plus the Instant factory, quoted in WETH.
///         Not a Script, so forge tests can call it. Pass `weth = address(0)` to deploy a
///         local WETH9. On GIWA, pass the canonical preinstall.
library ChimiStack {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint24 internal constant POOL_FEE = 10_000;
    int24 internal constant TICK_SPACING = 200;

    struct Addresses {
        address weth;
        address uniFactory;
        address nftDescriptor;
        address nfpm;
        address swapRouter02;
        address bpsSource;
        address lockerImpl;
        address locker;
        address factoryImpl;
        address factory;
    }

    struct DeployParams {
        address owner;
        address treasury;
        address lpRecipient;
        address stakingPool;
        address weth;
        uint64 lockDuration;
        uint256 creationFee;
        uint256 launchVirtualQuote;
        uint16 memeCreatorBps;
        uint16 memeStakerBps;
        bool wireOwner;
    }

    function defaultParams(address owner) internal pure returns (DeployParams memory p) {
        p.owner = owner;
        p.treasury = owner;
        p.lpRecipient = owner;
        p.stakingPool = owner;
        p.weth = address(0);
        p.lockDuration = uint64(100 * 365 days);
        p.creationFee = 0;
        // ~1 ETH opening FDV. Virtual token init is slightly above 1B, so spot FDV lands just under this.
        p.launchVirtualQuote = 1 ether;
        p.memeCreatorBps = 7000;
        p.memeStakerBps = 0;
        p.wireOwner = true;
    }

    function deploy(address owner) internal returns (Addresses memory) {
        return deploy(defaultParams(owner));
    }

    function deploy(DeployParams memory p) internal returns (Addresses memory s) {
        require(p.owner != address(0), "owner");

        s.weth = p.weth == address(0) ? address(new WETH9()) : p.weth;

        s.uniFactory = deployCode(_creation("UniswapV3Factory.hex"));
        s.nftDescriptor = address(new DummyNFTDescriptor());
        s.nfpm = deployCode(
            _creation("NonfungiblePositionManager.hex"), abi.encode(s.uniFactory, s.weth, s.nftDescriptor)
        );
        // SwapRouter02 has no deadline. factoryV2 stays unset; Chimi has no v2.
        s.swapRouter02 =
            deployCode(_creation("SwapRouter02.hex"), abi.encode(address(0), s.uniFactory, s.nfpm, s.weth));

        ArcBpsSource bps = new ArcBpsSource(p.owner);
        s.bpsSource = address(bps);
        if (p.wireOwner) bps.setMemeBps(p.memeCreatorBps, p.memeStakerBps);

        MonLockProxyInit lockerImpl = new MonLockProxyInit(s.nfpm);
        s.lockerImpl = address(lockerImpl);
        TransparentUpgradeableProxy lockerProxy = new TransparentUpgradeableProxy(
            address(lockerImpl),
            p.owner,
            abi.encodeCall(MonLockProxyInit.initialize, (p.lpRecipient, p.owner, p.lockDuration))
        );
        s.locker = address(lockerProxy);

        InstantErc20QuoteFactoryProxyInit factoryImpl =
            new InstantErc20QuoteFactoryProxyInit(s.weth, 18, s.weth);
        s.factoryImpl = address(factoryImpl);
        TransparentUpgradeableProxy factoryProxy = new TransparentUpgradeableProxy(
            address(factoryImpl),
            p.owner,
            abi.encodeCall(
                InstantErc20QuoteFactoryProxyInit.initialize,
                (p.treasury, p.stakingPool, p.owner, s.bpsSource, p.launchVirtualQuote)
            )
        );
        s.factory = address(factoryProxy);

        if (p.wireOwner) {
            InstantErc20QuoteFactoryProxyInit factory = InstantErc20QuoteFactoryProxyInit(payable(s.factory));
            factory.setUniV3Config(s.nfpm, POOL_FEE, TICK_SPACING, s.locker, s.swapRouter02);
            if (p.creationFee > 0) factory.setCreationFee(p.creationFee);
            MonLockProxyInit(payable(s.locker)).setStamper(s.factory);
        }
    }

    function deployCode(bytes memory bytecode) internal returns (address addr) {
        assembly {
            addr := create(0, add(bytecode, 0x20), mload(bytecode))
        }
        require(addr != address(0), "deploy");
    }

    function deployCode(bytes memory creation, bytes memory ctorArgs) internal returns (address) {
        return deployCode(abi.encodePacked(creation, ctorArgs));
    }

    function _creation(string memory filename) internal view returns (bytes memory) {
        string memory raw = vm.readFile(string.concat("./script/bytecode/", filename));
        return vm.parseBytes(raw);
    }
}
