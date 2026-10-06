import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { type Address } from "viem";
import { erc20Abi } from "@/lib/chimi/chain";
import { publicClient } from "@/lib/chimi/client";
import { fmt, loadCoin, loadSwaps, shortAddr, wethPerToken, type Coin, type PoolSwap } from "@/lib/chimi/market";
import { readTokenMeta } from "@/lib/chimi/meta";
import { tickFromSqrtPriceX96, tokensPerEthFromTick } from "@/lib/chimi/range";
import { PairMark } from "@/components/chimi/pair-mark";
import { PositionDesk } from "@/components/chimi/position-form";
import { useChimi } from "@/components/chimi/provider";

export const Route = createFileRoute("/pool/$address")({ component: PoolPage });

function money(n: number) {
  if (!Number.isFinite(n) || n <= 0) return "$0.00";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `$${Math.round(n).toLocaleString("en-US")}`;
  return `$${n.toFixed(2)}`;
}

function PoolPage() {
  const { address } = Route.useParams();
  const { coins, deployment, account, connect } = useChimi();
  const listed = coins.find((coin) => !coin.preview && coin.token.toLowerCase() === address.toLowerCase());
  const [coin, setCoin] = useState<Coin | null>(listed ?? null);
  const [swaps, setSwaps] = useState<PoolSwap[]>([]);
  const [ethUsd, setEthUsd] = useState<number>();
  const [wethBal, setWethBal] = useState<bigint>(0n);
  const [tokenBal, setTokenBal] = useState<bigint>(0n);
  const [reload, setReload] = useState(0);
  const [creating, setCreating] = useState(false);
  const [metric, setMetric] = useState<"volume" | "price">("volume");
  const [tf, setTf] = useState<"1D" | "1W" | "All">("1D");
  const [hover, setHover] = useState(-1);
  const [copied, setCopied] = useState(false);
  const [image, setImage] = useState<string>();

  useEffect(() => {
    if (listed) {
      setCoin(listed);
      return;
    }
    if (!deployment) return;
    let cancel = false;
    void loadCoin(deployment, address as Address).then((found) => {
      if (!cancel) setCoin(found);
    });
    return () => {
      cancel = true;
    };
  }, [address, deployment, listed]);

  useEffect(() => {
    if (!coin || !deployment) return;
    let cancel = false;
    void Promise.all([
      publicClient.readContract({ address: deployment.weth, abi: erc20Abi, functionName: "balanceOf", args: [coin.pool] }),
      publicClient.readContract({ address: coin.token, abi: erc20Abi, functionName: "balanceOf", args: [coin.pool] }),
      loadSwaps(coin.pool, coin.tokenIs0),
      fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot").then((r) => r.json()),
    ]).then(([weth, token, rows, price]) => {
      if (cancel) return;
      setWethBal(weth);
      setTokenBal(token);
      setSwaps(rows);
      const n = Number((price as { data?: { amount?: string } }).data?.amount);
      if (Number.isFinite(n) && n > 0) setEthUsd(n);
    }).catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [coin, deployment, reload]);

  useEffect(() => {
    if (window.location.hash === "#new") setCreating(true);
    if (coin) setImage(readTokenMeta(coin.token)?.image);
  }, [coin]);

  if (!coin || !deployment) {
    return (
      <main className="mx-auto max-w-[1180px] px-5 py-16">
        <Link to="/pools" className="text-sm text-seal">Pools</Link>
        <h1 className="mt-6 text-4xl font-semibold">Pool not found.</h1>
      </main>
    );
  }

  const price = wethPerToken(coin.sqrtPriceX96, coin.tokenIs0);
  const priceEth = Number(price) / 1e18;
  const tvlUsd = ethUsd ? (Number(wethBal) / 1e18) * ethUsd + (Number(tokenBal) / 1e18) * priceEth * ethUsd : 0;
  const now = Math.floor(Date.now() / 1000);
  const windowSec = tf === "1D" ? 86_400 : tf === "1W" ? 86_400 * 7 : Infinity;
  const shown = swaps.filter((swap) => now - swap.time <= windowSec);
  const volUsd = ethUsd ? shown.reduce((sum, swap) => sum + (Number(swap.ethAmount) / 1e18) * ethUsd, 0) : 0;
  const dayVol = ethUsd ? swaps.filter((swap) => now - swap.time <= 86_400).reduce((sum, swap) => sum + (Number(swap.ethAmount) / 1e18) * ethUsd, 0) : 0;
  const apr = tvlUsd > 0 ? ((dayVol * 0.01) / tvlUsd) * 365 * 100 : 0;
  const fees = dayVol * 0.01;
  const buckets = tf === "All" ? 12 : tf === "1W" ? 7 : 24;
  const span = windowSec === Infinity ? Math.max(now - (swaps[0]?.time ?? now), 3600) : windowSec;
  const bars = Array.from({ length: buckets }, (_, i) => {
    const start = now - span + (i * span) / buckets;
    const end = start + span / buckets;
    return shown.filter((swap) => swap.time >= start && swap.time < end).reduce((sum, swap) => sum + (Number(swap.ethAmount) / 1e18) * (ethUsd ?? 0), 0);
  });
  const maxBar = Math.max(...bars, 1);
  const prices = shown.filter((swap) => swap.sqrtPriceX96 > 0n).map((swap) => tokensPerEthFromTick(tickFromSqrtPriceX96(swap.sqrtPriceX96), coin.tokenIs0));
  const lo = Math.min(...prices, 1);
  const hi = Math.max(...prices, 1);
  const priceLine = prices.length > 1
    ? prices.map((value, i) => `${i ? "L" : "M"}${((i / (prices.length - 1)) * 1000).toFixed(1)} ${(220 - ((value - lo) / (hi - lo || 1)) * 190).toFixed(1)}`).join(" ")
    : "";
  const ethShare = tvlUsd > 0 ? Math.max(6, ((Number(wethBal) / 1e18) * (ethUsd ?? 0) / tvlUsd) * 100) : 50;
  const stats = {
    tvl: money(tvlUsd),
    vol: money(dayVol),
    fees: money(fees),
    apr: `${apr.toFixed(2)}%`,
  };

  if (creating) {
    return (
      <PositionDesk
        coin={coin}
        deployment={deployment}
        account={account}
        connect={connect}
        swaps={swaps}
        ethUsd={ethUsd}
        stats={stats}
        onBack={() => {
          setCreating(false);
          history.replaceState(null, "", window.location.pathname);
        }}
        onChanged={() => setReload((n) => n + 1)}
      />
    );
  }

  return (
    <main className="mx-auto max-w-[1180px] px-4 py-10 sm:px-6">
      <nav className="flex items-center gap-2 text-sm">
        <Link to="/pools" className="text-muted">Pools</Link>
        <span className="text-[#7d6f5a]">/</span>
        <span>{coin.symbol} / ETH</span>
      </nav>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-5 border-b border-line pb-7">
        <div className="flex min-w-0 items-center gap-4">
          <PairMark symbol={coin.symbol} image={image} size={60} />
          <div>
            <h1 className="text-[clamp(30px,4vw,42px)] leading-none font-semibold tracking-[-0.035em]">{coin.symbol} / ETH</h1>
            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[13px]">
              <span className="flex items-center gap-1.5 rounded-lg bg-ok/10 px-2.5 py-1 text-ok"><span className="size-1.5 rounded-full bg-ok" />GIWA Sepolia</span>
              <span className="overflow-hidden rounded-lg bg-fg/7 text-muted"><span className="px-2 py-1">v3</span><span className="border-l border-bg px-2 py-1">1%</span></span>
              <button type="button" onClick={() => { void navigator.clipboard.writeText(coin.pool); setCopied(true); setTimeout(() => setCopied(false), 1400); }} className="rounded-lg bg-fg/7 px-2.5 py-1 text-muted tabular-nums">
                {shortAddr(coin.pool)} {copied ? "Copied" : ""}
              </button>
            </div>
          </div>
        </div>
        <div className="flex gap-2.5">
          <Link to="/swap" className="rounded-full border border-line bg-chip/60 px-5 py-3 text-[15px] font-medium">Swap</Link>
          <button type="button" onClick={() => setCreating(true)} className="rounded-full bg-seal px-5 py-3 text-[15px] font-semibold text-onseal">+ New position</button>
        </div>
      </div>

      <div className="mt-7 flex flex-wrap items-start gap-5">
        <section className="min-w-0 flex-[999_1_560px] rounded-[28px] border border-line bg-chip/85 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-1">
              {(["volume", "price"] as const).map((item) => (
                <button key={item} type="button" onClick={() => { setMetric(item); setHover(-1); }} className={`rounded-full px-3.5 py-1.5 text-[15px] font-medium capitalize ${metric === item ? "bg-fg/9" : "text-muted"}`}>{item}</button>
              ))}
            </div>
            <div className="flex rounded-full border border-line bg-bg p-[3px]">
              {(["1D", "1W", "All"] as const).map((item) => (
                <button key={item} type="button" onClick={() => { setTf(item); setHover(-1); }} className={`rounded-full px-3 py-1 text-xs font-semibold ${tf === item ? "bg-[#3a2d22] text-fg" : "text-muted"}`}>{item}</button>
              ))}
            </div>
          </div>
          <div className="mt-5 text-[40px] leading-none font-semibold tracking-[-0.035em] tabular-nums">
            {metric === "volume" ? money(hover >= 0 ? bars[hover] : volUsd) : `${fmt(price, 8)} ETH`}
          </div>
          <p className="mt-1.5 text-sm text-muted">{metric === "volume" ? (tf === "1D" ? "Past day" : tf === "1W" ? "Past week" : "Trades we can read") : "Tokens per ETH, from recent trades"}</p>
          <div className="relative mt-6 h-60 bg-[radial-gradient(rgba(232,221,200,.09)_1px,transparent_1px)] bg-size-[22px_22px]" onMouseLeave={() => setHover(-1)}>
            {metric === "volume" ? (
              <div className="absolute inset-0 flex items-end gap-1">
                {bars.map((value, i) => (
                  <button key={i} type="button" onMouseEnter={() => setHover(i)} className="flex h-full flex-1 items-end">
                    <span className="w-full rounded-t-[5px]" style={{ height: `${Math.max(2, (value / maxBar) * 100)}%`, background: hover === -1 || hover === i ? "#e0b45a" : "rgba(224,180,90,.35)" }} />
                  </button>
                ))}
              </div>
            ) : priceLine ? (
              <svg viewBox="0 0 1000 240" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
                <path d={`${priceLine} L1000 240 L0 240 Z`} fill="rgba(224,180,90,.18)" />
                <path d={priceLine} fill="none" stroke="#e0b45a" strokeWidth="2.5" strokeLinejoin="round" />
              </svg>
            ) : (
              <p className="absolute inset-0 grid place-items-center text-sm text-muted">No trades in this window.</p>
            )}
          </div>
        </section>
        <section className="min-w-0 flex-[1_1_300px] rounded-[28px] border border-line bg-chip/85 p-6">
          <h2 className="text-xl font-semibold tracking-[-0.02em]">Stats</h2>
          <p className="mt-5 text-sm text-muted">Pool balances</p>
          <div className="mt-2 flex justify-between gap-3 text-sm font-medium tabular-nums">
            <span>{fmt(wethBal, 4)} ETH</span><span>{fmt(tokenBal, 2)} {coin.symbol}</span>
          </div>
          <div className="mt-2.5 flex h-2 gap-0.5">
            <span className="rounded-full bg-fg" style={{ width: `${ethShare}%` }} />
            <span className="flex-1 rounded-full bg-seal" />
          </div>
          <div className="mt-6 grid gap-5">
            <div><div className="text-sm text-muted">Fee APR</div><div className="text-[34px] leading-none font-semibold text-ok tabular-nums">{apr.toFixed(2)}%</div></div>
            <div><div className="text-sm text-muted">TVL</div><div className="text-[28px] leading-none font-semibold tabular-nums">{money(tvlUsd)}</div></div>
            <div><div className="text-sm text-muted">24h volume</div><div className="text-[28px] leading-none font-semibold tabular-nums">{money(dayVol)}</div></div>
            <div><div className="text-sm text-muted">24h fees</div><div className="text-[28px] leading-none font-semibold tabular-nums">{money(fees)}</div></div>
          </div>
        </section>
      </div>

      <section className="mt-5 overflow-hidden rounded-[28px] border border-line bg-chip/85">
        <h2 className="px-6 pt-6 pb-3.5 text-xl font-semibold tracking-[-0.02em]">Recent swaps</h2>
        <div className="grid grid-cols-[4.5rem_3.5rem_minmax(0,1fr)_minmax(0,1fr)_6.5rem] gap-2.5 border-y border-line px-6 py-2.5 text-xs text-muted">
          <span>Time</span><span>Type</span><span className="text-right">ETH</span><span className="text-right">{coin.symbol}</span><span className="text-right">Wallet</span>
        </div>
        {swaps.slice(-8).reverse().map((swap) => (
          <div key={`${swap.tx}-${swap.block}`} className="grid grid-cols-[4.5rem_3.5rem_minmax(0,1fr)_minmax(0,1fr)_6.5rem] gap-2.5 border-b border-line/55 px-6 py-3 text-sm tabular-nums">
            <span className="text-muted">{ago(now - swap.time)}</span>
            <span className={`font-medium ${swap.buy ? "text-ok" : "text-seal"}`}>{swap.buy ? "Buy" : "Sell"}</span>
            <span className="text-right">{fmt(swap.ethAmount, 4)}</span>
            <span className="truncate text-right">{(Number(swap.tokenAmount) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
            <span className="text-right text-muted">{shortAddr(swap.recipient)}</span>
          </div>
        ))}
        {swaps.length === 0 ? <p className="px-6 py-8 text-sm text-muted">No swaps in the window we can read.</p> : null}
      </section>
    </main>
  );
}

function ago(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}
