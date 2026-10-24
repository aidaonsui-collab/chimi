/**
 * Chimi points. The server keeps the book (routes/api/points.ts) and the pages read it; nothing here imports anything,
 * so both share one copy and node can test it directly.
 *
 * Every KST day DAILY_POOL points are shared by the wallets that traded that day, by weight: the ETH they bought and
 * sold on Chimi coins, plus CREATOR_SHARE of what other wallets traded on coins they launched. A creator's own trades
 * on their coin don't count. Only wallets with a GIWA Dojang share the pool: when a day closes, wallets without one
 * are left out and the rest split the whole pool. A day closes once the book has read a block from a later KST day.
 */
export const POINTS_VERSION = 1;
export const DAILY_POOL = 100_000;
export const CREATOR_SHARE = 0.1;

const KST_OFFSET_S = 9 * 3600;
const DAY_MS = 86_400_000;

/** The KST date of a unix time in seconds, as YYYY-MM-DD. */
export const kstDay = (ts: number) => new Date((ts + KST_OFFSET_S) * 1000).toISOString().slice(0, 10);

/** When a KST day ends, in ms. */
export const dayEndMs = (day: string) => Date.parse(`${day}T00:00:00+09:00`) + DAY_MS;

/** Today in KST. */
export const today = (ms = Date.now()) => kstDay(Math.floor(ms / 1000));

/** Milliseconds until today ends in KST. */
export const msToDayEnd = (ms = Date.now()) => dayEndMs(today(ms)) - ms;

export function dayLabel(day: string) {
  return new Date(`${day}T12:00:00+09:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "Asia/Seoul" });
}

/** A wallet's GIWA identity: its up.id name, and whether it holds a Dojang. `at` is when it was read (ms). */
export type Profile = { name: string | null; verified: boolean; at: number };

export type PointsFile = {
  version: number;
  chainId: number;
  factory: string;
  dailyPool: number;
  creatorShare: number;
  seasonStart: string; // KST date
  updatedAt: number; // ms
  through: number; // every swap up to this block is in the book
  throughTs: number; // that block's time, unix seconds
  tokens: number; // factory coins the book knows
  pools: Record<string, { token: string; creator: string; wethIs0: boolean }>; // by pool, lowercase
  /** Closed days: the points each Dojang wallet earned, and the wallets that traded without one. */
  days: { day: string; points: Record<string, number>; volume: number; unverified: string[] }[];
  open: { day: string; weights: Record<string, number>; volume: number }[];
  profiles: Record<string, Profile>;
};

export type PointsSettings = Pick<PointsFile, "chainId" | "factory" | "dailyPool" | "creatorShare" | "seasonStart">;

export function emptyBook(s: PointsSettings, through: number, throughTs: number): PointsFile {
  return { version: POINTS_VERSION, ...s, updatedAt: 0, through, throughTs, tokens: 0, pools: {}, days: [], open: [], profiles: {} };
}

/** Whether a saved book was kept under these settings; a book under other settings starts over. */
export function sameSettings(f: PointsFile, s: PointsSettings) {
  return (
    f.version === POINTS_VERSION &&
    f.chainId === s.chainId &&
    f.factory.toLowerCase() === s.factory.toLowerCase() &&
    f.dailyPool === s.dailyPool &&
    f.creatorShare === s.creatorShare &&
    f.seasonStart === s.seasonStart
  );
}

/** Adds one swap to its day's weights. Closed days never change. Mutates `book`. */
export function score(book: PointsFile, swap: { wallet: string; creator: string; eth: number; ts: number }) {
  const day = kstDay(swap.ts);
  const wallet = swap.wallet.toLowerCase();
  const creator = swap.creator.toLowerCase();
  if (day < book.seasonStart || book.days.some((d) => d.day === day)) return;
  // Creators earn from other wallets' trades on their coin, not from trading it themselves.
  if (wallet === creator) return;
  let open = book.open.find((d) => d.day === day);
  if (!open) book.open.push((open = { day, weights: {}, volume: 0 }));
  open.weights[wallet] = (open.weights[wallet] ?? 0) + swap.eth;
  open.weights[creator] = (open.weights[creator] ?? 0) + swap.eth * book.creatorShare;
  open.volume += swap.eth;
}

/** Open days the book has read past (their every swap is in), oldest first. */
export const closable = (book: PointsFile) =>
  book.open.filter((d) => d.day < kstDay(book.throughTs)).sort((a, b) => a.day.localeCompare(b.day));

/** Shares out each closable day among its Dojang wallets. Mutates `book`. */
export function closeDays(book: PointsFile, verified: (wallet: string) => boolean) {
  for (const d of closable(book)) {
    const earning = Object.entries(d.weights).filter(([w, x]) => x > 0 && verified(w));
    const total = earning.reduce((s, [, x]) => s + x, 0);
    const points = Object.fromEntries(earning.map(([w, x]) => [w, (book.dailyPool * x) / total]));
    const unverified = Object.keys(d.weights).filter((w) => !verified(w));
    book.days.push({ day: d.day, points, volume: d.volume, unverified });
    book.open = book.open.filter((o) => o !== d);
  }
  book.days.sort((a, b) => a.day.localeCompare(b.day));
}

export type Standing = { wallet: string; points: number; rank: number; prevRank: number | null };

export type Points = {
  file: PointsFile;
  season: Standing[];
  lastDay: { day: string; standings: Standing[] } | null;
  /** Today, scored as if it ended now: Dojang wallets only. */
  live: { day: string; standings: Standing[]; volume: number } | null;
  /** Points per closed day for one wallet, oldest first. */
  history: (wallet: string) => { day: string; points: number }[];
};

function rank(totals: Map<string, number>, previous?: Map<string, number>): Standing[] {
  const order = (m: Map<string, number>) =>
    [...m.entries()].filter(([, p]) => p > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const prevRanks = new Map(previous ? order(previous).map(([w], i) => [w, i + 1]) : []);
  return order(totals).map(([wallet, points], i) => ({
    wallet,
    points,
    rank: i + 1,
    prevRank: previous ? (prevRanks.get(wallet) ?? null) : null,
  }));
}

export function summarize(file: PointsFile): Points {
  const season = new Map<string, number>();
  const beforeLast = new Map<string, number>();
  file.days.forEach((d, i) => {
    for (const [w, p] of Object.entries(d.points)) {
      season.set(w, (season.get(w) ?? 0) + p);
      if (i < file.days.length - 1) beforeLast.set(w, (beforeLast.get(w) ?? 0) + p);
    }
  });
  const last = file.days[file.days.length - 1];
  const openDay = file.open.slice().sort((a, b) => b.day.localeCompare(a.day))[0];
  let live: Points["live"] = null;
  if (openDay) {
    const earning = Object.entries(openDay.weights).filter(([w]) => file.profiles[w]?.verified);
    const total = earning.reduce((s, [, x]) => s + x, 0);
    live = {
      day: openDay.day,
      volume: openDay.volume,
      standings: rank(new Map(earning.map(([w, x]) => [w, total > 0 ? (file.dailyPool * x) / total : 0]))),
    };
  }
  return {
    file,
    season: rank(season, file.days.length > 1 ? beforeLast : undefined),
    lastDay: last ? { day: last.day, standings: rank(new Map(Object.entries(last.points))) } : null,
    live,
    history: (wallet) => {
      const w = wallet.toLowerCase();
      return file.days.map((d) => ({ day: d.day, points: d.points[w] ?? 0 }));
    },
  };
}

/** Season leagues by rank, best first, named for the parts of a hanok roof from the ornament down. */
export type League = { name: string; korean: string; top: number; color: string };

export const LEAGUES: League[] = [
  { name: "Chimi", korean: "치미", top: 0.01, color: "#e0b45a" },
  { name: "Yongmaru", korean: "용마루", top: 0.05, color: "#d24a2e" },
  { name: "Giwa", korean: "기와", top: 0.15, color: "#8fbfae" },
  { name: "Seokkarae", korean: "서까래", top: 0.4, color: "#6f8fc9" },
  { name: "Juchutdol", korean: "주춧돌", top: 1, color: "#9a8f7f" },
];

export function leagueOf(rank: number, total: number): League {
  return LEAGUES.find((l) => rank <= Math.max(1, Math.ceil(total * l.top))) ?? LEAGUES[LEAGUES.length - 1]!;
}
