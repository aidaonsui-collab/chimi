import { decodeEventLog, formatEther, pad, parseAbiItem, toEventSelector, zeroAddress, type Address } from "viem";
import { POOL_FEE, erc20Abi, factoryAbi, giwaChain, isDeployed, poolAbi, type Deployment } from "@/lib/chimi/chain";
import { publicClient } from "@/lib/chimi/client";
import { blocksOf, nameSellers, routerKept, sellersFromRawTransfers, sellersFromTransfers, type Unnamed as UnnamedSale } from "@/lib/chimi/sale-rules";

export type Coin = {
  token: Address;
  name: string;
  symbol: string;
  pool: Address;
  creator: Address;
  /** The launch position, held by the locker. Its fees are what the creator claims. */
  positionId?: bigint;
  sqrtPriceX96: bigint;
  tokenIs0: boolean;
  liquidity: bigint;
  /** Pool fee tier in hundredths of a bip (10000 = 1%). Read from the pool. */
  fee?: number;
  /** The Uniswap v3 factory that made the pool: which of Chimi's DEXes the coin trades on (`dexOf` in chain.ts). */
  uniFactory?: Address;
  preview?: boolean;
};

/** "1%", "0.3%", "0.05%" from a v3 fee tier. */
export function feeLabel(fee: number = POOL_FEE) {
  return `${Number((fee / 10_000).toFixed(4))}%`;
}

const Q96 = 2n ** 96n;

export function wethPerToken(sqrtPriceX96: bigint, tokenIs0: boolean): bigint {
  if (sqrtPriceX96 === 0n) return 0n;
  const ratioX192 = sqrtPriceX96 * sqrtPriceX96;
  const one = 10n ** 18n;
  if (tokenIs0) return (ratioX192 * one) / (Q96 * Q96);
  return (Q96 * Q96 * one) / ratioX192;
}

export function fmt(wei: bigint, digits = 6): string {
  const s = formatEther(wei);
  const [w, f = ""] = s.split(".");
  return f.length > 0 ? `${w}.${f.slice(0, digits)}` : w;
}

export function short(err: unknown): string {
  if (err && typeof err === "object" && "shortMessage" in err) {
    return String((err as { shortMessage: string }).shortMessage);
  }
  if (err instanceof Error) return err.message;
  return "Transaction failed";
}

export function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Spot estimate after the pool's fee (`fee` in hundredths of a bip, 10000 = 1%). Buying a token spends ETH. */
export function estimatedOut(amountIn: bigint, priceWethPerToken: bigint, buyingToken: boolean, fee: number = POOL_FEE): bigint {
  if (amountIn <= 0n || priceWethPerToken <= 0n) return 0n;
  const afterFee = (amountIn * BigInt(1_000_000 - fee)) / 1_000_000n;
  if (buyingToken) return (afterFee * 10n ** 18n) / priceWethPerToken;
  return (afterFee * priceWethPerToken) / 10n ** 18n;
}

/*
 * A first buy locked at launch is paid out by the pool to the creator lock, not to the creator. Every trade shown on
 * Chimi names its trader by the swap's recipient, so a swap paid to the creator lock is shown as its coin's creator's:
 * the pools' creators are noted as coins load, and toSwap swaps the lock for the creator.
 */
let creatorLock: string | undefined;
const creatorOfPool = new Map<string, Address>();

function noteCreators(dep: Deployment, coins: Pick<Coin, "pool" | "creator">[]) {
  creatorLock = dep.creatorLock?.address.toLowerCase();
  for (const c of coins) creatorOfPool.set(c.pool.toLowerCase(), c.creator);
}

/** The trader a swap names: its recipient, or the coin's creator when the recipient is the creator lock. */
function traderOf(recipient: Address, pool: string): Address {
  if (!creatorLock || recipient.toLowerCase() !== creatorLock) return recipient;
  return creatorOfPool.get(pool.toLowerCase()) ?? recipient;
}

export async function loadCoins(dep: Deployment): Promise<Coin[]> {
  if (!isDeployed(dep)) return [];
  const length = Number(
    await publicClient.readContract({ address: dep.factory, abi: factoryAbi, functionName: "allTokensLength" }),
  );
  // Every coin is read at the same time; the client folds the reads into a few multicalls.
  const tokens = await Promise.all(
    Array.from({ length }, (_, i) =>
      publicClient.readContract({ address: dep.factory, abi: factoryAbi, functionName: "allTokens", args: [BigInt(i)] }),
    ),
  );
  const found = await Promise.all(
    tokens.map(async (token): Promise<Coin | null> => {
      try {
        const [name, symbol, pool] = await Promise.all([
          publicClient.readContract({ address: token, abi: erc20Abi, functionName: "name" }),
          publicClient.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
          publicClient.readContract({ address: dep.factory, abi: factoryAbi, functionName: "getPool", args: [token] }),
        ]);
        const [token0, slot0, fee, uniFactory] = await Promise.all([
          publicClient.readContract({ address: pool.uniPool, abi: poolAbi, functionName: "token0" }),
          publicClient.readContract({ address: pool.uniPool, abi: poolAbi, functionName: "slot0" }),
          publicClient.readContract({ address: pool.uniPool, abi: poolAbi, functionName: "fee" }).catch(() => POOL_FEE),
          publicClient.readContract({ address: pool.uniPool, abi: poolAbi, functionName: "factory" }).catch(() => undefined),
        ]);
        return {
          token,
          name,
          symbol,
          pool: pool.uniPool,
          creator: pool.creator,
          positionId: pool.positionId,
          sqrtPriceX96: slot0[0],
          tokenIs0: token0.toLowerCase() === token.toLowerCase(),
          liquidity: pool.liquidity,
          fee: Number(fee),
          uniFactory,
        };
      } catch {
        // One unreadable coin shouldn't blank the board.
        return null;
      }
    }),
  );
  const coins = found.filter((coin): coin is Coin => coin !== null).reverse();
  noteCreators(dep, coins);
  return coins;
}

export async function loadCoin(dep: Deployment, token: Address): Promise<Coin | null> {
  if (!isDeployed(dep)) return null;
  const pool = await publicClient.readContract({
    address: dep.factory,
    abi: factoryAbi,
    functionName: "getPool",
    args: [token],
  });
  if (pool.uniPool === zeroAddress) return null;
  noteCreators(dep, [{ pool: pool.uniPool, creator: pool.creator }]);
  const [name, symbol, token0, slot0, fee, uniFactory] = await Promise.all([
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: "name" }),
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
    publicClient.readContract({ address: pool.uniPool, abi: poolAbi, functionName: "token0" }),
    publicClient.readContract({ address: pool.uniPool, abi: poolAbi, functionName: "slot0" }),
    publicClient.readContract({ address: pool.uniPool, abi: poolAbi, functionName: "fee" }).catch(() => POOL_FEE),
    publicClient.readContract({ address: pool.uniPool, abi: poolAbi, functionName: "factory" }).catch(() => undefined),
  ]);
  return {
    token,
    name,
    symbol,
    pool: pool.uniPool,
    creator: pool.creator,
    positionId: pool.positionId,
    sqrtPriceX96: slot0[0],
    tokenIs0: token0.toLowerCase() === token.toLowerCase(),
    liquidity: pool.liquidity,
    fee: Number(fee),
    uniFactory,
  };
}

export type PoolSwap = {
  tx: `0x${string}`;
  block: bigint;
  /** Position in the block, so two trades in one block keep their order. */
  index?: number;
  time: number;
  /** The trader: who received the coins on a buy, who sold them on a sale. */
  recipient: Address;
  buy: boolean;
  tokenAmount: bigint;
  ethAmount: bigint;
  sqrtPriceX96: bigint;
};

const bySwapOrder = (a: PoolSwap, b: PoolSwap) =>
  a.block === b.block ? (a.index ?? 0) - (b.index ?? 0) : a.block < b.block ? -1 : 1;

export type Holder = {
  address: Address;
  balance: bigint;
};

const swapEvent = parseAbiItem(
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
);

const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

const createdEvent = parseAbiItem(
  "event InstantQuoteTokenCreated(address indexed token, address indexed creator, address pool, uint256 positionId)",
);

/** Runs at most `n` jobs at once, so a page with many pools doesn't flood the public RPC. */
function lane(n: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async function run<T>(job: () => Promise<T>): Promise<T> {
    if (active >= n) await new Promise<void>((go) => waiting.push(go));
    active++;
    try {
      return await job();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

const logLane = lane(6);

/** The newest `count` windows of 9,000 blocks, newest first. The public RPC answers at most 10,000 blocks of logs. */
function logSpans(latest: bigint, count: number) {
  const span = 9_000n;
  const spans: { from: bigint; to: bigint }[] = [];
  for (let i = 0; i < count; i++) {
    const to = latest - span * BigInt(i);
    if (to <= 0n) break;
    const from = to > span ? to - span + 1n : 0n;
    spans.push({ from, to });
    if (from === 0n) break;
  }
  return spans;
}

export type Launch = {
  token: Address;
  pool: Address;
  time: number;
};

export async function loadLaunches(factory: Address): Promise<Launch[]> {
  const latest = await publicClient.getBlock();
  const latestNum = latest.number;
  const latestTime = Number(latest.timestamp);
  const spans = logSpans(latestNum, 16);
  const pages = await Promise.all(
    spans.map((span) =>
      logLane(() => publicClient.getLogs({ address: factory, event: createdEvent, fromBlock: span.from, toBlock: span.to })),
    ),
  );
  const seen = new Set<string>();
  const rows: Launch[] = [];
  pages.forEach((logs, i) => {
    for (const log of logs) {
      const token = log.args.token;
      const pool = log.args.pool;
      if (!token || !pool || seen.has(token.toLowerCase())) continue;
      seen.add(token.toLowerCase());
      const block = log.blockNumber ?? spans[i]!.to;
      rows.push({ token, pool, time: latestTime - Number(latestNum - block) });
    }
  });
  rows.sort((a, b) => a.time - b.time);
  return rows;
}

type SwapLog = {
  address: Address;
  transactionHash: `0x${string}` | null;
  logIndex: number | null;
  blockNumber: bigint | null;
  args: { sender?: Address; recipient?: Address; amount0?: bigint; amount1?: bigint; sqrtPriceX96?: bigint };
};

type Unnamed = UnnamedSale<PoolSwap>;

/**
 * Names the seller on sales that were paid out through the router (see sale-rules). Reads the coin transfers
 * into the pools over the blocks those sales cover, in one request per window. A read that fails leaves the
 * router's address on the sale rather than losing the trade.
 */
async function sellersFromNode(groups: { unnamed: Unnamed[]; tokens: Map<string, Address | undefined> }[]) {
  await Promise.all(
    groups.map(({ unnamed, tokens }) =>
      logLane(async () => {
        if (unnamed.length === 0) return;
        const pools = [...new Set(unnamed.map((u) => u.pool))] as Address[];
        const coins = pools.map((pool) => tokens.get(pool));
        const { from, to } = blocksOf(unnamed);
        const logs = await publicClient.getLogs({
          // Without every coin's address the read still works; it just isn't narrowed to those contracts.
          address: coins.every(Boolean) ? (coins as Address[]) : undefined,
          event: transferEvent,
          args: { to: pools },
          fromBlock: from,
          toBlock: to,
        });
        nameSellers(unnamed, sellersFromTransfers(logs));
      }).catch(() => undefined),
    ),
  );
}

/** One Swap log as a trade seen from the coin's side. Block times assume GIWA's one-second blocks. */
function toSwap(log: SwapLog, tokenIs0: boolean, head: { number: bigint; time: number }, fallbackBlock: bigint): PoolSwap {
  const amount0 = log.args.amount0 ?? 0n;
  const amount1 = log.args.amount1 ?? 0n;
  const tokenAmt = tokenIs0 ? amount0 : amount1;
  const ethAmt = tokenIs0 ? amount1 : amount0;
  const block = log.blockNumber ?? fallbackBlock;
  return {
    tx: log.transactionHash ?? "0x",
    block,
    index: Number(log.logIndex ?? 0),
    time: head.time - Number(head.number - block),
    recipient: log.args.recipient ? traderOf(log.args.recipient, log.address) : log.address,
    buy: tokenAmt < 0n,
    tokenAmount: tokenAmt < 0n ? -tokenAmt : tokenAmt,
    ethAmount: ethAmt < 0n ? -ethAmt : ethAmt,
    sqrtPriceX96: log.args.sqrtPriceX96 ?? 0n,
  };
}

export async function loadSwaps(pool: Address, tokenIs0: boolean, token?: Address): Promise<PoolSwap[]> {
  return (await loadSwapsFor([{ pool, tokenIs0, token }])).get(pool.toLowerCase()) ?? [];
}

/**
 * About a day of swaps for many pools at once. Each window of blocks is one request covering every pool,
 * so a board of a hundred coins costs the same ten requests as a single coin.
 */
export async function loadSwapsFor(pools: { pool: Address; tokenIs0: boolean; token?: Address }[]): Promise<Map<string, PoolSwap[]>> {
  return (await loadSwapsThrough(pools)).byPool;
}

type PoolRef = { pool: Address; tokenIs0: boolean; token?: Address };

/** `loadSwapsFor`, and the block it read up to, so a later read can pick up from there (`loadSwapsSince`). */
export async function loadSwapsThrough(pools: PoolRef[]): Promise<{ byPool: Map<string, PoolSwap[]>; through: bigint }> {
  const out = new Map<string, PoolSwap[]>(pools.map((p) => [p.pool.toLowerCase(), []]));
  const latest = await publicClient.getBlock();
  if (pools.length === 0) return { byPool: out, through: latest.number };
  const side = new Map(pools.map((p) => [p.pool.toLowerCase(), p.tokenIs0]));
  const tokens = new Map(pools.map((p) => [p.pool.toLowerCase(), p.token]));
  const head = { number: latest.number, time: Number(latest.timestamp) };
  const spans = logSpans(latest.number, 10);
  const addresses = [...out.keys()] as Address[];
  const groups = Array.from({ length: Math.ceil(addresses.length / 300) }, (_, i) => addresses.slice(i * 300, (i + 1) * 300));
  const pages = await Promise.all(
    spans.flatMap((span) =>
      groups.map((address) =>
        logLane(async () => ({ span, logs: await publicClient.getLogs({ address, event: swapEvent, fromBlock: span.from, toBlock: span.to }) })),
      ),
    ),
  );
  const seen = new Set<string>();
  const unnamed = new Map<bigint, Unnamed[]>();
  for (const { span, logs } of pages) {
    for (const log of logs) {
      const key = `${log.transactionHash}:${log.logIndex}`;
      const pool = log.address.toLowerCase();
      const rows = out.get(pool);
      if (!rows || seen.has(key)) continue;
      seen.add(key);
      const swap = toSwap(log, side.get(pool) ?? true, head, span.to);
      rows.push(swap);
      if (routerKept(swap, log.args.sender)) unnamed.set(span.to, [...(unnamed.get(span.to) ?? []), { swap, pool }]);
    }
  }
  await sellersFromNode([...unnamed.values()].map((list) => ({ unnamed: list, tokens })));
  for (const rows of out.values()) rows.sort(bySwapOrder);
  return { byPool: out, through: latest.number };
}

/** The most blocks one tail read may cover. A tab that slept longer than this takes a full read instead. */
export const TAIL_REACH = 5_000n;

/**
 * Only the swaps after block `since`, for every pool here, in one request. This is what keeps the feed live: a
 * full read costs ten requests, this costs one, so it can run every few seconds. Throws when `since` is too far
 * back for one request to cover.
 */
export async function loadSwapsSince(pools: PoolRef[], since: bigint): Promise<{ byPool: Map<string, PoolSwap[]>; through: bigint }> {
  const out = new Map<string, PoolSwap[]>(pools.map((p) => [p.pool.toLowerCase(), []]));
  const latest = await publicClient.getBlock();
  if (pools.length === 0 || latest.number <= since) return { byPool: out, through: latest.number > since ? latest.number : since };
  if (latest.number - since > TAIL_REACH) throw new Error("too far behind for a tail read");
  const side = new Map(pools.map((p) => [p.pool.toLowerCase(), p.tokenIs0]));
  const tokens = new Map(pools.map((p) => [p.pool.toLowerCase(), p.token]));
  const head = { number: latest.number, time: Number(latest.timestamp) };
  const addresses = [...out.keys()] as Address[];
  const groups = Array.from({ length: Math.ceil(addresses.length / 300) }, (_, i) => addresses.slice(i * 300, (i + 1) * 300));
  const pages = await Promise.all(groups.map((address) => logLane(() => publicClient.getLogs({ address, event: swapEvent, fromBlock: since + 1n, toBlock: latest.number }))));
  const unnamed: Unnamed[] = [];
  for (const log of pages.flat()) {
    const pool = log.address.toLowerCase();
    const rows = out.get(pool);
    if (!rows) continue;
    const swap = toSwap(log, side.get(pool) ?? true, head, latest.number);
    rows.push(swap);
    if (routerKept(swap, log.args.sender)) unnamed.push({ swap, pool });
  }
  await sellersFromNode([{ unnamed, tokens }]);
  for (const rows of out.values()) rows.sort(bySwapOrder);
  return { byPool: out, through: latest.number };
}

export async function loadHolders(token: Address, pool: Address, traders: Address[]): Promise<Holder[]> {
  const unique = [...new Set([pool, ...traders].map((a) => a.toLowerCase() as Address))];
  const balances = await Promise.all(
    unique.map((holder) =>
      publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [holder] }),
    ),
  );
  return unique
    .map((address, i) => ({ address, balance: balances[i] }))
    .filter((row) => row.balance > 0n)
    .sort((a, b) => (a.balance < b.balance ? 1 : -1));
}

export type SwapWindow = {
  swaps: PoolSwap[];
  /** Unix time the swap history is complete from. Stats for windows older than this are unknown. */
  coveredFrom: number;
  source: "explorer" | "rpc";
};

const SWAP_TOPIC = toEventSelector(swapEvent);
const TRANSFER_TOPIC = toEventSelector(transferEvent);

type ExplorerLog = {
  blockNumber: string;
  timeStamp: string;
  data: `0x${string}`;
  topics: (`0x${string}` | null)[];
  transactionHash: `0x${string}`;
  logIndex: string;
};

/** A custom RPC means a fork or a private node, whose blocks the public explorer has never seen. */
const EXPLORER_KNOWS_CHAIN = !import.meta.env.VITE_GIWA_RPC;

/** Every log for one event on one address between two blocks, from the chain's Blockscout indexer. */
async function explorerLogs(address: Address, topic0: `0x${string}`, fromBlock: bigint, toBlock: bigint, topic2?: `0x${string}`): Promise<ExplorerLog[]> {
  if (!EXPLORER_KNOWS_CHAIN) throw new Error("explorer unavailable on a custom RPC");
  const rows: ExplorerLog[] = [];
  const pageSize = 1000;
  const narrowed = topic2 ? `&topic2=${topic2}&topic0_2_opr=and` : "";
  for (let page = 1; page <= 30; page++) {
    const url = `${giwaChain.blockExplorers.default.url}/api?module=logs&action=getLogs&address=${address}&topic0=${topic0}${narrowed}&fromBlock=${fromBlock}&toBlock=${toBlock}&page=${page}&offset=${pageSize}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`explorer ${res.status}`);
    const body = (await res.json()) as { status?: string; message?: string; result?: ExplorerLog[] | string };
    if (!Array.isArray(body.result)) {
      if (body.message && /no (records|logs) found/i.test(body.message)) break;
      throw new Error(body.message || "explorer error");
    }
    rows.push(...body.result);
    if (body.result.length < pageSize) break;
    if (page === 30) throw new Error("too many logs for the explorer window");
  }
  return rows;
}

/** The block `seconds` ago, estimated from the chain's recent pace, with a little slack. */
async function blockSecondsAgo(latest: { number: bigint; timestamp: bigint }, seconds: number) {
  const back = await publicClient.getBlock({ blockNumber: latest.number > 100_000n ? latest.number - 100_000n : 0n });
  const span = Number(latest.number - back.number) || 1;
  const secsPerBlock = Math.max(0.05, (Number(latest.timestamp) - Number(back.timestamp)) / span);
  const blocksBack = BigInt(Math.ceil(seconds / secsPerBlock) + 600);
  return latest.number > blocksBack ? latest.number - blocksBack : 0n;
}

/** The explorer's copy of `sellersFromNode`, for one pool: the coin's transfers into it, over the blocks the unnamed sales cover. */
async function sellersFromExplorer(unnamed: Unnamed[], pool: Address, token: Address | undefined) {
  if (!token) return;
  const { from, to } = blocksOf(unnamed);
  const logs = await explorerLogs(token, TRANSFER_TOPIC, from, to, pad(pool).toLowerCase() as `0x${string}`);
  nameSellers(unnamed, sellersFromRawTransfers(logs, pool));
}

// The explorer writes zero as a bare "0x".
const hexNumber = (hex: string | undefined) => (hex && hex !== "0x" ? Number(BigInt(hex)) : 0);

/**
 * Swaps for the last `seconds`. The public RPC caps getLogs at ~10k blocks (~3h at 1s blocks),
 * so long windows read from the chain's Blockscout indexer. If the indexer is down, falls back
 * to the RPC scan (about a day) and reports the shorter coverage so callers can show a dash.
 */
export async function loadSwapWindow(pool: Address, tokenIs0: boolean, seconds: number, token?: Address): Promise<SwapWindow> {
  const latest = await publicClient.getBlock();
  const now = Number(latest.timestamp);
  try {
    const fromBlock = await blockSecondsAgo(latest, seconds);
    const rows: PoolSwap[] = [];
    const unnamed: Unnamed[] = [];
    const seen = new Set<string>();
    for (const log of await explorerLogs(pool, SWAP_TOPIC, fromBlock, latest.number)) {
      const key = `${log.transactionHash}:${log.logIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const topics = log.topics.filter((t): t is `0x${string}` => Boolean(t));
      const decoded = decodeEventLog({ abi: [swapEvent], data: log.data, topics: topics as [`0x${string}`, ...`0x${string}`[]] });
      const args = decoded.args;
      const tokenAmt = tokenIs0 ? args.amount0 : args.amount1;
      const ethAmt = tokenIs0 ? args.amount1 : args.amount0;
      const swap: PoolSwap = {
        tx: log.transactionHash,
        block: BigInt(log.blockNumber),
        index: hexNumber(log.logIndex),
        time: Number(BigInt(log.timeStamp)),
        recipient: traderOf(args.recipient, pool),
        buy: tokenAmt < 0n,
        tokenAmount: tokenAmt < 0n ? -tokenAmt : tokenAmt,
        ethAmount: ethAmt < 0n ? -ethAmt : ethAmt,
        sqrtPriceX96: args.sqrtPriceX96,
      };
      rows.push(swap);
      if (routerKept(swap, args.sender)) unnamed.push({ swap, pool });
    }
    if (unnamed.length > 0) await sellersFromExplorer(unnamed, pool, token).catch(() => undefined);
    rows.sort(bySwapOrder);
    return { swaps: rows, coveredFrom: now - seconds, source: "explorer" };
  } catch {
    const swaps = await loadSwaps(pool, tokenIs0, token);
    // loadSwaps reads 10 windows of 9,000 blocks.
    const back = await publicClient.getBlock({ blockNumber: latest.number > 90_000n ? latest.number - 90_000n : 0n });
    return { swaps, coveredFrom: back.number === 0n ? 0 : Number(back.timestamp), source: "rpc" };
  }
}

export type LaunchWindow = {
  launches: Launch[];
  /** Unix time the list is complete from. */
  coveredFrom: number;
  source: "explorer" | "rpc";
};

const CREATED_TOPIC = toEventSelector(createdEvent);

/** Coins launched in the last `seconds`, from the explorer, falling back to the RPC's shorter reach. */
export async function loadLaunchWindow(factory: Address, seconds: number): Promise<LaunchWindow> {
  const latest = await publicClient.getBlock();
  const now = Number(latest.timestamp);
  try {
    const fromBlock = await blockSecondsAgo(latest, seconds);
    const seen = new Set<string>();
    const launches: Launch[] = [];
    for (const log of await explorerLogs(factory, CREATED_TOPIC, fromBlock, latest.number)) {
      const topics = log.topics.filter((t): t is `0x${string}` => Boolean(t));
      const decoded = decodeEventLog({ abi: [createdEvent], data: log.data, topics: topics as [`0x${string}`, ...`0x${string}`[]] });
      const token = decoded.args.token;
      if (seen.has(token.toLowerCase())) continue;
      seen.add(token.toLowerCase());
      launches.push({ token, pool: decoded.args.pool, time: Number(BigInt(log.timeStamp)) });
    }
    launches.sort((a, b) => a.time - b.time);
    return { launches, coveredFrom: now - seconds, source: "explorer" };
  } catch {
    const launches = await loadLaunches(factory);
    // loadLaunches reads 16 windows of 9,000 blocks.
    const back = await publicClient.getBlock({ blockNumber: latest.number > 144_000n ? latest.number - 144_000n : 0n });
    return { launches, coveredFrom: back.number === 0n ? 0 : Number(back.timestamp), source: "rpc" };
  }
}
