/**
 * Keeps the points book (rules in lib/chimi/points-rules.ts). There is no indexer: whenever someone asks for points and
 * the book is more than FRESH_MS old, it reads the chain from where it stopped, up to a budget per request, and saves.
 * It reads up to GIWA's "safe" head (a few minutes behind), so a swap it counts can't be undone by a reorg.
 */
import { createPublicClient, formatEther, http, parseAbiItem, type Address } from "viem";
import deployment from "../../public/deployments.json";
import { factoryAbi, giwaSepolia, poolAbi } from "@/lib/chimi/chain";
import { readProfiles } from "@/lib/chimi/identity";
import {
  CREATOR_SHARE,
  DAILY_POOL,
  closable,
  closeDays,
  emptyBook,
  sameSettings,
  score,
  type PointsFile,
  type PointsSettings,
} from "@/lib/chimi/points-rules";
import { docStore, takeLock } from "@/server/store";

const KEY = "chimi:points:v1";
const SPAN = 9_000; // GIWA's RPC serves up to 10,000 blocks per log query
const PARALLEL = 6; // spans read at once
const MAX_SPANS = 96; // ~10 days of chain per request, if the time budget allows
const TIME_BUDGET_MS = 8_000;
const FRESH_MS = 15_000;
const PROFILE_TTL_MS = 30 * 60_000;
const PROFILE_BATCH = 300;

const swapEvent = parseAbiItem(
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
);

export const giwa = () =>
  // GIWA_RPC points the server at another node, such as a local fork.
  createPublicClient({ chain: giwaSepolia, transport: http(process.env.GIWA_RPC || undefined, { batch: true }) });

export const pointsSettings = (): PointsSettings => ({
  chainId: giwaSepolia.id,
  factory: deployment.factory.toLowerCase(),
  dailyPool: DAILY_POOL,
  creatorShare: CREATOR_SHARE,
  seasonStart: process.env.CHIMI_SEASON_START || "2026-10-25",
});

/**
 * The points book, brought up to date first when it's stale. `file` is null until the first read finishes; `writable`
 * is false when there's nowhere to keep it (no Redis), and then it never fills.
 */
export async function currentPoints(): Promise<{ file: PointsFile | null; writable: boolean }> {
  const store = docStore<PointsFile>(KEY);
  const settings = pointsSettings();
  const { doc, rev } = await store.load();
  const book = doc && sameSettings(doc, settings) ? doc : null;
  const out = (file: PointsFile | null) => ({ file, writable: store.writable });
  if (!store.writable || (book && Date.now() - book.updatedAt < FRESH_MS)) return out(book);
  // One request reads the chain at a time; the others get the book as it is.
  const release = await takeLock(`${KEY}:lock`, 30_000);
  if (!release) return out(book);
  try {
    const next = await advance(book, settings);
    if (await store.save(next, rev)) return out(next);
    return out((await store.load()).doc ?? next);
  } catch (e) {
    console.error("[points]", e instanceof Error ? e.message : e);
    return out(book);
  } finally {
    await release();
  }
}

async function advance(prev: PointsFile | null, settings: PointsSettings): Promise<PointsFile> {
  const started = Date.now();
  const client = giwa();
  const head = await client.getBlock({ blockTag: "safe" });
  const headNum = Number(head.number);

  let book: PointsFile;
  if (prev) book = structuredClone(prev);
  else {
    // Start at the season's first block (GIWA makes one a second), or at the head if the season hasn't begun.
    const startTs = Date.parse(`${settings.seasonStart}T00:00:00+09:00`) / 1000;
    const start = Math.max(1, headNum - Math.max(0, Number(head.timestamp) - startTs));
    book = emptyBook(settings, start - 1, 0);
  }

  // Coins launched since the last read. The factory's list only grows.
  const length = Number(
    await client.readContract({ address: deployment.factory as Address, abi: factoryAbi, functionName: "allTokensLength", blockNumber: head.number }),
  );
  if (length > book.tokens) {
    const index = Array.from({ length: length - book.tokens }, (_, i) => BigInt(book.tokens + i));
    const tokens = await client.multicall({
      allowFailure: false,
      blockNumber: head.number,
      contracts: index.map((i) => ({ address: deployment.factory as Address, abi: factoryAbi, functionName: "allTokens", args: [i] }) as const),
    });
    const pools = await client.multicall({
      allowFailure: false,
      blockNumber: head.number,
      contracts: tokens.map((t) => ({ address: deployment.factory as Address, abi: factoryAbi, functionName: "getPool", args: [t] }) as const),
    });
    const token0 = await client.multicall({
      allowFailure: false,
      blockNumber: head.number,
      contracts: pools.map((p) => ({ address: p.uniPool, abi: poolAbi, functionName: "token0" }) as const),
    });
    tokens.forEach((token, i) => {
      book.pools[pools[i]!.uniPool.toLowerCase()] = {
        token: token.toLowerCase(),
        creator: pools[i]!.creator.toLowerCase(),
        wethIs0: token0[i]!.toLowerCase() === deployment.weth.toLowerCase(),
      };
    });
    book.tokens = length;
  }

  // Swaps on every Chimi pool, a span at a time. A swap pays out to its recipient, which is the trader, unless a
  // router took the output to unwrap it: then the trader is whoever sent the transaction.
  const pools = Object.keys(book.pools) as Address[];
  const routers = new Set([deployment.swapRouter, deployment.positionManager].map((a) => a.toLowerCase()));
  for (let spans = 0; book.through < headNum && spans < MAX_SPANS && Date.now() - started < TIME_BUDGET_MS; spans += PARALLEL) {
    const from = book.through + 1;
    const to = Math.min(headNum, from + SPAN * PARALLEL - 1);
    if (pools.length > 0) {
      const ranges = Array.from({ length: Math.ceil((to - from + 1) / SPAN) }, (_, i) => [from + i * SPAN, Math.min(to, from + (i + 1) * SPAN - 1)]);
      const logs = (
        await Promise.all(
          ranges.flatMap(([a, b]) =>
            chunks(pools, 500).map((address) => client.getLogs({ address, event: swapEvent, fromBlock: BigInt(a!), toBlock: BigInt(b!), strict: true })),
          ),
        )
      ).flat();
      const viaRouter = [...new Set(logs.filter((l) => routers.has(l.args.recipient.toLowerCase())).map((l) => l.transactionHash))];
      const senders = new Map(
        await Promise.all(viaRouter.map(async (hash) => [hash, (await client.getTransaction({ hash })).from.toLowerCase()] as const)),
      );
      const times = await blockTimes(client, logs);
      for (const log of logs) {
        const pool = book.pools[log.address.toLowerCase()];
        if (!pool) continue;
        const recipient = log.args.recipient.toLowerCase();
        const wallet = routers.has(recipient) ? senders.get(log.transactionHash) : recipient;
        const weth = pool.wethIs0 ? log.args.amount0 : log.args.amount1;
        if (!wallet) continue;
        score(book, { wallet, creator: pool.creator, eth: Number(formatEther(weth < 0n ? -weth : weth)), ts: times.get(log.blockNumber)! });
      }
    }
    book.through = to;
  }
  book.throughTs = Number((await client.getBlock({ blockNumber: BigInt(book.through) })).timestamp);

  // Close the days the book has read past, checking each trader's Dojang now.
  const closing = closable(book);
  if (closing.length > 0) {
    const fresh = await readProfiles(client, closing.flatMap((d) => Object.keys(d.weights)));
    Object.assign(book.profiles, fresh);
    closeDays(book, (w) => fresh[w]?.verified ?? false);
  }

  // Names and Dojangs for the boards: today's traders and everyone with points, missing ones first.
  const now = Date.now();
  const wanted = new Set([...book.open.flatMap((d) => Object.keys(d.weights)), ...book.days.flatMap((d) => Object.keys(d.points))]);
  const stale = [...wanted]
    .filter((w) => !book.profiles[w] || now - book.profiles[w]!.at > PROFILE_TTL_MS)
    .sort((a, b) => (book.profiles[a]?.at ?? 0) - (book.profiles[b]?.at ?? 0))
    .slice(0, PROFILE_BATCH);
  Object.assign(book.profiles, await readProfiles(client, stale));

  book.updatedAt = Date.now();
  return book;
}

/** Each log's block time: from the log when the node includes it, else read once per block. */
async function blockTimes(client: ReturnType<typeof giwa>, logs: { blockNumber: bigint; blockTimestamp?: bigint | null }[]) {
  const times = new Map<bigint, number>();
  for (const l of logs) if (l.blockTimestamp != null) times.set(l.blockNumber, Number(l.blockTimestamp));
  const missing = [...new Set(logs.map((l) => l.blockNumber).filter((n) => !times.has(n)))];
  const blocks = await Promise.all(missing.map((blockNumber) => client.getBlock({ blockNumber })));
  for (const b of blocks) times.set(b.number, Number(b.timestamp));
  return times;
}

const chunks = <T,>(list: T[], size: number) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));
