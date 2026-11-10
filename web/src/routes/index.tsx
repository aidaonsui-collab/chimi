import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { compactUsd, ethText, tokenUsd } from "@/lib/chimi/format";
import { coinStats, useEthUsd, usePoolEth, useSwaps, type CoinStats } from "@/lib/chimi/live";
import { shortAddr, type Coin } from "@/lib/chimi/market";
import { DAILY_POOL, dayEndMs, today } from "@/lib/chimi/points-rules";
import { fmtPoints } from "@/lib/chimi/rewards";
import { useTokenImages } from "@/lib/chimi/token-image";
import {
  IconArrowDown,
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconFlame,
  IconGrid,
  IconHouse,
  IconList,
  IconLock,
  IconPlus,
  IconPoints,
  IconSearch,
  IconSwap,
  IconTrophy,
} from "@/components/chimi/icons";
import { useChimi } from "@/components/chimi/provider";
import { duration, useNow } from "@/components/chimi/rewards-bits";
import { Tape } from "@/components/chimi/tape";
import { TokenArt, TokenLogo } from "@/components/chimi/token-logo";
import { Change, Empty, Seg, Sparkline } from "@/components/chimi/ui";

export const Route = createFileRoute("/")({ component: Home });

type Sort = "trending" | "top" | "new";
type View = "list" | "grid";
type Row = { coin: Coin; stats: CoinStats; image?: string; liqEth?: number; order: number };

const VIEW_KEY = "chimi.board.view";

function Home() {
  const { coins, preview, loading, deployment, note, refresh } = useChimi();
  const ethUsd = useEthUsd();
  const { byPool, ready } = useSwaps(coins);
  const reserves = usePoolEth(coins, deployment?.weth);
  const images = useTokenImages(useMemo(() => coins.map((coin) => coin.token), [coins]));
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("trending");
  const [view, setView] = useState<View>("list");

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

  const featured = useMemo(() => [...rows].sort((a, b) => (b.stats.volEth ?? 0) - (a.stats.volEth ?? 0) || b.stats.capEth - a.stats.capEth).slice(0, 4), [rows]);

  const totals = useMemo(() => {
    const live = rows.filter((r) => !r.coin.preview);
    return {
      coins: live.length,
      capEth: live.reduce((sum, r) => sum + r.stats.capEth, 0),
      volEth: ready ? live.reduce((sum, r) => sum + (r.stats.volEth ?? 0), 0) : undefined,
      trades: ready ? live.reduce((sum, r) => sum + (r.stats.trades ?? 0), 0) : undefined,
      liqEth: live.length > 0 && live.every((r) => r.liqEth !== undefined) ? live.reduce((sum, r) => sum + (r.liqEth ?? 0), 0) : undefined,
    };
  }, [rows, ready]);

  const usd = (eth: number | undefined) => (eth === undefined ? "—" : ethUsd ? compactUsd(eth * ethUsd) : `${ethText(eth)} ETH`);
  const price = (eth: number) => (ethUsd ? tokenUsd(eth * ethUsd) : `${ethText(eth)} ETH`);
  const failed = !loading && coins.length === 0 && !!note;

  return (
    <main>
      <section className="page pt-1">
        <Hero featured={featured} totals={totals} usd={usd} price={price} preview={preview} loading={loading} />
      </section>

      <section id="board" className="page scroll-mt-20 pt-12">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div>
            <p className="eyebrow">{preview ? "Preview coins" : "Live from the factory"}</p>
            <h2 className="mt-2 text-[30px] leading-none font-semibold tracking-[-0.03em] sm:text-[34px]">The board</h2>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2.5 sm:w-auto">
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
            <div className="seg" role="group" aria-label="Layout">
              <button type="button" aria-pressed={view === "list"} aria-label="Table" title="Table" onClick={() => pickView("list")} className="!px-2">
                <IconList size={16} />
              </button>
              <button type="button" aria-pressed={view === "grid"} aria-label="Cards" title="Cards" onClick={() => pickView("grid")} className="!px-2">
                <IconGrid size={16} />
              </button>
            </div>
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
      </section>

      <section className="page grid gap-5 pt-12 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <Tape listed={rows} byPool={byPool} ready={ready} loading={loading} />
        <div className="grid content-start gap-5">
          <PointsCard />
          <Link to="/houses" className="card card-lift group flex items-center gap-4 p-5">
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-raise2 text-gold">
              <IconHouse size={24} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[17px] font-semibold tracking-[-0.01em]">Trade under one seal</span>
              <span className="mt-0.5 block text-sm text-muted">Found a house or join one. Every point you earn counts for it too.</span>
            </span>
            <IconChevronRight size={18} className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-fg" />
          </Link>
        </div>
      </section>

      <section className="page pt-14 pb-6">
        <p className="eyebrow">How Chimi works</p>
        <h2 className="mt-2 max-w-xl text-[30px] leading-[1.08] font-semibold tracking-[-0.03em] sm:text-[34px]">One transaction from an idea to a market.</h2>
        <div className="mt-7 grid gap-4 md:grid-cols-3">
          <Step n="01" icon={<IconPlus size={20} />} title="Press a coin">
            Name it, give it a picture, and sign once. A billion tokens are minted in the same transaction.
          </Step>
          <Step n="02" icon={<IconLock size={20} />} title="The pool locks">
            The whole supply opens in a Uniswap v3 pool against ETH. The launch liquidity is locked for 100 years.
          </Step>
          <Step n="03" icon={<IconSwap size={20} />} title="Trade from block one">
            There is no bonding curve and nothing to graduate. The price you see is the pool, from the first block.
          </Step>
        </div>
      </section>
    </main>
  );
}

/* Hero --------------------------------------------------------------------------------------- */

type Totals = { coins: number; capEth: number; volEth?: number; trades?: number; liqEth?: number };

function Hero({
  featured,
  totals,
  usd,
  price,
  preview,
  loading,
}: {
  featured: Row[];
  totals: Totals;
  usd: (eth: number | undefined) => string;
  price: (eth: number) => string;
  preview: boolean;
  loading: boolean;
}) {
  const slides = 1 + featured.length;
  const [at, setAt] = useState(0);
  const hold = useRef(false);
  const index = at % slides;

  useEffect(() => {
    if (slides < 2) return;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => {
      if (!hold.current && document.visibilityState === "visible") setAt((n) => (n + 1) % slides);
    }, 7000);
    return () => clearInterval(timer);
  }, [slides]);

  const go = (n: number) => setAt(((n % slides) + slides) % slides);

  return (
    <div
      className="relative isolate overflow-hidden rounded-3xl border border-line bg-[#0d1024]"
      onMouseEnter={() => (hold.current = true)}
      onMouseLeave={() => (hold.current = false)}
      onFocusCapture={() => (hold.current = true)}
      onBlurCapture={() => (hold.current = false)}
      aria-roledescription="carousel"
      aria-label="Featured"
    >
      <picture>
        <source media="(max-width: 640px)" srcSet="/banner-960.webp" />
        <img src="/banner.webp" alt="" fetchPriority="high" className="absolute inset-0 -z-20 size-full object-cover object-[center_38%]" />
      </picture>
      <div className="banner-fog -z-10" />
      <div className="banner-fog banner-fog-b -z-10" />
      <div className="roof-scrim absolute inset-0 -z-10" />

      <div className="relative grid min-h-[440px] sm:min-h-[460px]">
        {/* Slide 0: what Chimi is. */}
        <Slide on={index === 0}>
          <div className="flex h-full flex-col justify-end p-5 sm:p-8 lg:p-10">
            <p className="flex items-center gap-2 text-[13px] font-medium text-fg/90">
              <span className={`live-dot ${preview ? "text-gold" : "text-ok"}`} />
              {preview ? "Preview" : "Live on GIWA Sepolia"}
              <span className="font-serif text-[15px] text-gold">치미</span>
            </p>
            <h1 className="mt-3 max-w-[14ch] text-[44px] leading-[0.98] font-semibold tracking-[-0.04em] text-balance sm:text-[64px]">The pool is the market.</h1>
            <p className="mt-4 max-w-[46ch] text-[15px] leading-relaxed text-fg/80 sm:text-[17px]">
              Launch a coin in one transaction. A billion tokens open in a locked pool, with no bonding curve and nothing to graduate.
            </p>
            <div className="mt-6 flex flex-wrap gap-2.5">
              <Link to="/launch" className="btn btn-lg btn-primary">
                <IconPlus size={18} />
                Launch a coin
              </Link>
              <a href="#board" className="btn btn-lg btn-glass">
                Explore the board
                <IconArrowDown size={16} />
              </a>
            </div>
            <StatBar
              items={[
                ["Coins", loading ? null : totals.coins.toLocaleString("en-US")],
                ["24h volume", loading ? null : usd(totals.volEth)],
                ["Market cap", loading ? null : usd(totals.coins ? totals.capEth : undefined)],
                ["Liquidity", loading ? null : usd(totals.liqEth)],
              ]}
            />
          </div>
        </Slide>

        {featured.map((row, i) => (
          <Slide key={row.coin.token} on={index === i + 1}>
            <div className="flex h-full items-end justify-between gap-8 p-5 sm:p-8 lg:p-10">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-[13px] font-medium text-fg/90">
                  <IconFlame size={15} className="text-gold" />
                  {i === 0 ? "Leading the board" : `#${i + 1} on the board`}
                  {row.coin.preview ? <span className="chip h-5 px-1.5 text-[11px]">preview</span> : null}
                </p>
                <div className="mt-4 flex items-center gap-4">
                  <TokenLogo symbol={row.coin.symbol} image={row.image} size={64} shape="rounded" className="shadow-[0_12px_30px_-8px_rgba(0,0,0,.7)]" />
                  <div className="min-w-0">
                    <h2 className="truncate text-[36px] leading-[1.05] font-semibold tracking-[-0.035em] sm:text-[48px]">{row.coin.name}</h2>
                    <p className="mt-1 flex items-center gap-2 text-[15px] text-fg/75">
                      <span className="font-medium text-fg">${row.coin.symbol}</span>
                      <span className="text-fg/40">·</span>
                      <span className="num">by {shortAddr(row.coin.creator)}</span>
                    </p>
                  </div>
                </div>
                <div className="mt-6 flex flex-wrap gap-2.5">
                  <Link to="/coin/$address" params={{ address: row.coin.token }} className="btn btn-lg btn-light">
                    Trade {row.coin.symbol}
                    <IconChevronRight size={16} />
                  </Link>
                </div>
                <StatBar
                  items={[
                    ["Market cap", usd(row.stats.capEth)],
                    ["Price", price(row.stats.priceEth)],
                    ["24h", <Change key="c" value={row.stats.change} />],
                    ["24h volume", row.coin.preview ? "—" : usd(row.stats.volEth)],
                  ]}
                />
              </div>
              <Link
                to="/coin/$address"
                params={{ address: row.coin.token }}
                tabIndex={-1}
                aria-hidden
                className="mb-2 hidden aspect-square w-[240px] shrink-0 rotate-3 overflow-hidden rounded-3xl border border-white/15 shadow-[0_30px_70px_-20px_rgba(0,0,0,.85)] transition-transform duration-300 [container-type:inline-size] hover:rotate-1 lg:block xl:w-[280px]"
              >
                <TokenArt symbol={row.coin.symbol} image={row.image} />
              </Link>
            </div>
          </Slide>
        ))}
      </div>

      {slides > 1 ? (
        <div className="absolute top-5 right-5 z-10 flex items-center gap-2 sm:top-7 sm:right-8">
          <div className="glass flex items-center gap-1.5 rounded-full px-2.5 py-2">
            {Array.from({ length: slides }, (_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Slide ${i + 1} of ${slides}`}
                aria-current={i === index}
                onClick={() => go(i)}
                className={`h-1.5 rounded-full transition-all duration-300 ${i === index ? "w-6 bg-fg" : "w-1.5 bg-fg/35 hover:bg-fg/60"}`}
              />
            ))}
          </div>
          <button type="button" aria-label="Previous" onClick={() => go(index - 1)} className="glass hidden size-9 place-items-center rounded-full text-fg hover:bg-white/10 sm:grid">
            <IconChevronLeft size={16} />
          </button>
          <button type="button" aria-label="Next" onClick={() => go(index + 1)} className="glass hidden size-9 place-items-center rounded-full text-fg hover:bg-white/10 sm:grid">
            <IconChevronRight size={16} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Slide({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <div
      aria-hidden={!on}
      inert={!on}
      className={`col-start-1 row-start-1 transition-[opacity,transform] duration-500 ease-out ${on ? "opacity-100" : "pointer-events-none translate-y-2 opacity-0"}`}
    >
      {children}
    </div>
  );
}

function StatBar({ items }: { items: [string, ReactNode | null][] }) {
  return (
    <dl className="glass mt-7 grid max-w-[640px] grid-cols-2 gap-y-3 rounded-2xl px-1 py-3.5 sm:grid-cols-4">
      {items.map(([label, value], i) => (
        <div key={label} className={`min-w-0 px-4 ${i % 2 ? "border-l border-white/10" : ""} ${i ? "sm:border-l sm:border-white/10" : ""}`}>
          <dt className="text-xs text-fg/60">{label}</dt>
          <dd className="num mt-0.5 truncate text-[19px] font-semibold tracking-[-0.02em]">{value === null ? <span className="skeleton mt-1 h-5 w-16 opacity-60" /> : value}</dd>
        </div>
      ))}
    </dl>
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

/* Below the board ---------------------------------------------------------------------------- */

function PointsCard() {
  const now = useNow();
  const left = now === null ? null : dayEndMs(today(now)) - now;
  return (
    <Link to="/points" className="card card-lift group relative overflow-hidden p-5">
      <div className="pointer-events-none absolute -top-24 -right-16 size-64 rounded-full bg-[radial-gradient(closest-side,rgba(212,67,43,.22),transparent)]" />
      <div className="relative">
        <p className="eyebrow flex items-center gap-2">
          <IconPoints size={14} />
          Season 1
        </p>
        <p className="mt-3 text-[26px] leading-[1.1] font-semibold tracking-[-0.03em]">{fmtPoints(DAILY_POOL)} points, every day</p>
        <p className="mt-2 text-sm text-muted">Shared by everyone with a Dojang who trades Chimi coins. Creators earn on their coin’s volume too.</p>
        <div className="mt-5 flex items-end justify-between gap-3 border-t border-line pt-4">
          <div>
            <p className="text-xs text-faint">Today’s pool is shared out in</p>
            <p className="num mt-0.5 text-xl font-semibold tracking-[-0.02em]">{left === null ? "—" : left > 0 ? duration(left) : "now…"}</p>
          </div>
          <span className="flex items-center gap-1 text-sm font-medium text-fg">
            See the board
            <IconChevronRight size={15} className="transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </div>
    </Link>
  );
}

function Step({ n, icon, title, children }: { n: string; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="card relative overflow-hidden p-6">
      <span className="num absolute top-5 right-6 text-[13px] font-medium text-faint">{n}</span>
      <span className="grid size-11 place-items-center rounded-xl bg-raise2 text-gold">{icon}</span>
      <p className="mt-5 text-[19px] font-semibold tracking-[-0.02em]">{title}</p>
      <p className="mt-2 text-sm leading-relaxed text-muted">{children}</p>
    </div>
  );
}
