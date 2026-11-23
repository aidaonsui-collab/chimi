/*
 * The home board's rules, apart from the page: which coins a filter keeps, how a sort orders them, and the four
 * "highlights" over the board (biggest, top volume, top gainers, hot now). Pure, so they're tested on their own
 * (web/test/board.test.ts).
 */

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

/** How recent a launch counts as new. */
export const NEW_WINDOW_S = 7 * DAY;

export type BoardFilter = "all" | "new" | "trending" | "live" | "locked";
export type BoardSortKey = "activity" | "cap" | "chg" | "vol" | "newest" | "burned";
export type BoardSort = { key: BoardSortKey; dir: "desc" | "asc" };
export type BoardView = "list" | "grid";

export const DEFAULT_SORT: BoardSort = { key: "activity", dir: "desc" };

export const FILTERS: readonly (readonly [BoardFilter, string])[] = [
  ["all", "All"],
  ["new", "New"],
  ["trending", "Trending"],
  ["live", "Live"],
  ["locked", "Dev locked"],
];

export const SORTS: readonly (readonly [BoardSortKey, string])[] = [
  ["activity", "Last trade"],
  ["cap", "Market cap"],
  ["vol", "Volume 24h"],
  ["chg", "Change 24h"],
  ["newest", "Newest"],
  ["burned", "Burned"],
];

/** What the rules need to know about a coin on the board. */
export type BoardFacts = {
  /** Lowercase. */
  token: string;
  name: string;
  symbol: string;
  /** Its place in the factory's list, newest first. */
  order: number;
  capEth: number;
  /** The day's move in percent. */
  change?: number;
  /** The day's volume in ETH; undefined while the trades are still being read. */
  volEth?: number;
  /** The day's trades. */
  trades?: number;
  /** Launch time, unix seconds, when known. */
  born?: number;
  /** Share of the supply burned, 0..1. */
  burned?: number;
  /** The latest trade read. */
  last?: { buy: boolean; eth: number; time: number };
  /** Trades in the last hour. */
  hour: number;
};

/** Trades in the hour before `now` (unix seconds). */
export function hourTrades(swaps: readonly { time: number }[], now: number): number {
  let n = 0;
  for (const s of swaps) if (s.time > now - HOUR && s.time <= now + 60) n++;
  return n;
}

/** Whether a coin is in the filter's list. `live` and `locked` are lowercase tokens. */
export function inFilter(row: BoardFacts, filter: BoardFilter, ctx: { now: number; live: ReadonlySet<string>; locked?: ReadonlySet<string> }): boolean {
  switch (filter) {
    case "new":
      return row.born !== undefined && ctx.now - row.born < NEW_WINDOW_S;
    case "trending":
      return (row.trades ?? 0) > 0;
    case "live":
      return ctx.live.has(row.token);
    case "locked":
      return !!ctx.locked?.has(row.token);
    default:
      return true;
  }
}

/** Whether a coin matches what was typed in search: its name, its ticker (with or without $), or the start of its address. */
export function matchesQuery(row: BoardFacts, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/^\$/, "");
  if (!q) return true;
  if (q.startsWith("0x")) return row.token.startsWith(q);
  return row.name.toLowerCase().includes(q) || row.symbol.toLowerCase().includes(q);
}

/** When a coin was last busy: its latest trade, else its launch. */
const activityOf = (row: BoardFacts) => row.last?.time ?? row.born;

/** A sort's number for a coin; undefined when it isn't known, and those always go last whichever way the sort runs. */
function keyOf(row: BoardFacts, key: BoardSortKey): number | undefined {
  switch (key) {
    case "activity":
      return activityOf(row);
    case "cap":
      return row.capEth;
    case "chg":
      return row.change;
    case "vol":
      return row.volEth;
    case "newest":
      return row.born;
    case "burned":
      return row.burned;
  }
}

/** The board in the sort's order. Ties go to the bigger coin, then to the factory's order. */
export function sortBoard<T extends BoardFacts>(rows: readonly T[], sort: BoardSort): T[] {
  const sign = sort.dir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = keyOf(a, sort.key);
    const y = keyOf(b, sort.key);
    if (x !== undefined && y !== undefined && x !== y) return sign * (x - y);
    if (x === undefined && y !== undefined) return 1;
    if (y === undefined && x !== undefined) return -1;
    // The factory lists coins newest first, so for "newest" a coin without a known launch time keeps that place.
    if (sort.key === "newest" && a.order !== b.order) return sign === -1 ? a.order - b.order : b.order - a.order;
    return b.capEth - a.capEth || a.order - b.order;
  });
}

/** The four lists over the board, three coins each at most. */
export function highlights<T extends BoardFacts>(rows: readonly T[], top = 3) {
  const by = (keep: (r: T) => boolean, value: (r: T) => number) =>
    rows
      .filter(keep)
      .sort((a, b) => value(b) - value(a) || b.capEth - a.capEth || a.order - b.order)
      .slice(0, top);
  return {
    biggest: by((r) => r.capEth > 0, (r) => r.capEth),
    volume: by((r) => (r.volEth ?? 0) > 0, (r) => r.volEth ?? 0),
    gainers: by((r) => (r.change ?? 0) >= 0.005, (r) => r.change ?? 0),
    hot: by((r) => r.hour > 0, (r) => r.hour),
  };
}
