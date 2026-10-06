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

Name and symbol are on-chain; the picture, description, and links are a token profile. After a launch the creator signs the profile once (no gas) and `/api/token-meta` stores it in Vercel Blob after checking the signer is the coin's creator on the factory. Every page reads profiles from that endpoint, falls back to the GIWA explorer's token icon, then to the copy kept in the launching browser, then to the seal initials.

Shared storage needs a Vercel Blob store connected to the project (Vercel adds `BLOB_READ_WRITE_TOKEN`). Without it, reads still work and pictures stay in the creator's browser. A creator can (re)publish from the coin page with "Set picture".

