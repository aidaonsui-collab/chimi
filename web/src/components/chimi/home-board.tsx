import { Link } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { ago, compactUsd, ethText } from "@/lib/chimi/format";
import { coinStats, type CoinStats } from "@/lib/chimi/live";
import type { Coin } from "@/lib/chimi/market";
import type { Profile } from "@/lib/chimi/points-rules";
import { shortWallet, useProfiles } from "@/lib/chimi/rewards";
import { QuickAmount, QuickBuy } from "@/components/chimi/feed-rows";
import { IconChevronLeft, IconChevronRight, IconPlus } from "@/components/chimi/icons";
import { TokenLogo } from "@/components/chimi/token-logo";
import { Change, Seg } from "@/components/chimi/ui";

/*
 * The board on the home page, under the feed: two boxes side by side. One is the board itself, every pair that is
 * trading, ranked; the other is the pairs that have just launched. Each row is one press from a buy. The whole
 * table, with prices, search and the card view, is at /board.
 *
 * The columns answer to the width of the box itself (.pairs in styles.css), not the screen, so a box shows what it
 * has room for whether it is half a laptop or the whole of a phone.
 */

type Sort = "trending" | "top" | "gainers";

/** Rows on a page of either list. A phone shows the first five until asked for the rest. */
const PAGE = 10;
const SHORT = 5;

const EMPTY: CoinStats = { priceEth: 0, capEth: 0, spark: [] };

type Row = { coin: Coin; stats: CoinStats; image?: string };

export type HomeBoardProps = {
  /** Newest first, the order the factory lists them in. */
  coins: Coin[];
  stats: Record<string, CoinStats>;
  images: Record<string, string | undefined>;
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

export function HomeBoard({ coins, stats, images, ethUsd, launched, known, now, waiting, tradesReady }: HomeBoardProps) {
  const [sort, setSort] = useState<Sort>("trending");
  const rows = useMemo<Row[]>(
    () => coins.map((coin) => ({ coin, stats: stats[coin.token.toLowerCase()] ?? (coin.preview ? coinStats(coin, []) : EMPTY), image: images[coin.token.toLowerCase()] })),
    [coins, stats, images],
  );
  const ranked = useMemo(() => {
    const list = [...rows];
    if (sort === "top") list.sort((a, b) => b.stats.capEth - a.stats.capEth);
    else if (sort === "gainers") list.sort((a, b) => (b.stats.change ?? -Infinity) - (a.stats.change ?? -Infinity) || b.stats.capEth - a.stats.capEth);
    else list.sort((a, b) => (b.stats.volEth ?? 0) - (a.stats.volEth ?? 0) || b.stats.capEth - a.stats.capEth);
    return list;
  }, [rows, sort]);

  const usd = (eth: number | undefined) => (eth === undefined ? "—" : ethUsd ? compactUsd(eth * ethUsd) : `${ethText(eth)} ETH`);

  return (
    <section id="board" aria-labelledby="board-title" className="scroll-mt-20">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pb-3">
        <h2 id="board-title" className="flex min-w-0 items-baseline gap-2.5 text-[20px] font-semibold tracking-[-0.02em]">
          The board
          <span className="hidden truncate text-[13px] font-normal tracking-normal text-muted sm:inline">Every coin against ETH, in its own locked pool</span>
        </h2>
        <div className="flex items-center gap-2">
          <QuickAmount />
          <Link to="/board" className="btn btn-sm btn-secondary">
            Full board
            <IconChevronRight size={14} />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 lg:gap-5">
        <PairList
          kind="top"
          title="Trading pairs"
          count={waiting ? undefined : rows.length}
          rows={ranked}
          waiting={waiting}
          resetOn={sort}
          controls={
            <Seg
              label="Rank pairs by"
              value={sort}
              onChange={setSort}
              options={[
                ["trending", "Trending"],
                ["top", "Top"],
                ["gainers", "Gainers"],
              ]}
            />
          }
          head={
            <>
              <span>#</span>
              <span>Pair</span>
              <span className="pair-chg text-right">24h</span>
              <span className="pair-cap text-right">Market cap</span>
              <span className="pair-vol text-right">24h volume</span>
              <span className="text-right">Buy</span>
            </>
          }
          empty="Pairs show up here as soon as a coin launches."
          render={(row, i) => {
            const pending = !row.coin.preview && !tradesReady && row.stats.volEth === undefined;
            return (
              <>
                <span className="num text-[12.5px] text-faint">{i + 1}</span>
                <PairName row={row} sub={row.coin.name} />
                <span className="pair-chg text-right text-[13.5px]">{pending ? <Dots /> : <Change value={row.stats.change} />}</span>
                <span className="pair-cap text-right">
                  <span className="num block text-[14px] font-medium">{usd(row.stats.capEth)}</span>
                  <span className="pair-cap-chg text-[12px]">{pending ? null : <Change value={row.stats.change} />}</span>
                </span>
                <span className="pair-vol num text-right text-[14px] text-muted">{row.coin.preview ? "—" : pending ? <Dots /> : usd(row.stats.volEth)}</span>
                <QuickBuy coin={row.coin} compact />
              </>
            );
          }}
        />

        <NewPairs rows={rows} launched={launched} known={known} now={now} waiting={waiting} tradesReady={tradesReady} usd={usd} />
      </div>
    </section>
  );
}

/** The pairs by when they launched, newest first: how old, who launched it, and where it stands now. */
function NewPairs({
  rows,
  launched,
  known,
  now,
  waiting,
  tradesReady,
  usd,
}: {
  rows: Row[];
  launched?: Map<string, number>;
  known?: Record<string, Profile>;
  now: number;
  waiting: boolean;
  tradesReady: boolean;
  usd: (eth: number | undefined) => string;
}) {
  const creators = useMemo(() => [...new Set(rows.slice(0, 40).map((r) => r.coin.creator.toLowerCase()))], [rows]);
  const profiles = useProfiles(creators, known);
  const age = (token: string) => {
    const at = launched?.get(token.toLowerCase());
    return at === undefined ? undefined : ago(Math.max(0, now - at));
  };
  return (
    <PairList
      kind="new"
      title="New pairs"
      note="newest first"
      rows={rows}
      waiting={waiting}
      head={
        <>
          <span>Pair</span>
          <span className="pair-age text-right">Age</span>
          <span className="pair-chg text-right">24h</span>
          <span className="pair-cap text-right">Market cap</span>
          <span className="text-right">Buy</span>
        </>
      }
      empty="Nothing has launched yet."
      invite
      render={(row) => {
        const creator = row.coin.creator.toLowerCase();
        const by = profiles[creator]?.name?.replace(/\.up\.id$/, "") ?? shortWallet(creator);
        const old = age(row.coin.token);
        const pending = !row.coin.preview && !tradesReady && row.stats.volEth === undefined;
        return (
          <>
            <PairName
              row={row}
              sub={
                <>
                  <span className="pair-age-inline">{old ? `${old} · ` : null}</span>by {by}
                </>
              }
            />
            <span className="pair-age num text-right text-[13.5px] text-muted">{old ?? "—"}</span>
            <span className="pair-chg text-right text-[13.5px]">{pending ? <Dots /> : <Change value={row.stats.change} />}</span>
            <span className="pair-cap text-right">
              <span className="num block text-[14px] font-medium">{usd(row.stats.capEth)}</span>
              <span className="pair-cap-chg text-[12px]">{pending ? null : <Change value={row.stats.change} />}</span>
            </span>
            <QuickBuy coin={row.coin} compact />
          </>
        );
      }}
    />
  );
}

/** The coin against ETH, as the start of a row. Pressing anywhere on the row but its buy button opens the coin. */
function PairName({ row, sub }: { row: Row; sub: ReactNode }) {
  return (
    <Link to="/coin/$address" params={{ address: row.coin.token }} className="pair-name">
      <TokenLogo symbol={row.coin.symbol} image={row.image} size={32} />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[14.5px] font-semibold">
            {row.coin.symbol}
            <span className="font-normal text-faint">/ETH</span>
          </span>
          {row.coin.preview ? <span className="chip h-[18px] shrink-0 px-1.5 text-[10.5px]">preview</span> : null}
        </span>
        <span className="block truncate text-[12.5px] text-muted">{sub}</span>
      </span>
    </Link>
  );
}

function Dots() {
  return <span className="skeleton ml-auto h-3.5 w-10" />;
}

/** One of the two lists: a heading, the column names, a page of rows, and a way to the next page. */
function PairList({
  kind,
  title,
  note,
  count,
  rows,
  waiting,
  controls,
  head,
  render,
  empty,
  invite = false,
  resetOn,
}: {
  kind: "top" | "new";
  title: string;
  note?: string;
  count?: number;
  rows: Row[];
  waiting: boolean;
  controls?: ReactNode;
  head: ReactNode;
  render: (row: Row, index: number) => ReactNode;
  empty: string;
  /** End a short list with a way to add to it. */
  invite?: boolean;
  /** Going back to the first page when this changes (the order picked, say). */
  resetOn?: string;
}) {
  const [at, setAt] = useState<{ page: number; of?: string }>({ page: 0, of: resetOn });
  const [short, setShort] = useState(true);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const page = at.of === resetOn ? Math.min(at.page, pages - 1) : 0;
  const start = page * PAGE;
  const shown = rows.slice(start, start + PAGE);
  const go = (next: number) => setAt({ page: next, of: resetOn });

  return (
    <section className={`card pairs pairs-${kind} overflow-hidden`} data-short={short ? "" : undefined} aria-label={title}>
      <div className="flex min-h-[3.75rem] flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2.5 sm:px-4">
        <h3 className="flex items-baseline gap-2 text-[15px] font-semibold">
          {title}
          {count !== undefined && count > 0 ? <span className="num text-[12px] font-normal text-faint">{count}</span> : null}
          {note ? <span className="text-[12px] font-normal text-faint">{note}</span> : null}
        </h3>
        {controls}
      </div>
      <div className="pair-head th border-y border-line/70 py-2">{head}</div>

      {waiting ? (
        <ul aria-hidden>
          {Array.from({ length: SHORT }, (_, i) => (
            <li key={i} className="pair-item">
              <div className="flex min-h-[3.25rem] items-center gap-3 px-3 sm:px-4">
                <span className="skeleton size-8 shrink-0 rounded-full" />
                <span className="flex-1 space-y-1.5">
                  <span className="skeleton block h-3.5 w-2/5" />
                  <span className="skeleton block h-3 w-1/4" />
                </span>
                <span className="skeleton h-4 w-14" />
                <span className="skeleton h-7 w-16 rounded-lg" />
              </div>
            </li>
          ))}
        </ul>
      ) : rows.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <p className="text-sm text-muted">{empty}</p>
          <Link to="/launch" className="btn btn-sm btn-primary mt-3">
            <IconPlus size={15} />
            Launch a coin
          </Link>
        </div>
      ) : (
        <>
          <ul className={pages > 1 ? "pair-rows-paged" : undefined}>
            {shown.map((row, i) => (
              <li key={row.coin.token} className="pair-item">
                <div className="pair-row">{render(row, start + i)}</div>
              </li>
            ))}
            {invite && pages === 1 && rows.length < SHORT ? (
              <li className="pair-item">
                <Link to="/launch" className="pair-invite">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full border border-dashed border-edge text-muted">
                    <IconPlus size={15} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[14px] font-semibold text-fg">Your pair here</span>
                    <span className="block truncate text-[12.5px]">Launch a coin in one transaction</span>
                  </span>
                </Link>
              </li>
            ) : null}
          </ul>
          {shown.length > SHORT ? (
            <button type="button" onClick={() => setShort(false)} className="pair-more">
              Show {shown.length - SHORT} more
            </button>
          ) : null}
          {pages > 1 ? (
            <div className="pair-pager flex items-center justify-between gap-3 border-t border-line/70 px-3 py-2 sm:px-4">
              <span className="num text-[12.5px] text-muted">
                {start + 1}–{start + shown.length} of {rows.length}
              </span>
              <span className="flex items-center gap-1.5">
                <button type="button" disabled={page === 0} onClick={() => go(page - 1)} aria-label={`Previous ${PAGE} pairs`} className="btn btn-sm btn-icon btn-secondary disabled:opacity-35">
                  <IconChevronLeft size={15} />
                </button>
                <button type="button" disabled={page >= pages - 1} onClick={() => go(page + 1)} aria-label={`Next ${PAGE} pairs`} className="btn btn-sm btn-icon btn-secondary disabled:opacity-35">
                  <IconChevronRight size={15} />
                </button>
              </span>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
