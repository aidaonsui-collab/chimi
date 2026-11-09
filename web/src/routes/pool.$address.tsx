import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { type Address } from "viem";
import { erc20Abi, giwaSepolia } from "@/lib/chimi/chain";
import { publicClient } from "@/lib/chimi/client";
import { ago, compactCount, ethText } from "@/lib/chimi/format";
import { fetchSwaps, useEthUsd } from "@/lib/chimi/live";
import { feeLabel, fmt, loadCoin, shortAddr, wethPerToken, type Coin, type PoolSwap } from "@/lib/chimi/market";
import { useTokenProfile } from "@/lib/chimi/token-image";
import { tickFromSqrtPriceX96, tokensPerEthFromTick } from "@/lib/chimi/range";
import { AreaChart, BarChart, type ChartPoint } from "@/components/chimi/charts";
import { IconChevronRight, IconExternal, IconPlus, IconSwap } from "@/components/chimi/icons";
import { PairMark } from "@/components/chimi/pair-mark";
import { PositionDesk } from "@/components/chimi/position-form";
import { useChimi } from "@/components/chimi/provider";
import { Blockie, CopyButton, Empty, Seg } from "@/components/chimi/ui";

export const Route = createFileRoute("/pool/$address")({ component: PoolPage });

function money(n: number) {
  if (!Number.isFinite(n) || n <= 0) return "$0.00";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `$${Math.round(n).toLocaleString("en-US")}`;
  return `$${n.toFixed(2)}`;
}

function PoolPage() {
  const { address } = Route.useParams();
  const { coins, deployment, account, connect, loading } = useChimi();
  const listed = coins.find((coin) => !coin.preview && coin.token.toLowerCase() === address.toLowerCase());
  const [coin, setCoin] = useState<Coin | null>(listed ?? null);
  const [missing, setMissing] = useState(false);
  const [swaps, setSwaps] = useState<PoolSwap[]>();
  const ethUsd = useEthUsd();
  const [wethBal, setWethBal] = useState<bigint>(0n);
  const [tokenBal, setTokenBal] = useState<bigint>(0n);
  const [reload, setReload] = useState(0);
  const [creating, setCreating] = useState(false);
  const [metric, setMetric] = useState<"volume" | "price">("volume");
  const [tf, setTf] = useState<"1D" | "1W" | "All">("1D");
  const [hover, setHover] = useState(-1);
  const [hoverPrice, setHoverPrice] = useState<ChartPoint | null>(null);
  const image = useTokenProfile(coin?.token)?.image;

  useEffect(() => {
    if (listed) {
      setCoin(listed);
      setMissing(false);
      return;
    }
    if (!deployment || loading) return;
    let cancel = false;
    void loadCoin(deployment, address as Address)
      .then((found) => {
        if (cancel) return;
        setCoin(found);
        setMissing(!found);
      })
      .catch(() => {
        if (!cancel) setMissing(true);
      });
    return () => {
      cancel = true;
    };
  }, [address, deployment, listed, loading]);

  useEffect(() => {
    if (!coin || !deployment) return;
    let cancel = false;
    void Promise.all([
      publicClient.readContract({ address: deployment.weth, abi: erc20Abi, functionName: "balanceOf", args: [coin.pool] }),
      publicClient.readContract({ address: coin.token, abi: erc20Abi, functionName: "balanceOf", args: [coin.pool] }),
      fetchSwaps(coin, reload > 0),
    ])
      .then(([weth, token, rows]) => {
        if (cancel) return;
        setWethBal(weth);
        setTokenBal(token);
        setSwaps(rows);
      })
      .catch(() => {
        if (!cancel) setSwaps((prev) => prev ?? []);
      });
    return () => {
      cancel = true;
    };
  }, [coin, deployment, reload]);

  // "#new" opens the position screen, whether the page loads with it or a link adds it later.
  useEffect(() => {
    const check = () => {
      if (window.location.hash === "#new") setCreating(true);
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, [coin]);

  if (!coin || !deployment) {
    return (
      <main className="page pt-4 pb-16">
        {missing ? (
          <div className="card mt-4">
            <Empty
              mark="없음"
              title="Pool not found"
              action={
                <Link to="/pools" className="btn btn-secondary">
                  All pools
                </Link>
              }
            >
              <span className="num">{shortAddr(address)}</span> isn’t a coin on Chimi’s factory, so it has no pool here.
            </Empty>
          </div>
        ) : (
          <div className="space-y-5" aria-busy>
            <span className="skeleton h-24 w-full rounded-2xl" />
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
              <span className="skeleton h-[420px] rounded-2xl" />
              <span className="skeleton h-[420px] rounded-2xl" />
            </div>
          </div>
        )}
      </main>
    );
  }

  const rows = swaps ?? [];
  const price = wethPerToken(coin.sqrtPriceX96, coin.tokenIs0);
  const priceEth = Number(price) / 1e18;
  const tvlUsd = ethUsd ? (Number(wethBal) / 1e18) * ethUsd + (Number(tokenBal) / 1e18) * priceEth * ethUsd : 0;
  const now = Math.floor(Date.now() / 1000);
  const windowSec = tf === "1D" ? 86_400 : tf === "1W" ? 86_400 * 7 : Infinity;
  const shown = rows.filter((swap) => now - swap.time <= windowSec);
  const volUsd = ethUsd ? shown.reduce((sum, swap) => sum + (Number(swap.ethAmount) / 1e18) * ethUsd, 0) : 0;
  const dayVol = ethUsd ? rows.filter((swap) => now - swap.time <= 86_400).reduce((sum, swap) => sum + (Number(swap.ethAmount) / 1e18) * ethUsd, 0) : 0;
  const feeRate = (coin.fee ?? 10_000) / 1_000_000;
  const apr = tvlUsd > 0 ? ((dayVol * feeRate) / tvlUsd) * 365 * 100 : 0;
  const fees = dayVol * feeRate;
  const buckets = tf === "All" ? 12 : tf === "1W" ? 7 : 24;
  const span = windowSec === Infinity ? Math.max(now - (rows[0]?.time ?? now), 3600) : windowSec;
  const bars = Array.from({ length: buckets }, (_, i) => {
    const start = now - span + (i * span) / buckets;
    const end = start + span / buckets;
    return shown.filter((swap) => swap.time >= start && swap.time < end).reduce((sum, swap) => sum + (Number(swap.ethAmount) / 1e18) * (ethUsd ?? 0), 0);
  });
  const barLabels = Array.from({ length: buckets }, (_, i) => {
    const start = new Date((now - span + (i * span) / buckets) * 1000);
    return span > 86_400 * 2 ? start.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  });
  const currentTokens = coin.sqrtPriceX96 > 0n ? tokensPerEthFromTick(tickFromSqrtPriceX96(coin.sqrtPriceX96), coin.tokenIs0) : 0;
  const pricePoints: ChartPoint[] = [
    ...shown.filter((swap) => swap.sqrtPriceX96 > 0n).map((swap) => ({ t: swap.time, v: tokensPerEthFromTick(tickFromSqrtPriceX96(swap.sqrtPriceX96), coin.tokenIs0) })),
    { t: now, v: currentTokens },
  ];
  const priceFrom = windowSec === Infinity ? (pricePoints[0]?.t ?? now - 3600) : now - windowSec;
  const perEth = (v: number) => `${compactCount(v)} ${coin.symbol}`;
  const ethShare = tvlUsd > 0 ? Math.max(6, (((Number(wethBal) / 1e18) * (ethUsd ?? 0)) / tvlUsd) * 100) : 50;
  const stats = {
    tvl: money(tvlUsd),
    vol: money(dayVol),
    fees: money(fees),
    apr: `${apr.toFixed(2)}%`,
  };
  const explorer = giwaSepolia.blockExplorers.default.url;

  if (creating) {
    return (
      <PositionDesk
        coin={coin}
        deployment={deployment}
        account={account}
        connect={connect}
        swaps={rows}
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
    <main className="page pt-4 pb-16">
      <nav className="flex items-center gap-1.5 text-sm text-muted" aria-label="Breadcrumb">
        <Link to="/pools" className="hover:text-fg">
          Pools
        </Link>
        <IconChevronRight size={13} className="text-faint" />
        <span className="text-fg">{coin.symbol} / ETH</span>
      </nav>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-5">
        <div className="flex min-w-0 items-center gap-4">
          <PairMark symbol={coin.symbol} image={image} size={56} />
          <div className="min-w-0">
            <h1 className="text-[30px] leading-none font-semibold tracking-[-0.035em] sm:text-[38px]">{coin.symbol} / ETH</h1>
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <span className="chip border-ok/25 bg-ok/10 text-ok">
                <span className="size-1.5 rounded-full bg-ok" />
                GIWA Sepolia
              </span>
              <span className="chip">v3 · {feeLabel(coin.fee)}</span>
              <span className="chip gap-1 pr-0.5">
                <span className="num">{shortAddr(coin.pool)}</span>
                <CopyButton text={coin.pool} label="Copy pool address" className="btn btn-icon btn-ghost size-6 rounded-md" size={12} />
              </span>
              <a href={`${explorer}/address/${coin.pool}`} target="_blank" rel="noreferrer" aria-label="Pool on the explorer" className="chip hover:text-fg">
                <IconExternal size={12} />
              </a>
            </div>
          </div>
        </div>
        <div className="flex gap-2.5">
          <Link to="/coin/$address" params={{ address: coin.token }} className="btn btn-lg btn-secondary">
            <IconSwap size={17} />
            Trade
          </Link>
          <button type="button" onClick={() => setCreating(true)} className="btn btn-lg btn-primary">
            <IconPlus size={18} />
            New position
          </button>
        </div>
      </div>

      <div className="mt-7 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="card min-w-0 p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Seg
              label="Chart"
              value={metric}
              onChange={(v) => {
                setMetric(v);
                setHover(-1);
              }}
              options={[
                ["volume", "Volume"],
                ["price", "Price"],
              ]}
            />
            <Seg
              label="Range"
              value={tf}
              onChange={(v) => {
                setTf(v);
                setHover(-1);
              }}
              options={[
                ["1D", "1D"],
                ["1W", "1W"],
                ["All", "All"],
              ]}
            />
          </div>
          <div className="num mt-5 text-[34px] leading-none font-semibold tracking-[-0.035em] sm:text-[40px]">
            {metric === "volume" ? money(hover >= 0 ? (bars[hover] ?? 0) : volUsd) : hoverPrice ? perEth(hoverPrice.v) : `${fmt(price, 8)} ETH`}
          </div>
          <p className="mt-2 text-sm text-muted">
            {metric === "volume"
              ? hover >= 0
                ? `From ${barLabels[hover]}`
                : tf === "1D"
                  ? "Past day"
                  : tf === "1W"
                    ? "Past week, as far back as we can read"
                    : "Every trade we can read"
              : hoverPrice
                ? "per ETH, at that trade"
                : `per ${coin.symbol} · the chart shows ${coin.symbol} per ETH`}
          </p>
          <div className="mt-6">
            {!swaps ? (
              <span className="skeleton h-[264px] w-full rounded-xl" />
            ) : metric === "volume" ? (
              <BarChart values={bars} labels={barLabels} format={money} height={240} onHover={(i) => setHover(i ?? -1)} />
            ) : (
              <AreaChart points={pricePoints} from={priceFrom} to={now} format={perEth} height={240} onHover={setHoverPrice} empty="No trades in this window." />
            )}
          </div>
        </section>

        <section className="card min-w-0 p-5 sm:p-6">
          <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Stats</h2>
          <p className="mt-5 text-[13px] text-muted">Pool balances</p>
          <div className="num mt-2 flex justify-between gap-3 text-sm font-medium">
            <span>{fmt(wethBal, 4)} ETH</span>
            <span>
              {compactCount(Number(tokenBal) / 1e18)} {coin.symbol}
            </span>
          </div>
          <div className="mt-2.5 flex h-2 gap-0.5">
            <span className="rounded-full bg-indigo" style={{ width: `${ethShare}%` }} />
            <span className="flex-1 rounded-full bg-gold" />
          </div>
          <dl className="mt-6 grid gap-5">
            <Big label="Fee APR" value={`${apr.toFixed(2)}%`} tone="text-ok" />
            <Big label="TVL" value={money(tvlUsd)} />
            <Big label="24h volume" value={money(dayVol)} />
            <Big label="24h fees" value={money(fees)} />
          </dl>
        </section>
      </div>

      <section className="card mt-5 overflow-hidden">
        <h2 className="px-5 pt-5 pb-3.5 text-[17px] font-semibold tracking-[-0.01em] sm:px-6">Recent swaps</h2>
        {!swaps ? (
          <div className="space-y-3 px-6 pb-6">
            {Array.from({ length: 4 }, (_, i) => (
              <span key={i} className="skeleton h-5 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <Empty mark="첫 거래" title="No swaps in the last day" />
        ) : (
          <>
            <div className={`${SWAP_GRID} th border-y border-line py-2.5`}>
              <span>Time</span>
              <span>Type</span>
              <span className="text-right">ETH</span>
              <span className="text-right">{coin.symbol}</span>
              <span className="hidden text-right sm:block">Wallet</span>
            </div>
            {rows
              .slice(-10)
              .reverse()
              .map((swap) => (
                <a key={`${swap.tx}:${swap.index ?? 0}`} href={`${explorer}/tx/${swap.tx}`} target="_blank" rel="noreferrer" className={`${SWAP_GRID} row-hover num border-b border-line/70 py-3 text-sm last:border-0`}>
                  <span className="text-muted">{ago(now - swap.time)}</span>
                  <span className={`font-semibold ${swap.buy ? "text-ok" : "text-down"}`}>{swap.buy ? "Buy" : "Sell"}</span>
                  <span className="text-right">{ethText(Number(swap.ethAmount) / 1e18)}</span>
                  <span className="truncate text-right">{compactCount(Number(swap.tokenAmount) / 1e18)}</span>
                  <span className="hidden items-center justify-end gap-2 text-muted sm:flex">
                    <Blockie address={swap.recipient} size={16} />
                    {shortAddr(swap.recipient)}
                  </span>
                </a>
              ))}
          </>
        )}
      </section>
    </main>
  );
}

const SWAP_GRID = "grid items-center gap-3 px-5 sm:px-6 grid-cols-[2.75rem_2.75rem_minmax(0,1fr)_minmax(0,1fr)] sm:grid-cols-[4rem_3.5rem_minmax(0,1fr)_minmax(0,1fr)_9rem]";

function Big({ label, value, tone = "" }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div>
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className={`num mt-1 text-[26px] leading-none font-semibold tracking-[-0.03em] ${tone}`}>{value}</dd>
    </div>
  );
}
