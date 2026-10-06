import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { formatEther, parseEther, type Address } from "viem";
import { POOL_FEE, erc20Abi, giwaSepolia } from "@/lib/chimi/chain";
import { publicClient } from "@/lib/chimi/client";
import {
  estimatedOut,
  feeLabel,
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
import { saveTokenMeta, shrinkImage } from "@/lib/chimi/meta";
import { tokenUsd } from "@/lib/chimi/format";
import { publishTokenProfile, refreshTokenProfiles, sharedStorageEnabled, useTokenProfile } from "@/lib/chimi/token-image";
import { useChimi } from "@/components/chimi/provider";
import { EthLogo, TokenLogo } from "@/components/chimi/token-logo";

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
  const { coins, deployment, account, connect, trade, unwrap, signMessage } = useChimi();
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
  const meta = useTokenProfile(address);
  const [editing, setEditing] = useState(false);
  const [ethUsd, setEthUsd] = useState<number>();
  const [payBal, setPayBal] = useState<bigint>();
  const [poolEth, setPoolEth] = useState<bigint>();
  const [swaps, setSwaps] = useState<PoolSwap[]>([]);
  const [holders, setHolders] = useState<Holder[]>([]);
  const [range, setRange] = useState<(typeof RANGES)[number][0]>("1H");
  const [panel, setPanel] = useState<"trades" | "holders">("trades");

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
  const coinLogo = (size: number) => <TokenLogo symbol={coin.symbol} image={meta?.image} size={size} />;
  const isCreator = Boolean(account && coin.creator && account.toLowerCase() === coin.creator.toLowerCase() && !coin.preview);
  const priceUsd = ethUsd ? (Number(price) / 1e18) * ethUsd : undefined;
  const links = [
    { label: "Contract", href: `${explorer}/address/${coin.token}` },
    { label: "Pool", href: `${explorer}/address/${coin.pool}` },
    meta?.twitter ? { label: "X", href: `https://x.com/${meta.twitter}` } : null,
    meta?.telegram ? { label: "Telegram", href: `https://t.me/${meta.telegram}` } : null,
    meta?.website ? { label: "Website", href: meta.website } : null,
  ].filter((link): link is { label: string; href: string } => Boolean(link));

  return (
    <main className="mx-auto max-w-[1180px] px-4 pt-5 pb-16 sm:px-6 sm:pt-7">
      <nav className="flex items-center gap-1.5 text-sm text-muted" aria-label="Breadcrumb">
        <Link to="/" className="hover:text-fg">Board</Link>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden><path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <span className="text-fg">{coin.symbol}</span>
        <span className="ml-1 truncate tabular-nums">{shortAddr(coin.token)}</span>
      </nav>

      <header className="mt-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3.5">
          {coinLogo(56)}
          <div className="min-w-0">
            <h1 className="truncate text-[28px] leading-tight font-semibold tracking-[-0.03em] sm:text-[32px]">{coin.name}</h1>
            <p className="text-[15px] text-muted">{coin.symbol}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {links.map((link) => (
            <a key={link.label} href={link.href} target="_blank" rel="noreferrer" className="rounded-full border border-line bg-chip px-3.5 py-1.5 text-sm text-muted hover:text-fg">
              {link.label}
            </a>
          ))}
          {isCreator ? (
            <button type="button" onClick={() => setEditing((v) => !v)} className="rounded-full border border-gold/40 bg-gold/10 px-3.5 py-1.5 text-sm font-medium text-gold">
              {meta?.shared ? "Edit profile" : "Set picture"}
            </button>
          ) : null}
        </div>
      </header>

      {isCreator && editing ? (
        <ProfileEditor
          token={coin.token}
          symbol={coin.symbol}
          initial={meta}
          sign={signMessage}
          onDone={() => setEditing(false)}
        />
      ) : null}

      <div className="mt-6 grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="min-w-0 lg:col-start-1">
          <p className="text-[40px] leading-none font-semibold tracking-[-0.04em] tabular-nums sm:text-[44px]">
            {fdvUsd ? money(fdvUsd) : `${fmt(price * 1_000_000_000n, 4)} ETH`}
          </p>
          <p className="mt-1.5 text-sm">
            <span className={change < 0 ? "text-seal" : "text-ok"}>
              {change < 0 ? "▼" : "▲"} {Math.abs(change).toFixed(2)}%
            </span>
            <span className="ml-1.5 text-muted">{range === "ALL" ? "all time" : range} · market cap</span>
          </p>
          <div className="relative mt-5 h-[240px] sm:h-[300px]">
            <svg viewBox="0 0 640 280" preserveAspectRatio="none" className="h-full w-full">
              <defs>
                <linearGradient id="chimi-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#e0b45a" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#e0b45a" stopOpacity="0" />
                </linearGradient>
              </defs>
              {[70, 140, 210].map((y) => (
                <line key={y} x1="0" y1={y} x2="640" y2={y} stroke="#3f3325" strokeDasharray="3 6" vectorEffect="non-scaling-stroke" />
              ))}
              {chart.area ? <path d={chart.area} fill="url(#chimi-fill)" /> : null}
              {chart.line ? <path d={chart.line} fill="none" stroke="#e0b45a" strokeWidth="2" vectorEffect="non-scaling-stroke" /> : null}
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
          <div className="mt-4 flex justify-between gap-3">
            <div className="flex rounded-full border border-line bg-chip p-1">
              {RANGES.map(([label]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setRange(label)}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${range === label ? "bg-fg/10 text-fg" : "text-muted"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="min-w-0 rounded-[28px] border border-line bg-chip p-3 shadow-[inset_0_1px_0_rgba(255,255,255,.05),0_30px_60px_-30px_rgba(0,0,0,.8)] lg:sticky lg:top-24 lg:col-start-2 lg:row-span-4 lg:row-start-1">
          <div className="flex items-center justify-between px-2 pt-1 pb-3">
            <div className="flex rounded-[10px] border border-line bg-bg p-[3px]">
              {(["buy", "sell"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setSide(key);
                    setAmount("");
                  }}
                  className={`rounded-[7px] px-4 py-1.5 text-[13px] font-medium capitalize ${side === key ? "bg-[#3a2d22] text-fg shadow-[inset_0_1px_0_rgba(255,255,255,.06)]" : "text-muted"}`}
                >
                  {key}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setAdjust((v) => !v)} className="rounded-full border border-line px-3 py-1.5 text-[13px] font-medium text-muted tabular-nums">
              {slippageBps / 100}% slippage
            </button>
          </div>
          {adjust ? (
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-line bg-bg px-4 py-3">
              <span className="text-sm text-muted">Max slippage</span>
              <div className="flex gap-1.5">
                {SLIPPAGE.map((bps) => (
                  <button
                    key={bps}
                    type="button"
                    onClick={() => setSlippageBps(bps)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${slippageBps === bps ? "border-fg bg-fg text-bg" : "border-line text-muted"}`}
                  >
                    {bps / 100}%
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="relative flex flex-col gap-1.5">
            <TradeField
              label={side === "buy" ? "You pay" : "You sell"}
              symbol={paySymbol}
              logo={side === "buy" ? <EthLogo size={26} /> : coinLogo(26)}
              value={amount}
              onChange={setAmount}
              balance={payBal}
              usd={ethUsd && parsed > 0n ? money((Number(parsed) / 1e18) * (side === "buy" ? 1 : Number(price) / 1e18) * ethUsd) : undefined}
            />
            <button
              type="button"
              aria-label="Flip direction"
              onClick={() => {
                setSide((v) => (v === "buy" ? "sell" : "buy"));
                setAmount("");
              }}
              className="absolute top-1/2 left-1/2 z-10 grid size-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-[14px] border-4 border-chip bg-chip text-fg shadow-[0_0_0_1px_#3f3325]"
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M8 2.5v11M3.5 9 8 13.5 12.5 9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <TradeField
              label="You receive"
              symbol={recvSymbol}
              logo={side === "buy" ? coinLogo(26) : <EthLogo size={26} />}
              value={quote === 0n ? "0" : fmt(quote)}
              readOnly
              usd={ethUsd && quote > 0n ? money((Number(quote) / 1e18) * (side === "buy" ? Number(price) / 1e18 : 1) * ethUsd) : undefined}
            />
          </div>

          <div className="mt-2.5 flex gap-1.5">
            {[25, 50, 75, 100].map((pct) => (
              <button
                key={pct}
                type="button"
                disabled={payBal === undefined}
                onClick={() => payBal !== undefined && setAmount(formatEther((payBal * BigInt(pct)) / 100n))}
                className="flex-1 rounded-full border border-line py-1.5 text-xs text-muted disabled:opacity-40"
              >
                {pct === 100 ? "Max" : `${pct}%`}
              </button>
            ))}
          </div>

          <div className="mt-2.5 rounded-[20px] border border-line/70 px-4 text-sm">
            <div className="flex justify-between gap-3 border-b border-line/55 py-2.5">
              <span className="text-muted">Rate</span>
              <span className="text-right tabular-nums">1 {coin.symbol} = {tinyEth(price)} ETH</span>
            </div>
            <div className="flex justify-between gap-3 py-2.5">
              <span className="text-muted">Minimum received</span>
              <span className="text-right tabular-nums">{quote === 0n ? "—" : `${fmt(minOut)} ${recvSymbol}`}</span>
            </div>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={() => void go()}
            className="mt-3 w-full rounded-[20px] bg-seal py-4 text-base font-semibold text-onseal shadow-[inset_0_1px_0_rgba(255,255,255,.22),0_10px_30px_rgba(210,74,46,.28)] disabled:opacity-40"
          >
            {busy ? "Confirming…" : account ? (side === "buy" ? `Buy ${coin.symbol}` : `Sell ${coin.symbol}`) : "Connect wallet"}
          </button>
          <button type="button" onClick={() => void doUnwrap()} className="mt-2 w-full text-center text-xs text-muted">
            Unwrap WETH
          </button>
          {tradeNote ? (
            <p className={`mt-2 text-center text-sm ${kind === "bad" ? "text-seal" : kind === "good" ? "text-ok" : "text-muted"}`}>{tradeNote}</p>
          ) : null}
        </section>

        <section className="min-w-0 lg:col-start-1">
          <h2 className="text-xl font-semibold tracking-[-0.02em]">Stats</h2>
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-5 rounded-3xl border border-line bg-chip px-5 py-5 sm:grid-cols-3">
            <Stat label="Market cap" value={fdvUsd ? money(fdvUsd) : `${fmt(price * 1_000_000_000n, 4)} ETH`} />
            <Stat label="FDV" value={fdvUsd ? money(fdvUsd) : `${fmt(price * 1_000_000_000n, 4)} ETH`} />
            <Stat label="Liquidity" value={liqUsd ? money(liqUsd) : poolEth !== undefined ? `${fmt(poolEth, 4)} ETH` : "—"} />
            <Stat label="1 day volume" value={volumeUsd === undefined ? "—" : money(volumeUsd)} />
            <Stat label="All-time high" value={fdvUsd || ath ? money(ath) : "—"} />
            <Stat label="Price" value={priceUsd !== undefined ? tokenUsd(priceUsd) : `${tinyEth(price)} ETH`} />
          </div>
        </section>

        <section className="min-w-0 lg:col-start-1">
          <h2 className="text-xl font-semibold tracking-[-0.02em]">About</h2>
          <div className="mt-3 rounded-3xl border border-line bg-chip px-5 py-5">
            <p className="text-[15px] text-muted">{meta?.description || "The full supply sits in a locked pool. No bonding curve."}</p>
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-muted">
              <span>Creator <a className="text-fg tabular-nums" href={`${explorer}/address/${coin.creator}`} target="_blank" rel="noreferrer">{shortAddr(coin.creator)}</a></span>
              <span>Supply <span className="text-fg">1B</span></span>
              <span>Pool <span className="text-fg">{coin.symbol}/ETH · v3 · {feeLabel(coin.fee ?? POOL_FEE)}</span></span>
              <span>Launch liquidity <span className="text-fg">locked 100 years</span></span>
            </div>
          </div>
        </section>

        <section className="min-w-0 lg:col-start-1">
          <div className="flex items-center gap-2">
            {(["trades", "holders"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setPanel(key)}
                className={`rounded-full px-3.5 py-1.5 text-[15px] font-semibold ${panel === key ? "bg-fg/10 text-fg" : "text-muted"}`}
              >
                {key === "trades" ? "Transactions" : "Holders"}
              </button>
            ))}
            <span className="ml-auto text-xs text-muted">{panel === "trades" ? swaps.length : holders.length}</span>
          </div>
          <div className="mt-3 overflow-hidden rounded-3xl border border-line bg-chip">
            {panel === "trades" ? (
              <>
                <div className="grid grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1fr)] gap-3 border-b border-line bg-[#261d16] px-5 py-3 text-[13px] text-muted sm:grid-cols-[4rem_3.5rem_minmax(0,1fr)_minmax(0,1fr)_7rem]">
                  <span>Time</span>
                  <span className="hidden sm:block">Type</span>
                  <span className="text-right">{coin.symbol}</span>
                  <span className="text-right">ETH</span>
                  <span className="hidden text-right sm:block">Tx</span>
                </div>
                {swaps.length === 0 ? <p className="px-5 py-6 text-sm text-muted">No swaps in the last few thousand blocks.</p> : null}
                {[...swaps].reverse().map((swap) => (
                  <a
                    key={`${swap.tx}-${swap.block}`}
                    href={`${explorer}/tx/${swap.tx}`}
                    target="_blank"
                    rel="noreferrer"
                    className="grid grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 border-b border-line/55 px-5 py-3 text-sm tabular-nums last:border-0 sm:grid-cols-[4rem_3.5rem_minmax(0,1fr)_minmax(0,1fr)_7rem]"
                  >
                    <span className="text-muted">{ago(now - swap.time)}</span>
                    <span className={`hidden font-medium sm:block ${swap.buy ? "text-ok" : "text-seal"}`}>{swap.buy ? "Buy" : "Sell"}</span>
                    <span className="truncate text-right">
                      <span className={`mr-1.5 sm:hidden ${swap.buy ? "text-ok" : "text-seal"}`}>{swap.buy ? "Buy" : "Sell"}</span>
                      {fmt(swap.tokenAmount, 2)}
                    </span>
                    <span className="text-right">
                      {fmt(swap.ethAmount, 6)}
                      {ethUsd ? <span className="block text-xs text-muted">{money((Number(swap.ethAmount) / 1e18) * ethUsd)}</span> : null}
                    </span>
                    <span className="hidden text-right text-muted sm:block">{shortAddr(swap.tx)}</span>
                  </a>
                ))}
              </>
            ) : (
              <>
                {holders.length === 0 ? <p className="px-5 py-6 text-sm text-muted">No holder balances yet.</p> : null}
                {holders.map((holder) => {
                  const share = Number((holder.balance * 10_000n) / (1_000_000_000n * 10n ** 18n)) / 100;
                  const isPool = holder.address.toLowerCase() === coin.pool.toLowerCase();
                  return (
                    <a
                      key={holder.address}
                      href={`${explorer}/address/${holder.address}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between gap-3 border-b border-line/55 px-5 py-3 text-sm last:border-0"
                    >
                      <span className="tabular-nums">
                        {shortAddr(holder.address)}
                        {isPool ? <span className="ml-2 text-xs text-muted">Pool</span> : null}
                      </span>
                      <span className="text-right tabular-nums">
                        {fmt(holder.balance, 2)} {coin.symbol}
                        <span className="mt-0.5 block text-xs text-muted">{share.toFixed(2)}%</span>
                      </span>
                    </a>
                  );
                })}
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function ago(seconds: number) {
  if (seconds < 60) return `${Math.max(0, seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[13px] text-muted">{label}</p>
      <p className="mt-0.5 truncate text-lg font-semibold tracking-[-0.01em] tabular-nums">{value}</p>
    </div>
  );
}

function TradeField({
  label,
  symbol,
  logo,
  value,
  onChange,
  balance,
  readOnly,
  usd,
}: {
  label: string;
  symbol: string;
  logo: ReactNode;
  value: string;
  onChange?: (value: string) => void;
  balance?: bigint;
  readOnly?: boolean;
  usd?: string;
}) {
  return (
    <div className={`rounded-[22px] border border-line px-4 py-4 ${readOnly ? "bg-bg/55" : "bg-bg"}`}>
      <p className="text-[13px] text-muted">{label}</p>
      <div className="mt-1.5 flex items-center gap-3">
        {readOnly ? (
          <p className="min-w-0 flex-1 truncate text-[32px] leading-[1.15] font-medium tracking-[-0.03em] tabular-nums">{value}</p>
        ) : (
          <input
            inputMode="decimal"
            value={value}
            placeholder="0"
            aria-label={label}
            onChange={(e) => onChange?.(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[32px] leading-[1.15] font-medium tracking-[-0.03em] tabular-nums outline-none"
          />
        )}
        <span className="flex shrink-0 items-center gap-2 rounded-full border border-line bg-chip py-1 pr-3 pl-1 text-[15px] font-semibold">
          {logo}
          {symbol}
        </span>
      </div>
      <div className="mt-1.5 flex justify-between gap-3 text-[13px] text-muted tabular-nums">
        <span>{usd ?? ""}</span>
        <span>{balance === undefined ? "" : `Balance ${fmt(balance, 4)}`}</span>
      </div>
    </div>
  );
}

function ProfileEditor({
  token,
  symbol,
  initial,
  sign,
  onDone,
}: {
  token: Address;
  symbol: string;
  initial: { description?: string; image?: string; twitter?: string; telegram?: string; website?: string } | null;
  sign: (message: string) => Promise<`0x${string}`>;
  onDone: () => void;
}) {
  const [image, setImage] = useState(initial?.image);
  const [description, setDescription] = useState(initial?.description ?? "");
  const [twitter, setTwitter] = useState(initial?.twitter ?? "");
  const [telegram, setTelegram] = useState(initial?.telegram ?? "");
  const [website, setWebsite] = useState(initial?.website ?? "");
  const [note, setNote] = useState("");
  const [bad, setBad] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = "mt-1 w-full rounded-xl border border-line bg-bg px-3 py-2.5 text-[15px] text-fg outline-none";

  async function publish() {
    const profile = { description, image, twitter, telegram, website };
    try {
      setBusy(true);
      setBad(false);
      setNote("Sign the message in your wallet. It costs no gas.");
      await publishTokenProfile(token, profile, sign);
      setNote("Published. Everyone now sees this picture.");
      setTimeout(onDone, 900);
    } catch (err) {
      saveTokenMeta(token, { ...profile, description });
      refreshTokenProfiles();
      setBad(true);
      setNote(`${short(err)} Saved in this browser only.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-5 rounded-3xl border border-gold/30 bg-chip p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Token profile</h2>
        <button type="button" onClick={onDone} className="text-sm text-muted">Close</button>
      </div>
      <p className="mt-1 text-sm text-muted">
        You launched {symbol}. Sign once with your wallet to share its picture, description, and links with everyone.
        {sharedStorageEnabled() === false ? " Shared pictures aren’t switched on for this site yet, so this will only save in this browser." : ""}
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)]">
        <label className="flex cursor-pointer flex-col items-center gap-2 text-sm text-muted">
          <TokenLogo symbol={symbol} image={image} size={88} />
          <span className="rounded-full border border-line px-3 py-1 text-xs">Choose image</span>
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              void shrinkImage(file)
                .then(setImage)
                .catch((err) => {
                  setBad(true);
                  setNote(short(err));
                });
            }}
          />
        </label>
        <div className="grid gap-3">
          <label className="block text-sm text-muted">
            Description
            <textarea value={description} maxLength={280} rows={2} onChange={(e) => setDescription(e.target.value)} className={input} />
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-sm text-muted">
              X handle
              <input value={twitter} onChange={(e) => setTwitter(e.target.value.replace(/^@/, ""))} className={input} />
            </label>
            <label className="block text-sm text-muted">
              Telegram
              <input value={telegram} onChange={(e) => setTelegram(e.target.value)} className={input} />
            </label>
            <label className="block text-sm text-muted">
              Website
              <input value={website} placeholder="https://" onChange={(e) => setWebsite(e.target.value)} className={input} />
            </label>
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className={`text-sm ${bad ? "text-seal" : "text-muted"}`}>{note}</p>
        <button type="button" disabled={busy} onClick={() => void publish()} className="rounded-full bg-seal px-5 py-2.5 text-sm font-semibold text-onseal disabled:opacity-40">
          {busy ? "Publishing…" : "Sign and publish"}
        </button>
      </div>
    </section>
  );
}
