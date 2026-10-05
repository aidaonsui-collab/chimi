import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { formatEther, parseEther, type Address } from "viem";
import { erc20Abi, giwaSepolia } from "@/lib/chimi/chain";
import { publicClient } from "@/lib/chimi/client";
import {
  estimatedOut,
  fmt,
  loadCoin,
  loadHolders,
  loadSwaps,
  short,
  shortAddr,
  wethPerToken,
  type Coin,
  type Holder,
  type PoolSwap,
} from "@/lib/chimi/market";
import { readTokenMeta, type TokenMeta } from "@/lib/chimi/meta";
import { useChimi } from "@/components/chimi/provider";

export const Route = createFileRoute("/coin/$address")({ component: CoinPage });

const SLIPPAGE = [100, 200, 500];
const RANGES = [
  ["5M", 5 * 60],
  ["1H", 60 * 60],
  ["6H", 6 * 60 * 60],
  ["1D", 24 * 60 * 60],
  ["ALL", 0],
] as const;

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
  const [holders, setHolders] = useState<Holder[]>([]);
  const [range, setRange] = useState<(typeof RANGES)[number][0]>("1H");
  const [panel, setPanel] = useState<"trades" | "holders">("trades");

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
      .then(async (rows) => {
        if (cancel) return;
        setSwaps(rows);
        const found = await loadHolders(coin.token, coin.pool, rows.map((row) => row.recipient));
        if (!cancel) setHolders(found);
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
  const now = Math.floor(Date.now() / 1000);
  const windowSec = RANGES.find((item) => item[0] === range)?.[1] ?? 0;
  const inRange = swaps.filter((swap) => windowSec === 0 || now - swap.time <= windowSec);
  const dayAgo = swaps.filter((swap) => now - swap.time <= 24 * 60 * 60);
  const volumeUsd = ethUsd ? dayAgo.reduce((sum, swap) => sum + (Number(swap.ethAmount) / 1e18) * ethUsd, 0) : undefined;
  const capOf = (sqrt: bigint) => {
    const eth = (Number(wethPerToken(sqrt, coin?.tokenIs0 ?? true)) / 1e18) * 1_000_000_000;
    return ethUsd ? eth * ethUsd : eth;
  };
  const series = [...inRange.map((swap) => capOf(swap.sqrtPriceX96)), fdvUsd ?? fdvEth];
  const ath = Math.max(fdvUsd ?? fdvEth, ...swaps.map((swap) => capOf(swap.sqrtPriceX96)));
  const first = series[0] || 0;
  const last = series[series.length - 1] || 0;
  const change = first > 0 ? ((last - first) / first) * 100 : 0;
  const chart = chartPath(series);
  const clock = (unix: number) =>
    new Date(unix * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

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
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat
              label="Market cap"
              value={fdvUsd ? `${money(fdvUsd)} / ${money(fdvUsd)} FDV` : `${fmt(price * 1_000_000_000n, 4)} ETH`}
            />
            <Stat label="Liquidity" value={liqUsd ? money(liqUsd) : poolEth !== undefined ? `${fmt(poolEth, 4)} ETH` : "—"} />
            <Stat label="24h volume" value={volumeUsd === undefined ? "—" : money(volumeUsd)} />
            <Stat label="ATH" value={fdvUsd || ath ? money(ath) : "—"} />
          </div>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-4xl font-semibold tracking-[-0.04em]">{fdvUsd ? money(fdvUsd) : `${fmt(price * 1_000_000_000n, 4)} ETH`}</p>
              <p className={`mt-1 text-sm ${change < 0 ? "text-seal" : "text-ok"}`}>
                {change > 0 ? "+" : ""}
                {change.toFixed(2)}% <span className="text-muted">{range === "ALL" ? "all" : range}</span>
              </p>
            </div>
            <div className="flex rounded-full border border-line bg-bg p-1">
              {RANGES.map(([label]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setRange(label)}
                  className={`rounded-full px-2.5 py-1 text-xs ${range === label ? "bg-fg/10 text-fg" : "text-muted"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="relative mt-4 h-[280px]">
            <svg viewBox="0 0 640 280" className="h-full w-full">
              <defs>
                <linearGradient id="chimi-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#e0b45a" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#e0b45a" stopOpacity="0" />
                </linearGradient>
              </defs>
              {[70, 140, 210].map((y) => (
                <line key={y} x1="0" y1={y} x2="640" y2={y} stroke="#3f3325" strokeDasharray="3 6" />
              ))}
              {chart.area ? <path d={chart.area} fill="url(#chimi-fill)" /> : null}
              {chart.line ? <path d={chart.line} fill="none" stroke="#e0b45a" strokeWidth="2" /> : null}
            </svg>
            <div className="pointer-events-none absolute inset-y-2 right-0 flex flex-col justify-between text-[11px] text-muted">
              <span>{money(Math.max(...series))}</span>
              <span>{money(series.reduce((a, b) => a + b, 0) / series.length || 0)}</span>
              <span>{money(Math.min(...series))}</span>
            </div>
            <div className="absolute right-10 bottom-0 left-0 flex justify-between text-[11px] text-muted">
              <span>{inRange[0] ? clock(inRange[0].time) : ""}</span>
              <span>{inRange.length > 2 ? clock(inRange[Math.floor(inRange.length / 2)].time) : ""}</span>
              <span>{inRange.length ? clock(inRange[inRange.length - 1].time) : "now"}</span>
            </div>
          </div>
        </section>
      </div>

      <section className="mt-4 rounded-3xl border border-line bg-chip p-4">
        <div className="flex gap-2">
          {(["trades", "holders"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setPanel(key)}
              className={`rounded-full px-3 py-1.5 text-sm ${panel === key ? "bg-fg/10 text-fg" : "text-muted"}`}
            >
              {key === "trades" ? "Trades" : "Holders"}
            </button>
          ))}
          <span className="ml-auto text-xs text-muted">{panel === "trades" ? swaps.length : holders.length}</span>
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
          <div className="mt-3 divide-y divide-line/60">
            {holders.length === 0 ? <p className="py-6 text-sm text-muted">No holder balances yet.</p> : null}
            {holders.map((holder) => {
              const pct = Number((holder.balance * 10_000n) / (1_000_000_000n * 10n ** 18n)) / 100;
              const isPool = holder.address.toLowerCase() === coin.pool.toLowerCase();
              return (
                <a
                  key={holder.address}
                  href={`${explorer}/address/${holder.address}`}
                  className="flex items-center justify-between gap-3 py-3 text-sm"
                >
                  <span>
                    {shortAddr(holder.address)}
                    {isPool ? <span className="ml-2 text-xs text-muted">Pool</span> : null}
                  </span>
                  <span className="text-right tabular-nums">
                    {fmt(holder.balance, 2)} {coin.symbol}
                    <span className="mt-0.5 block text-xs text-muted">{pct.toFixed(2)}%</span>
                  </span>
                </a>
              );
            })}
          </div>
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
