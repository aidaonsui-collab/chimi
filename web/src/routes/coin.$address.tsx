import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { giwaSepolia } from "@/lib/chimi/chain";
import { fmt, short, shortAddr, wethPerToken } from "@/lib/chimi/market";
import { useChimi } from "@/components/chimi/provider";

export const Route = createFileRoute("/coin/$address")({ component: CoinPage });

function chartPath(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const ys: number[] = [];
  let y = 48;
  for (let i = 0; i < 36; i++) {
    h = Math.imul(h, 1664525) + 1013904223;
    y = Math.max(12, Math.min(78, y + ((h >>> 0) % 15) - 7));
    ys.push(y);
  }
  ys[ys.length - 1] = 34;
  const step = 640 / (ys.length - 1);
  const line = ys.map((p, i) => `${i === 0 ? "M" : "L"}${i * step},${p}`).join(" ");
  const area = `${line} L640,90 L0,90 Z`;
  return { line, area };
}

function CoinPage() {
  const { address } = Route.useParams();
  const { coins, note, trade, unwrap } = useChimi();
  const coin = coins.find((c) => c.token.toLowerCase() === address.toLowerCase());
  const [tab, setTab] = useState<"trades" | "pool">("trades");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [tradeNote, setTradeNote] = useState("");
  const [kind, setKind] = useState<"" | "bad" | "good">("");
  const [busy, setBusy] = useState(false);
  const explorer = giwaSepolia.blockExplorers.default.url;
  const chart = useMemo(() => (coin ? chartPath(coin.token) : { line: "", area: "" }), [coin]);

  async function go(next: "buy" | "sell") {
    if (!coin || !amount.trim() || amount.endsWith("%")) {
      setKind("bad");
      setTradeNote(amount.endsWith("%") ? "Enter an amount, not a percent." : "Enter an amount.");
      return;
    }
    try {
      setBusy(true);
      setKind("");
      setTradeNote("Confirm in your wallet.");
      await trade(coin, next, amount);
      setKind("good");
      setTradeNote(next === "buy" ? "Bought." : "Sold for wrapped ETH.");
    } catch (err) {
      setKind("bad");
      setTradeNote(short(err));
    } finally {
      setBusy(false);
    }
  }

  async function doUnwrap() {
    try {
      setBusy(true);
      setKind("");
      setTradeNote("Confirm unwrap in your wallet.");
      await unwrap();
      setKind("good");
      setTradeNote("Unwrapped.");
    } catch (err) {
      setKind("bad");
      setTradeNote(short(err));
    } finally {
      setBusy(false);
    }
  }

  if (!coin) {
    return (
      <main className="mx-auto max-w-6xl px-5 py-16">
        <Link to="/" className="text-sm text-seal">
          Board
        </Link>
        <h1 className="mt-6 font-display text-6xl leading-none">
          {note === "Reading the factory…" ? "Reading the factory…" : "Not on this factory."}
        </h1>
        <p className="mt-3 max-w-md text-muted">{note || shortAddr(address)}</p>
      </main>
    );
  }

  const px = wethPerToken(coin.sqrtPriceX96, coin.tokenIs0);
  const fdv = px * 1_000_000_000n;
  const presets = side === "buy" ? ["0.01", "0.1", "0.5", "1"] : ["25%", "50%", "75%", "100%"];

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <Link to="/" className="text-sm text-muted">
        Back
      </Link>
      <div className="mt-4 flex items-center gap-4">
        <span className="grid size-14 place-items-center rounded-full border-2 border-seal font-display text-sm text-seal">
          {coin.symbol.slice(0, 4)}
        </span>
        <div>
          <h1 className="font-display text-4xl leading-none sm:text-5xl">{coin.name}</h1>
          <p className="mt-1 text-sm text-muted">
            ${coin.symbol}
            {coin.preview ? " · preview" : " · in the pool"}
          </p>
        </div>
      </div>

      <div className="mt-6 grid items-start gap-4 lg:grid-cols-[1fr_340px]">
        <section className="rounded-3xl border border-line bg-chip p-4 sm:p-5">
          <p className="text-xs tracking-[0.16em] text-muted uppercase">Price</p>
          <p className="font-display text-4xl leading-none tabular-nums sm:text-5xl">{fmt(px, 8)}</p>
          <p className="mt-1 text-sm text-muted">ETH per token</p>
          <svg viewBox="0 0 640 90" className="mt-4 h-44 w-full" role="img" aria-label="Preview price chart">
            <path d={chart.area} fill="rgba(224,180,90,0.12)" />
            <path d={chart.line} fill="none" stroke="#e0b45a" strokeWidth="2.5" />
          </svg>
          {coin.preview ? <p className="text-xs text-muted">Preview chart. Not price history.</p> : null}

          <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["FDV", `${fmt(fdv, 2)} ETH`],
              ["Liquidity", `${fmt(coin.liquidity, 3)} ETH`],
              ["Supply", "1B"],
              ["Fee", "1%"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-line bg-bg px-3 py-3">
                <dt className="text-[11px] tracking-[0.14em] text-muted uppercase">{label}</dt>
                <dd className="mt-1 text-sm tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-5 flex gap-2">
            {(["trades", "pool"] as const).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`rounded-full px-4 py-1.5 text-sm capitalize ${tab === id ? "bg-fg text-bg" : "text-muted"}`}
              >
                {id === "trades" ? "Trades" : "Pool"}
              </button>
            ))}
          </div>

          {tab === "trades" ? (
            <div className="mt-3">
              {coin.preview ? (
                <ul>
                  {[
                    ["Buy", "0.42 ETH", "2m"],
                    ["Sell", "0.18 ETH", "14m"],
                    ["Buy", "1.05 ETH", "1h"],
                    ["Buy", "0.07 ETH", "3h"],
                  ].map(([dir, amt, ago]) => (
                    <li key={ago} className="grid grid-cols-3 border-b border-line py-3 text-sm last:border-0">
                      <span className={dir === "Buy" ? "text-ok" : "text-seal"}>{dir}</span>
                      <span className="text-right tabular-nums">{amt}</span>
                      <span className="text-right text-muted">{ago}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-6 text-sm text-muted">No trades on this coin yet.</p>
              )}
              {coin.preview ? <p className="pt-2 text-xs text-muted">Sample rows. Not chain history.</p> : null}
            </div>
          ) : (
            <dl className="mt-2 divide-y divide-line">
              {[
                ["Token", coin.token],
                ["Pool", coin.pool],
                ["Launched by", coin.creator],
              ].map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-3 py-3">
                  <dt className="text-xs tracking-[0.14em] text-muted uppercase">{label}</dt>
                  <dd>
                    <a className="text-sm text-seal" href={`${explorer}/address/${value}`}>
                      {shortAddr(value)}
                    </a>
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        <aside className="rounded-3xl border border-line bg-chip p-5 lg:sticky lg:top-24">
          <div className="grid grid-cols-2 rounded-full border border-line p-1">
            {(["buy", "sell"] as const).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setSide(id)}
                className={`rounded-full py-2 text-sm font-semibold capitalize ${side === id ? (id === "buy" ? "bg-ok text-bg" : "bg-seal text-onseal") : "text-muted"}`}
              >
                {id}
              </button>
            ))}
          </div>
          <label className="mt-5 block text-sm text-muted" htmlFor="amount">
            {side === "buy" ? "You pay, in ETH" : "You sell, in tokens"}
          </label>
          <input
            id="amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.0"
            className="mt-1 w-full rounded-2xl border border-line bg-bg px-3 py-3 text-lg tabular-nums"
          />
          <div className="mt-3 grid grid-cols-4 gap-2">
            {presets.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setAmount(p)}
                className="rounded-full border border-line py-1.5 text-xs text-muted"
              >
                {p}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void go(side)}
            className={`mt-4 w-full rounded-full py-3 text-sm font-semibold disabled:opacity-40 ${side === "buy" ? "bg-ok text-bg" : "bg-seal text-onseal"}`}
          >
            {side === "buy" ? "Buy" : "Sell"}
          </button>
          <p className="mt-3 text-xs text-muted">Pool fee 1%. Sell pays wrapped ETH.</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void doUnwrap()}
            className="mt-2 text-sm text-muted underline decoration-line underline-offset-4"
          >
            Unwrap WETH
          </button>
          {tradeNote ? (
            <p className={`mt-3 text-sm ${kind === "bad" ? "text-seal" : kind === "good" ? "text-ok" : "text-muted"}`}>
              {tradeNote}
            </p>
          ) : null}
          {coin.preview ? (
            <p className="mt-3 text-xs text-gold">Layout only. This coin is not on the factory.</p>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
