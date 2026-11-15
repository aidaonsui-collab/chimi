import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { compactUsd, ethText, tokenUsd } from "@/lib/chimi/format";
import { coinStats, useEthUsd, usePoolEth, useSwaps, type CoinStats } from "@/lib/chimi/live";
import type { Coin } from "@/lib/chimi/market";
import { useTokenImages } from "@/lib/chimi/token-image";
import { IconClock, IconFlame, IconGrid, IconList, IconPlus, IconSearch, IconTrophy } from "@/components/chimi/icons";
import { useChimi } from "@/components/chimi/provider";
import { TokenArt, TokenLogo } from "@/components/chimi/token-logo";
import { Change, Empty, PageHead, Seg, Sparkline } from "@/components/chimi/ui";

/** Every coin on the factory, as a table or as cards. It was the home page until the feed took that place. */
export const Route = createFileRoute("/board")({ component: Board });

type Sort = "trending" | "top" | "new";
type View = "list" | "grid";
type Row = { coin: Coin; stats: CoinStats; image?: string; liqEth?: number; order: number };

const VIEW_KEY = "chimi.board.view";

function Board() {
  const { coins, preview, loading, deployment, note, refresh } = useChimi();
  const ethUsd = useEthUsd();
  const { byPool, ready } = useSwaps(coins);
  const reserves = usePoolEth(coins, deployment?.weth);
  const images = useTokenImages(useMemo(() => coins.map((coin) => coin.token), [coins]));
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("trending");
  const [view, setView] = useState<View>("list");

  useEffect(() => {
    const before = document.title;
    document.title = "The board · Chimi";
    return () => {
      document.title = before;
    };
  }, []);

  useEffect(() => {
    try {
      if (localStorage.getItem(VIEW_KEY) === "grid") setView("grid");
    } catch {
      /* private mode */
    }
  }, []);
  const pickView = (next: View) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* private mode */
    }
  };

  const rows = useMemo<Row[]>(
    () =>
      coins.map((coin, order) => {
        const pool = coin.pool.toLowerCase();
        const wei = reserves[pool];
        return {
          coin,
          order,
          stats: coinStats(coin, coin.preview ? [] : byPool[pool]),
          image: images[coin.token.toLowerCase()],
          liqEth: wei === undefined ? undefined : Number(wei) / 1e18,
        };
      }),
    [coins, byPool, reserves, images],
  );

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? rows.filter((r) => r.coin.name.toLowerCase().includes(q) || r.coin.symbol.toLowerCase().includes(q) || r.coin.token.toLowerCase() === q) : [...rows];
    if (sort === "new") list.sort((a, b) => a.order - b.order);
    else if (sort === "top") list.sort((a, b) => b.stats.capEth - a.stats.capEth);
    else list.sort((a, b) => (b.stats.volEth ?? 0) - (a.stats.volEth ?? 0) || b.stats.capEth - a.stats.capEth);
    return list;
  }, [rows, query, sort]);

  const usd = (eth: number | undefined) => (eth === undefined ? "—" : ethUsd ? compactUsd(eth * ethUsd) : `${ethText(eth)} ETH`);
  const price = (eth: number) => (ethUsd ? tokenUsd(eth * ethUsd) : `${ethText(eth)} ETH`);
  const failed = !loading && coins.length === 0 && !!note;

  return (
    <main className="page pt-2 pb-16">
      <PageHead
        eyebrow={preview ? "Preview coins" : "Live from the factory"}
        title="The board"
        actions={
          <Link to="/launch" className="btn btn-primary">
            <IconPlus size={17} />
            Launch a coin
          </Link>
        }
      >
        Every coin launched on Chimi, each in its own locked pool. Sort by what is trading, what is biggest, or what is newest.
      </PageHead>

      <div className="mt-8 flex w-full flex-wrap items-center gap-2.5">
        <Seg
          label="Sort coins"
          value={sort}
          onChange={setSort}
          options={[
            [
              "trending",
              <span key="t" className="flex items-center gap-1.5">
                <IconFlame size={14} />
                Trending
              </span>,
            ],
            [
              "top",
              <span key="p" className="flex items-center gap-1.5">
                <IconTrophy size={14} />
                Top
              </span>,
            ],
            [
              "new",
              <span key="n" className="flex items-center gap-1.5">
                <IconClock size={14} />
                New
              </span>,
            ],
          ]}
        />
        <label className="field flex min-h-0 flex-1 items-center gap-2.5 bg-chip py-0 sm:w-[240px] sm:flex-none">
          <IconSearch size={16} className="shrink-0 text-faint" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter coins" aria-label="Filter coins" className="h-[38px] min-w-0 flex-1 bg-transparent text-sm outline-none" />
        </label>
        <div className="seg sm:ml-auto" role="group" aria-label="Layout">
          <button type="button" aria-pressed={view === "list"} aria-label="Table" title="Table" onClick={() => pickView("list")} className="!px-2">
            <IconList size={16} />
          </button>
          <button type="button" aria-pressed={view === "grid"} aria-label="Cards" title="Cards" onClick={() => pickView("grid")} className="!px-2">
            <IconGrid size={16} />
          </button>
        </div>
      </div>

      {preview ? (
        <p className="mt-5 flex items-start gap-2.5 rounded-xl border border-gold/25 bg-gold/8 px-4 py-3 text-sm text-fg/90">
          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-gold" />
          Nothing has launched on the factory yet, so these rows are placeholders showing how the board looks. They can’t be traded.
        </p>
      ) : null}

      <div className="mt-5">
        {loading ? (
          <BoardSkeleton view={view} />
        ) : failed ? (
          <div className="card">
            <Empty
              mark="끊김"
              title="Couldn’t reach GIWA"
              action={
                <button type="button" onClick={() => void refresh().catch(() => undefined)} className="btn btn-secondary">
                  Try again
                </button>
              }
            >
              The board reads straight from the chain and the node didn’t answer. {note}
            </Empty>
          </div>
        ) : sorted.length === 0 ? (
          <div className="card">
            <Empty mark="없음" title={`No coin matches “${query.trim()}”`}>
              Try a name, a ticker, or paste a token address.
            </Empty>
          </div>
        ) : view === "list" ? (
          <BoardTable rows={sorted} usd={usd} price={price} ready={ready} />
        ) : (
          <BoardGrid rows={sorted} usd={usd} />
        )}
      </div>
    </main>
  );
}

/* Board -------------------------------------------------------------------------------------- */

const GRID =
  "grid items-center gap-x-4 px-4 sm:px-5 grid-cols-[1.5rem_minmax(0,1fr)_auto] md:grid-cols-[2rem_minmax(0,1.5fr)_repeat(3,minmax(0,1fr))] xl:grid-cols-[2rem_minmax(0,1.6fr)_repeat(5,minmax(0,1fr))_7.5rem]";

function BoardTable({ rows, usd, price, ready }: { rows: Row[]; usd: (eth: number | undefined) => string; price: (eth: number) => string; ready: boolean }) {
  return (
    <div className="card overflow-hidden">
      <div className={`${GRID} th border-b border-line py-3`}>
        <span>#</span>
        <span>Coin</span>
        <span className="text-right md:hidden">Market cap</span>
        <span className="hidden text-right md:block">Price</span>
        <span className="hidden text-right md:block">24h</span>
        <span className="hidden text-right md:block">Market cap</span>
        <span className="hidden text-right xl:block">24h volume</span>
        <span className="hidden text-right xl:block">Liquidity</span>
        <span className="hidden text-right xl:block">Last 24h</span>
      </div>
      {rows.map((row, i) => {
        const waiting = !row.coin.preview && !ready && row.stats.volEth === undefined;
        return (
          <Link key={row.coin.token} to="/coin/$address" params={{ address: row.coin.token }} className={`${GRID} row-hover border-b border-line/70 py-3 last:border-0`}>
            <span className="num text-sm text-faint">{i + 1}</span>
            <span className="flex min-w-0 items-center gap-3">
              <TokenLogo symbol={row.coin.symbol} image={row.image} size={40} />
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="truncate text-[15px] font-semibold">{row.coin.name}</span>
                  {row.coin.preview ? <span className="chip h-5 shrink-0 px-1.5 text-[11px]">preview</span> : null}
                </span>
                <span className="block truncate text-[13px] text-muted">${row.coin.symbol}</span>
              </span>
            </span>
            <span className="text-right md:hidden">
              <span className="num block text-[15px] font-medium">{usd(row.stats.capEth)}</span>
              <Change value={row.stats.change} className="text-xs" />
            </span>
            <span className="num hidden text-right text-[15px] md:block">{price(row.stats.priceEth)}</span>
            <span className="hidden text-right text-[15px] md:block">{waiting ? <Dots /> : <Change value={row.stats.change} />}</span>
            <span className="num hidden text-right text-[15px] font-medium md:block">{usd(row.stats.capEth)}</span>
            <span className="num hidden text-right text-[15px] xl:block">{row.coin.preview ? "—" : waiting ? <Dots /> : usd(row.stats.volEth)}</span>
            <span className="num hidden text-right text-[15px] xl:block">{row.coin.preview ? "—" : usd(row.liqEth)}</span>
            <span className="hidden justify-end xl:flex">{waiting ? <span className="skeleton h-8 w-[104px]" /> : <Sparkline values={row.stats.spark} width={104} height={34} />}</span>
          </Link>
        );
      })}
    </div>
  );
}

function Dots() {
  return <span className="skeleton ml-auto h-4 w-12" />;
}

function BoardGrid({ rows, usd }: { rows: Row[]; usd: (eth: number | undefined) => string }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {rows.map((row) => (
        <Link key={row.coin.token} to="/coin/$address" params={{ address: row.coin.token }} className="card card-lift group overflow-hidden">
          <div className="relative aspect-square overflow-hidden bg-raise [container-type:inline-size]">
            <div className="size-full transition-transform duration-500 ease-out group-hover:scale-[1.04]">
              <TokenArt symbol={row.coin.symbol} image={row.image} />
            </div>
            {row.coin.preview ? <span className="chip absolute top-2.5 left-2.5 h-6 bg-bg/70 backdrop-blur">preview</span> : null}
            <span className="glass absolute right-2.5 bottom-2.5 rounded-lg px-2 py-1 text-xs font-medium">
              <Change value={row.stats.change} />
            </span>
          </div>
          <div className="p-3.5 sm:p-4">
            <p className="truncate text-[15px] font-semibold">{row.coin.name}</p>
            <p className="truncate text-[13px] text-muted">${row.coin.symbol}</p>
            <div className="mt-3 flex items-end justify-between gap-2 border-t border-line pt-3">
              <div className="min-w-0">
                <p className="text-[11px] text-faint">Market cap</p>
                <p className="num truncate text-[15px] font-semibold">{usd(row.stats.capEth)}</p>
              </div>
              <div className="min-w-0 text-right">
                <p className="text-[11px] text-faint">24h volume</p>
                <p className="num truncate text-[15px] font-medium text-muted">{row.coin.preview ? "—" : usd(row.stats.volEth)}</p>
              </div>
            </div>
          </div>
        </Link>
      ))}
      <Link to="/launch" className="group flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-edge p-5 text-center transition-colors hover:border-seal/70 hover:bg-seal/5">
        <span className="grid size-12 place-items-center rounded-2xl bg-raise2 text-fg transition-colors group-hover:bg-seal group-hover:text-onseal">
          <IconPlus size={22} />
        </span>
        <span>
          <span className="block text-[15px] font-semibold">Your coin here</span>
          <span className="mt-0.5 block text-[13px] text-muted">Launch in one transaction</span>
        </span>
      </Link>
    </div>
  );
}

function BoardSkeleton({ view }: { view: View }) {
  if (view === "grid") {
    return (
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="card overflow-hidden">
            <span className="skeleton aspect-square rounded-none" />
            <div className="space-y-2 p-4">
              <span className="skeleton h-4 w-2/3" />
              <span className="skeleton h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="card divide-y divide-line/70">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-3.5">
          <span className="skeleton h-4 w-4" />
          <span className="skeleton size-10 rounded-full" />
          <span className="flex-1 space-y-2">
            <span className="skeleton h-4 w-40 max-w-full" />
            <span className="skeleton h-3 w-16" />
          </span>
          <span className="skeleton hidden h-4 w-20 md:block" />
          <span className="skeleton h-4 w-20" />
        </div>
      ))}
    </div>
  );
}
