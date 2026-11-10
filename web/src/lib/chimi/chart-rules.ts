/*
 * How a coin's trades become a candle chart with traders marked on it. This file imports nothing, so the rules
 * can be tested on their own.
 */

export const INTERVALS = [
  ["1m", 60],
  ["5m", 5 * 60],
  ["15m", 15 * 60],
  ["1h", 60 * 60],
  ["4h", 4 * 60 * 60],
  ["1D", 24 * 60 * 60],
] as const;
export type IntervalKey = (typeof INTERVALS)[number][0];

export function intervalSeconds(key: IntervalKey): number {
  return INTERVALS.find(([k]) => k === key)![1];
}

/** The most candles a chart is given. Older ones are dropped, so a long-lived coin on a short interval stays light. */
export const MAX_CANDLES = 3000;

/** One trade as the chart needs it, with values already in the unit being charted. */
export type Tick = {
  time: number;
  /** The value the trade moved the coin to. */
  after: number;
  /** The value it moved it from, when that could be worked out. Only the first trade's is used. */
  before?: number;
  volume: number;
  buy: boolean;
};

export type Candle = {
  /** Start of the candle, Unix seconds, a multiple of the interval. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades: number;
};

/**
 * Candles of `seconds` each, from trades in time order.
 *
 * A candle opens where the one before it closed, so the chart never jumps between candles; the very first opens at
 * the value its first trade started from. Stretches with no trade are filled with flat candles up to `now`, so a
 * quiet hour reads as an hour and not as nothing. Only the latest `max` candles are kept.
 */
export function buildCandles(ticks: Tick[], seconds: number, now: number, max = MAX_CANDLES): Candle[] {
  if (ticks.length === 0 || !(seconds > 0)) return [];
  const bucket = (t: number) => Math.floor(t / seconds) * seconds;
  const last = Math.max(bucket(now), bucket(ticks[ticks.length - 1]!.time));
  // Nothing before this can survive the cut, so flat candles before it are never made.
  const earliest = last - (max - 1) * seconds;
  const out: Candle[] = [];
  let cur: Candle | undefined;

  const flatUntil = (until: number) => {
    if (!cur) return;
    const close = cur.close;
    for (let t = Math.max(cur.time + seconds, earliest); t < until; t += seconds) {
      out.push({ time: t, open: close, high: close, low: close, close, volume: 0, trades: 0 });
    }
  };

  for (const tick of ticks) {
    if (!(tick.after > 0)) continue;
    const at = bucket(tick.time);
    if (cur && at === cur.time) {
      cur.high = Math.max(cur.high, tick.after);
      cur.low = Math.min(cur.low, tick.after);
      cur.close = tick.after;
      cur.volume += tick.volume;
      cur.trades += 1;
      continue;
    }
    if (cur && at < cur.time) continue; // out of order; the caller sorts, this only keeps the chart valid
    const open: number = cur ? cur.close : tick.before && tick.before > 0 ? tick.before : tick.after;
    if (cur) {
      out.push(cur);
      flatUntil(at);
    }
    cur = { time: at, open, high: Math.max(open, tick.after), low: Math.min(open, tick.after), close: tick.after, volume: tick.volume, trades: 1 };
  }
  if (!cur) return [];
  out.push(cur);
  flatUntil(last + seconds);
  return out.length > max ? out.slice(out.length - max) : out;
}

/**
 * The interval a chart opens on: the shortest one that shows the coin's whole life in a few hundred candles, so a
 * coin from this morning opens on minutes and one from last month on hours.
 */
export function pickInterval(firstTrade: number | undefined, now: number, comfortable = 400): IntervalKey {
  if (firstTrade === undefined) return "15m";
  const age = Math.max(0, now - firstTrade);
  for (const [key, seconds] of INTERVALS) {
    if (age / seconds <= comfortable) return key;
  }
  return "1D";
}

export type BubbleKind = "you" | "dev" | "following" | "other";
export type BubbleMode = "all" | "following" | "off";

/** A trade to mark on the chart. */
export type Mark = { key: string; time: number; wallet: string; buy: boolean; eth: number };
export type Bubble = Mark & { kind: BubbleKind };

/** How many traders a chart shows at once. Past this the smallest trades by strangers are left out. */
export const MAX_BUBBLES = 140;

const RANK: Record<BubbleKind, number> = { you: 0, dev: 1, following: 2, other: 3 };

/**
 * Which trades get a bubble, in time order.
 *
 * Your own trades, the creator's and those of wallets you follow are always marked. With "all", other wallets are
 * marked too, biggest trades first, until the chart holds `max`. "following" leaves strangers out; "off" marks nothing.
 */
export function pickBubbles(
  marks: Mark[],
  who: { me?: string; creator?: string; following?: Iterable<string> },
  mode: BubbleMode,
  max = MAX_BUBBLES,
): Bubble[] {
  if (mode === "off") return [];
  const me = who.me?.toLowerCase();
  const creator = who.creator?.toLowerCase();
  const following = new Set([...(who.following ?? [])].map((w) => w.toLowerCase()));
  const kindOf = (wallet: string): BubbleKind => (wallet === me ? "you" : wallet === creator ? "dev" : following.has(wallet) ? "following" : "other");
  const all = marks.map((m) => ({ ...m, wallet: m.wallet.toLowerCase() })).map((m) => ({ ...m, kind: kindOf(m.wallet) }));
  const wanted = mode === "all" ? all : all.filter((b) => b.kind !== "other");
  const kept = wanted.length > max ? [...wanted].sort((a, b) => RANK[a.kind] - RANK[b.kind] || b.eth - a.eth || b.time - a.time).slice(0, max) : wanted;
  return kept.sort((a, b) => a.time - b.time);
}

/**
 * Where bubbles sit so they don't cover one another: bubbles in the same column are pushed up into a stack, the
 * lowest first, each `step` above the one below it. A stack that would climb past `top` is squeezed so that it
 * still fits, down to a few pixels apart. `x` and `y` are pixels, `y` growing downward. Returns the new `y` for
 * each bubble, in the order given.
 */
export function stackBubbles(points: { x: number; y: number }[], step: number, column = step, top = -Infinity): number[] {
  const out = points.map((p) => p.y);
  const columns = new Map<number, number[]>();
  points.forEach((p, i) => {
    const key = Math.round(p.x / column);
    const list = columns.get(key);
    if (list) list.push(i);
    else columns.set(key, [i]);
  });
  for (const list of columns.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => points[b]!.y - points[a]!.y);
    const lay = (gap: number) => {
      let floor = Infinity;
      for (const i of list) {
        const y = Math.min(points[i]!.y, floor - gap);
        out[i] = y;
        floor = y;
      }
      return floor;
    };
    if (lay(step) < top) {
      const lowest = points[list[0]!]!.y;
      lay(Math.min(step, Math.max(3, (lowest - top) / (list.length - 1))));
    }
  }
  return out;
}
