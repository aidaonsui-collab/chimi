import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { Address } from "viem";
import { erc20Abi } from "@/lib/chimi/chain";
import { publicClient } from "@/lib/chimi/client";
import { loadSwapsSince, loadSwapsThrough, poolKey, readReserves, refOf, wethPerToken, type Coin, type PoolRef, type PoolSwap } from "@/lib/chimi/market";
import { isV4Live, type Deployment } from "@/lib/chimi/chain";

/*
 * Live numbers every page shares: the ETH price, each pool's recent trades and its ETH reserve.
 * They are read once, kept for a short while, and handed to every component that asks, so moving
 * between pages doesn't read the chain again.
 */

type Store<T> = {
  value: T;
  listeners: Set<() => void>;
};

function emit(store: Store<unknown>) {
  for (const l of store.listeners) l();
}

function subscribeTo(store: Store<unknown>, onFirst?: () => void | (() => void)) {
  return (l: () => void) => {
    store.listeners.add(l);
    const stop = store.listeners.size === 1 ? onFirst?.() : undefined;
    return () => {
      store.listeners.delete(l);
      if (store.listeners.size === 0) stop?.();
    };
  };
}

const visible = () => typeof document === "undefined" || document.visibilityState === "visible";

/* ETH price ------------------------------------------------------------------------------- */

const eth: Store<number | undefined> & { at: number; job?: Promise<void> } = { value: undefined, listeners: new Set(), at: 0 };

function loadEthUsd() {
  if (eth.job || Date.now() - eth.at < 55_000) return;
  eth.job = fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot")
    .then((r) => r.json())
    .then((body: { data?: { amount?: string } }) => {
      const n = Number(body.data?.amount);
      if (Number.isFinite(n) && n > 0) {
        eth.value = n;
        eth.at = Date.now();
        emit(eth);
      }
    })
    .catch(() => undefined)
    .finally(() => {
      eth.job = undefined;
    });
}

const subscribeEth = subscribeTo(eth, () => {
  loadEthUsd();
  const timer = setInterval(() => visible() && loadEthUsd(), 60_000);
  return () => clearInterval(timer);
});

/** ETH in US dollars, or undefined until the price has loaded. */
export function useEthUsd(): number | undefined {
  return useSyncExternalStore(
    subscribeEth,
    () => eth.value,
    () => undefined,
  );
}

/* Recent trades per pool ------------------------------------------------------------------- */

/**
 * `through` is the block the pool's trades are known up to, once a full read has said so; a tail read picks up
 * from it. `fullAt` is when the last full read landed: tail reads keep a pool fresh, and a full read still runs
 * now and then to drop trades older than a day and mend anything a tail read missed.
 */
type SwapEntry = { swaps?: PoolSwap[]; at: number; job?: Promise<PoolSwap[]>; through?: bigint; fullAt?: number };
const swapStore: Store<number> & { byPool: Map<string, SwapEntry> } = { value: 0, listeners: new Set(), byPool: new Map() };
const SWAP_TTL_MS = 45_000;

/** A pool's trades from about the last day. Answers from memory when they were read moments ago. */
export function fetchSwaps(coin: Parameters<typeof refOf>[0], force = false): Promise<PoolSwap[]> {
  const key = poolKey(coin);
  const entry = swapStore.byPool.get(key) ?? { at: 0 };
  swapStore.byPool.set(key, entry);
  if (entry.job) return entry.job;
  if (!force && entry.swaps && Date.now() - entry.at < SWAP_TTL_MS) return Promise.resolve(entry.swaps);
  entry.job = loadSwapsThrough([refOf(coin)]).then(({ byPool }) => byPool.get(key) ?? [])
    .then((swaps) => {
      entry.swaps = swaps;
      entry.at = Date.now();
      return swaps;
    })
    .finally(() => {
      entry.job = undefined;
      swapStore.value++;
      emit(swapStore);
    });
  return entry.job;
}

/** Reads every pool here whose trades are missing or stale, all in one pass over the chain. */
function fetchSwapsMany(pools: PoolRef[]) {
  const stale = pools.filter((p) => {
    const entry = swapStore.byPool.get(poolKey(p));
    return !entry?.job && !(entry?.swaps && Date.now() - entry.at < SWAP_TTL_MS);
  });
  if (stale.length === 0) return;
  const all = loadSwapsThrough(stale);
  for (const p of stale) {
    const key = poolKey(p);
    const entry = swapStore.byPool.get(key) ?? { at: 0 };
    swapStore.byPool.set(key, entry);
    entry.job = all
      .then(({ byPool, through }) => {
        entry.swaps = byPool.get(key) ?? [];
        entry.at = Date.now();
        entry.fullAt = entry.at;
        entry.through = through;
        return entry.swaps;
      })
      .finally(() => {
        entry.job = undefined;
      });
    // Whoever awaits this job handles its failure; the board just keeps what it had.
    entry.job.catch(() => undefined);
  }
  void all
    .catch(() => undefined)
    .finally(() => {
      swapStore.value++;
      emit(swapStore);
    });
}

const TAIL_MS = 8_000;
const FULL_EVERY_MS = 10 * 60_000;
let tailing = false;

/**
 * Picks up the trades since the last read, for every pool here that has been read in full once: one request,
 * however many pools. New trades are added to what is held and everyone listening is told. A pool that hasn't had
 * its full read yet, or is having one now, is left to that.
 */
async function tailSwaps(pools: PoolRef[]) {
  if (tailing) return;
  const known = pools.filter((p) => {
    const entry = swapStore.byPool.get(poolKey(p));
    return entry?.swaps && entry.through !== undefined && !entry.job;
  });
  if (known.length === 0) return;
  const since = known.map((p) => swapStore.byPool.get(poolKey(p))!.through!).reduce((a, b) => (a < b ? a : b));
  tailing = true;
  try {
    const { byPool, through } = await loadSwapsSince(known, since);
    let added = false;
    for (const p of known) {
      const key = poolKey(p);
      const entry = swapStore.byPool.get(key);
      // A full read may have started, or landed, while this one was on its way; it knows more.
      if (!entry?.swaps || entry.job || entry.through === undefined || entry.through > through) continue;
      const have = new Set(entry.swaps.map((s) => `${s.tx}:${s.index ?? 0}`));
      const fresh = (byPool.get(key) ?? []).filter((s) => s.block > entry.through! && !have.has(`${s.tx}:${s.index ?? 0}`));
      if (fresh.length > 0) {
        entry.swaps = [...entry.swaps, ...fresh];
        added = true;
      }
      entry.through = through;
      // Fresh enough that the slower full read can wait, until it is due anyway.
      if (Date.now() - (entry.fullAt ?? 0) < FULL_EVERY_MS) entry.at = Date.now();
    }
    if (added) {
      swapStore.value++;
      emit(swapStore);
    }
  } catch {
    // Too far behind, or the node said no: the next full read catches up.
  } finally {
    tailing = false;
  }
}

const subscribeSwaps = subscribeTo(swapStore);

/**
 * Trades for each of these coins' pools, keyed by lowercase pool address. A pool is missing from the
 * answer until its first read lands; `ready` is true once every pool has answered.
 */
export function useSwaps(coins: Coin[], { live = false }: { live?: boolean } = {}) {
  const version = useSyncExternalStore(
    subscribeSwaps,
    () => swapStore.value,
    () => 0,
  );
  const key = coins
    .filter((c) => !c.preview)
    .map((c) => [poolKey(c), c.tokenIs0 ? "1" : "0", c.token.toLowerCase(), c.pool.toLowerCase(), (c.poolId ?? "").toLowerCase(), (c.hook ?? "").toLowerCase()].join("|"))
    .join(",");
  useEffect(() => {
    if (!key) return;
    const pools = key.split(",").map((item): PoolRef => {
      const [, is0, token, pool, poolId, hook] = item.split("|");
      return {
        pool: pool as Address,
        tokenIs0: is0 === "1",
        token: token as Address,
        poolId: poolId ? (poolId as PoolRef["poolId"]) : undefined,
        manager: poolId ? (pool as Address) : undefined,
        hook: hook ? (hook as Address) : undefined,
      };
    });
    const read = () => {
      if (visible()) fetchSwapsMany(pools);
    };
    read();
    const timer = setInterval(read, 60_000);
    // A live page also asks every few seconds for just the trades since its last read.
    const tail = live
      ? setInterval(() => {
          if (visible()) void tailSwaps(pools);
        }, TAIL_MS)
      : undefined;
    return () => {
      clearInterval(timer);
      clearInterval(tail);
    };
  }, [key, live]);
  return useMemo(() => {
    const byPool: Record<string, PoolSwap[]> = {};
    let ready = true;
    for (const item of key ? key.split(",") : []) {
      const pool = item.split("|")[0]!;
      const swaps = swapStore.byPool.get(pool)?.swaps;
      if (swaps) byPool[pool] = swaps;
      else ready = false;
    }
    return { byPool, ready };
    // `version` changes whenever any pool's trades are read again.
  }, [key, version]);
}

/* ETH held by each pool --------------------------------------------------------------------- */

const reserveStore: Store<number> & { byPool: Map<string, bigint>; at: Map<string, number> } = {
  value: 0,
  listeners: new Set(),
  byPool: new Map(),
  at: new Map(),
};
const subscribeReserves = subscribeTo(reserveStore);

/** ETH sitting in each coin's pool (its quote-side liquidity), keyed by `poolKey`. */
export function usePoolEth(coins: Coin[], deployment: Deployment | null | undefined) {
  const version = useSyncExternalStore(
    subscribeReserves,
    () => reserveStore.value,
    () => 0,
  );
  const weth = deployment?.weth;
  const key = coins
    .filter((c) => !c.preview)
    .map((c) => [poolKey(c), c.poolId ? "4" : "3", c.token.toLowerCase(), c.pool.toLowerCase()].join("|"))
    .join(",");
  useEffect(() => {
    if (!key || !weth || !deployment) return;
    const stale = key.split(",").filter((row) => Date.now() - (reserveStore.at.get(row.split("|")[0]!) ?? 0) > 60_000);
    if (stale.length === 0) return;
    for (const row of stale) reserveStore.at.set(row.split("|")[0]!, Date.now());
    void Promise.all(
      stale.map((row) => {
        const [id, kind, token, pool] = row.split("|");
        const read =
          kind === "4" && isV4Live(deployment)
            ? readReserves(deployment, { pool: pool as Address, token: token as Address, poolId: id as Coin["poolId"] }).then((r) => r.eth)
            : publicClient.readContract({ address: weth, abi: erc20Abi, functionName: "balanceOf", args: [pool as Address] });
        return read.then((wei) => reserveStore.byPool.set(id!, wei)).catch(() => reserveStore.at.delete(id!));
      }),
    ).then(() => {
      reserveStore.value++;
      emit(reserveStore);
    });
  }, [key, weth, deployment]);
  return useMemo(() => {
    const out: Record<string, bigint> = {};
    for (const row of key ? key.split(",") : []) {
      const id = row.split("|")[0]!;
      const wei = reserveStore.byPool.get(id);
      if (wei !== undefined) out[id] = wei;
    }
    return out;
  }, [key, version]);
}

/* Chain head -------------------------------------------------------------------------------- */

const head: Store<bigint | undefined> = { value: undefined, listeners: new Set() };
const subscribeHead = subscribeTo(head, () => {
  const read = () => {
    if (!visible()) return;
    void publicClient
      .getBlockNumber({ cacheTime: 0 })
      .then((n) => {
        head.value = n;
        emit(head);
      })
      .catch(() => undefined);
  };
  read();
  const timer = setInterval(read, 12_000);
  return () => clearInterval(timer);
});

/** The latest GIWA block, refreshed every few seconds while the tab is in view. */
export function useBlockNumber(): bigint | undefined {
  return useSyncExternalStore(
    subscribeHead,
    () => head.value,
    () => undefined,
  );
}

/* Per-coin market numbers ------------------------------------------------------------------- */

export const SUPPLY = 1_000_000_000;
const DAY = 86_400;

export type CoinStats = {
  /** ETH per token. */
  priceEth: number;
  capEth: number;
  /** ETH traded in the last day; undefined until the pool's trades have loaded. */
  volEth?: number;
  trades?: number;
  /** Percent move over the last day; undefined when there were no trades to measure from. */
  change?: number;
  /** Market cap in ETH after each trade of the last day, ending at the current one. */
  spark: number[];
  lastTrade?: number;
};

/**
 * Market cap in ETH just before a trade, worked back from the trade itself. Inside one liquidity range the
 * average price paid is the geometric mean of the prices before and after, so before = average² ÷ after.
 * This is what lets a coin's very first trade show as a move instead of a flat line.
 */
export function capBefore(swap: PoolSwap, coin: Pick<Coin, "tokenIs0" | "fee" | "sellFee">): number | undefined {
  const after = Number(wethPerToken(swap.sqrtPriceX96, coin.tokenIs0)) / 1e18;
  const eth = Number(swap.ethAmount) / 1e18;
  const tokens = Number(swap.tokenAmount) / 1e18;
  if (!(after > 0) || !(eth > 0) || !(tokens > 0)) return undefined;
  // The pool keeps its fee out of whatever was paid in. A v4 sell uses the sell tax.
  const fee = swap.buy ? coin.fee : (coin.sellFee ?? coin.fee);
  const kept = 1 - (fee ?? 10_000) / 1_000_000;
  const average = swap.buy ? (eth * kept) / tokens : eth / (tokens * kept);
  const before = (average * average) / after;
  return Number.isFinite(before) && before > 0 ? before * SUPPLY : undefined;
}

/** The coin's market cap in ETH at the price this trade left. */
export const capAfter = (swap: PoolSwap, coin: Pick<Coin, "tokenIs0">) => (Number(wethPerToken(swap.sqrtPriceX96, coin.tokenIs0)) / 1e18) * SUPPLY;

/**
 * The market cap a window opened at: where the last trade before it left the price, or, when the window's
 * first trade is the earliest one we can read, the price that trade started from.
 */
export function openingCap(swaps: PoolSwap[], coin: Pick<Coin, "tokenIs0" | "fee">, since: number): number | undefined {
  const priced = swaps.filter((s) => s.sqrtPriceX96 > 0n);
  const before = priced.filter((s) => s.time < since);
  if (before.length) return capAfter(before[before.length - 1]!, coin);
  const first = priced.find((s) => s.time >= since);
  return first ? (capBefore(first, coin) ?? capAfter(first, coin)) : undefined;
}

export function coinStats(coin: Coin, swaps: PoolSwap[] | undefined, nowSec = Math.floor(Date.now() / 1000)): CoinStats {
  const priceEth = Number(wethPerToken(coin.sqrtPriceX96, coin.tokenIs0)) / 1e18;
  const capEth = priceEth * SUPPLY;
  if (!swaps) return { priceEth, capEth, spark: [] };
  const cutoff = nowSec - DAY;
  const day = swaps.filter((s) => s.time >= cutoff);
  const base = openingCap(swaps, coin, cutoff);
  const series = day.filter((s) => s.sqrtPriceX96 > 0n).map((s) => capAfter(s, coin));
  const spark = base !== undefined ? [base, ...series, capEth] : [capEth, capEth];
  return {
    priceEth,
    capEth,
    volEth: day.reduce((sum, s) => sum + Number(s.ethAmount) / 1e18, 0),
    trades: day.length,
    change: base && day.length ? ((capEth - base) / base) * 100 : undefined,
    spark,
    lastTrade: swaps.length ? swaps[swaps.length - 1]!.time : undefined,
  };
}
