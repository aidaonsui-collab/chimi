/*
 * What the home feed shows, and in what order: trades, launches, comments, coins crossing a round market cap, and
 * the times someone bought after you. The feed is built in the browser from things the page already reads, so this
 * file only sorts and picks. It imports nothing, so the rules can be tested on their own.
 */

/** One buy or sale. `key` is the transaction and its place in it, so a trade read twice is one trade. */
export type FeedTrade = { key: string; time: number; wallet: string; token: string; buy: boolean; tokens: number; eth: number; tx: string };

export type FeedLaunch = { token: string; creator: string; time: number };

export type FeedComment = { id: string; token: string; wallet: string; text: string; time: number; likes?: number; liked?: boolean; replies?: number; replyTo?: string };

/** A coin's market cap around one trade, oldest first. `before` is unknown for a trade whose size can't be read back. */
export type CapPoint = { time: number; before?: number; after: number };

/** One trade as the feed shows it. */
export type TradeItem = { kind: "trade"; followed: boolean; mine: boolean; largest: boolean; nth: number } & FeedTrade;

/**
 * Several trades on one coin in quick succession, shown as one card. `trades` is newest first; `time` is the
 * newest of them and `since` the oldest; `wallets` are the traders, biggest spender first.
 */
export type BurstItem = { kind: "burst"; key: string; time: number; since: number; token: string; trades: TradeItem[]; wallets: string[]; buys: number; sells: number; eth: number };

export type FeedItem =
  | TradeItem
  | BurstItem
  | { kind: "launch"; key: string; time: number; token: string; creator: string; followed: boolean; earlier: number }
  | { kind: "comment"; key: string; time: number; token: string; wallet: string; text: string; followed: boolean; mine: boolean; id: string; likes: number; liked: boolean; replies: number; replyTo?: string }
  | { kind: "milestone"; key: string; time: number; token: string; cap: number }
  | { kind: "copied"; key: string; time: number; token: string; by: string[]; eth: number }
  /** `wallet` tipped `creator`, who launched `token`, `eth` while they streamed. `text` is the message, already made safe to show. */
  | { kind: "tip"; key: string; time: number; token: string; wallet: string; creator: string; eth: number; text: string; followed: boolean; mine: boolean };

/** A tip as the feed takes it in. */
export type FeedTip = { key: string; time: number; token: string; wallet: string; creator: string; eth: number; text: string };

export const DAY_S = 24 * 60 * 60;

/** Round market caps worth a card, in dollars. */
export const CAP_STEPS = [5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 5_000_000];

/** A "largest buy today" needs a few buys to be the largest of. */
export const MIN_BUYS_FOR_LARGEST = 3;

/** For you shows every trade until there are this many; past it, strangers' small trades drop out. */
export const CROWDED = 30;

/** Trades on one coin this close together are one burst. */
export const BURST_GAP_S = 5 * 60;
/** A burst covers this long at most, so a coin that trades all day reads as several cards, not one. */
export const BURST_SPAN_S = 30 * 60;
/** Fewer trades than this stay cards of their own. */
export const BURST_MIN = 3;

const lower = (s: string) => s.toLowerCase();
const newestFirst = (a: { time: number; key: string }, b: { time: number; key: string }) => b.time - a.time || (a.key < b.key ? 1 : -1);

/** The biggest buy since `since`, when there were enough buys for that to mean something. */
export function largestBuy(trades: FeedTrade[], since: number): string | undefined {
  const buys = trades.filter((t) => t.buy && t.time >= since);
  if (buys.length < MIN_BUYS_FOR_LARGEST) return undefined;
  return buys.reduce((top, t) => (t.eth > top.eth ? t : top)).key;
}

/** For each buy, which buy of that coin by that wallet it is among the trades given: 1 for the first. */
export function buyCounts(trades: FeedTrade[]): Map<string, number> {
  const seen = new Map<string, number>();
  const out = new Map<string, number>();
  for (const t of [...trades].sort((a, b) => a.time - b.time || (a.key < b.key ? -1 : 1))) {
    if (!t.buy) continue;
    const id = `${lower(t.wallet)}:${lower(t.token)}`;
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    out.set(t.key, n);
  }
  return out;
}

/**
 * The highest round market cap a coin climbed through in these trades and still stands above. One per coin at
 * most, so a price wobbling around a line doesn't fill the feed.
 */
export function milestoneOf(points: CapPoint[], capNow: number, steps: readonly number[] = CAP_STEPS): { cap: number; time: number } | undefined {
  let best: { cap: number; time: number } | undefined;
  let previous: number | undefined;
  for (const p of points) {
    const from = p.before ?? previous;
    previous = p.after;
    if (from === undefined || !(p.after > from)) continue;
    for (const step of steps) {
      if (from < step && p.after >= step && capNow >= step && (!best || step >= best.cap)) best = { cap: step, time: p.time };
    }
  }
  return best;
}

/**
 * The times someone who follows `me` bought a coin within a day after `me` bought it. Each of my buys gets one
 * entry naming who came after; a follower counts once per coin, against my latest buy before theirs.
 */
export function copies(trades: FeedTrade[], me: string | undefined, followers: readonly string[], windowS = DAY_S): Extract<FeedItem, { kind: "copied" }>[] {
  if (!me || followers.length === 0) return [];
  const mine = lower(me);
  const fans = new Set(followers.map(lower));
  const buys = trades.filter((t) => t.buy).sort((a, b) => a.time - b.time || (a.key < b.key ? -1 : 1));
  const led = new Map<string, { lead: FeedTrade; by: string[]; time: number }>();
  const counted = new Set<string>();
  const latestMine = new Map<string, FeedTrade>();
  for (const t of buys) {
    const token = lower(t.token);
    const wallet = lower(t.wallet);
    if (wallet === mine) {
      latestMine.set(token, t);
      continue;
    }
    const lead = latestMine.get(token);
    if (!lead || !fans.has(wallet) || t.time - lead.time > windowS || counted.has(`${wallet}:${token}`)) continue;
    counted.add(`${wallet}:${token}`);
    const entry = led.get(lead.key) ?? { lead, by: [], time: t.time };
    entry.by.push(wallet);
    entry.time = Math.max(entry.time, t.time);
    led.set(lead.key, entry);
  }
  return [...led.values()].map(({ lead, by, time }) => ({ kind: "copied", key: `copied:${lead.key}`, time, token: lower(lead.token), by, eth: lead.eth }));
}

export type FeedInput = {
  trades: FeedTrade[];
  launches: FeedLaunch[];
  comments: FeedComment[];
  /** Tips to creators while they streamed. */
  tips?: FeedTip[];
  /** Per coin (lowercase token): its market cap around each trade, and what it is now. */
  caps?: Record<string, { points: CapPoint[]; now: number }>;
  me?: string;
  following?: readonly string[];
  followers?: readonly string[];
  /** Unix seconds. "Today" for the largest buy is the day before this. */
  now: number;
};

/** Everything that happened, newest first. Tabs pick from this. */
export function buildFeed(input: FeedInput): FeedItem[] {
  const me = input.me ? lower(input.me) : undefined;
  const followed = new Set((input.following ?? []).map(lower));
  const largest = largestBuy(input.trades, input.now - DAY_S);
  const nth = buyCounts(input.trades);
  const items: FeedItem[] = [];
  const seen = new Set<string>();

  for (const t of input.trades) {
    if (seen.has(t.key)) continue;
    seen.add(t.key);
    const wallet = lower(t.wallet);
    items.push({ ...t, kind: "trade", wallet, token: lower(t.token), followed: followed.has(wallet), mine: wallet === me, largest: t.key === largest, nth: nth.get(t.key) ?? 0 });
  }

  // A creator's earlier coins say something about a new one, so count them.
  const byCreator = new Map<string, number>();
  for (const l of [...input.launches].sort((a, b) => a.time - b.time)) {
    const creator = lower(l.creator);
    const earlier = byCreator.get(creator) ?? 0;
    byCreator.set(creator, earlier + 1);
    items.push({ kind: "launch", key: `launch:${lower(l.token)}`, time: l.time, token: lower(l.token), creator, followed: followed.has(creator), earlier });
  }

  for (const c of input.comments) {
    const wallet = lower(c.wallet);
    items.push({
      kind: "comment",
      key: `comment:${lower(c.token)}:${c.id}`,
      time: c.time,
      token: lower(c.token),
      wallet,
      text: c.text,
      followed: followed.has(wallet),
      mine: wallet === me,
      id: c.id,
      likes: c.likes ?? 0,
      liked: c.liked ?? false,
      replies: c.replies ?? 0,
      replyTo: c.replyTo,
    });
  }

  for (const t of input.tips ?? []) {
    const wallet = lower(t.wallet);
    const creator = lower(t.creator);
    items.push({ kind: "tip", key: `tip:${t.key}`, time: t.time, token: lower(t.token), wallet, creator, eth: t.eth, text: t.text, followed: followed.has(wallet) || followed.has(creator), mine: wallet === me });
  }

  for (const [token, cap] of Object.entries(input.caps ?? {})) {
    const hit = milestoneOf(cap.points, cap.now);
    if (hit) items.push({ kind: "milestone", key: `milestone:${lower(token)}:${hit.cap}`, time: hit.time, token: lower(token), cap: hit.cap });
  }

  items.push(...copies(input.trades, me, input.followers ?? []));
  return items.sort(newestFirst);
}

/**
 * Folds runs of trades on one coin into single cards. A run is `min` or more trades, each within `gapS` of the one
 * before and all within `spanS`. Trades by you, by wallets you follow, and the day's largest buy are never folded:
 * they are why you opened the feed. Everything else passes through, and the list stays newest first.
 */
export function groupBursts(items: FeedItem[], gapS = BURST_GAP_S, spanS = BURST_SPAN_S, min = BURST_MIN): FeedItem[] {
  const byToken = new Map<string, TradeItem[]>();
  for (const item of items) {
    if (item.kind !== "trade" || item.followed || item.mine || item.largest) continue;
    const list = byToken.get(item.token);
    if (list) list.push(item);
    else byToken.set(item.token, [item]);
  }
  const folded = new Set<string>();
  const bursts: BurstItem[] = [];
  for (const [token, list] of byToken) {
    if (list.length < min) continue;
    const oldestFirst = [...list].sort((a, b) => a.time - b.time || (a.key < b.key ? -1 : 1));
    let run: TradeItem[] = [];
    const close = () => {
      if (run.length >= min) {
        const spent = new Map<string, number>();
        for (const t of run) {
          folded.add(t.key);
          spent.set(t.wallet, (spent.get(t.wallet) ?? 0) + t.eth);
        }
        bursts.push({
          kind: "burst",
          // Named for its first trade, so the card stays the same card as more trades join it.
          key: `burst:${token}:${run[0]!.key}`,
          time: run[run.length - 1]!.time,
          since: run[0]!.time,
          token,
          trades: [...run].reverse(),
          wallets: [...spent.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([wallet]) => wallet),
          buys: run.filter((t) => t.buy).length,
          sells: run.filter((t) => !t.buy).length,
          eth: run.reduce((sum, t) => sum + t.eth, 0),
        });
      }
      run = [];
    };
    for (const t of oldestFirst) {
      const last = run[run.length - 1];
      if (last && (t.time - last.time > gapS || t.time - run[0]!.time > spanS)) close();
      run.push(t);
    }
    close();
  }
  if (bursts.length === 0) return items;
  return [...items.filter((i) => i.kind !== "trade" || !folded.has(i.key)), ...bursts].sort(newestFirst);
}

/**
 * The For you tab: everything, with runs of trades on one coin folded into one card each. If it is still crowded,
 * trades by strangers that are smaller than the usual trade drop out, and what stays is what you follow, what you
 * did, launches, comments, milestones, bursts and the big buys.
 */
export function forYou(all: FeedItem[]): FeedItem[] {
  const items = groupBursts(all);
  const trades = items.filter((i): i is TradeItem => i.kind === "trade");
  if (trades.length <= CROWDED) return items;
  const sizes = trades.map((t) => t.eth).sort((a, b) => a - b);
  const usual = sizes[Math.floor(sizes.length / 2)] ?? 0;
  return items.filter((i) => i.kind !== "trade" || i.followed || i.mine || i.largest || (i.buy && i.eth >= usual));
}

/** What tells one showing of an item from the next: a burst counts as new again each time a trade joins it. */
export const freshnessKey = (item: FeedItem) => (item.kind === "burst" ? `${item.key}#${item.trades.length}` : item.key);

/** The Following tab: what the wallets you follow bought, sold, launched, said and tipped (or were tipped). */
export function fromFollowed(items: FeedItem[]): FeedItem[] {
  return items.filter((i) => (i.kind === "trade" || i.kind === "launch" || i.kind === "comment" || i.kind === "tip") && i.followed);
}

/** The New tab: launches, newest first. */
export function launchesOnly(items: FeedItem[]): FeedItem[] {
  return items.filter((i) => i.kind === "launch");
}

/** True when nothing has been traded, launched or said for `quietS`: the feed then leads with a digest instead. */
export function isQuiet(items: FeedItem[], now: number, quietS = 60 * 60): boolean {
  return !items.some((i) => i.kind !== "copied" && now - i.time < quietS);
}

/** The last day in three numbers. */
export function digest(trades: FeedTrade[], now: number): { trades: number; eth: number; wallets: number } {
  const day = trades.filter((t) => t.time >= now - DAY_S);
  return { trades: day.length, eth: day.reduce((sum, t) => sum + t.eth, 0), wallets: new Set(day.map((t) => lower(t.wallet))).size };
}

export type Suggestion = { wallet: string; points?: number; eth?: number };

/**
 * Wallets worth following: the season's leaders, or failing that whoever traded most in the trades given. Never
 * you, and never someone you already follow.
 */
export function suggestTraders(season: readonly { wallet: string; points: number }[], trades: FeedTrade[], known: readonly (string | undefined)[], max = 5): Suggestion[] {
  const skip = new Set(known.filter((w): w is string => !!w).map(lower));
  const leaders = season.filter((s) => !skip.has(lower(s.wallet))).map((s) => ({ wallet: lower(s.wallet), points: s.points }));
  if (leaders.length > 0) return leaders.slice(0, max);
  const volume = new Map<string, number>();
  for (const t of trades) volume.set(lower(t.wallet), (volume.get(lower(t.wallet)) ?? 0) + t.eth);
  return [...volume.entries()]
    .filter(([wallet]) => !skip.has(wallet))
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, max)
    .map(([wallet, eth]) => ({ wallet, eth }));
}

/** Who traded most since `since` (unix seconds), by ETH: the day's busiest wallets, for the list beside the feed. */
export function topTraders(trades: FeedTrade[], since: number, max = 5): { wallet: string; eth: number; trades: number }[] {
  const by = new Map<string, { wallet: string; eth: number; trades: number }>();
  const seen = new Set<string>();
  for (const t of trades) {
    if (t.time < since || seen.has(t.key)) continue;
    seen.add(t.key);
    const wallet = lower(t.wallet);
    const row = by.get(wallet) ?? { wallet, eth: 0, trades: 0 };
    row.eth += t.eth;
    row.trades += 1;
    by.set(wallet, row);
  }
  return [...by.values()].sort((a, b) => b.eth - a.eth || b.trades - a.trades || (a.wallet < b.wallet ? -1 : 1)).slice(0, max);
}

/** "third" from 3, for "their third buy of it". Past tenth it is just the number. */
export function ordinal(n: number): string {
  return ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"][n] ?? `${n}th`;
}

/*
 * The remembered feed is kept as JSON, which has no way to write the chain's big whole numbers. They are written as
 * marked text and read back as numbers, so a price or an amount survives the round trip exactly.
 */
const BIG = "#big:";

/** JSON text for anything that may hold bigints. */
export function packBig(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? `${BIG}${v}` : v));
}

/** The reverse of `packBig`. Throws on text that isn't JSON, like JSON.parse. */
export function unpackBig<T>(text: string): T {
  return JSON.parse(text, (_key, v) => (typeof v === "string" && v.startsWith(BIG) && /^-?\d+$/.test(v.slice(BIG.length)) ? BigInt(v.slice(BIG.length)) : v)) as T;
}

