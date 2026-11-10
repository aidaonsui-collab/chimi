import { useEffect, useMemo, useState } from "react";
import { loadSwapWindow, type Coin, type PoolSwap } from "@/lib/chimi/market";

/*
 * A coin's trades as far back as they can be read. The page already follows about a day of them from the node;
 * the rest come once from the chain's explorer, which keeps the whole history. On a fork or when the explorer
 * can't be reached, the day is all there is, and the chart simply starts there.
 */

/** How far back to ask for: longer than any coin here has lived. */
const REACH_S = 400 * 86_400;
const KEEP_MS = 5 * 60_000;

type Old = { swaps: PoolSwap[]; coveredFrom: number };
const cache = new Map<string, { at: number; job: Promise<Old> }>();

function loadHistory(coin: Pick<Coin, "pool" | "tokenIs0">): Promise<Old> {
  const key = coin.pool.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.job;
  const job = loadSwapWindow(coin.pool, coin.tokenIs0, REACH_S).then(({ swaps, coveredFrom }) => ({ swaps, coveredFrom }));
  cache.set(key, { at: Date.now(), job });
  job.catch(() => cache.delete(key));
  return job;
}

const inOrder = (a: PoolSwap, b: PoolSwap) => (a.block === b.block ? (a.index ?? 0) - (b.index ?? 0) : a.block < b.block ? -1 : 1);

/**
 * Every trade of this coin that can be read, oldest first: the long history joined with `recent`, the day of
 * trades the page keeps fresh. Undefined until the first of the two has arrived.
 */
export function useSwapHistory(coin: Pick<Coin, "pool" | "tokenIs0" | "preview"> | undefined, recent: PoolSwap[] | undefined): PoolSwap[] | undefined {
  const pool = coin && !coin.preview ? coin.pool.toLowerCase() : undefined;
  const tokenIs0 = coin?.tokenIs0;
  const [old, setOld] = useState<{ pool: string; swaps: PoolSwap[] }>();

  useEffect(() => {
    if (!pool || tokenIs0 === undefined) return;
    let off = false;
    loadHistory({ pool: pool as Coin["pool"], tokenIs0 })
      .then((found) => !off && setOld({ pool, swaps: found.swaps }))
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [pool, tokenIs0]);

  return useMemo(() => {
    const older = old && old.pool === pool ? old.swaps : undefined;
    if (!older && !recent) return undefined;
    // The explorer's times are exact and the node's are worked out from block numbers, so the explorer's copy wins.
    const byKey = new Map<string, PoolSwap>();
    for (const s of recent ?? []) byKey.set(`${s.tx}:${s.index ?? 0}`, s);
    for (const s of older ?? []) byKey.set(`${s.tx}:${s.index ?? 0}`, s);
    return [...byKey.values()].sort(inOrder);
  }, [old, recent, pool]);
}
