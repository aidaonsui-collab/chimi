# Chimi

Instant DEX launchpad for GIWA. A create transaction mints 1 billion tokens into a locked Uniswap v3 pool quoted in wrapped ETH. There is no bonding curve.

The factory is the Arc Instant factory (`InstantErc20QuoteFactory`) with the quote set to WETH. Chimi deploys its own v3 factory, position manager, and router from Uniswap's published bytecode. The v3 factory owner is renounced on deploy so the protocol fee stays off.

## Contracts

```
cd contracts
forge test
```

Deploy to GIWA Sepolia (chain 91342). Keep `PRIVATE_KEY` in the environment.

```
forge script script/DeployChimiGiwa.s.sol \
  --rpc-url https://sepolia-rpc.giwa.io \
  --broadcast
```

The script writes `web/public/deployments.json`. Quote is the canonical WETH `0x4200…0006`. Opening virtual quote defaults to 1 ETH. The liquidity lock lasts 100 years. Optional env: `TREASURY`, `LOCK_DURATION`, `CREATION_FEE_WEI`, `LAUNCH_VIRTUAL_QUOTE`.

## Site

```
cd web
npm install
npm run dev
```

The page is the board, the launch sheet, and a coin page. It reads `/deployments.json` and talks to the GIWA Sepolia factory. Until that file has a factory address, the board shows preview coins and launch stays disabled.

### Token pictures

Name and symbol are on-chain; the picture, description, and links are a token profile, stored the same way as eve.fun (Arcfun):

1. **Picture bytes → Vercel Blob.** The browser shrinks the file to a 256px JPEG, then `POST /api/upload` (`web/src/server/upload.ts`) puts it under `chimi/` in a public Blob store and returns its `https://…public.blob.vercel-storage.com/chimi/…` URL. The limits are 1 MB, jpeg/png/gif/webp only, and 12 uploads/min per IP.
2. **Profile record → Upstash Redis (KV).** The creator signs a register message once (no gas) covering the payload hash, a single-use nonce and a timestamp. `POST /api/token-meta` (`web/src/server/token-meta.ts`) checks the signer is the coin's creator on the factory, burns the nonce, and merges the record into `chimi:token:meta:<lowercase token>`.
3. **Read-back.** Every page asks `GET /api/token-meta?tokens=…`, which does one KV `MGET` and is CDN-cached (`s-maxage=60`). After that it falls back to the GIWA explorer's token icon, then the copy kept in the launching browser, then the seal initials.

Env vars (same names as eve.fun): `BLOB_READ_WRITE_TOKEN`, which Vercel adds when a Blob store is connected, and `KV_REST_API_URL` + `KV_REST_API_TOKEN`, which Vercel adds when an Upstash Redis/KV store is connected (`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` also work). Without them, reads still work and pictures stay in the creator's browser. A creator can (re)publish from the coin page with "Set picture".


### Look and feel

The site is one dark theme, defined in `web/src/styles.css`: colour tokens under `@theme` (night-sky surfaces, the vermilion `seal` accent, `gold` for small highlights, `ok` and `down` for price moves) and a small set of component classes (`card`, `btn`, `field`, `seg`, `chip`, `skeleton`). Shared pieces live in `web/src/components/chimi/`: `shell.tsx` (side rail, top bar, status bar, phone tab bar), `ui.tsx`, `charts.tsx`, `icons.tsx`, `command.tsx` (search, opened with `/` or Cmd/Ctrl+K), `wallet-menu.tsx` and `toast.tsx`.

Numbers that several pages show (the ETH price, each pool's recent trades and ETH reserve, the chain head) are read once and shared through `web/src/lib/chimi/live.ts`. Contract reads go through Multicall3, and the board reads every pool's trades in one pass, so its cost doesn't grow with the number of coins.

### Trader pages

Every wallet has a page at `/u/<address>`: what it holds, what it has bought and sold, its profit, the coins it launched, its house and its points. Addresses across the site link to it, and pasting an address into search offers it.

The trades come from the trade record (`web/src/lib/chimi/ledger-rules.ts`, kept by `web/src/server/ledger.ts`). It works like the points book: there is no indexer. `GET /api/trader?wallet=0x…` reads the chain from where the record stopped, up to a budget per request, and answers with that wallet's record. It keeps one small document per wallet (a running tally per coin and the latest 200 trades) and a cursor, in the same Redis as the points book.

- It starts at the factory's own block, which it asks the GIWA explorer for once. Set `CHIMI_LEDGER_START` to a block number to skip that (a local fork, for example).
- The first fill reads about four days of chain per request, a few seconds apart, because the public RPC limits how fast logs can be read. A read that fails keeps everything before it.
- Profit is what selling brought in plus what is still held, less what was paid, at each pool's current price. Balances are read straight from the chain, so tokens that were transferred in or out show up in the balance without counting as a trade.
