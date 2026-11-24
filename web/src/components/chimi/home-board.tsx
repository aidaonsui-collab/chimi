import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  DEFAULT_SORT,
  FILTERS,
  SORTS,
  highlights,
  hourTrades,
  inFilter,
  matchesQuery,
  sortBoard,
  type BoardFacts,
  type BoardFilter,
  type BoardSort,
  type BoardSortKey,
  type BoardView,
} from "@/lib/chimi/board-rules";
import { burnedText } from "@/lib/chimi/burned";
import { ago, compactUsd, ethText } from "@/lib/chimi/format";
import { coinStats, type CoinStats } from "@/lib/chimi/live";
import type { Coin, PoolSwap } from "@/lib/chimi/market";
import type { Profile } from "@/lib/chimi/points-rules";
import { shortWallet, useProfiles } from "@/lib/chimi/rewards";
import { useLiveTokens } from "@/lib/chimi/streams";
import { xHandleOf } from "@/lib/chimi/x-rules";
import { DevLockedTag } from "@/components/chimi/creator-lock";
import { QuickAmount, QuickBuy } from "@/components/chimi/feed-rows";
import { IconCheck, IconClose, IconGlobe, IconGrid, IconList, IconPlus, IconSearch, IconSliders, IconTelegram, IconX } from "@/components/chimi/icons";
import { LivePill } from "@/components/chimi/stream";
import { TokenArt, TokenLogo } from "@/components/chimi/token-logo";
import { Change, Seg, Sparkline } from "@/components/chimi/ui";

/*
 * The home page's board: every coin on Chimi. On top, a strip of the live trades and four short lists (the biggest
 * coins, the day's volume, the day's gainers, the last hour's busiest). Under them a bar to filter, search and sort
 * the board, and to show it as a list (the default) or as a grid of coin cards. Each list row is one press from a buy;
 * a card carries the same buy button on its picture.
 *
 * The list is a container: its columns come in as the board itself widens (.pairs-card in styles.css). On a phone
 * a row keeps the look it had before the grid came in: a round logo, the name over the ticker, market cap, the day's
 * line and the buy button.
 */

const DAY = 24 * 60 * 60;

/** Rows or cards shown before "Show more": a list page, and a grid page that fills rows of 2, 3, 5 or 6. */
const PAGE: Record<BoardView, number> = { list: 25, grid: 30 };

const VIEW_KEY = "chimi.board.view";

const EMPTY: CoinStats = { priceEth: 0, capEth: 0, spark: [] };

type Row = BoardFacts & { coin: Coin; stats: CoinStats; image?: string };

/** A coin's links, as its creator typed them on the coin page. */
export type CoinLinks = { twitter?: string; telegram?: string; website?: string };

export type PairsBoardProps = {
  /** Newest first, the order the factory lists them in. */
  coins: Coin[];
  stats: Record<string, CoinStats>;
  images: Record<string, string | undefined>;
  /** About a day of each pool's trades, by lowercase pool address. */
  byPool: Record<string, PoolSwap[] | undefined>;
  /** Each coin's burned share of its supply (0..1), by lowercase token. */
  burned?: Record<string, number>;
  /** Each coin's links, by lowercase token. */
  links?: Record<string, CoinLinks | undefined>;
  /** The platform's own coin (CHIMI), lowercase: it carries an Official tag. */
  official?: string;
  /** Coins whose creator's first buy is still in the creator lock, lowercase: they carry a "Dev locked" tag. */
  locked?: Set<string>;
  ethUsd?: number;
  /** When each coin launched, by lowercase token. */
  launched?: Map<string, number>;
  /** Names the page already knows, so the creators' and traders' don't have to be read again. */
  known?: Record<string, Profile>;
  /** Unix seconds. */
  now: number;
  /** True until there is a coin list to show. */
  waiting: boolean;
  /** False while the pools' trades are still being read: volume and the day's move aren't known yet. */
  tradesReady: boolean;
};

/** List or grid, remembered in this browser. The list until the page has read it, so the server's page and the first paint agree. */
function useBoardView(): [BoardView, (view: BoardView) => void] {
  const [view, setView] = useState<BoardView>("list");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (saved === "grid" || saved === "list") setView(saved);
    } catch {
      /* no storage: the list it is */
    }
  }, []);
  const choose = (next: BoardView) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* remembered for this visit only */
    }
  };
  return [view, choose];
}

export function PairsBoard({ coins, stats, images, byPool, burned, links, official, locked, ethUsd, launched, known, now, waiting, tradesReady }: PairsBoardProps) {
  const [filter, setFilter] = useState<BoardFilter>("all");
  const [sort, setSort] = useState<BoardSort>(DEFAULT_SORT);
  const [query, setQuery] = useState("");
  const [view, setView] = useBoardView();
  const [shown, setShown] = useState(PAGE.list);
  const live = useLiveTokens();

  const rows = useMemo<Row[]>(
    () =>
      coins.map((coin, order) => {
        const token = coin.token.toLowerCase();
        const st = stats[token] ?? (coin.preview ? coinStats(coin, []) : EMPTY);
        const swaps = byPool[coin.pool.toLowerCase()];
        let last: PoolSwap | undefined;
        for (const s of swaps ?? []) if (!last || s.time > last.time || (s.time === last.time && (s.block > last.block || (s.block === last.block && (s.index ?? 0) > (last.index ?? 0))))) last = s;
        return {
          coin,
          stats: st,
          image: images[token],
          token,
          name: coin.name,
          symbol: coin.symbol,
          order,
          capEth: st.capEth,
          change: st.change,
          volEth: st.volEth,
          trades: st.trades,
          born: launched?.get(token),
          burned: burned?.[token],
          last: last ? { buy: last.buy, eth: Number(last.ethAmount) / 1e18, time: last.time } : undefined,
          hour: swaps ? hourTrades(swaps, now) : 0,
        };
      }),
    [coins, stats, images, byPool, launched, burned, now],
  );
  const listed = useMemo(() => sortBoard(rows.filter((r) => inFilter(r, filter, { now, live, locked }) && matchesQuery(r, query)), sort), [rows, filter, query, sort, now, live, locked]);
  const page = listed.slice(0, shown);
  const creators = useMemo(() => [...new Set(page.map((r) => r.coin.creator.toLowerCase()))], [page]);
  const profiles = useProfiles(creators, known);
  const byOf = (row: Row) => {
    const creator = row.coin.creator.toLowerCase();
    return profiles[creator]?.name?.replace(/\.up\.id$/, "") ?? shortWallet(creator);
  };
  const usd = (eth: number | undefined) => (eth === undefined ? "—" : ethUsd ? compactUsd(eth * ethUsd) : `${ethText(eth)} ETH`);

  // A new filter, search, order or layout starts again from the top of the list.
  const fresh = (next: BoardView = view) => setShown(PAGE[next]);
  const pickFilter = (next: BoardFilter) => {
    setFilter(next);
    fresh();
  };
  const pickSort = (key: BoardSortKey) => {
    setSort({ key, dir: "desc" });
    fresh();
  };
  // A heading's first press sorts by it, biggest first; the next flips it.
  const pressColumn = (key: BoardSortKey) => {
    setSort((was) => (was.key === key ? { key, dir: was.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));
    fresh();
  };
  const pickView = (next: BoardView) => {
    setView(next);
    fresh(next);
  };
  const showAll = () => {
    setFilter("all");
    setQuery("");
    fresh();
  };

  // On a phone: filter, order and layout on one line, then search and the quick-buy amount. Wider, the two groups open
  // into one line (styles.css .board-tools).
  const tools = (
    <div className="board-tools">
      <div className="board-filter-tabs min-w-0">
        <Seg label="Show" value={filter} onChange={pickFilter} options={FILTERS} />
      </div>
      <div className="board-tools-a">
        <label className="chip board-select board-filter-pick">
          <span className="text-faint">Filter:</span>
          <select value={filter} onChange={(e) => pickFilter(e.target.value as BoardFilter)} aria-label="Filter the board">
            {FILTERS.map(([key, text]) => (
              <option key={key} value={key}>
                {text}
              </option>
            ))}
          </select>
        </label>
        <label className="chip board-select board-sort" title={sort.dir === "asc" ? "Smallest first" : "Biggest first"}>
          <IconSliders size={14} className="board-sort-icon shrink-0 text-faint" />
          <select value={sort.key} onChange={(e) => pickSort(e.target.value as BoardSortKey)} aria-label="Sort the board">
            {SORTS.map(([key, text]) => (
              <option key={key} value={key}>
                {text}
              </option>
            ))}
          </select>
        </label>
        <ViewToggle view={view} onChange={pickView} />
      </div>
      <div className="board-tools-b">
        <label className="board-search">
          <IconSearch size={15} className="shrink-0 text-faint" />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              fresh();
            }}
            placeholder="Search coins…"
            aria-label="Search coins on the board"
            autoComplete="off"
            spellCheck={false}
          />
          {query ? (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="grid size-6 shrink-0 place-items-center rounded-full text-muted hover:bg-raise2 hover:text-fg">
              <IconClose size={13} />
            </button>
          ) : null}
        </label>
        <QuickAmount className="board-quick" />
      </div>
    </div>
  );

  const heading = (key: BoardSortKey, label: ReactNode, className: string) => {
    const on = sort.key === key ? sort.dir : null;
    return (
      <span className={className} aria-sort={on === "desc" ? "descending" : on === "asc" ? "ascending" : "none"}>
        <button type="button" onClick={() => pressColumn(key)} className={`pg-sort justify-end ${on ? "text-fg" : ""}`} title={on ? (on === "desc" ? "Biggest first. Press to flip." : "Smallest first. Press to flip.") : "Sort by this"}>
          <SortMark dir={on} />
          {label}
        </button>
      </span>
    );
  };

  const nothingYet = !waiting && rows.length === 0;
  const noMatch = !waiting && rows.length > 0 && listed.length === 0;
  const invite = !waiting && rows.length > 0 && rows.length < 6 && filter === "all" && !query && listed.length <= shown;

  const list = (
    <div className="card pairs-card overflow-hidden">
      <div className="pairs-grid th border-b border-line/70 py-3">
        <span>Coin</span>
        {heading("cap", "Market cap", "text-right")}
        {heading("chg", "24h", "pg-chg text-right")}
        {heading(
          "burned",
          <>
            Burned <span aria-hidden>🔥</span>
          </>,
          "pg-burn text-right",
        )}
        {heading("vol", "Volume 24h", "pg-vol text-right")}
        {heading("activity", "Last trade", "pg-last text-right")}
        <span className="pg-spark text-right">Last 24h</span>
        <span className="text-right">Buy</span>
      </div>
      {waiting ? (
        <ul aria-hidden>
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="flex min-h-[4.25rem] items-center gap-3 border-b border-line/60 px-4 last:border-0 sm:px-5">
              <span className="skeleton size-10 shrink-0 rounded-full" />
              <span className="flex-1 space-y-1.5">
                <span className="skeleton block h-3.5 w-2/5" />
                <span className="skeleton block h-3 w-1/4" />
              </span>
              <span className="skeleton h-4 w-16" />
              <span className="skeleton h-7 w-16 rounded-full" />
            </li>
          ))}
        </ul>
      ) : (
        <ul>
          {page.map((row) => {
            const pending = !row.coin.preview && !tradesReady && row.stats.volEth === undefined;
            const token = row.token;
            const isNew = row.born !== undefined && now - row.born < DAY;
            return (
              <li key={row.coin.token} className="pair-item border-b border-line/60 last:border-0">
                <div className="pairs-grid">
                  <span className="pg-pair">
                    <Link to="/coin/$address" params={{ address: row.coin.token }} className="pair-name" aria-label={`${row.coin.name} ($${row.coin.symbol})`}>
                      <span className="pg-logo-wrap">
                        <TokenLogo symbol={row.coin.symbol} image={row.image} size={40} className="pg-logo" style={LOGO_BOX} />
                        {official === token ? (
                          <span aria-hidden title="Official" className="pg-official-badge">
                            <IconCheck size={9} />
                          </span>
                        ) : null}
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span className="pg-title truncate">
                            <span className="pg-t-phone">{row.coin.name}</span>
                            <span className="pg-t-wide">{row.coin.symbol}</span>
                          </span>
                          {official === token ? <span className="official-tag official-top shrink-0">Official</span> : null}
                          {locked?.has(token) ? <DevLockedTag className="shrink-0" /> : null}
                          {row.coin.preview ? <span className="chip h-[18px] shrink-0 px-1.5 text-[10.5px]">preview</span> : null}
                          {live.has(token) ? <LivePill small /> : null}
                        </span>
                        <span className="pg-sub num">
                          <span className="pg-t-phone shrink-0">${row.coin.symbol}</span>
                          <span className="pg-t-wide min-w-0 truncate">{row.coin.name}</span>
                          {row.born !== undefined ? <span className={`pg-age shrink-0 ${isNew ? "text-ok" : ""}`}>{ago(Math.max(0, now - row.born))}</span> : null}
                          <span className="pg-by truncate text-faint">by {byOf(row)}</span>
                        </span>
                      </span>
                    </Link>
                    <Socials links={links?.[token]} name={row.coin.name} />
                  </span>
                  <span className="text-right">
                    <span className="num block text-[15px] font-semibold">{usd(row.stats.capEth)}</span>
                    <span className="pg-chg-inline text-[12.5px]">{pending ? null : <Change value={row.stats.change} />}</span>
                  </span>
                  <span className="pg-chg text-right text-[14px]">{pending ? <Dots /> : <Change value={row.stats.change} />}</span>
                  <span className={`pg-burn num text-right text-[14px] ${row.burned ? "text-fg" : "text-muted"}`}>{row.coin.preview ? "—" : burnedText(row.burned)}</span>
                  <span className="pg-vol num text-right text-[14px] text-muted">{row.coin.preview ? "—" : pending ? <Dots /> : usd(row.stats.volEth)}</span>
                  <span className="pg-last num text-right text-[13px] text-muted">
                    {row.last ? (
                      <>
                        <span className={row.last.buy ? "text-ok" : "text-down"}>
                          {row.last.buy ? "Buy" : "Sell"} {usd(row.last.eth)}
                        </span>
                        <span className="text-faint"> · {ago(Math.max(0, now - row.last.time))}</span>
                      </>
                    ) : pending ? (
                      <Dots />
                    ) : (
                      <span className="text-faint" title="No trade in the last day">
                        —
                      </span>
                    )}
                  </span>
                  <span className="pg-spark flex justify-end">
                    {row.stats.spark.length > 1 ? <Sparkline values={row.stats.spark} width={112} height={30} fluid /> : <span className="block h-[30px] w-[112px]" />}
                  </span>
                  <span className="flex justify-end">
                    <QuickBuy coin={row.coin} compact />
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {listed.length > shown ? (
        <button type="button" onClick={() => setShown((n) => n + PAGE.list)} className="w-full border-t border-line/70 py-3 text-sm font-medium text-muted hover:text-fg">
          Show more ({listed.length - shown} left)
        </button>
      ) : invite ? (
        <Link to="/launch" className="pair-invite border-t border-line/60">
          <span className="grid size-10 shrink-0 place-items-center rounded-full border border-dashed border-edge text-muted">
            <IconPlus size={16} />
          </span>
          <span className="min-w-0">
            <span className="block text-[14.5px] font-semibold text-fg">Your pair here</span>
            <span className="block truncate text-[12.5px]">Launch a coin in one transaction</span>
          </span>
        </Link>
      ) : null}
    </div>
  );

  const grid = (
    <>
      <ul className="coin-grid">
        {waiting
          ? Array.from({ length: 10 }, (_, i) => (
              <li key={i} className="coin-card" aria-hidden>
                <span className="skeleton block aspect-square rounded-none" />
                <span className="block space-y-2 p-3">
                  <span className="skeleton block h-4 w-1/2" />
                  <span className="skeleton block h-3 w-3/4" />
                  <span className="skeleton block h-3 w-2/3" />
                </span>
              </li>
            ))
          : page.map((row) => {
              const token = row.token;
              const pending = !row.coin.preview && !tradesReady && row.stats.volEth === undefined;
              const isNew = row.born !== undefined && now - row.born < DAY;
              return (
                <li key={row.coin.token} className="coin-card">
                  <div className="coin-card-art">
                    <TokenArt symbol={row.coin.symbol} image={row.image} />
                    <span className="coin-card-tags">
                      {official === token ? <span className="official-tag">Official</span> : null}
                      {locked?.has(token) ? <DevLockedTag /> : null}
                      {live.has(token) ? <LivePill small /> : null}
                    </span>
                    <span className="coin-card-buy">
                      <QuickBuy coin={row.coin} compact />
                    </span>
                  </div>
                  <div className="coin-card-body">
                    <div className="flex items-center justify-between gap-2">
                      <Link to="/coin/$address" params={{ address: row.coin.token }} className="coin-card-link" aria-label={`${row.coin.name} ($${row.coin.symbol})`}>
                        {row.coin.symbol}
                      </Link>
                      {row.stats.spark.length > 1 ? <Sparkline values={row.stats.spark} width={64} height={20} className="shrink-0" /> : null}
                    </div>
                    <div className="coin-card-line">
                      <span className="min-w-0 truncate text-muted">{row.coin.name}</span>
                      {pending ? <Dots /> : <Change value={row.stats.change} className="shrink-0" />}
                    </div>
                    <div className="coin-card-line num">
                      <span className="min-w-0 truncate">
                        <span className="text-faint">MC </span>
                        <span className="font-semibold text-fg">{usd(row.stats.capEth)}</span>
                      </span>
                      <span className={`shrink-0 ${row.burned ? "text-fg" : "text-muted"}`} title="Share of the supply burned">
                        🔥 {row.coin.preview ? "—" : burnedText(row.burned)}
                      </span>
                    </div>
                    <div className="coin-card-line text-[12px] text-faint">
                      <span className="num min-w-0 truncate">by {byOf(row)}</span>
                      {row.born !== undefined ? <span className={`num shrink-0 ${isNew ? "text-ok" : ""}`}>{ago(Math.max(0, now - row.born))}</span> : null}
                    </div>
                  </div>
                </li>
              );
            })}
        {invite ? (
          <li className="coin-card coin-card-invite">
            <Link to="/launch" className="coin-card-link-invite">
              <span className="grid size-11 place-items-center rounded-full border border-dashed border-edge text-muted">
                <IconPlus size={18} />
              </span>
              <span className="mt-3 block text-[14.5px] font-semibold text-fg">Your coin here</span>
              <span className="mt-0.5 block text-[12.5px] text-muted">Launch in one transaction</span>
            </Link>
          </li>
        ) : null}
      </ul>
      {listed.length > shown ? (
        <button type="button" onClick={() => setShown((n) => n + PAGE.grid)} className="btn btn-secondary mx-auto mt-5 flex">
          Show more ({listed.length - shown} left)
        </button>
      ) : null}
    </>
  );

  return (
    <section id="board" aria-labelledby="board-title" className="scroll-mt-24">
      <h2 id="board-title" className="sr-only">
        Board
      </h2>
      <div className="card board-top">
        <ActivityStrip rows={rows} byPool={byPool} usd={usd} now={now} known={known} ready={!waiting && tradesReady} />
        <BoardStats rows={rows} usd={usd} waiting={waiting} ready={tradesReady} />
      </div>
      {tools}
      {nothingYet ? (
        <div className="card px-4 py-12 text-center">
          <p className="font-serif text-xl text-gold">첫 코인</p>
          <p className="mt-3 text-[15px] font-semibold">Nothing has launched yet</p>
          <p className="mt-1 text-sm text-muted">Coins show up here as soon as one launches.</p>
          <Link to="/launch" className="btn btn-primary mt-4">
            <IconPlus size={16} />
            Launch the first coin
          </Link>
        </div>
      ) : noMatch ? (
        <div className="card px-4 py-12 text-center">
          <p className="text-[15px] font-semibold">{emptyTitle(filter, query)}</p>
          <p className="mt-1 text-sm text-muted">{query ? "Try a name, a ticker or the start of an address." : emptyBody(filter)}</p>
          <button type="button" onClick={showAll} className="btn btn-sm btn-secondary mt-4">
            Show every coin
          </button>
        </div>
      ) : view === "grid" ? (
        grid
      ) : (
        list
      )}
    </section>
  );
}

const LOGO_BOX: CSSProperties = { width: "var(--pg-logo)", height: "var(--pg-logo)" };

function emptyTitle(filter: BoardFilter, query: string) {
  if (query.trim()) return `No coin matches “${query.trim()}”`;
  switch (filter) {
    case "new":
      return "Nothing launched this week";
    case "trending":
      return "No coin has traded in the last day";
    case "live":
      return "Nobody is streaming right now";
    case "locked":
      return "No creator lock is running";
    default:
      return "No coins";
  }
}

function emptyBody(filter: BoardFilter) {
  switch (filter) {
    case "new":
      return "New shows coins launched in the last 7 days.";
    case "trending":
      return "Trending shows coins with a trade in the last 24 hours.";
    case "live":
      return "Live shows coins whose creator is streaming on the coin’s page.";
    case "locked":
      return "Dev locked shows coins whose creator’s first buy is still in the creator lock.";
    default:
      return "";
  }
}

function ViewToggle({ view, onChange }: { view: BoardView; onChange: (view: BoardView) => void }) {
  return (
    <div className="view-toggle" role="group" aria-label="Show the board as">
      <button type="button" aria-pressed={view === "grid"} onClick={() => onChange("grid")} title="Grid">
        <IconGrid size={16} />
        <span className="sr-only">Grid</span>
      </button>
      <button type="button" aria-pressed={view === "list"} onClick={() => onChange("list")} title="List">
        <IconList size={16} />
        <span className="sr-only">List</span>
      </button>
    </div>
  );
}

const keyOf = (swap: PoolSwap) => `${swap.tx}:${swap.index ?? 0}`;

/**
 * The live strip over the board: every coin's trades from the last day, newest first, sliding past. A trade shows
 * the coin, buy or sell, what it was worth, who made it and when. It holds still under the pointer.
 */
function ActivityStrip({
  rows,
  byPool,
  usd,
  now,
  known,
  ready,
}: {
  rows: Row[];
  byPool: Record<string, PoolSwap[] | undefined>;
  usd: (eth: number | undefined) => string;
  now: number;
  known?: Record<string, Profile>;
  ready: boolean;
}) {
  const items = useMemo(() => {
    const out: { row: Row; swap: PoolSwap }[] = [];
    for (const row of rows) for (const swap of byPool[row.coin.pool.toLowerCase()] ?? []) if (now - swap.time < DAY) out.push({ row, swap });
    return out.sort((a, b) => b.swap.time - a.swap.time || Number(b.swap.block - a.swap.block) || (b.swap.index ?? 0) - (a.swap.index ?? 0)).slice(0, 20);
  }, [rows, byPool, now]);
  const wallets = useMemo(() => [...new Set(items.map((i) => i.swap.recipient.toLowerCase()))], [items]);
  const profiles = useProfiles(wallets, known);
  const name = (wallet: string) => profiles[wallet]?.name?.replace(/\.up\.id$/, "") ?? shortWallet(wallet);
  // A few trades sit still; more slide, as two copies end to end so the loop has no seam.
  const moving = items.length > 3;

  const line = (hidden: boolean) => (
    <div className="ticker-row act-row" aria-hidden={hidden || undefined}>
      {items.map(({ row, swap }) => {
        const wallet = swap.recipient.toLowerCase();
        const eth = Number(swap.ethAmount) / 1e18;
        return (
          <span key={keyOf(swap)} className={`act-item ${swap.buy ? "act-buy" : "act-sell"}`}>
            <Link to="/coin/$address" params={{ address: row.coin.token }} tabIndex={hidden ? -1 : undefined} className="act-coin">
              <TokenLogo symbol={row.coin.symbol} image={row.image} size={22} shape="rounded" ring={false} />
              <span className="text-muted">{swap.buy ? "Buy" : "Sell"}</span>
              <span className="font-semibold text-fg">{row.coin.symbol}</span>
            </Link>
            <span className={`num font-semibold ${swap.buy ? "text-ok" : "text-down"}`}>
              {swap.buy ? "+" : "−"}
              {usd(eth)}
            </span>
            <Link to="/u/$address" params={{ address: wallet }} tabIndex={hidden ? -1 : undefined} className="num text-muted hover:text-fg">
              {name(wallet)}
            </Link>
            <span className="num text-faint">{ago(Math.max(0, now - swap.time))}</span>
          </span>
        );
      })}
    </div>
  );

  return (
    <div className={`act-strip ${moving ? "ticker-moving" : ""}`} style={{ "--ticker-s": `${items.length * 5}s` } as CSSProperties}>
      <span className="act-label">
        <span className="live-dot text-ok" />
        Live activity
      </span>
      {items.length === 0 ? (
        ready ? (
          <span className="act-quiet truncate">Quiet on GIWA: no trades in the last day.</span>
        ) : (
          <span className="act-quiet flex gap-6" aria-hidden>
            <span className="skeleton h-4 w-44" />
            <span className="skeleton h-4 w-44" />
            <span className="skeleton h-4 w-44" />
          </span>
        )
      ) : (
        <div className={`ticker-window ${moving ? "" : "act-still"}`}>
          <div className="ticker-track">
            {line(false)}
            {moving ? line(true) : null}
          </div>
        </div>
      )}
    </div>
  );
}

/** The four short lists over the board. A row opens its coin. */
function BoardStats({ rows, usd, waiting, ready }: { rows: Row[]; usd: (eth: number | undefined) => string; waiting: boolean; ready: boolean }) {
  const top = useMemo(() => highlights(rows), [rows]);
  const panels: { key: string; title: string; sub: string; list: Row[]; value: (row: Row) => ReactNode; empty: string; needsTrades: boolean }[] = [
    { key: "biggest", title: "Biggest", sub: "market cap", list: top.biggest, value: (r) => usd(r.capEth), empty: "Nothing has launched yet.", needsTrades: false },
    { key: "volume", title: "Top volume", sub: "24h", list: top.volume, value: (r) => usd(r.volEth), empty: "No trades in the last day.", needsTrades: true },
    { key: "gainers", title: "Top gainers", sub: "24h", list: top.gainers, value: (r) => <Change value={r.change} />, empty: "No coin is up over 24h.", needsTrades: true },
    { key: "hot", title: "Hot now", sub: "trades, last 1h", list: top.hot, value: (r) => r.hour.toLocaleString("en-US"), empty: "No trades in the last hour.", needsTrades: true },
  ];
  return (
    <div className="board-stats">
      {panels.map((p) => (
        <section key={p.key} className="board-stat" aria-label={`${p.title}, ${p.sub}`}>
          <header className="flex items-baseline justify-between gap-2">
            <h3 className="truncate text-[14px] font-semibold">{p.title}</h3>
            <span className="shrink-0 text-[12px] text-faint">{p.sub}</span>
          </header>
          {waiting || (p.needsTrades && !ready && p.list.length === 0) ? (
            <ol aria-hidden className="mt-1.5">
              {[0, 1, 2].map((i) => (
                <li key={i} className="stat-row">
                  <span className="skeleton size-6 shrink-0 rounded-md" />
                  <span className="skeleton h-3.5 flex-1" />
                </li>
              ))}
            </ol>
          ) : p.list.length === 0 ? (
            <p className="mt-2.5 text-[13px] text-faint">{p.empty}</p>
          ) : (
            <ol className="mt-1.5">
              {p.list.map((row, i) => (
                <li key={row.token}>
                  <Link to="/coin/$address" params={{ address: row.coin.token }} className="stat-row stat-link">
                    <span className="stat-rank num w-3 shrink-0 text-[12.5px] text-faint">{i + 1}</span>
                    <TokenLogo symbol={row.coin.symbol} image={row.image} size={24} shape="rounded" ring={false} />
                    <span className="min-w-0 truncate text-[14px] font-semibold">{row.coin.symbol}</span>
                    <span className="num ml-auto shrink-0 text-[13.5px]">{p.value(row)}</span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </section>
      ))}
    </div>
  );
}

function SortMark({ dir }: { dir: "desc" | "asc" | null }) {
  return (
    <span aria-hidden className={`pg-sort-mark ${dir ? "is-on" : ""}`}>
      {dir === "asc" ? "▲" : "▼"}
    </span>
  );
}

/** Where a coin's links go, made safe: an X handle or link, a Telegram name or link, a website. */
function socialHrefs(links: CoinLinks | undefined) {
  if (!links) return [];
  const out: { key: string; href: string; label: string; icon: ReactNode }[] = [];
  const x = xHandleOf(links.twitter);
  if (x) out.push({ key: "x", href: `https://x.com/${x}`, label: `@${x} on X`, icon: <IconX size={12} /> });
  const tg = links.telegram?.trim();
  if (tg) {
    const name = tg.replace(/^https?:\/\/(t\.me|telegram\.me)\//i, "").replace(/^@/, "");
    if (/^[A-Za-z0-9_+/-]{3,64}$/.test(name)) out.push({ key: "tg", href: `https://t.me/${name}`, label: "Telegram", icon: <IconTelegram size={13} /> });
  }
  const web = links.website?.trim();
  if (web) {
    const href = /^https?:\/\//i.test(web) ? web : `https://${web}`;
    try {
      const url = new URL(href);
      if (url.protocol === "https:" || url.protocol === "http:") out.push({ key: "web", href: url.href, label: url.hostname, icon: <IconGlobe size={13} /> });
    } catch {
      /* not a link */
    }
  }
  return out;
}

/** The coin's X, Telegram and website, as small icons after its name. Above the row's link, so they open on their own. */
function Socials({ links, name }: { links?: CoinLinks; name: string }) {
  const list = socialHrefs(links);
  if (list.length === 0) return null;
  return (
    <span className="pair-socials">
      {list.map((s) => (
        <a key={s.key} href={s.href} target="_blank" rel="noopener noreferrer" title={s.label} aria-label={`${name}: ${s.label}`} className="pair-social">
          {s.icon}
        </a>
      ))}
    </span>
  );
}

function Dots() {
  return <span className="skeleton ml-auto inline-block h-3.5 w-10" />;
}
