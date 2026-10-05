import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { fmt, wethPerToken, type Coin } from "@/lib/chimi/market";
import { readTokenMeta } from "@/lib/chimi/meta";
import { useChimi } from "@/components/chimi/provider";

export const Route = createFileRoute("/")({ component: Home });

type Sort = "top" | "new" | "az";

function priceOf(c: Coin) {
  return wethPerToken(c.sqrtPriceX96, c.tokenIs0);
}

function fdvOf(c: Coin) {
  return priceOf(c) * 1_000_000_000n;
}

function Chevron() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-[#7d6f5a]" aria-hidden>
      <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Mark({ symbol, image, large }: { symbol: string; image?: string; large?: boolean }) {
  const frame = large
    ? "size-20 border-2 shadow-[0_0_0_6px_rgba(210,74,46,.08),0_12px_30px_rgba(210,74,46,.25)]"
    : "size-11 border-[1.5px]";
  if (image) {
    return <img src={image} alt="" className={`shrink-0 rounded-full border-seal object-cover ${frame}`} />;
  }
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full border-seal bg-[radial-gradient(circle_at_35%_30%,rgba(210,74,46,.18),rgba(23,18,14,.6))] font-display text-seal ${frame} ${large ? "text-[15px]" : "text-[10px]"}`}
    >
      {symbol.slice(0, 4)}
    </span>
  );
}

function Home() {
  const { coins, preview } = useChimi();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("top");
  const [images, setImages] = useState<Record<string, string>>({});
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const coin of coins) {
      const image = readTokenMeta(coin.token)?.image;
      if (image) next[coin.token.toLowerCase()] = image;
    }
    setImages(next);
  }, [coins]);
  const order = useMemo(() => new Map(coins.map((c, i) => [c.token, i])), [coins]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return coins;
    return coins.filter((c) => c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q));
  }, [coins, query]);

  const byTop = useMemo(() => [...filtered].sort((a, b) => (fdvOf(b) > fdvOf(a) ? 1 : fdvOf(b) < fdvOf(a) ? -1 : 0)), [filtered]);
  const rank = useMemo(() => new Map(byTop.map((c, i) => [c.token, i + 1])), [byTop]);
  const leading = byTop[0];

  const rows = useMemo(() => {
    const list = [...filtered];
    if (sort === "top") list.sort((a, b) => (fdvOf(b) > fdvOf(a) ? 1 : -1));
    else if (sort === "new") list.sort((a, b) => (order.get(b.token) ?? 0) - (order.get(a.token) ?? 0));
    else list.sort((a, b) => a.name.localeCompare(b.name));
    return sort === "top" && leading ? list.filter((c) => c.token !== leading.token) : list;
  }, [filtered, sort, order, leading]);

  return (
    <main>
      <section className="mx-auto max-w-[1180px] px-4 pt-7 pb-20 sm:px-6">
        <div className="relative mb-8 h-[168px] overflow-hidden rounded-[28px] border border-line/80 shadow-[inset_0_1px_0_rgba(255,255,255,.06)] sm:h-[200px]">
          <img src="/banner.png" alt="" className="absolute inset-0 size-full object-cover object-[center_46%]" />
          <div className="banner-clouds" />
          <div className="banner-fog" />
          <div className="banner-fog banner-fog-b" />
          <div className="absolute inset-0 z-[1] flex flex-col items-center justify-center px-[12%] text-center">
            <h1 className="font-serif text-5xl leading-[0.9] text-fg drop-shadow-[0_12px_40px_rgba(10,12,40,.7)] sm:text-6xl">
              Chimi
            </h1>
            <p className="mt-1 font-serif text-xl leading-none text-gold drop-shadow-[0_4px_18px_rgba(10,12,40,.8)] sm:text-2xl">
              치미
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="text-[13px] font-semibold tracking-[0.14em] text-gold">
              {preview ? "PREVIEW COINS" : "LIVE FROM THE FACTORY"}
            </p>
            <h2 className="mt-1.5 text-[44px] leading-none font-semibold tracking-[-0.035em]">The Board</h2>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex w-full items-center gap-2.5 rounded-xl border border-line bg-chip px-3.5 py-2.5 shadow-[inset_0_1px_2px_rgba(0,0,0,.3)] sm:w-[280px]">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0 text-muted" aria-hidden>
                <circle cx="7" cy="7" r="4.75" stroke="currentColor" strokeWidth="1.5" />
                <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a coin"
                aria-label="Find a coin"
                className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
              />
            </label>
            <div className="flex rounded-[10px] border border-line bg-chip p-[3px]">
              {(
                [
                  ["top", "Top"],
                  ["new", "New"],
                  ["az", "A–Z"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSort(key)}
                  className={`rounded-[7px] px-3.5 py-1.5 text-[13px] font-medium ${sort === key ? "bg-[#3a2d22] text-fg shadow-[0_1px_3px_rgba(0,0,0,.35),inset_0_1px_0_rgba(255,255,255,.06)]" : "text-muted"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {preview ? (
          <p className="mt-4 text-sm text-muted">Factory isn’t showing live coins. These rows are layout previews, not on the factory.</p>
        ) : null}
        {filtered.length === 0 ? (
          <div className="mt-8 rounded-3xl border border-dashed border-line px-6 py-14 text-center text-muted">
            No coin matches “{query}”.
          </div>
        ) : null}

        {leading ? (
          <div className="mt-7 grid w-full grid-cols-1 items-start gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
            <Link
              to="/coin/$address"
              params={{ address: leading.token }}
              className="relative block w-full overflow-hidden rounded-[28px] border border-gold/35 bg-gradient-to-br from-[#2a1f17] to-[#1d1611] p-7 text-fg shadow-[inset_0_1px_0_rgba(255,255,255,.06),0_30px_60px_-30px_rgba(0,0,0,.8)]"
            >
              <div className="pointer-events-none absolute -top-20 -right-20 size-60 rounded-full bg-[radial-gradient(closest-side,rgba(210,74,46,.28),transparent)]" />
              <div className="relative flex items-center justify-between">
                <span className="inline-flex rounded-full bg-gold/12 px-2.5 py-1 text-xs font-semibold tracking-[0.08em] text-gold">
                  LEADING
                </span>
                <span className="text-[13px] text-muted tabular-nums">#01</span>
              </div>
              <div className="relative mt-7">
                <Mark symbol={leading.symbol} image={images[leading.token.toLowerCase()]} large />
              </div>
              <p className="relative mt-5 text-[32px] leading-[1.05] font-semibold tracking-[-0.03em]">{leading.name}</p>
              <p className="relative mt-1 text-[15px] text-muted">
                ${leading.symbol}
                {leading.preview ? " · preview" : ""}
              </p>
              <div className="relative mt-7 grid grid-cols-2 gap-4 border-t border-line/90 pt-5">
                <div>
                  <div className="text-xs text-muted">Price</div>
                  <div className="mt-0.5 text-[22px] font-semibold tracking-[-0.02em] tabular-nums">{fmt(priceOf(leading), 6)}</div>
                  <div className="text-xs text-muted">ETH</div>
                </div>
                <div>
                  <div className="text-xs text-muted">FDV</div>
                  <div className="mt-0.5 text-[22px] font-semibold tracking-[-0.02em] tabular-nums">{fmt(fdvOf(leading), 2)}</div>
                  <div className="text-xs text-muted">ETH</div>
                </div>
              </div>
              <div className="relative mt-6 flex items-center justify-between rounded-[14px] bg-fg/6 px-4 py-3 text-sm font-medium">
                <span>View coin</span>
                <Chevron />
              </div>
            </Link>

            <div className="min-w-0 overflow-hidden rounded-3xl border border-line bg-chip/85 shadow-[inset_0_1px_0_rgba(255,255,255,.04)]">
              <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_1rem] gap-3 border-b border-line px-5 py-3.5 text-xs font-medium tracking-[0.06em] text-muted sm:grid-cols-[2.5rem_minmax(0,1fr)_8rem_7rem_1rem]">
                <span>#</span>
                <span>Coin</span>
                <span className="hidden text-right sm:block">Price, ETH</span>
                <span className="hidden text-right sm:block">FDV, ETH</span>
                <span />
              </div>
              {rows.map((c) => (
                <Link
                  key={c.token}
                  to="/coin/$address"
                  params={{ address: c.token }}
                  className="grid grid-cols-[2.5rem_minmax(0,1fr)_1rem] items-center gap-3 border-b border-line/55 px-5 py-3.5 text-fg last:border-0 hover:bg-fg/4 sm:grid-cols-[2.5rem_minmax(0,1fr)_8rem_7rem_1rem]"
                >
                  <span className="text-sm text-muted tabular-nums">{String(rank.get(c.token) ?? 0).padStart(2, "0")}</span>
                  <span className="flex min-w-0 items-center gap-3.5">
                    <Mark symbol={c.symbol} image={images[c.token.toLowerCase()]} />
                    <span className="min-w-0">
                      <span className="block truncate text-base font-medium">{c.name}</span>
                      <span className="block truncate text-[13px] text-muted">
                        ${c.symbol}
                        {c.preview ? " · preview" : ""}
                      </span>
                    </span>
                  </span>
                  <span className="hidden text-right text-[15px] tabular-nums sm:block">{fmt(priceOf(c), 6)}</span>
                  <span className="hidden text-right text-[15px] font-medium tabular-nums sm:block">{fmt(fdvOf(c), 2)}</span>
                  <Chevron />
                </Link>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
