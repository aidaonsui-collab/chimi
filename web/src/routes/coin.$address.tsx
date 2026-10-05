import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { formatEther, parseEther, type Address } from "viem";
import { erc20Abi, giwaSepolia } from "@/lib/chimi/chain";
import { publicClient } from "@/lib/chimi/client";
import {
  estimatedOut,
  fmt,
  loadCoin,
  loadSwaps,
  short,
  shortAddr,
  wethPerToken,
  type Coin,
  type PoolSwap,
} from "@/lib/chimi/market";
import { readTokenMeta, type TokenMeta } from "@/lib/chimi/meta";
import { useChimi } from "@/components/chimi/provider";

export const Route = createFileRoute("/coin/$address")({ component: CoinPage });

const SLIPPAGE = [100, 200, 500];

function chartPath(values: number[]) {
  const series = values.length === 1 ? [values[0], values[0]] : values;
  if (series.length === 0) return { line: "", area: "" };
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || Math.abs(max) * 0.04 || 1;
  const lo = min - span * 0.2;
  const hi = max + span * 0.2;
  const width = 640;
  const height = 280;
  const step = width / (series.length - 1);
  const pts = series.map((value, i) => {
    const x = i * step;
    const y = height - ((value - lo) / (hi - lo)) * (height - 28) - 14;
    return [x, y] as const;
  });
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  return { line, area: `${line} L${width},${height} L0,${height} Z` };
}

function tinyEth(wei: bigint) {
  const s = formatEther(wei);
  const hit = s.search(/[1-9]/);
  if (hit < 0) return "0";
  return s.slice(0, Math.min(s.length, hit + 4));
}

function money(n: number) {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `$${Math.round(n).toLocaleString("en-US")}`;
  if (n >= 1) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return `$${n.toFixed(4)}`;
}

function CoinPage() {
  const { address } = Route.useParams();
  const { coins, deployment, account, connect, trade, unwrap } = useChimi();
  const listed = coins.find((c) => !c.preview && c.token.toLowerCase() === address.toLowerCase());
  const [coin, setCoin] = useState<Coin | null>(listed ?? null);
  const [phase, setPhase] = useState<"loading" | "ready" | "missing">(listed ? "ready" : "loading");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(200);
  const [adjust, setAdjust] = useState(false);
  const [tradeNote, setTradeNote] = useState("");
  const [kind, setKind] = useState<"" | "bad" | "good">("");
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState<TokenMeta | null>(null);
  const [ethUsd, setEthUsd] = useState<number>();
  const [payBal, setPayBal] = useState<bigint>();
  const [poolEth, setPoolEth] = useState<bigint>();
  const [swaps, setSwaps] = useState<PoolSwap[]>([]);
  const [panel, setPanel] = useState<"trades" | "pool">("trades");

  useEffect(() => {
    setMeta(readTokenMeta(address));
  }, [address]);

  useEffect(() => {
    if (listed) {
      setCoin(listed);
      setPhase("ready");
      return;
    }
    if (!deployment) return;
    let cancel = false;
    setPhase("loading");
    void loadCoin(deployment, address as Address)
      .then((found) => {
        if (cancel) return;
        setCoin(found);
        setPhase(found ? "ready" : "missing");
      })
      .catch(() => {
        if (!cancel) setPhase("missing");
      });
    return () => {
      cancel = true;
    };
  }, [address, deployment, listed]);

  useEffect(() => {
    let cancel = false;
    void fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot")
      .then((r) => r.json())
      .then((body: { data?: { amount?: string } }) => {
        const n = Number(body.data?.amount);
        if (!cancel && Number.isFinite(n) && n > 0) setEthUsd(n);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (!coin || !deployment || !account) {
      setPayBal(undefined);
      return;
    }
    let cancel = false;
    const read =
      side === "buy"
        ? publicClient.getBalance({ address: account })
        : publicClient.readContract({
            address: coin.token,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [account],
          });
    void read.then((wei) => {
      if (!cancel) setPayBal(wei);
    });
    return () => {
      cancel = true;
    };
  }, [account, coin, deployment, side]);

  useEffect(() => {
    if (!coin || !deployment) return;
    let cancel = false;
    void publicClient
      .readContract({
        address: deployment.weth,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [coin.pool],
      })
      .then((wei) => {
        if (!cancel) setPoolEth(wei);
      })
      .catch(() => undefined);
    void loadSwaps(coin.pool, coin.tokenIs0)
      .then((rows) => {
        if (!cancel) setSwaps(rows);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [coin, deployment]);

  const explorer = giwaSepolia.blockExplorers.default.url;
  const price = coin ? wethPerToken(coin.sqrtPriceX96, coin.tokenIs0) : 0n;
  const fdvEth = Number(price * 1_000_000_000n) / 1e18;
  const fdvUsd = ethUsd ? fdvEth * ethUsd : undefined;
  const liqUsd = ethUsd && poolEth !== undefined ? (Number(poolEth) / 1e18) * ethUsd : undefined;

  let parsed = 0n;
  let badAmount = false;
  try {
    parsed = amount.trim() ? parseEther(amount.trim()) : 0n;
  } catch {
    badAmount = true;
  }
  const quote = coin && !badAmount ? estimatedOut(parsed, price, side === "buy") : 0n;
  const minOut = (quote * BigInt(10_000 - slippageBps)) / 10_000n;
  const chart = useMemo(() => {
    const points = swaps.map((swap) => {
      const eth = Number(wethPerToken(swap.sqrtPriceX96, coin?.tokenIs0 ?? true)) / 1e18 * 1_000_000_000;
      return ethUsd ? eth * ethUsd : eth;
    });
    if (points.length === 0) points.push(fdvUsd ?? fdvEth);
    else points.push(fdvUsd ?? fdvEth);
    return chartPath(points);
  }, [swaps, coin?.tokenIs0, ethUsd, fdvUsd, fdvEth]);

  async function go() {
    if (!coin) return;
    if (!amount.trim() || badAmount || parsed === 0n) {
      setKind("bad");
      setTradeNote("Enter an amount.");
      return;
    }
    if (!account) {
      try {
        await connect();
      } catch (err) {
        setKind("bad");
        setTradeNote(short(err));
      }
      return;
    }
    try {
      setBusy(true);
      setKind("");
      setTradeNote("Confirm in your wallet.");
      await trade(coin, side, amount.trim(), minOut);
      setKind("good");
      setTradeNote(side === "buy" ? "Bought." : "Sold for wrapped ETH.");
      setAmount("");
      const fresh = deployment ? await loadCoin(deployment, coin.token) : null;
      if (fresh) setCoin(fresh);
      setSwaps(await loadSwaps(coin.pool, coin.tokenIs0));
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
      <main className="mx-auto max-w-[1180px] px-5 py-16">
        <Link to="/" className="text-sm text-seal">Board</Link>
        <h1 className="mt-6 font-display text-6xl leading-none">
          {phase === "loading" ? "Reading the factory…" : "Not on this factory."}
        </h1>
        <p className="mt-3 max-w-md text-muted">{phase === "loading" ? "Checking this coin." : shortAddr(address)}</p>
      </main>
    );
  }

  const paySymbol = side === "buy" ? "ETH" : coin.symbol;
  const recvSymbol = side === "buy" ? coin.symbol : "ETH";

  return (
    <main className="mx-auto max-w-[1180px] px-4 py-6 sm:px-6">
      <Link to="/" className="inline-flex items-center rounded-full border border-line bg-chip px-3 py-1.5 text-sm text-muted">
        ← Board
      </Link>

      <section className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-line bg-chip/80 px-5 py-4">
        <div>
          <p className="text-sm font-medium">About</p>
          <p className="mt-1 max-w-xl text-sm text-muted">
            {meta?.description || "The full supply sits in a locked pool. No bonding curve."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a className="rounded-full border border-line px-3 py-1.5 text-sm" href={`${explorer}/address/${coin.token}`}>Contract</a>
          <a className="rounded-full border border-line px-3 py-1.5 text-sm" href={`${explorer}/address/${coin.pool}`}>Pool</a>
          {meta?.twitter ? <a className="rounded-full border border-line px-3 py-1.5 text-sm" href={`https://x.com/${meta.twitter}`}>X</a> : null}
          {meta?.website ? <a className="rounded-full border border-line px-3 py-1.5 text-sm" href={meta.website}>Site</a> : null}
        </div>
      </section>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <section className="rounded-3xl border border-line bg-chip p-4">
          <div className="flex items-center gap-3 px-1 pb-4">
            {meta?.image ? (
              <img src={meta.image} alt="" className="size-12 rounded-2xl object-cover" />
            ) : (
              <span className="grid size-12 place-items-center rounded-2xl border border-seal font-display text-[10px] text-seal">{coin.symbol.slice(0, 4)}</span>
            )}
            <div>
              <p className="text-lg font-semibold tracking-[-0.02em]">{coin.name}</p>
              <p className="text-xs tracking-[0.14em] text-muted">{coin.symbol}</p>
            </div>
          </div>

          <div className="relative flex flex-col gap-1.5">
            <TradeField
              label={side === "buy" ? "Buy with" : "Sell"}
              symbol={paySymbol}
              value={amount}
              onChange={setAmount}
              balance={payBal}
            />
            <button
              type="button"
              aria-label="Flip direction"
              onClick={() => {
                setSide((v) => (v === "buy" ? "sell" : "buy"));
                setAmount("");
              }}
              className="absolute top-1/2 left-1/2 z-10 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-line bg-bg"
            >
              ↕
            </button>
            <TradeField
              label={side === "buy" ? "Buy" : "Receive"}
              symbol={recvSymbol}
              value={quote === 0n ? "0" : fmt(quote)}
              readOnly
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {[25, 50, 75, 100].map((pct) => (
              <button
                key={pct}
                type="button"
                disabled={payBal === undefined}
                onClick={() => payBal !== undefined && setAmount(formatEther((payBal * BigInt(pct)) / 100n))}
                className="flex-1 rounded-full border border-line py-1.5 text-xs text-muted"
              >
                {pct}%
              </button>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between px-1 text-sm">
            <span className="text-muted">Slippage</span>
            <button type="button" onClick={() => setAdjust((v) => !v)} className="rounded-full border border-line px-3 py-1 text-xs">
              {slippageBps / 100}% · Adjust
            </button>
          </div>
          {adjust ? (
            <div className="mt-2 flex gap-2">
              {SLIPPAGE.map((bps) => (
                <button
                  key={bps}
                  type="button"
                  onClick={() => setSlippageBps(bps)}
                  className={`rounded-full px-3 py-1 text-xs ${slippageBps === bps ? "bg-fg text-bg" : "border border-line text-muted"}`}
                >
                  {bps / 100}%
                </button>
              ))}
            </div>
          ) : null}

          <button
            type="button"
            disabled={busy}
            onClick={() => void go()}
            className="mt-4 w-full rounded-2xl bg-seal py-3.5 text-base font-semibold text-onseal disabled:opacity-40"
          >
            {busy ? "Confirming…" : account ? (side === "buy" ? "Buy" : "Sell") : "Connect wallet"}
          </button>
          <button type="button" onClick={() => void doUnwrap()} className="mt-2 w-full text-center text-xs text-muted">
            Unwrap WETH
          </button>
          {tradeNote ? (
            <p className={`mt-2 text-center text-sm ${kind === "bad" ? "text-seal" : kind === "good" ? "text-ok" : "text-muted"}`}>{tradeNote}</p>
          ) : null}
        </section>

        <section className="rounded-3xl border border-line bg-chip p-5">
          <div className="grid grid-cols-2 gap-4 border-b border-line pb-4 sm:grid-cols-4">
            <Stat label="Market cap" value={fdvUsd ? money(fdvUsd) : `${fmt(price * 1_000_000_000n, 4)} ETH`} />
            <Stat label="Liquidity" value={liqUsd ? money(liqUsd) : poolEth !== undefined ? `${fmt(poolEth, 4)} ETH` : "—"} />
            <Stat label="Price" value={`${tinyEth(price)} ETH`} />
            <Stat label="Supply" value="1B" />
          </div>
          <p className="mt-4 text-4xl font-semibold tracking-[-0.04em]">{fdvUsd ? money(fdvUsd) : `${fmt(price * 1_000_000_000n, 4)} ETH`}</p>
          <p className="mt-1 text-sm text-muted">{tinyEth(price)} ETH per token</p>
          <svg viewBox="0 0 640 280" className="mt-4 h-[280px] w-full">
            <defs>
              <linearGradient id="chimi-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#e0b45a" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#e0b45a" stopOpacity="0" />
              </linearGradient>
            </defs>
            {chart.area ? <path d={chart.area} fill="url(#chimi-fill)" /> : null}
            {chart.line ? <path d={chart.line} fill="none" stroke="#e0b45a" strokeWidth="2" /> : null}
          </svg>
          <p className="text-xs text-muted">{swaps.length === 0 ? "No trades in the recent window. The line is the opening price." : "Market cap from recent pool trades."}</p>
        </section>
      </div>

      <section className="mt-4 rounded-3xl border border-line bg-chip p-4">
        <div className="flex gap-2">
          {(["trades", "pool"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setPanel(key)}
              className={`rounded-full px-3 py-1.5 text-sm ${panel === key ? "bg-fg/10 text-fg" : "text-muted"}`}
            >
              {key === "trades" ? "Recent trades" : "Pool"}
            </button>
          ))}
          <span className="ml-auto text-xs text-muted">{panel === "trades" ? swaps.length : ""}</span>
        </div>
        {panel === "trades" ? (
          <div className="mt-3 divide-y divide-line/60">
            {swaps.length === 0 ? <p className="py-6 text-sm text-muted">No swaps in the last few thousand blocks.</p> : null}
            {[...swaps].reverse().map((swap) => (
              <a
                key={`${swap.tx}-${swap.block}`}
                href={`${explorer}/tx/${swap.tx}`}
                className="flex items-center justify-between gap-3 py-3 text-sm"
              >
                <span>
                  <span className={swap.buy ? "text-ok" : "text-seal"}>{swap.buy ? "Buy" : "Sell"}</span>
                  <span className="ml-2">{fmt(swap.tokenAmount, 2)} {coin.symbol}</span>
                  <span className="mt-0.5 block text-xs text-muted">{shortAddr(swap.tx)}</span>
                </span>
                <span className="text-right tabular-nums">
                  {fmt(swap.ethAmount, 6)} ETH
                  {ethUsd ? <span className="mt-0.5 block text-xs text-muted">{money((Number(swap.ethAmount) / 1e18) * ethUsd)}</span> : null}
                </span>
              </a>
            ))}
          </div>
        ) : (
          <dl className="mt-3 divide-y divide-line/60 text-sm">
            {[
              ["Token", coin.token],
              ["Pool", coin.pool],
              ["Creator", coin.creator],
              ["Wrapped ETH in pool", poolEth !== undefined ? `${fmt(poolEth, 6)} ETH` : "—"],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 py-3">
                <dt className="text-muted">{label}</dt>
                <dd className="max-w-[60%] truncate text-right">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-sm font-medium tabular-nums">{value}</p>
    </div>
  );
}

function TradeField({
  label,
  symbol,
  value,
  onChange,
  balance,
  readOnly,
}: {
  label: string;
  symbol: string;
  value: string;
  onChange?: (value: string) => void;
  balance?: bigint;
  readOnly?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-line bg-bg px-4 py-3">
      <div className="flex justify-between text-xs text-muted">
        <span>{label}</span>
        <span>{balance === undefined ? "" : `Balance ${fmt(balance, 4)}`}</span>
      </div>
      {readOnly ? (
        <p className="mt-1 text-3xl font-medium tabular-nums">{value}</p>
      ) : (
        <input
          inputMode="decimal"
          value={value}
          placeholder="0"
          aria-label={label}
          onChange={(e) => onChange?.(e.target.value)}
          className="mt-1 w-full bg-transparent text-3xl font-medium tabular-nums outline-none"
        />
      )}
      <p className="mt-2 text-sm">{symbol}</p>
    </div>
  );
}
