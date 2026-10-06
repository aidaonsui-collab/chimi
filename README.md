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

