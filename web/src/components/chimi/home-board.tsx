import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ago, compactUsd, ethText } from "@/lib/chimi/format";
import { coinStats, type CoinStats } from "@/lib/chimi/live";
import type { Coin } from "@/lib/chimi/market";
import type { Profile } from "@/lib/chimi/points-rules";
import { shortWallet, useProfiles } from "@/lib/chimi/rewards";
import { QuickAmount, QuickBuy } from "@/components/chimi/feed-rows";
import { IconPlus } from "@/components/chimi/icons";
import { TokenLogo } from "@/components/chimi/token-logo";
import { Change, Seg, Sparkline } from "@/components/chimi/ui";

/*
 * The home page's table: every pair on Chimi in one list, the way a trading floor shows its board. The tabs change
 * the order (what is trading, what just launched, the biggest, the day's gainers), and each row is one press from a
 * buy. On a phone a row keeps the pair, its market cap and move, the day's line and the buy button; the other
 * columns come in as the screen widens (.pairs-grid in styles.css).
 */

type Sort = "trending" | "new" | "top" | "gainers";

/** Rows shown before "Show more". */
const PAGE = 25;

const EMPTY: CoinStats = { priceEth: 0, capEth: 0, spark: [] };

type Row = { coin: Coin; stats: CoinStats; image?: string; liqEth?: number; order: number; born?: number };

export type PairsBoardProps = {
  /** Newest first, the order the factory lists them in. */
  coins: Coin[];
  stats: Record<string, CoinStats>;
  images: Record<string, string | undefined>;
  /** ETH in each pool, by lowercase pool address. */
  reserves: Record<string, bigint | undefined>;
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
};

export function PairsBoard({ coins, stats, images, reserves, ethUsd, launched, known, now, waiting, tradesReady }: PairsBoardProps) {
  const [sort, setSort] = useState<Sort>("trending");
  const [shown, setShown] = useState(PAGE);
  const rows = useMemo<Row[]>(
    () =>
      coins.map((coin, order) => {
        const wei = reserves[coin.pool.toLowerCase()];
        return {
          coin,
          order,
          stats: stats[coin.token.toLowerCase()] ?? (coin.preview ? coinStats(coin, []) : EMPTY),
          image: images[coin.token.toLowerCase()],
          liqEth: wei === undefined ? undefined : Number(wei) / 1e18,
          born: launched?.get(coin.token.toLowerCase()),
        };
      }),
    [coins, stats, images, reserves, launched],
  );
  const ranked = useMemo(() => {
    const list = [...rows];
    // The factory lists coins newest first, so a coin whose launch time isn't known keeps that place.
    if (sort === "new") list.sort((a, b) => (a.born !== undefined && b.born !== undefined ? b.born - a.born : a.order - b.order));
    else if (sort === "top") list.sort((a, b) => b.stats.capEth - a.stats.capEth);
    else if (sort === "gainers") list.sort((a, b) => (b.stats.change ?? -Infinity) - (a.stats.change ?? -Infinity) || b.stats.capEth - a.stats.capEth);
    else list.sort((a, b) => (b.stats.volEth ?? 0) - (a.stats.volEth ?? 0) || (b.stats.trades ?? 0) - (a.stats.trades ?? 0) || b.stats.capEth - a.stats.capEth);
    return list;
  }, [rows, sort]);
  const page = ranked.slice(0, shown);
  const creators = useMemo(() => [...new Set(page.map((r) => r.coin.creator.toLowerCase()))], [page]);
  const profiles = useProfiles(creators, known);

  const usd = (eth: number | undefined) => (eth === undefined ? "—" : ethUsd ? compactUsd(eth * ethUsd) : `${ethText(eth)} ETH`);

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
      <div className="no-scrollbar -mx-1 flex items-center justify-between gap-2 overflow-x-auto px-1 pb-3">
        <Seg
          label="Order the board by"
          value={sort}
          onChange={(next) => {
            setSort(next);
            setShown(PAGE);
          }}
          options={[
            ["trending", "Trending"],
            ["new", "New"],
            ["top", "Top"],
            ["gainers", "Gainers"],
          ]}
        />
      </div>

      <div className="card overflow-hidden">
        <div className="pairs-grid th border-b border-line/70 py-3">
          <span className="pg-rank">#</span>
          <span>Pair</span>
          <span className="text-right">Market cap</span>
          <span className="pg-chg text-right">24h</span>
          <span className="pg-vol text-right">Volume</span>
          <span className="pg-liq text-right">Liquidity</span>
          <span className="pg-trades text-right">Trades</span>
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
              const creator = row.coin.creator.toLowerCase();
              const by = profiles[creator]?.name?.replace(/\.up\.id$/, "") ?? shortWallet(creator);
              const fresh = row.born !== undefined && now - row.born < 24 * 60 * 60;
              return (
                <li key={row.coin.token} className="pair-item border-b border-line/60 last:border-0">
                  <div className="pairs-grid min-h-[4.25rem] py-2.5">
                    <span className="pg-rank num text-[13px] text-faint">{i + 1}</span>
                    <Link to="/coin/$address" params={{ address: row.coin.token }} className="pair-name">
                      <TokenLogo symbol={row.coin.symbol} image={row.image} size={40} />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-[15px] font-semibold">{row.coin.name}</span>
                          {row.coin.preview ? <span className="chip h-[18px] shrink-0 px-1.5 text-[10.5px]">preview</span> : null}
                        </span>
                        <span className="num flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted">
                          <span className="shrink-0">${row.coin.symbol}</span>
                          {row.born !== undefined ? <span className={`shrink-0 ${fresh ? "text-ok" : ""}`}>{ago(Math.max(0, now - row.born))}</span> : null}
                          <span className="hidden truncate text-faint xl:inline">by {by}</span>
                        </span>
                      </span>
                    </Link>
                    <span className="text-right">
                      <span className="num block text-[15px] font-semibold">{usd(row.stats.capEth)}</span>
                      <span className="pg-chg-inline text-[12.5px]">{pending ? null : <Change value={row.stats.change} />}</span>
                    </span>
                    <span className="pg-chg text-right text-[14px]">{pending ? <Dots /> : <Change value={row.stats.change} />}</span>
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
    </section>
  );
}

function Dots() {
  return <span className="skeleton ml-auto h-3.5 w-10" />;
}
