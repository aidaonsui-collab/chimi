import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { burnedText } from "@/lib/chimi/burned";
import { ago, compactUsd, ethText } from "@/lib/chimi/format";
import { capAfter, coinStats, type CoinStats } from "@/lib/chimi/live";
import type { Coin, PoolSwap } from "@/lib/chimi/market";
import type { Profile } from "@/lib/chimi/points-rules";
import { shortWallet, useProfiles } from "@/lib/chimi/rewards";
import { xHandleOf } from "@/lib/chimi/x-rules";
import { QuickAmount, QuickBuy } from "@/components/chimi/feed-rows";
import { IconGlobe, IconPlus, IconTelegram, IconX } from "@/components/chimi/icons";
import { TokenLogo } from "@/components/chimi/token-logo";
import { LivePill } from "@/components/chimi/stream";
import { useLiveTokens } from "@/lib/chimi/streams";
import { Change, Seg, Sparkline } from "@/components/chimi/ui";

/*
 * The home page's table: every pair on Chimi in one list, the way a trading floor shows its board. The tabs change
 * the order (what is trading, what just launched, the biggest, the day's gainers), and a column's heading sorts by
 * that column instead (press again to flip it, a third time to go back to the tab). Each row is one press from a buy.
 * Beside the board on a wide screen, under it on a phone, the live trades across every coin.
 *
 * The board is a container: its columns come in as the board itself widens (.pairs-card in styles.css), so it lays
 * out the same beside the trades as it would across the page.
 */

type Sort = "trending" | "new" | "top" | "gainers";
type Column = "pair" | "cap" | "chg" | "burned" | "vol" | "liq" | "trades";
type ColumnSort = { key: Column; dir: "desc" | "asc" } | null;

/** Rows shown before "Show more". */
const PAGE = 25;

const EMPTY: CoinStats = { priceEth: 0, capEth: 0, spark: [] };

type Row = { coin: Coin; stats: CoinStats; image?: string; liqEth?: number; order: number; born?: number; burned?: number };

/** A coin's links, as its creator typed them on the coin page. */
export type CoinLinks = { twitter?: string; telegram?: string; website?: string };

export type PairsBoardProps = {
  /** Newest first, the order the factory lists them in. */
  coins: Coin[];
  stats: Record<string, CoinStats>;
  images: Record<string, string | undefined>;
  /** ETH in each pool, by lowercase pool address. */
  reserves: Record<string, bigint | undefined>;
  /** Each coin's burned share of its supply (0..1), by lowercase token. */
  burned?: Record<string, number>;
  /** Each coin's links, by lowercase token. */
  links?: Record<string, CoinLinks | undefined>;
  /** The platform's own coin (CHIMI), lowercase: it carries an Official tag. */
  official?: string;
  ethUsd?: number;
  /** When each coin launched, by lowercase token. */
  launched?: Map<string, number>;
  /** Names the page already knows, so the creators' don't have to be read again. */
  known?: Record<string, Profile>;
  /** Unix seconds. */
  now: number;
  /** True until there is a coin list to show. */
  waiting: boolean;
  /** False while the pools' trades are still being read: volume and the day's move aren't known yet. */
  tradesReady: boolean;
  /** Shown beside the board on a wide screen, under it on a phone: the live trades. */
  side?: ReactNode;
};

const value = (row: Row, key: Column): number => {
  switch (key) {
    case "cap":
      return row.stats.capEth;
    case "chg":
      return row.stats.change ?? -Infinity;
    case "burned":
      return row.burned ?? -1;
    case "vol":
      return row.stats.volEth ?? -1;
    case "liq":
      return row.liqEth ?? -1;
    case "trades":
      return row.stats.trades ?? -1;
    default:
      return 0;
  }
};

export function PairsBoard({ coins, stats, images, reserves, burned, links, official, ethUsd, launched, known, now, waiting, tradesReady, side }: PairsBoardProps) {
  const [sort, setSort] = useState<Sort>("trending");
  const [column, setColumn] = useState<ColumnSort>(null);
  const [shown, setShown] = useState(PAGE);
  const rows = useMemo<Row[]>(
    () =>
      coins.map((coin, order) => {
        const wei = reserves[coin.pool.toLowerCase()];
        const token = coin.token.toLowerCase();
        return {
          coin,
          order,
          stats: stats[token] ?? (coin.preview ? coinStats(coin, []) : EMPTY),
          image: images[token],
          liqEth: wei === undefined ? undefined : Number(wei) / 1e18,
          born: launched?.get(token),
          burned: burned?.[token],
        };
      }),
    [coins, stats, images, reserves, launched, burned],
  );
  const ranked = useMemo(() => {
    const list = [...rows];
    if (column) {
      const sign = column.dir === "desc" ? -1 : 1;
      if (column.key === "pair") list.sort((a, b) => sign * a.coin.name.localeCompare(b.coin.name, "en", { sensitivity: "base" }) || a.order - b.order);
      else list.sort((a, b) => sign * (value(a, column.key) - value(b, column.key)) || b.stats.capEth - a.stats.capEth);
      return list;
    }
    // The factory lists coins newest first, so a coin whose launch time isn't known keeps that place.
    if (sort === "new") list.sort((a, b) => (a.born !== undefined && b.born !== undefined ? b.born - a.born : a.order - b.order));
    else if (sort === "top") list.sort((a, b) => b.stats.capEth - a.stats.capEth);
    else if (sort === "gainers") list.sort((a, b) => (b.stats.change ?? -Infinity) - (a.stats.change ?? -Infinity) || b.stats.capEth - a.stats.capEth);
    else list.sort((a, b) => (b.stats.volEth ?? 0) - (a.stats.volEth ?? 0) || (b.stats.trades ?? 0) - (a.stats.trades ?? 0) || b.stats.capEth - a.stats.capEth);
    return list;
  }, [rows, sort, column]);
  const page = ranked.slice(0, shown);
  const creators = useMemo(() => [...new Set(page.map((r) => r.coin.creator.toLowerCase()))], [page]);
  const profiles = useProfiles(creators, known);
  const live = useLiveTokens();

  const usd = (eth: number | undefined) => (eth === undefined ? "—" : ethUsd ? compactUsd(eth * ethUsd) : `${ethText(eth)} ETH`);

  // A heading's first press sorts by it, biggest first (names A to Z); the second flips it; the third goes back to the tab.
  const pressColumn = (key: Column) => {
    setShown(PAGE);
    setColumn((was) => {
      const first = key === "pair" ? "asc" : "desc";
      if (!was || was.key !== key) return { key, dir: first };
      if (was.dir === first) return { key, dir: first === "desc" ? "asc" : "desc" };
      return null;
    });
  };
  const heading = (key: Column, label: ReactNode, className: string, align: "left" | "right" = "right") => {
    const on = column?.key === key ? column.dir : null;
    return (
      <span className={className} aria-sort={on === "desc" ? "descending" : on === "asc" ? "ascending" : "none"}>
        <button
          type="button"
          onClick={() => pressColumn(key)}
          className={`pg-sort ${align === "right" ? "justify-end" : ""} ${on ? "text-fg" : ""}`}
          title={on ? (on === "desc" ? "Biggest first. Press to flip." : "Smallest first. Press to go back.") : "Sort by this"}
        >
          {align === "right" ? <SortMark dir={on} /> : null}
          {label}
          {align === "left" ? <SortMark dir={on} /> : null}
        </button>
      </span>
    );
  };

  const board = (
    <div className="min-w-0">
      <div className="no-scrollbar -mx-1 flex items-center justify-between gap-2 overflow-x-auto px-1 pb-3">
        <Seg
          label="Order the board by"
          value={sort}
          onChange={(next) => {
            setSort(next);
            setColumn(null);
            setShown(PAGE);
          }}
          options={[
            ["trending", "Trending"],
            ["new", "New"],
            ["top", "Top"],
            ["gainers", "Gainers"],
          ]}
        />
        {column ? (
          <button type="button" onClick={() => setColumn(null)} className="btn btn-sm btn-ghost shrink-0 text-muted">
            Clear sort
          </button>
        ) : null}
      </div>

      <div className="card pairs-card overflow-hidden">
        <div className="pairs-grid th border-b border-line/70 py-3">
          <span className="pg-rank">#</span>
          {heading("pair", "Pair", "", "left")}
          {heading("cap", "Market cap", "text-right")}
          {heading("chg", "24h", "pg-chg text-right")}
          {heading(
            "burned",
            <>
              Burned <span aria-hidden>🔥</span>
            </>,
            "pg-burn text-right",
          )}
          {heading("vol", "Volume", "pg-vol text-right")}
          {heading("liq", "Liquidity", "pg-liq text-right")}
          {heading("trades", "Trades", "pg-trades text-right")}
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
        ) : rows.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="font-serif text-xl text-gold">첫 코인</p>
            <p className="mt-3 text-[15px] font-semibold">Nothing has launched yet</p>
            <p className="mt-1 text-sm text-muted">Pairs show up here as soon as a coin launches.</p>
            <Link to="/launch" className="btn btn-primary mt-4">
              <IconPlus size={16} />
              Launch the first coin
            </Link>
          </div>
        ) : (
          <ul>
            {page.map((row, i) => {
              const pending = !row.coin.preview && !tradesReady && row.stats.volEth === undefined;
              const token = row.coin.token.toLowerCase();
              const creator = row.coin.creator.toLowerCase();
              const by = profiles[creator]?.name?.replace(/\.up\.id$/, "") ?? shortWallet(creator);
              const fresh = row.born !== undefined && now - row.born < 24 * 60 * 60;
              return (
                <li key={row.coin.token} className="pair-item border-b border-line/60 last:border-0">
                  <div className="pairs-grid min-h-[4.25rem] py-2.5">
                    <span className="pg-rank num text-[13px] text-faint">{i + 1}</span>
                    <span className="pg-pair">
                      <Link to="/coin/$address" params={{ address: row.coin.token }} className="pair-name">
                        <TokenLogo symbol={row.coin.symbol} image={row.image} size={40} />
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-[15px] font-semibold">{row.coin.name}</span>
                            {official === token ? <span className="official-tag official-top shrink-0">Official</span> : null}
                            {row.coin.preview ? <span className="chip h-[18px] shrink-0 px-1.5 text-[10.5px]">preview</span> : null}
                            {live.has(token) ? <LivePill small /> : null}
                          </span>
                          <span className="num flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted">
                            <span className="shrink-0">${row.coin.symbol}</span>
                            {official === token ? (
                              <span aria-hidden className="official-tag official-sub shrink-0">
                                Official
                              </span>
                            ) : null}
                            {row.born !== undefined ? <span className={`shrink-0 ${fresh ? "text-ok" : ""}`}>{ago(Math.max(0, now - row.born))}</span> : null}
                            <span className="pg-by hidden truncate text-faint">by {by}</span>
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
                    <span className="pg-liq num text-right text-[14px] text-muted">{row.coin.preview ? "—" : usd(row.liqEth)}</span>
                    <span className="pg-trades num text-right text-[14px] text-muted">{pending ? <Dots /> : (row.stats.trades ?? 0).toLocaleString("en-US")}</span>
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
        {ranked.length > shown ? (
          <button type="button" onClick={() => setShown((n) => n + PAGE)} className="w-full border-t border-line/70 py-3 text-sm font-medium text-muted hover:text-fg">
            Show more ({ranked.length - shown} left)
          </button>
        ) : !waiting && rows.length > 0 && rows.length < 6 ? (
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
    </div>
  );

  return (
    <section id="board" aria-labelledby="board-title" className="scroll-mt-24">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 pb-4">
        <h2 id="board-title" className="flex items-baseline gap-2.5 px-1 text-[28px] leading-none font-semibold tracking-[-0.03em]">
          Board
          {!waiting && rows.length > 0 ? <span className="num text-[15px] font-medium tracking-normal text-faint">{rows.length}</span> : null}
        </h2>
        <span className="flex items-center gap-2">
          <QuickAmount />
          <Link to="/launch" className="btn btn-sm btn-light hidden sm:inline-flex">
            <IconPlus size={15} />
            Launch a coin
          </Link>
        </span>
      </div>
      {side ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
          {board}
          <aside className="live-trades-aside min-w-0" aria-label="Live trades">
            {side}
          </aside>
        </div>
      ) : (
        board
      )}
    </section>
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
  return <span className="skeleton ml-auto h-3.5 w-10" />;
}

const keyOf = (swap: PoolSwap) => `${swap.tx}:${swap.index ?? 0}`;

/**
 * Every coin's trades, newest first: the coin, its market cap just after the trade, what the trade was worth (green
 * for a buy, red for a sale) and when. A row opens the coin.
 */
export function LiveTrades({
  coins,
  byPool,
  images,
  ethUsd,
  now,
  ready = true,
  max = 30,
}: {
  coins: Coin[];
  byPool: Record<string, PoolSwap[] | undefined>;
  images: Record<string, string | undefined>;
  ethUsd?: number;
  /** Unix seconds. */
  now: number;
  /** False while the trades are still being read. */
  ready?: boolean;
  max?: number;
}) {
  const rows = useMemo(() => {
    const out: { coin: Coin; swap: PoolSwap }[] = [];
    for (const coin of coins) for (const swap of byPool[coin.pool.toLowerCase()] ?? []) out.push({ coin, swap });
    return out.sort((a, b) => b.swap.time - a.swap.time || Number(b.swap.block - a.swap.block) || (b.swap.index ?? 0) - (a.swap.index ?? 0)).slice(0, max);
  }, [coins, byPool, max]);
  // Trades that arrive while the page is open flash once; the ones there on first paint don't.
  const seen = useRef<Set<string> | null>(null);
  const fresh = new Set<string>();
  if (seen.current) for (const r of rows) if (!seen.current.has(keyOf(r.swap))) fresh.add(keyOf(r.swap));
  useEffect(() => {
    seen.current = new Set([...(seen.current ?? []), ...rows.map((r) => keyOf(r.swap))]);
  }, [rows]);
  const usd = (eth: number) => (ethUsd ? compactUsd(eth * ethUsd) : `${ethText(eth)} ETH`);
  return (
    <div className="card live-trades overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line/70 px-4 py-3">
        <span className="flex items-center gap-2 text-[15px] font-semibold">
          <span className="live-dot text-ok" />
          Live trades
        </span>
        <span className="text-xs text-faint">Last day</span>
      </div>
      {rows.length === 0 && !ready ? (
        <ul aria-hidden className="live-trades-list">
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="flex min-h-[3.75rem] items-center gap-3 border-b border-line/60 px-4 last:border-0">
              <span className="skeleton size-9 shrink-0 rounded-full" />
              <span className="flex-1 space-y-1.5">
                <span className="skeleton block h-3.5 w-1/3" />
                <span className="skeleton block h-3 w-1/2" />
              </span>
              <span className="skeleton h-4 w-14" />
            </li>
          ))}
        </ul>
      ) : rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted">No trades in the last day.</p>
      ) : (
        <ul className="live-trades-list">
          {rows.map(({ coin, swap }) => {
            const eth = Number(swap.ethAmount) / 1e18;
            const cap = swap.sqrtPriceX96 > 0n ? capAfter(swap, coin) : undefined;
            return (
              <li key={keyOf(swap)} className={`border-b border-line/60 last:border-0 ${fresh.has(keyOf(swap)) ? "live-trade-new" : ""}`}>
                <Link to="/coin/$address" params={{ address: coin.token }} className="live-trade" aria-label={`${swap.buy ? "Buy" : "Sale"} of ${coin.symbol}, ${usd(eth)}`}>
                  <TokenLogo symbol={coin.symbol} image={images[coin.token.toLowerCase()]} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold">{coin.symbol}</span>
                    <span className="num block truncate text-[12px] text-muted">MC {cap !== undefined ? usd(cap) : "—"}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className={`num block text-[15px] font-semibold ${swap.buy ? "text-ok" : "text-down"}`}>
                      {swap.buy ? "+" : "−"}
                      {usd(eth)}
                    </span>
                    <span className="num block text-[12px] text-muted">
                      {ethText(eth)} ETH · {ago(Math.max(0, now - swap.time))}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
