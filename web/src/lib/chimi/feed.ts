import { useEffect, useMemo, useRef, useState } from "react";
import type { Address } from "viem";
import {
  buildFeed,
  digest,
  forYou,
  fromFollowed,
  isQuiet,
  launchesOnly,
  packBig,
  suggestTraders,
  unpackBig,
  type CapPoint,
  type FeedComment,
  type FeedItem,
  type FeedLaunch,
  type FeedTrade,
} from "@/lib/chimi/feed-rules";
import { followersOf, followingOf } from "@/lib/chimi/follow-rules";
import { useFeed as useFollowedRecord, useFollows } from "@/lib/chimi/follows";
import { SUPPLY, capAfter, capBefore, coinStats, useEthUsd, useSwaps, type CoinStats } from "@/lib/chimi/live";
import { loadLaunchWindow, type Coin, type PoolSwap } from "@/lib/chimi/market";
import { usePoints } from "@/lib/chimi/rewards";
import { useChimi } from "@/components/chimi/provider";

/*
 * The home feed's data. Nothing here is new to read: trades come from the pools the board already follows, launch
 * times from the factory's own events, comments from the coins' threads, and who follows whom from the follow list.
 * feed-rules.ts turns them into one list.
 */

const DAY = 24 * 60 * 60;
/** Longer than any coin here has lived, so every launch has its real time when the explorer answers. */
const LAUNCH_REACH_S = 400 * DAY;
const KEEP_MS = 5 * 60_000;

const launchCache = new Map<string, { at: number; job: Promise<Map<string, number>> }>();

/** When each coin launched, by lowercase token. Without the explorer only the last day or two can be read; older coins are then absent. */
function launchTimes(factory: Address): Promise<Map<string, number>> {
  const key = factory.toLowerCase();
  const hit = launchCache.get(key);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.job;
  const job = loadLaunchWindow(factory, LAUNCH_REACH_S).then(({ launches }) => new Map(launches.map((l) => [l.token.toLowerCase(), l.time])));
  launchCache.set(key, { at: Date.now(), job });
  job.catch(() => launchCache.delete(key));
  return job;
}

function useLaunchTimes(factory: Address | undefined, coins: number) {
  const [times, setTimes] = useState<Map<string, number>>();
  useEffect(() => {
    if (!factory || coins === 0) return;
    let off = false;
    void launchTimes(factory)
      .then((found) => !off && setTimes(found))
      .catch(() => !off && setTimes(new Map()));
    return () => {
      off = true;
    };
    // A new coin on the board means the list of launches has changed.
  }, [factory, coins]);
  return times;
}

type RecentComment = { id: string; wallet: string; text: string; time: number; token: string; likes?: number; liked?: boolean; replies?: number; replyTo?: string };

/** The newest comments across these coins, read again every 45 seconds while the page is in view. `me` is who is asking, so the answer can say which ones they like. */
function useRecentComments(tokens: string[], me: string | undefined): FeedComment[] {
  const key = tokens.join(",") + (me ? `&wallet=${me}` : "");
  const [found, setFound] = useState<{ of: string; items: FeedComment[] }>({ of: "", items: [] });
  useEffect(() => {
    if (!key) return;
    let off = false;
    const read = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/comments?recent=20&tokens=${key}`);
        const body = (await res.json().catch(() => null)) as { items?: RecentComment[] } | null;
        if (off || !res.ok || !body?.items) return;
        // Comments carry the server's clock in milliseconds; the feed runs on seconds, like the chain.
        setFound({
          of: key,
          items: body.items.map((c) => ({ id: c.id, token: c.token, wallet: c.wallet, text: c.text, time: Math.floor(c.time / 1000), likes: c.likes, liked: c.liked, replies: c.replies, replyTo: c.replyTo })),
        });
      } catch {
        /* the feed simply has no comments this round */
      }
    };
    void read();
    const timer = setInterval(() => void read(), 45_000);
    return () => {
      off = true;
      clearInterval(timer);
    };
  }, [key]);
  return found.of === key ? found.items : [];
}

/*
 * The last feed this browser saw. A visit paints it at once and the chain's answer replaces it a moment later, so
 * the page never opens on placeholders for someone who has been here before.
 */

type Snapshot = { v: 1; factory: string; at: number; coins: Coin[]; byPool: Record<string, PoolSwap[]> };

const SNAPSHOT_KEY = "chimi.feed.last";
const SNAPSHOT_COINS = 40;
const SNAPSHOT_SWAPS = 60;
/** Older than this and it is more misleading than useful. */
const SNAPSHOT_MAX_AGE_MS = 3 * 24 * 60 * 60_000;

function readSnapshot(): Snapshot | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const found = unpackBig<Snapshot>(raw);
    if (found?.v !== 1 || !Array.isArray(found.coins) || Date.now() - found.at > SNAPSHOT_MAX_AGE_MS) return null;
    return found;
  } catch {
    return null;
  }
}

function writeSnapshot(factory: string, coins: Coin[], byPool: Record<string, PoolSwap[]>) {
  const kept = coins.slice(0, SNAPSHOT_COINS);
  const snapshot: Snapshot = {
    v: 1,
    factory: factory.toLowerCase(),
    at: Date.now(),
    coins: kept,
    byPool: Object.fromEntries(kept.map((c) => [c.pool.toLowerCase(), (byPool[c.pool.toLowerCase()] ?? []).slice(-SNAPSHOT_SWAPS)])),
  };
  try {
    localStorage.setItem(SNAPSHOT_KEY, packBig(snapshot));
  } catch {
    /* private mode, or the store is full: the next visit just loads the usual way */
  }
}

/** A coin's place in the order coins were launched stands in for a time when the real one is too old to read. */
const UNKNOWN_BEFORE = 1_000_000_000;

/** True when a feed time is a real clock time, not a stand-in for "some time ago". */
export const knownTime = (time: number) => time >= UNKNOWN_BEFORE;

export type HomeFeed = ReturnType<typeof useHomeFeed>;

/** Everything the home page shows: the feed's tabs, the coins beside it, and the quiet-day digest. */
export function useHomeFeed(nowMs: number | null) {
  const { coins, deployment, account, loading } = useChimi();
  const fromChain = useMemo(() => coins.filter((c) => !c.preview), [coins]);
  const { byPool: read, ready } = useSwaps(fromChain, { live: true });
  const ethUsd = useEthUsd();

  // Until the chain has answered, show what this browser saw last time.
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  useEffect(() => setSnapshot(readSnapshot()), []);
  const factory = deployment?.factory.toLowerCase();
  const remembered = snapshot && (!factory || snapshot.factory === factory) ? snapshot : null;
  const fromMemory = loading && fromChain.length === 0 && !!remembered;
  const live = fromMemory ? remembered.coins : fromChain;
  const byPool = useMemo(() => {
    if (!remembered) return read;
    // A pool keeps its remembered trades until its own read lands, so the feed never empties on the way.
    const merged: Record<string, PoolSwap[]> = {};
    for (const coin of live) {
      const pool = coin.pool.toLowerCase();
      const swaps = read[pool] ?? remembered.byPool[pool];
      if (swaps) merged[pool] = swaps;
    }
    return merged;
  }, [read, remembered, live]);
  const lastSaved = useRef(0);
  useEffect(() => {
    if (!factory || loading || !ready || fromChain.length === 0 || Date.now() - lastSaved.current < 20_000) return;
    lastSaved.current = Date.now();
    writeSnapshot(factory, fromChain, read);
  }, [factory, loading, ready, fromChain, read]);

  const { data: follows } = useFollows();
  const { data: points } = usePoints();
  const me = account?.toLowerCase();
  const following = useMemo(() => followingOf(follows?.state, me), [follows, me]);
  const followers = useMemo(() => followersOf(follows?.state, me), [follows, me]);
  // Trades by followed wallets from before the day the page reads live.
  const record = useFollowedRecord(me, follows?.state);
  const times = useLaunchTimes(deployment?.factory, live.length);
  const tokens = useMemo(() => live.map((c) => c.token.toLowerCase()), [live]);
  const comments = useRecentComments(tokens, me);

  const byToken = useMemo(() => new Map(live.map((c) => [c.token.toLowerCase(), c])), [live]);

  const stats = useMemo(() => {
    const out: Record<string, CoinStats> = {};
    for (const coin of live) out[coin.token.toLowerCase()] = coinStats(coin, byPool[coin.pool.toLowerCase()]);
    return out;
  }, [live, byPool]);

  const feed = useMemo(() => {
    const now = Math.floor((nowMs ?? Date.now()) / 1000);
    const trades: FeedTrade[] = [];
    const seen = new Set<string>();
    const caps: Record<string, { points: CapPoint[]; now: number }> = {};
    for (const coin of live) {
      const token = coin.token.toLowerCase();
      const swaps = byPool[coin.pool.toLowerCase()] ?? [];
      const points: CapPoint[] = [];
      for (const swap of swaps) {
        const key = `${swap.tx}:${swap.index ?? 0}`;
        seen.add(key);
        trades.push({ key, time: swap.time, wallet: swap.recipient.toLowerCase(), token, buy: swap.buy, tokens: Number(swap.tokenAmount) / 1e18, eth: Number(swap.ethAmount) / 1e18, tx: swap.tx });
        if (ethUsd && swap.sqrtPriceX96 > 0n) {
          const before = capBefore(swap, coin);
          points.push({ time: swap.time, before: before === undefined ? undefined : before * ethUsd, after: capAfter(swap, coin) * ethUsd });
        }
      }
      if (ethUsd && points.length > 0) caps[token] = { points, now: (stats[token]?.capEth ?? 0) * ethUsd };
    }
    for (const t of record.trades ?? []) {
      const key = `${t.tx}:${t.i}`;
      if (seen.has(key) || !byToken.has(t.token)) continue;
      seen.add(key);
      trades.push({ key, time: t.t, wallet: t.wallet, token: t.token, buy: t.buy, tokens: t.tokens, eth: t.eth, tx: t.tx });
    }

    // Every coin is a launch. One too old for its time to be read keeps its place in the order instead.
    const launches: FeedLaunch[] = live.map((coin, i) => ({
      token: coin.token.toLowerCase(),
      creator: coin.creator.toLowerCase(),
      time: times?.get(coin.token.toLowerCase()) ?? live.length - i,
    }));

    const items = buildFeed({ trades, launches, comments, caps, me, following, followers, now });
    return {
      now,
      trades,
      items,
      tabs: { foryou: forYou(items), following: fromFollowed(items), new: launchesOnly(items) } satisfies Record<string, FeedItem[]>,
      quiet: isQuiet(
        items.filter((i) => knownTime(i.time)),
        now,
      ),
      digest: digest(trades, now),
      suggestions: suggestTraders(points?.season ?? [], trades, [me, ...following]),
    };
  }, [live, byPool, record.trades, byToken, times, comments, me, following, followers, ethUsd, stats, points, nowMs]);

  return {
    ...feed,
    live,
    byToken,
    byPool,
    stats,
    me,
    following,
    ethUsd,
    points,
    /** True until there is a coin list to show: the factory's answer, or the one remembered from the last visit. */
    waiting: loading && !fromMemory,
    /**
     * False while the pools' trades are still being read (or the node refused the read and it is being tried
     * again). The feed shows what it has meanwhile, and says the trades are on their way.
     */
    tradesReady: ready || feed.trades.length > 0 || live.length === 0 || live.every((c) => byPool[c.pool.toLowerCase()] !== undefined),
    /** True while what is showing is remembered, or still being brought up to date. */
    refreshing: fromMemory || (live.length > 0 && !ready),
    hasCoins: live.length > 0,
    supply: SUPPLY,
  };
}
