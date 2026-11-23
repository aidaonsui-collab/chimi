# Moving Chimi to GIWA mainnet

Chimi runs on GIWA Sepolia today. Mainnet is a fresh deployment, not a migration: new contracts, a new CHIMI, new coins. Nothing on the testnet carries over: coins, balances, points, Houses, follows or comments.

GIWA mainnet isn't live yet. On 2026-11-20 GIWA's docs ([connect to GIWA](https://docs.giwa.io/get-started/connect-to-giwa)) said mainnet is under development and listed only Sepolia (chain 91342). Take every mainnet value below from GIWA's official docs only. A look-alike "GIWA mainnet" with fake RPCs and a draining bridge has been seen before.

## What changes where

| | Where | What to do |
|---|---|---|
| Contracts | `contracts/script/DeployChimiMainnet.s.sol` (library `ChimiMainnet.sol`) | One run deploys everything in its final form (below). |
| Which chain the app runs on | `web/public/deployments.json` → its `chainId` | Replace it with the file the deploy writes. |
| That chain's details | `web/src/lib/chimi/network-rules.ts` | Add mainnet's entry: name, RPC, explorer, Dojang, up.id. Until you do, the app stops with a clear error as soon as it loads. |
| Server data | Vercel env (Upstash Redis) | Start mainnet on a **new, empty** Redis. Points, Houses, follows, comments, streams, tips, X posts and token profiles are all keyed to testnet addresses. |
| Keeper | Vercel env | A keeper wallet with mainnet ETH for gas; its address goes into the deploy. |

## What the deploy creates

`DeployChimiMainnet` does, in order (GIWA Sepolia got here in three steps; mainnet gets it in one):

1. **The stack**: a copy of Uniswap v3 with the 2% and 3% tiers on and its owner given up; the fee settings; the locker; the launch contract (pad), launching into 2% pools.
2. **CHIMI**: by default the script launches it on the new pad from the signer, who becomes its creator.
3. **The burner** (`ChimiBurner`): fixed forever to CHIMI, the router of CHIMI's pool and that pool's fee. The pad's 5% share then goes to it, and the pad is upgraded to `ChimiPadV3`, which offers the burn-my-coin choice at launch and lets a creator lock their first buy. CHIMI's own launch is pointed at the burner too, so CHIMI's 5% buys and burns CHIMI.
   - **The creator lock** (`ChimiCreatorLock`) is deployed in the same step, fixed to the pad. A creator who locks their first buy at launch has it delivered straight into the lock: nothing unlocks before the cliff, then it releases evenly over the vesting period (four years at most in all). It has no owner. Only the creator claims, and a lock can be pushed later, never shortened.
4. **Tips** (`ChimiTips`): 90% to the creator, 10% to the platform.

Fee split of every new coin's ETH fees:

| | Creator | Coin's own burn | CHIMI burn | Platform |
|---|---|---|---|---|
| Burns itself (ticked) | 70% | 10% | 5% | 15% |
| Doesn't (unticked) | 80% | | 5% | 15% |

There is no flywheel on mainnet: CHIMI holder payouts ended with the fee choice. The daily keeper (`/api/keeper/flywheel`) runs the burns from the burner alone.

**Why the order matters.** The burner needs the pad's address, and the pad's new code needs the burner's. So the pad starts on its first implementation and is upgraded in step 3. CHIMI and its pool must exist before the burner. Getting the burner's CHIMI wrong means a new burner and another pad upgrade.

## Decide first

- **Who launches CHIMI.**
  - **The deployer (simplest):** the deployer launches it in the same run (`CHIMI_NAME`, `CHIMI_SYMBOL`, `CHIMI_FIRST_BUY_WEI`). CHIMI's 80% creator share then goes to the deployer.
  - **Another wallet:** run twice. First `STACK_ONLY=1`; launch CHIMI from that wallet; then `RESUME=1 CHIMI=0x…`. Any coin launched between the two runs is pointed at the burner by the second run.
  - **A CHIMI that already exists elsewhere:** set `CHIMI`, `CHIMI_ROUTER` (a SwapRouter02) and `CHIMI_POOL_FEE`. The run refuses if that router's factory has no CHIMI/WETH pool at that fee.
- **The opening price** of every coin, `LAUNCH_VIRTUAL_QUOTE` in wei: opening FDV in ETH × 1.0667e18.

  ```bash
  python3 -c "fdv_usd=3000; eth_usd=2711; print(int(fdv_usd/eth_usd*1066666666666666666))"
  ```

  This gives Sepolia's value (1,180,308,761,395,051,186): $3,000 at $2,711 per ETH. Recompute it with the ETH price on the day.
- **The platform wallet** (`PLATFORM`): creation fees, the 15% fee share, tips' 10%.
- **The keeper** (`KEEPER`): the address of `KEEPER_PRIVATE_KEY`, which only spends the burns.
- **The owner**: the signing wallet owns the pad, its ProxyAdmin, the fee settings, the locker, the burner and tips. Use a wallet you can keep safe. Moving ownership to a multisig afterwards is an owner call on each.

## Rehearse (local chain)

From `contracts/`. Anvil's well-known test accounts are fine here, never on mainnet.

```bash
anvil --port 8650 --chain-id 31337
```

Put WETH where an OP Stack chain has it (0x4200…0006) and Multicall3 at its usual address:

```bash
R=http://127.0.0.1:8650
cast rpc anvil_setCode 0x4200000000000000000000000000000000000006 $(python3 -c "import json;print(json.load(open('out/WETH9.sol/WETH9.json'))['deployedBytecode']['object'])") --rpc-url $R
cast rpc anvil_setStorageAt 0x4200000000000000000000000000000000000006 0x2 0x0000000000000000000000000000000000000000000000000000000000000012 --rpc-url $R
cast rpc anvil_setCode 0xcA11bde05977b3631167028862bE2a173976CA11 $(cast code 0xcA11bde05977b3631167028862bE2a173976CA11 --rpc-url https://sepolia-rpc.giwa.io) --rpc-url $R
```

Then the deploy (account 0 signs, 1 is the platform, 2 the keeper):

```bash
EXPECTED_CHAIN_ID=31337 PLATFORM=0x70997970C51812dc3A010C7d01b50e0d17dc79C8 KEEPER=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC \
  LAUNCH_VIRTUAL_QUOTE=1180308761395051186 CHIMI_FIRST_BUY_WEI=10000000000000000 \
  PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  FOUNDRY_PROFILE=deploy forge script script/DeployChimiMainnet.s.sol --rpc-url http://127.0.0.1:8650 --broadcast --slow
```

`--slow` sends one transaction at a time; without it anvil can pack a burst into a full block and leave the next one waiting forever. It writes `web/public/deployments.31337.json`. To see the app on it, copy that over `deployments.json` in a scratch checkout. The `LOCAL` entry in `network-rules.ts` describes chain 31337. Then run the app with `VITE_GIWA_RPC=http://127.0.0.1:8650 GIWA_RPC=http://127.0.0.1:8650`. Delete the file afterwards; don't commit it.

The same order is covered by `forge test --match-contract ChimiMainnetTest`.

## Launch day

1. **Confirm GIWA mainnet's details** on docs.giwa.io: chain id, RPC, explorer. Use a production RPC provider; GIWA's public RPC is rate-limited and "not suitable for production" per its docs. Also confirm:
   - WETH has code at `0x4200000000000000000000000000000000000006`;
   - Multicall3 has code at `0xcA11bde05977b3631167028862bE2a173976CA11`;
   - the DojangScroll and up.id addresses, and the Upbit attester id.
2. **Deploy** from `contracts/`:

   ```bash
   EXPECTED_CHAIN_ID=<id> PLATFORM=0x… KEEPER=0x… LAUNCH_VIRTUAL_QUOTE=<wei> PRIVATE_KEY=0x… \
     FOUNDRY_PROFILE=deploy forge script script/DeployChimiMainnet.s.sol --rpc-url <RPC> --broadcast --slow
   ```

   The run stops if the RPC isn't on `EXPECTED_CHAIN_ID`, if it's GIWA Sepolia, or if anything it checks afterwards is off. Those checks are: owners, the 2% DEX with its owner given up, both splits, the upgrade, the keeper, and every launch's 5% going to the burner. It writes `web/public/deployments.<id>.json`.
3. **Verify the contracts** on GIWA's explorer (`forge verify-contract`), so anyone can read them.
4. **Fund the keeper** with a little mainnet ETH.
5. **Switch the app** in one PR:
   - add mainnet's entry to `NETWORKS` in `web/src/lib/chimi/network-rules.ts` (the template is in the comment there);
   - save today's `deployments.json` as `deployments.91342.json`;
   - move `deployments.<id>.json` to `deployments.json`;
   - read the docs page once more for wording that should change (the Dojang paragraph says how to get one on mainnet).
6. **Switch Vercel** (production env), then deploy:
   - `KV_REST_API_URL` / `KV_REST_API_TOKEN` → the new, empty Redis;
   - `KEEPER_PRIVATE_KEY` → the mainnet keeper;
   - `GIWA_RPC` and `VITE_GIWA_RPC` → the production RPC;
   - `CHIMI_SEASON_START` → the first points day;
   - keep `CRON_SECRET`, `CHIMI_ADMIN_TOKEN`, `TWITTERAPI_IO_KEY` and `BLOB_READ_WRITE_TOKEN`.
7. **Check** the site:
   - the board loads;
   - a launch with and without the burn box;
   - a buy and a sell;
   - `/api/keeper/flywheel?dry=1` (with the cron secret) plans the burns;
   - a tip;
   - CHIMI carries the **Official** tag on the board (it is `burner.chimi` in `deployments.json`);
   - once the keeper has burned, CHIMI's **Burned** column on the board is above 0%. The keeper burns on its daily run, or when called with the cron secret after some trading. The column reads the burn address with Multicall3, so a column stuck on "—" means Multicall3 is missing (step 1);
   - from a wallet with a Dojang, found a house with a **picture seal**. The upload going through shows `BLOB_READ_WRITE_TOKEN` works on this deployment;
   - **Connect, Disconnect, Connect again**: the wallet asks which account to share, and with two wallets installed Chimi first asks which wallet;
   - a launch with **Lock my first buy** ticked: the coin page shows the creator lock card and a "Dev locked" tag, the lock is on `/locks`, and the creator's wallet holds none of the first buy.

To keep the testnet running alongside, deploy a second Vercel project (e.g. testnet.chimi.club) from a branch whose `deployments.json` is Sepolia's. Before step 6 switches production's settings, copy today's to the new project:
- the old Redis (`KV_REST_API_URL` / `KV_REST_API_TOKEN`);
- the testnet keeper (`KEEPER_PRIVATE_KEY`);
- the Sepolia RPCs (`GIWA_RPC` / `VITE_GIWA_RPC`);
- `CHIMI_SEASON_START`;
- `BLOB_READ_WRITE_TOKEN`, `CRON_SECRET`, `CHIMI_ADMIN_TOKEN` and `TWITTERAPI_IO_KEY`.

Without the Blob token there, coin pictures and house picture seals can't be uploaded on the testnet.

If testnet users should get something on mainnet, snapshot first: CHIMI holders, points, Houses. That data lives in the old Redis and on GIWA Sepolia.

The mainnet waitlist (`/mainnet`) promised its wallets the OG seal and a first-week points boost. Before step 6 switches Redis, export it from the testnet site:

```bash
curl -H "Authorization: Bearer $CHIMI_ADMIN_TOKEN" "https://www.chimi.club/api/waitlist?export=csv" -o chimi-mainnet-waitlist.csv
```

It lists wallet, place and join time in order. It lives in the old Redis as the sorted set `chimi:waitlist:v1`.
