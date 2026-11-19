# Chimi

Instant DEX launchpad for GIWA. A create transaction mints 1 billion tokens into a locked Uniswap v3 pool quoted in wrapped ETH. There is no bonding curve.

The factory is the Arc Instant factory (`InstantErc20QuoteFactory`) with the quote set to WETH. Chimi deploys its own v3 factory, position manager, and router from Uniswap's published bytecode. The v3 factory owner is renounced on deploy so the protocol fee stays off.

## Contracts

```
cd contracts
npm install
forge test
```

`npm install` fetches the three libraries the contracts compile against: forge-std, OpenZeppelin 5.7.0 and Uniswap v4-core 1.0.2 (for `TickMath` only). They are pinned in `package-lock.json` to the versions the live contracts were built with, so a fresh build has the same executable code as the contracts on GIWA Sepolia. Only the compiler's metadata hash differs, because it records file paths.

`test/ChimiFull.t.sol` runs the pad, the DEX and the locker together on two local stacks, one for each currency order (the launch token as currency0 and as currency1). The tests named `test_gap_…` describe things the contracts allow today that a launchpad would rather not: no cap on the creator's first buy, and a locker that its proxy admin can replace.

`test/ChimiLive.t.sol` checks the contracts that are live on GIWA Sepolia, at the addresses in `web/public/deployments.json`, on a fork. It sends nothing to the real chain, and is skipped unless `GIWA_RPC` is set:

```
GIWA_RPC=https://sepolia-rpc.giwa.io forge test --match-contract ChimiLiveForkTest
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

The home page is the board: every coin on Chimi. The feed is on the Traders page, and the launch sheet, a page per coin and a page per trader sit beside them. The site reads `/deployments.json` and talks to the GIWA Sepolia factory. Until that file has a factory address, the board shows preview coins and launch stays disabled.

### The home page

`/` is the roof banner, then the board: every pair on Chimi in one table (`web/src/components/chimi/home-hero.tsx`, `home-board.tsx`).

- **The banner** keeps the roof; the message on it takes turns every seven seconds: what Chimi is, the traders to follow, the day's points, the houses. It holds still under the pointer and for visitors who ask for less motion, and the bars at its foot pick a message. Live totals sit on glass at its right on a laptop.
- **The table** orders the pairs by Trending (the day's volume), New (launch time), Top (market cap) or Gainers (the day's move). A row is the pair, its age, market cap, the day's move, volume, liquidity, trades, the day's line and one quick-buy button; a phone keeps the pair, market cap and move, the line and the button, and the other columns come in as the screen widens. `/board` now sends to `/`.

### Traders: the feed and the leaderboard

`/traders` is the social side, laid out like a trading floor's social tab. Three tiles say what the last day was about: the coin with the most comments, the coin that took the most ETH in buys, and the wallet that traded the most (`web/src/lib/chimi/social-rules.ts`, tests in `web/test/social.test.ts`). Under them the feed runs beside the Top traders card (season points, or the day's trading before a season has points; Follow takes the number's place under the pointer; See all opens the leaderboard). `?view=leaderboard` is the whole list of traders, by season points, followers or the day's trading. A phone switches between Feed and Leaderboard with the control under the title, and the tiles scroll sideways.

The feed shows what is happening, newest first: buys and sales, launches, comments, a coin crossing a round market cap, and the times someone who follows you bought a coin after you did.

- **Tabs.** For you is everything; once the feed is crowded, small trades by wallets you don't follow drop out. Following is what the wallets you follow bought, sold, launched and said. New is launches. Top is the coins by the day's volume.
- **Bursts.** Three or more trades on one coin, each within five minutes of the one before, are one row in For you: how many wallets, which way, how much and how fast, with the trades a press away (`groupBursts` in `feed-rules.ts`). A burst covers 30 minutes at most, so a coin that trades all day reads as several cards. Your own trades, those of wallets you follow and the day's largest buy always keep a card of their own. A burst that gains a trade moves to the top like a new row.
- **The post box** leads For you: write something and it goes out as a comment on one coin, so it lands in the feed with the coin under it and on that coin's page. The coin is the one picked from the chip under the text (a searchable list, biggest first) or else the first coin the text names with a $, like $CHIMI (`web/src/lib/chimi/post-rules.ts`, tests in `web/test/post.test.ts`). The comment rules hold as on a coin's page: signed with the wallet, no gas, a Dojang, 280 characters, no links, one comment per coin every 15 seconds. The new post shows at once, and the feed reads its comments again right away (`notePosted` in `web/src/lib/chimi/feed.ts`).
- **Comments in the feed are posts**: who said it and what they hold, what they said, the coin as a card under it (price, the day's move and line), and its replies and likes. The heart works from the post; Reply opens the comment on the coin's page. Trades stay compact rows.
- **A row, not a card.** The feed is one list. A row is a line of who did what and a quieter line of detail, with the coin's market cap, the day's line and move, the time and one small buy button at its end. A 1440×900 screen shows about twelve rows and a phone eight or nine (cards showed three or four, and two or three). A lone trade by a wallet you don't follow is a single line; your own trades, those of wallets you follow, the day's largest buy and bursts get both lines, and what a wallet you follow did carries a gold edge. On a phone the buy button sits at the end of the second line so the sentence keeps the full width. Follow, Copy and a burst's Trades button appear under the pointer on a wide screen and are left out on a phone, where tapping a burst opens its trades.
- **Proof beside a name.** A trade or comment row says what its wallet holds of that coin right now ("holds 1.2%", "sold all"); the balances of every row on screen are read together and again when the feed changes (`web/src/lib/chimi/holdings.ts`). A wallet in the season's top ten carries its rank ("#3"), and the Dojang mark stays.
- **Quick buy** spends one amount, chosen once above the feed and remembered in the browser (`web/src/lib/chimi/quick.ts`). It is one confirmation. The minimum received comes from a dry run of that exact swap, so it allows for the price the buy itself moves, less 2% (`quickBuy` in `web/src/components/chimi/provider.tsx`). The button says what is happening: asking the wallet, then done.
- **It opens at once.** The last feed a browser saw is kept and painted immediately on the next visit, then replaced by the chain's answer (`chimi.feed.last` in localStorage; written by `web/src/lib/chimi/feed.ts`).
- **It stays live.** Every 8 seconds the page asks for just the trades since its last read, in one request for all pools (`loadSwapsSince` in `market.ts`, `tailSwaps` in `live.ts`). A new row is lit for a moment as it arrives, and a reader who has scrolled down gets a "3 new" pill instead of a jump. The full ten-request read still runs every ten minutes.
- **One slim bar.** The tabs, the Live mark and the quick-buy amount share one bar at the top of the feed.
- **A quiet chain.** When nothing has happened for an hour the feed leads with the last day in three numbers and a way to start something. Every coin's launch is always in the feed, so it is never empty once a coin exists.
- **The live strip** in the top bar of every page shows the last day's trades and launches moving past (`useTicker` in `feed.ts`, which reads only the pools, not the feed's comments and follows). It holds still under the pointer and for visitors who ask for less motion, and says so on a quiet day. On a phone it is a thin line above the bar.

Nothing new is read from the chain for this. Trades come from the pools the board already follows, launch times from the factory's events, comments from `GET /api/comments?recent=20&tokens=…`, and who follows whom from the follow list. The rules that turn those into one list are in `web/src/lib/chimi/feed-rules.ts`, with tests in `web/test/feed.test.ts`.

Not built yet: house updates in the feed.

### Token pictures

Name and symbol are on-chain; the picture, description, and links are a token profile, stored the same way as eve.fun (Arcfun):

1. **Picture bytes → Vercel Blob.** The browser shrinks the file to a 256px JPEG, then `POST /api/upload` (`web/src/server/upload.ts`) puts it under `chimi/` in a public Blob store and returns its `https://…public.blob.vercel-storage.com/chimi/…` URL. The limits are 1 MB, jpeg/png/gif/webp only, and 12 uploads/min per IP.
2. **Profile record → Upstash Redis (KV).** The creator signs a register message once (no gas) covering the payload hash, a single-use nonce and a timestamp. `POST /api/token-meta` (`web/src/server/token-meta.ts`) checks the signer is the coin's creator on the factory, burns the nonce, and merges the record into `chimi:token:meta:<lowercase token>`.
3. **Read-back.** Every page asks `GET /api/token-meta?tokens=…`, which does one KV `MGET` and is CDN-cached (`s-maxage=60`). After that it falls back to the GIWA explorer's token icon, then the copy kept in the launching browser, then the seal initials.

Env vars (same names as eve.fun): `BLOB_READ_WRITE_TOKEN`, which Vercel adds when a Blob store is connected, and `KV_REST_API_URL` + `KV_REST_API_TOKEN`, which Vercel adds when an Upstash Redis/KV store is connected (`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` also work). Without them, reads still work and pictures stay in the creator's browser. A creator can (re)publish from the coin page with "Set picture".


### The quote in the trade panel

The coin page's trade panel shows what the pool would really pay for the amount typed, the price impact, and the minimum received. GIWA has no quoter contract, so the page runs the swap itself as a call that changes nothing (`web/src/lib/chimi/quote.ts`): the node is asked what the router would pay a stand-in wallet that, for the length of that one call, is given the ETH or the coins to spend (an `eth_call` with a state override; for a sale the stand-in's balance and allowance are written into the coin's storage, which is OpenZeppelin's standard layout). The answer accounts for the fee, the pool's depth and every range the price crosses.

- The quote is asked for a moment after typing stops, again every 12 seconds while an amount sits there, and again when the pool's price changes.
- **Price impact** is what the trade loses to its own weight beyond the pool's fee (`web/src/lib/chimi/quote-rules.ts`). From 1% it is shown in gold; from 5% in red, with a note that a smaller amount gets a better price.
- **Minimum received** is the quote less the chosen slippage, and it is the floor sent with the trade. If Buy or Sell is pressed before the quote has arrived, the page asks for it first.
- If the node can't answer, the panel falls back to the price on the screen less the fee and says "Minimum received, about". That estimate ignores the trade's own weight, so a large trade made on it can fail on its floor rather than fill badly.

### Selling for ETH

A sale is an approval and then one transaction. The site calls the router's `multicall` with two steps: the swap, addressed to the router itself, and `unwrapWETH9`, which turns the pool's wrapped ETH into ETH and pays the seller. Both happen or neither does, the same minimum applies to both, and the sale lapses after 20 minutes. A buy or sale that lands but fails on-chain is reported as failed.

Because the router receives the swap's output, the pool's `Swap` log names the router as the recipient of a sale. The seller is read from the coin's `Transfer` into the pool in the same transaction (`nameSellers` in `web/src/lib/chimi/market.ts`), with one extra log read per window of blocks that has such sales. The points book and the trade record already resolve these through the transaction's sender.

### Creator fees

Each coin's launch liquidity is held by the locker and earns the pool's 1% fee. Of the part paid in ETH, the creator's share (70% today, stamped on the lock at launch) goes to the creator and the rest to the platform; the part paid in the coin is burned. Nothing moves until the position is swept with `collectFees` on the locker, which anyone can call.

- A coin's page shows its creator a **Your creator fees** card with the amount waiting and a Claim button (`web/src/components/chimi/creator-fees.tsx`).
- A trader's own page lists the fees waiting on each coin they launched, with one button that sweeps them all (`collectFeesBatch`).
- The locker pays wrapped ETH, so a claim is two confirmations: the sweep, then unwrapping what arrived. Turning down the second leaves the wrapped ETH in the wallet; the trade panel offers to unwrap any the wallet holds.
- The amount waiting is a dry run of the sweep (`web/src/lib/chimi/fees.ts`).

### Look and feel

The site is one dark theme, defined in `web/src/styles.css`: colour tokens under `@theme` (night-sky surfaces, the vermilion `seal` accent, `gold` for small highlights, `ok` and `down` for price moves) and a small set of component classes (`card`, `btn`, `field`, `seg`, `chip`, `skeleton`). Buttons, chips and tab controls are pills; the picked tab is a light pill. Shared pieces live in `web/src/components/chimi/`: `shell.tsx` (an icon-only side rail with names beside the icons under the pointer and Launch as its round light button; search opens with `/` or Cmd/Ctrl+K, and on a phone from the magnifier in the top bar, the top bar with the live strip, the status bar, and on a phone one floating bar of icons with Launch in the middle), `ui.tsx`, `charts.tsx`, `icons.tsx`, `command.tsx` (search, opened with `/` or Cmd/Ctrl+K), `wallet-menu.tsx` and `toast.tsx`.

Numbers that several pages show (the ETH price, each pool's recent trades and ETH reserve, the chain head) are read once and shared through `web/src/lib/chimi/live.ts`. Contract reads go through Multicall3, and the board reads every pool's trades in one pass, so its cost doesn't grow with the number of coins.

### Trader pages

Every wallet has a page at `/u/<address>`: what it holds, what it has bought and sold, its profit, the coins it launched, its house and its points. Addresses across the site link to it, and pasting an address into search offers it.

The trades come from the trade record (`web/src/lib/chimi/ledger-rules.ts`, kept by `web/src/server/ledger.ts`). It works like the points book: there is no indexer. `GET /api/trader?wallet=0x…` reads the chain from where the record stopped, up to a budget per request, and answers with that wallet's record. It keeps one small document per wallet (a running tally per coin and the latest 200 trades) and a cursor, in the same Redis as the points book.

- It starts at the factory's own block, which it asks the GIWA explorer for once. Set `CHIMI_LEDGER_START` to a block number to skip that (a local fork, for example).
- The first fill reads about four days of chain per request, a few seconds apart, because the public RPC limits how fast logs can be read. A read that fails keeps everything before it.
- Profit is what selling brought in plus what is still held, less what was paid, at each pool's current price. Balances are read straight from the chain, so tokens that were transferred in or out show up in the balance without counting as a trade.

### Following

A wallet can follow other wallets and see their trades under **Following** in the feed on the Traders page. Trader pages show a Follow button, how many followers a wallet has, and who it follows.

- Following is a message the wallet signs, with no transaction, handled like house actions (`web/src/lib/chimi/follow-rules.ts`, `POST /api/follows`).
- Only a wallet with a GIWA Dojang can follow, so a follower count is a count of people. Anyone can be followed and anyone can unfollow. A wallet follows at most 100 others.
- Who follows whom is one public document in Redis (`chimi:follows:v1`), read through `GET /api/follows`.
- The feed has two sources. Trades from about the last day are read live from the chain in the browser. Older ones come from the trade record through `GET /api/feed?wallet=0x…`, which runs a few minutes behind the chain's head. The page merges the two and drops duplicates.

### Copying a buy, and leading one

Buys in the Following feed have a **Copy** button. It opens the coin's page on the buy side with a size filled in and a notice saying whose buy is being copied. The size is this browser's last choice (0.01 ETH the first time), and nothing is sent until the buy button is pressed.

Leading a buy earns points, worked out from the chain and the follow list alone, so there is nothing to claim and nothing to fake:

- When a wallet buys a coin within 24 hours after a wallet it follows bought the same coin, the followed wallet earns 10% of that buy as weight in the day's pool (`LEAD_SHARE`, `LEAD_WINDOW_S` in `web/src/lib/chimi/points-rules.ts`).
- The lead is capped at the size of the leader's own buy, so nobody is paid for leading with dust.
- If the buyer follows several such wallets, the one that bought most recently leads. A coin's creator never leads on their own coin.
- Nothing is taken from the buyer, and like every other point it only pays wallets with a Dojang.

It applies from the day this ships; earlier days are unchanged. A trader's page shows how many buys it has led.

### Comments

What is said about a coin leads the list under its chart: **Comments** is the first tab, beside Trades and Holders. Each comment shows who wrote it and what they hold of the coin at this moment: "holds 1.2%", "sold", or "Creator". The day's trades run between the threads as single lines ("8 trades · 0.06 ETH · 6 buys, 2 sales"), opened on request, so the talk and the tape read as one story (`web/src/lib/chimi/activity-rules.ts`). `?tab=comments|trades|holders` opens a list and `?c=<comment id>` brings one comment into view.

- A comment is a message the wallet signs, with no transaction (`web/src/lib/chimi/comment-rules.ts`, `POST /api/comments`). A signature is good for five minutes and only once.
- Only a wallet with a GIWA Dojang can comment, and only on a coin the factory made.
- Text only, up to 280 characters, and no links. One wallet can comment on one coin every 15 seconds at most.
- **Replies.** A comment can answer another. Threads are one level deep: an answer to an answer joins the same thread and names whom it answers. A thread shows its last three replies until the rest are asked for. When a comment is deleted its replies stay, as a thread of their own.
- **Likes.** A wallet with a Dojang can like a comment that isn't its own, once, and take the like back. Likes ride on a pass: the first like in a browser asks the wallet to sign one message that lets that browser like and unlike as the wallet for seven days, so every like after it is one press. The pass is kept in that browser only (`chimi.likes.pass.<wallet>` in localStorage), is checked on every like, and allows nothing else: writing, replying and deleting still take a signature each.
- A wallet can delete its own comments. The operator can take any comment out: `POST /api/comments` with `{ "admin": "delete", "token": "0x…", "id": "…" }` and the `CHIMI_ADMIN_TOKEN` bearer token.
- Each coin's comments are one document in Redis (`chimi:comments:v1:<token>`), which keeps the latest 500 and their likes. `GET /api/comments?token=0x…` answers with the newest 50 threads and every reply to them (`&limit=` for more threads, `&wallet=0x…` to learn which ones that wallet likes).
- What a commenter holds is read from the chain in the browser. "Sold" means the balance is zero and the trade record, or the trades the page has read itself, shows a buy.

### The inbox

A connected wallet has a bell in the top bar. It lists what other wallets did that concerns it, newest first, with a count of what is new:

- someone replied to its comment, or replied to someone else in a thread it started;
- someone liked its comment (likes of one comment are one line);
- someone commented on a coin it launched;
- someone followed it;
- a wallet that follows it bought a coin after it did (the buy that earns lead points).

The server adds an item when the thing happens: in `POST /api/comments` and `POST /api/follows`, and when the points book counts a led buy (`web/src/server/inbox.ts`; rules in `web/src/lib/chimi/inbox-rules.ts`). Adding to an inbox never fails the action that caused it. Each wallet's inbox is one document in Redis (`chimi:inbox:v1:<wallet>`) holding its latest 100 items, read with `GET /api/inbox?wallet=0x…`. Everything in an inbox is public already (comments, likes, follows and trades are), so reading takes no signature. What has been seen is remembered in the browser (`chimi.inbox.seen.<wallet>`), so the count is per browser. A line opens the comment on its coin's page, the coin, or the follower's page.

Not built: push or email notifications, and a count that follows the wallet across browsers.

### The coin chart

A coin's page charts its trades as candles, with volume underneath and the traders marked where they traded.

- It is drawn with [TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts) (Apache-2.0), loaded only on coin pages. Its mark stays on the chart, as the licence asks.
- Candles run from one minute to one day. A chart opens on the size that fits the coin's age, and can show price or market cap, as candles or a line. Drag to move through time, scroll or pinch to zoom.
- Candles are built in the browser from the pool's swaps (`web/src/lib/chimi/chart-rules.ts`). A candle opens where the one before it closed, a stretch with no trade is flat, and the latest 3,000 candles are kept.
- The whole history comes from the chain's explorer (`web/src/lib/chimi/history.ts`); the last day comes from the node and keeps the chart current. If the explorer can't be reached, or on a fork, the chart starts a day back.
- Traders are bubbles on the candles, ringed green for a buy and red for a sell: the creator is a "D", wallets you follow carry a star, and your own trades have a white ring. Other wallets show too, biggest trades first, up to 140 at once. The switch above the chart shows everyone, only those you follow, or nobody. A bubble opens that trader's page.
- Dollar figures use today's ETH price for the whole history, like the rest of the site.
