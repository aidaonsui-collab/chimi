/*
 * What the home feed shows, and in what order: trades, launches, comments, coins crossing a round market cap, and
 * the times someone bought after you. The feed is built in the browser from things the page already reads, so this
 * file only sorts and picks. It imports nothing, so the rules can be tested on their own.
 */

/** One buy or sale. `key` is the transaction and its place in it, so a trade read twice is one trade. */
export type FeedTrade = { key: string; time: number; wallet: string; token: string; buy: boolean; tokens: number; eth: number; tx: string };

export type FeedLaunch = { token: string; creator: string; time: number };

export type FeedComment = { id: string; token: string; wallet: string; text: string; time: number };

/** A coin's market cap around one trade, oldest first. `before` is unknown for a trade whose size can't be read back. */
export type CapPoint = { time: number; before?: number; after: number };

export type FeedItem =
  | ({ kind: "trade"; followed: boolean; mine: boolean; largest: boolean; nth: number } & FeedTrade)
  | { kind: "launch"; key: string; time: number; token: string; creator: string; followed: boolean; earlier: number }
  | { kind: "comment"; key: string; time: number; token: string; wallet: string; text: string; followed: boolean; mine: boolean }
  | { kind: "milestone"; key: string; time: number; token: string; cap: number }
  | { kind: "copied"; key: string; time: number; token: string; by: string[]; eth: number };

export const DAY_S = 24 * 60 * 60;

/** Round market caps worth a card, in dollars. */
export const CAP_STEPS = [5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 5_000_000];

/** A "largest buy today" needs a few buys to be the largest of. */
export const MIN_BUYS_FOR_LARGEST = 3;

/** For you shows every trade until there are this many; past it, strangers' small trades drop out. */
export const CROWDED = 30;

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
    items.push({ kind: "comment", key: `comment:${lower(c.token)}:${c.id}`, time: c.time, token: lower(c.token), wallet, text: c.text, followed: followed.has(wallet), mine: wallet === me });
  }

  for (const [token, cap] of Object.entries(input.caps ?? {})) {
    const hit = milestoneOf(cap.points, cap.now);
    if (hit) items.push({ kind: "milestone", key: `milestone:${lower(token)}:${hit.cap}`, time: hit.time, token: lower(token), cap: hit.cap });
  }

  items.push(...copies(input.trades, me, input.followers ?? []));
  return items.sort(newestFirst);
}

/**
 * The For you tab: everything, until the feed is crowded. Then trades by strangers that are smaller than the usual
 * trade drop out, and what stays is what you follow, what you did, launches, comments, milestones and the big buys.
 */
export function forYou(items: FeedItem[]): FeedItem[] {
  const trades = items.filter((i): i is Extract<FeedItem, { kind: "trade" }> => i.kind === "trade");
  if (trades.length <= CROWDED) return items;
  const sizes = trades.map((t) => t.eth).sort((a, b) => a - b);
  const usual = sizes[Math.floor(sizes.length / 2)] ?? 0;
  return items.filter((i) => i.kind !== "trade" || i.followed || i.mine || i.largest || (i.buy && i.eth >= usual));
}

/** The Following tab: what the wallets you follow bought, sold, launched and said. */
export function fromFollowed(items: FeedItem[]): FeedItem[] {
  return items.filter((i) => (i.kind === "trade" || i.kind === "launch" || i.kind === "comment") && i.followed);
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

/** "third" from 3, for "their third buy of it". Past tenth it is just the number. */
export function ordinal(n: number): string {
  return ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"][n] ?? `${n}th`;
}
