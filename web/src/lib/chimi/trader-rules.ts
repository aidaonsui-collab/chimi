/*
 * Everyone who trades on Chimi as one list of rows: the season's points, who follows them, the buys they have led and
 * what they traded in the last day. The Traders page shows all of it; the home page shows the top of it beside the
 * feed. Pure, so it can be tested without a browser.
 */

import { followerCounts, type FollowsState } from "./follow-rules.ts";
import type { Points } from "./points-rules.ts";

export type TraderRow = { wallet: string; points: number; rank?: number; followers: number; led: number; ledEth: number; todayEth: number; trades: number };

export type TraderSort = "points" | "followers" | "today";

/** A trade as far as this list cares: who, how much ETH, and when (unix seconds). */
export type TraderTrade = { wallet: string; eth: number; time: number };

/**
 * One row per wallet the site knows of. A wallet without a Dojang earns no points, but it still traded, so everyone
 * the points book has seen belongs here, along with anyone followed and anyone in `trades` since `since`.
 */
export function traderRows(points: Points | null | undefined, follows: FollowsState | undefined, trades: readonly TraderTrade[], since: number): TraderRow[] {
  const out = new Map<string, TraderRow>();
  const row = (wallet: string) => {
    const key = wallet.toLowerCase();
    let found = out.get(key);
    if (!found) {
      found = { wallet: key, points: 0, followers: 0, led: 0, ledEth: 0, todayEth: 0, trades: 0 };
      out.set(key, found);
    }
    return found;
  };
  for (const s of points?.season ?? []) {
    const r = row(s.wallet);
    r.points = s.points;
    r.rank = s.rank;
  }
  const file = points?.file;
  for (const wallet of Object.keys(file?.profiles ?? {})) row(wallet);
  for (const day of file?.days ?? []) {
    for (const wallet of Object.keys(day.points)) row(wallet);
    for (const wallet of day.unverified) row(wallet);
  }
  for (const day of file?.open ?? []) for (const wallet of Object.keys(day.weights)) row(wallet);
  for (const [wallet, n] of followerCounts(follows)) row(wallet).followers = n;
  for (const [wallet, led] of Object.entries(file?.led ?? {})) {
    const r = row(wallet);
    r.led = led.n;
    r.ledEth = led.eth;
  }
  for (const t of trades) {
    if (t.time < since) continue;
    const r = row(t.wallet);
    r.todayEth += t.eth;
    r.trades += 1;
  }
  return [...out.values()];
}

/** The rows in order: by the thing asked for, then by points, then by the day's trading, then by address so it never shuffles. */
export function orderTraders(rows: readonly TraderRow[], by: TraderSort): TraderRow[] {
  const key: Record<TraderSort, (r: TraderRow) => number> = { points: (r) => r.points, followers: (r) => r.followers, today: (r) => r.todayEth };
  return [...rows].sort((a, b) => key[by](b) - key[by](a) || b.points - a.points || b.todayEth - a.todayEth || (a.wallet < b.wallet ? -1 : 1));
}

/** Before a season has any points, the day's trades are the list worth opening on. */
export const defaultTraderSort = (rows: readonly TraderRow[]): TraderSort => (rows.some((r) => r.points > 0) ? "points" : "today");
