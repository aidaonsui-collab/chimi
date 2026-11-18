# Chimi v4 deploy runbook

Do not broadcast this from a cloud agent, and do not put a private key in the repo. The script reads the key the way Foundry does (`PRIVATE_KEY` in the environment, or `--private-key` / a keystore). It sends nothing unless you pass `--broadcast`.

## Is Uniswap v4 on GIWA Sepolia?

No official deployment.

- [Uniswap's deployments page](https://developers.uniswap.org/docs/protocols/v4/deployments) has no chain 91342. The published PoolManager addresses for Ethereum (`0x000000000004444c5dc75cB358380D2e3dE08A90`), Sepolia (`0xE03A1074c86CFeDd5C142C4F04F1a1536e203543`) and Base Sepolia (`0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408`) have no code on GIWA Sepolia. The same is true of Ethereum's StateView (`0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227`), PositionManager (`0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e`) and Universal Router (`0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af`).
- [GIWA's contract list](https://docs.giwa.io/network-information/contracts.md) does not list PoolManager, PositionManager, StateView, Quoter or the Universal Router. It does list two preinstalls this deploy uses:
  - Permit2 `0x000000000022D473030F116dDEE9F6B43aC78BA3` (code is present, about 9 KB)
  - Arachnid CREATE2 deployer `0x4e59b44847b379578588920cA78FbF26c0B4956C`
  - WETH `0x4200000000000000000000000000000000000006` (the v3 quote; v4 pools are native ETH)
- Third parties have deployed their own PoolManagers (Gamapad `0xC889F63b793a0CE059e086aE614ac8E4a15a5e87`, giwagmi `0xdd9ee9e333237225C98d2DD1D05B76E33aF70Aa9`, and `0x5FC6154086BEA250736F3950cB5Ff47a007a2C7f`). Those are not Uniswap's, and they are not used here. Chimi deploys its own PoolManager from the pinned `@uniswap/v4-core` 1.0.2.

`ChimiV4ForkTest` checks the empty official addresses and the preinstalls on a fork. It is skipped unless `GIWA_RPC` is set.

## What actually has to be deployed

Trading, quoting and the launch all go through Chimi's contracts, not the Universal Router or the v4 Quoter. The position is a PoolManager position owned by `ChimiV4Locker`, not a PositionManager NFT. So the script deploys:

1. `PoolManager` (skip with `POOL_MANAGER` if you already have one you trust)
2. `ChimiV4Launcher` (it deploys `ChimiV4TokenFactory` and `ChimiV4Locker`)
3. `ChimiTaxHook`, CREATE2-mined so the address carries the hook permission bits
4. `ChimiV4Router`

PositionManager, StateView, Quoter and the Universal Router are left at the zero address in `deployments.json`. Permit2 is recorded at the preinstall address for the record; the router does not pull through it.

## Steps

From `contracts/`, with Foundry on the path:

```bash
# optional: compile and see the plan. This does not write deployments.json.
forge script script/DeployChimiV4.s.sol --rpc-url https://sepolia-rpc.giwa.io

# broadcast. Foundry reads PRIVATE_KEY from the environment; the script does not.
UPDATE_DEPLOYMENTS=true \
TREASURY=0xYourTreasury \
forge script script/DeployChimiV4.s.sol \
  --rpc-url https://sepolia-rpc.giwa.io \
  --broadcast
```

`UPDATE_DEPLOYMENTS=true` rewrites `web/public/deployments.json` only during a real broadcast (`forge script --broadcast`). A dry run leaves the file alone. v3 addresses are copied through. The v4 UI stays hidden until `poolManager`, `launcher`, `hook`, `router` and `locker` are non-zero.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `PRIVATE_KEY` | required by Foundry for `--broadcast` | Deployer key. Not read by the script body. |
| `TREASURY` | the broadcaster | Platform beneficiary, creation-fee recipient, and the locker's beneficiary. |
| `STAKING_POOL` | `TREASURY` | Where a non-zero staker bps would be claimed. Today's bps source has staker bps at 0. |
| `BPS_SOURCE` | `.bpsSource` in `web/public/deployments.json` | `ArcBpsSource`. Launches stamp platform and staker cuts from `lpMemeCreatorBps` / `lpMemeStakerBps`. |
| `OWNER` | the broadcaster | Owns the new PoolManager. If this is not the broadcaster, launcher ownership is offered (Ownable2Step) and must be accepted. |
| `POOL_MANAGER` | deploy a new one | Use an existing PoolManager instead of deploying. |
| `LOCK_DURATION` | `100 * 365 days` | Term for new locks, in seconds. Minimum 30 days. Existing locks do not move. |
| `CREATION_FEE_WEI` | `0` | ETH paid on launch, except by the contract owner. Capped at 1 ETH. |
| `START_MARKET_CAP_WEI` | v3 opening FDV, about 1.106 ETH | Fully diluted ETH value the pool opens at. |
| `UPDATE_DEPLOYMENTS` | false | Write `web/public/deployments.json` on a broadcast. |

The PoolManager owner can later name a protocol-fee controller. Leave that unset and the protocol fee stays off, which is the v3 factory's posture (v3 renounces the factory owner; this PoolManager keeps an owner so the controller can be set or the ownership handed on). The owner cannot move, pause or unlock a position.

## After the addresses are in deployments.json

The create form shows **Taxed (v4)** next to **Standard (v3)**. v3 launches are the same transaction as today. A taxed launch calls `ChimiV4Launcher.launch`. The app sends the whole post-platform remainder to the creator (70% at today's bps source). Buybacks and holder rewards stay on the hook for direct calls; the form does not offer them.

## Checks before you broadcast

```bash
forge test
GIWA_RPC=https://sepolia-rpc.giwa.io forge test --match-contract ChimiV4ForkTest
```

The fork test deploys the stack on a fork of GIWA Sepolia and launches, trades, claims and checks the lock. It does not send a transaction to the chain.
