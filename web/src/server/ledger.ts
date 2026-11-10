/**
 * Keeps the trade record (rules in lib/chimi/ledger-rules.ts): one small document per wallet, plus a cursor saying how
 * far along the chain the reader has got. Like the points book there is no indexer. When someone opens a wallet's page
 * and the cursor is more than FRESH_MS old, this reads the chain from where it stopped, up to a budget per request.
 *
 * It starts at the factory's own block, so the record covers every trade ever made on Chimi, and it reads up to GIWA's
 * "safe" head, so a trade it counts can't be undone by a reorg. Wallet documents are written before the cursor moves,
 * and each wallet skips trades it has already counted, so a request that dies halfway does no harm.
 */
import { formatEther, type Address } from "viem";
import deployment from "../../public/deployments.json";
import { factoryAbi, giwaSepolia, poolAbi } from "@/lib/chimi/chain";
import { LEDGER_VERSION, byChainOrder, emptyWallet, record, type LedgerCursor, type Trade, type WalletBook } from "@/lib/chimi/ledger-rules";
import { env } from "@/server/env";
import { kvMGetJson, kvReady } from "@/server/kv";
import { blockTimes, giwa, swapEvent } from "@/server/points";
import { docStore, takeLock } from "@/server/store";

const KEY = "chimi:ledger:v1";
const SPAN = 9_000; // GIWA's RPC serves up to 10,000 blocks per log query
const PARALLEL = 4; // spans read at once
const MAX_SPANS = 40; // ~4 days of chain per request: the public RPC limits how fast it can be read
const TIME_BUDGET_MS = 6_500;
const FRESH_MS = 20_000;
const BEHIND_S = 15 * 60; // further than this from now, the reader is still catching up
const CATCH_UP_GAP_MS = 5_000; // and while it is, this is the least time between two reads
const WRITES_AT_ONCE = 16;

const walletStore = (wallet: string) => docStore<WalletBook>(`${KEY}:w:${wallet.toLowerCase()}`);

const mine = (c: LedgerCursor) => c.version === LEDGER_VERSION && c.chainId === giwaSepolia.id && c.factory === deployment.factory.toLowerCase();

export type TraderRecord = {
  wallet: string;
  /** Null when the wallet has never traded on Chimi (or the reader hasn't reached its first trade yet). */
  book: WalletBook | null;
  /** Every trade up to this block and time is counted; 0 until the reader has run once. */
  through: number;
  throughTs: number;
  /** The first block the record covers. */
  start: number;
  /** False when there is nowhere to keep the record (no Redis), and then it never fills. */
  writable: boolean;
};

/** Where the reader stands, after bringing it closer to the chain's head when it has fallen behind. */
async function freshCursor(): Promise<{ cursor: LedgerCursor | null; writable: boolean }> {
  const store = docStore<LedgerCursor>(KEY);
  const { doc, rev } = await store.load();
  let cursor = doc && mine(doc) ? doc : null;
  // Fresh means read moments ago and close to the head. While it is still working through old blocks (the first
  // fill, or after a long quiet spell) requests carry it further, a few seconds apart.
  const age = cursor ? Date.now() - cursor.updatedAt : Infinity;
  const behind = !cursor || Date.now() / 1000 - cursor.throughTs > BEHIND_S;
  const fresh = age < (behind ? CATCH_UP_GAP_MS : FRESH_MS);
  if (store.writable && !fresh) {
    // One request reads the chain at a time; the others answer from what is already saved.
    const release = await takeLock(`${KEY}:lock`, 30_000);
    if (release) {
      try {
        const next = await advance(cursor);
        cursor = (await store.save(next, rev)) ? next : ((await store.load()).doc ?? next);
      } catch (e) {
        console.error("[ledger]", e instanceof Error ? e.message : e);
      } finally {
        await release();
      }
    }
  }
  return { cursor, writable: store.writable };
}

/** One wallet's trade record, with the reader brought closer to the chain's head first when it has fallen behind. */
export async function traderRecord(wallet: string): Promise<TraderRecord> {
  const { cursor, writable } = await freshCursor();
  const { doc: book } = await walletStore(wallet).load();
  return {
    wallet: wallet.toLowerCase(),
    book: book && book.version === LEDGER_VERSION ? book : null,
    through: cursor?.through ?? 0,
    throughTs: cursor?.throughTs ?? 0,
    start: cursor?.start ?? 0,
    writable,
  };
}

export type FeedTrade = Trade & { wallet: string };

export type Feed = {
  /** The latest trades by the wallets asked for, newest first. */
  trades: FeedTrade[];
  through: number;
  throughTs: number;
  writable: boolean;
};

/** The latest trades made by any of these wallets, newest first: what a "following" feed shows. */
export async function tradeFeed(wallets: string[], limit = 60): Promise<Feed> {
  const { cursor, writable } = await freshCursor();
  const list = [...new Set(wallets.map((w) => w.toLowerCase()))];
  const trades: FeedTrade[] = [];
  for (const [i, book] of (await walletBooks(list)).entries()) {
    if (book?.version !== LEDGER_VERSION) continue;
    for (const trade of book.recent.slice(-limit)) trades.push({ ...trade, wallet: list[i]! });
  }
  trades.sort((a, b) => byChainOrder(b, a));
  return { trades: trades.slice(0, limit), through: cursor?.through ?? 0, throughTs: cursor?.throughTs ?? 0, writable };
}

/**
 * Which of these wallets have ever bought this coin. Like the other readers it first brings the record closer to the
 * chain's head when it has fallen behind, so the answer doesn't depend on someone having opened a trader's page
 * lately. The last few minutes are still missing; the coin's page fills those in from the trades it has read itself.
 */
export async function everBought(token: string, wallets: string[]): Promise<string[]> {
  const list = [...new Set(wallets.map((w) => w.toLowerCase()))];
  if (list.length === 0) return [];
  await freshCursor();
  const coin = token.toLowerCase();
  const books = await walletBooks(list);
  return list.filter((_, i) => books[i]?.version === LEDGER_VERSION && (books[i]?.coins[coin]?.buys ?? 0) > 0);
}

/** Many wallets' documents at once: one Redis read for all of them. */
async function walletBooks(wallets: string[]): Promise<(WalletBook | null)[]> {
  if (wallets.length === 0) return [];
  if (kvReady()) return kvMGetJson<WalletBook>(wallets.map((w) => `${KEY}:w:${w}`));
  return Promise.all(wallets.map(async (w) => (await walletStore(w).load()).doc));
}

/**
 * The block the factory was created in. Nothing can have traded before it. CHIMI_LEDGER_START sets it by hand;
 * otherwise the chain's explorer is asked once and the answer is kept in the cursor.
 */
async function factoryBlock(): Promise<number> {
  const fixed = Number(env("CHIMI_LEDGER_START"));
  if (Number.isInteger(fixed) && fixed > 0) return fixed;
  const url = `${giwaSepolia.blockExplorers.default.url}/api?module=contract&action=getcontractcreation&contractaddresses=${deployment.factory}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  const body = (await res.json().catch(() => null)) as { result?: { blockNumber?: string }[] } | null;
  const block = Number(body?.result?.[0]?.blockNumber);
  if (!res.ok || !Number.isInteger(block) || block <= 0) throw new Error("couldn't find the factory's first block; set CHIMI_LEDGER_START");
  return block;
}

async function advance(prev: LedgerCursor | null): Promise<LedgerCursor> {
  const started = Date.now();
  const client = giwa();
  const head = await client.getBlock({ blockTag: "safe" });
  const headNum = Number(head.number);

  let cursor: LedgerCursor;
  if (prev) cursor = structuredClone(prev);
  else {
    const start = Math.min(await factoryBlock(), headNum);
    cursor = {
      version: LEDGER_VERSION,
      chainId: giwaSepolia.id,
      factory: deployment.factory.toLowerCase(),
      start,
      through: start - 1,
      throughTs: 0,
      tokens: 0,
      pools: {},
      updatedAt: 0,
    };
  }

  // Coins launched since the last read. The factory's list only grows, and a pool that is newer than the safe head
  // simply has no swaps in the blocks read below yet.
  const factory = deployment.factory as Address;
  const length = Number(await client.readContract({ address: factory, abi: factoryAbi, functionName: "allTokensLength" }));
  if (length > cursor.tokens) {
    const index = Array.from({ length: length - cursor.tokens }, (_, i) => BigInt(cursor.tokens + i));
    const tokens = await client.multicall({
      allowFailure: false,
      contracts: index.map((i) => ({ address: factory, abi: factoryAbi, functionName: "allTokens", args: [i] }) as const),
    });
    const pools = await client.multicall({
      allowFailure: false,
      contracts: tokens.map((t) => ({ address: factory, abi: factoryAbi, functionName: "getPool", args: [t] }) as const),
    });
    const token0 = await client.multicall({
      allowFailure: false,
      contracts: pools.map((p) => ({ address: p.uniPool, abi: poolAbi, functionName: "token0" }) as const),
    });
    tokens.forEach((token, i) => {
      cursor.pools[pools[i]!.uniPool.toLowerCase()] = {
        token: token.toLowerCase(),
        wethIs0: token0[i]!.toLowerCase() === deployment.weth.toLowerCase(),
      };
    });
    cursor.tokens = length;
  }

  // Swaps on every Chimi pool, a few spans at a time. The trader is whoever received the swap's output, unless a router
  // took it to unwrap: then it is whoever sent the transaction.
  const pools = Object.keys(cursor.pools) as Address[];
  const routers = new Set([deployment.swapRouter, deployment.positionManager].map((a) => a.toLowerCase()));
  for (let spans = 0; cursor.through < headNum && spans < MAX_SPANS && Date.now() - started < TIME_BUDGET_MS; spans += PARALLEL) {
    const from = cursor.through + 1;
    const to = Math.min(headNum, from + SPAN * PARALLEL - 1);
    try {
      if (pools.length > 0) await readStretch(client, cursor, pools, routers, from, to);
    } catch (e) {
      // Usually the RPC's rate limit. Keep everything read before this stretch; the next request carries on from here.
      console.error("[ledger]", `stopped at block ${from}:`, e instanceof Error ? e.message.split("\n")[0] : e);
      break;
    }
    cursor.through = to;
  }
  if (cursor.through >= cursor.start) {
    // GIWA makes a block a second, which is close enough if the block itself can't be read just now.
    const guess = Number(head.timestamp) - (headNum - cursor.through);
    cursor.throughTs = await client.getBlock({ blockNumber: BigInt(cursor.through) }).then(
      (b) => Number(b.timestamp),
      () => guess,
    );
  }
  cursor.updatedAt = Date.now();
  return cursor;
}

/** Reads every swap between two blocks and adds each to its trader's document. */
async function readStretch(client: ReturnType<typeof giwa>, cursor: LedgerCursor, pools: Address[], routers: Set<string>, from: number, to: number) {
  const ranges = Array.from({ length: Math.ceil((to - from + 1) / SPAN) }, (_, i) => [from + i * SPAN, Math.min(to, from + (i + 1) * SPAN - 1)]);
  const logs = (
    await Promise.all(
      ranges.flatMap(([a, b]) =>
        chunks(pools, 500).map((address) => client.getLogs({ address, event: swapEvent, fromBlock: BigInt(a!), toBlock: BigInt(b!), strict: true })),
      ),
    )
  ).flat();
  if (logs.length === 0) return;
  const viaRouter = [...new Set(logs.filter((l) => routers.has(l.args.recipient.toLowerCase())).map((l) => l.transactionHash))];
  const senders = new Map(await Promise.all(viaRouter.map(async (hash) => [hash, (await client.getTransaction({ hash })).from.toLowerCase()] as const)));
  const times = await blockTimes(client, logs);
  const byWallet = new Map<string, Trade[]>();
  for (const log of logs) {
    const pool = cursor.pools[log.address.toLowerCase()];
    if (!pool) continue;
    const recipient = log.args.recipient.toLowerCase();
    const wallet = routers.has(recipient) ? senders.get(log.transactionHash) : recipient;
    if (!wallet) continue;
    const weth = pool.wethIs0 ? log.args.amount0 : log.args.amount1;
    const coin = pool.wethIs0 ? log.args.amount1 : log.args.amount0;
    if (coin === 0n) continue;
    const list = byWallet.get(wallet) ?? [];
    byWallet.set(wallet, list);
    list.push({
      t: times.get(log.blockNumber)!,
      b: Number(log.blockNumber),
      i: log.logIndex,
      tx: log.transactionHash,
      token: pool.token,
      // The pool paying the coin out is someone buying it.
      buy: coin < 0n,
      tokens: Number(formatEther(coin < 0n ? -coin : coin)),
      eth: Number(formatEther(weth < 0n ? -weth : weth)),
    });
  }
  await writeTrades(byWallet);
}

/** Adds each wallet's new trades to its document. A wallet that has already counted a trade leaves it out. */
async function writeTrades(byWallet: Map<string, Trade[]>) {
  const jobs = [...byWallet.entries()];
  for (const group of chunks(jobs, WRITES_AT_ONCE)) {
    await Promise.all(
      group.map(async ([wallet, trades]) => {
        const store = walletStore(wallet);
        const sorted = [...trades].sort(byChainOrder);
        // The lock means nobody else is writing; one retry covers a write that raced anyway.
        for (let attempt = 0; attempt < 2; attempt++) {
          const { doc, rev } = await store.load();
          const book = doc && doc.version === LEDGER_VERSION ? doc : emptyWallet(wallet);
          let changed = false;
          for (const trade of sorted) changed = record(book, trade) || changed;
          if (!changed || (await store.save(book, rev))) return;
        }
        throw new Error(`couldn't save trades for ${wallet}`);
      }),
    );
  }
}

const chunks = <T,>(list: T[], size: number) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));
