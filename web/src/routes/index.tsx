import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { fmt, wethPerToken } from "@/lib/chimi/market";
import { useChimi } from "@/components/chimi/provider";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const { coins, note, preview } = useChimi();
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return coins;
    return coins.filter((c) => c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q));
  }, [coins, query]);

  const ranked = useMemo(() => {
    return [...shown].sort((a, b) => {
      const fa = wethPerToken(a.sqrtPriceX96, a.tokenIs0) * 1_000_000_000n;
      const fb = wethPerToken(b.sqrtPriceX96, b.tokenIs0) * 1_000_000_000n;
      if (fb === fa) return 0;
      return fb > fa ? 1 : -1;
    });
  }, [shown]);
  const leading = ranked[0];

  return (
    <main>
      <section id="board" className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <div>
          <p className="text-xs font-semibold tracking-[0.22em] text-gold">
            {preview ? "PREVIEW COINS" : "LIVE FROM THE FACTORY"}
          </p>
          <h2 className="mt-1 font-display text-4xl leading-none">THE BOARD</h2>
        </div>
        <label className="mt-5 flex items-center gap-3 rounded-2xl border border-line bg-chip px-4 py-3">
          <span className="text-xs tracking-[0.16em] text-muted uppercase">Search</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a coin"
            aria-label="Find a coin"
            className="w-full bg-transparent text-sm outline-none"
          />
        </label>
        {preview ? <p className="mt-3 text-sm text-muted">{note} These rows are not on the factory.</p> : null}
        {ranked.length === 0 ? <p className="mt-8 text-muted">No coin matches that.</p> : null}

        {leading ? (
          <div className="mt-5 grid items-start gap-4 lg:grid-cols-[280px_1fr]">
            <Link
              to="/coin/$address"
              params={{ address: leading.token }}
              className="rounded-3xl border border-gold/50 bg-chip p-5"
            >
              <p className="text-[11px] tracking-[0.18em] text-gold uppercase">Leading</p>
              <span className="mt-4 grid size-16 place-items-center rounded-full border-2 border-seal font-display text-sm text-seal">
                {leading.symbol.slice(0, 4)}
              </span>
              <p className="mt-4 font-display text-3xl leading-none">{leading.name}</p>
              <p className="mt-1 text-sm text-muted">${leading.symbol}</p>
              <p className="mt-4 font-display text-3xl leading-none tabular-nums">
                {fmt(wethPerToken(leading.sqrtPriceX96, leading.tokenIs0))}
              </p>
              <p className="text-sm text-muted">
                ETH · {fmt(wethPerToken(leading.sqrtPriceX96, leading.tokenIs0) * 1_000_000_000n, 2)} FDV
              </p>
            </Link>

            <div className="overflow-hidden rounded-3xl border border-line bg-chip">
              <div className="grid grid-cols-[2rem_1fr_auto] gap-3 border-b border-line px-4 py-3 text-[11px] tracking-[0.16em] text-muted uppercase sm:grid-cols-[2rem_1fr_7rem_7rem]">
                <span>#</span>
                <span>Coin</span>
                <span className="hidden text-right sm:block">Price</span>
                <span className="text-right">FDV</span>
              </div>
              <ul>
                {ranked.map((c, i) => {
                  const px = wethPerToken(c.sqrtPriceX96, c.tokenIs0);
                  const fdv = px * 1_000_000_000n;
                  return (
                    <li key={c.token} className="border-b border-line last:border-0">
                      <Link
                        to="/coin/$address"
                        params={{ address: c.token }}
                        className="grid grid-cols-[2rem_1fr_auto] items-center gap-3 px-4 py-3 hover:bg-bg sm:grid-cols-[2rem_1fr_7rem_7rem]"
                      >
                        <span className="text-sm text-muted">{i + 1}</span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{c.name}</span>
                          <span className="text-xs text-muted">
                            ${c.symbol}
                            {c.preview ? " · preview" : ""}
                          </span>
                        </span>
                        <span className="hidden text-right text-sm tabular-nums sm:block">{fmt(px)} ETH</span>
                        <span className="text-right text-sm tabular-nums">{fmt(fdv, 2)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
