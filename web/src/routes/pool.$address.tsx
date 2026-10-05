import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { type Address } from "viem";
import { erc20Abi } from "@/lib/chimi/chain";
import { publicClient } from "@/lib/chimi/client";
import { fmt, loadCoin, loadSwaps, shortAddr, wethPerToken, type Coin, type PoolSwap } from "@/lib/chimi/market";
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
  const day = swaps.filter((swap) => now - swap.time <= 86400);
  const volUsd = ethUsd ? day.reduce((sum, swap) => sum + (Number(swap.ethAmount) / 1e18) * ethUsd, 0) : 0;
  const apr = tvlUsd > 0 ? ((volUsd * 0.01) / tvlUsd) * 365 * 100 : 0;
  const hours = Array.from({ length: 12 }, (_, i) => {
    const start = now - (12 - i) * 3600;
    return day.filter((swap) => swap.time >= start && swap.time < start + 3600).reduce((sum, swap) => sum + (Number(swap.ethAmount) / 1e18) * (ethUsd ?? 0), 0);
  });
  const maxBar = Math.max(...hours, 1);

  return (
    <main className="mx-auto max-w-[1180px] px-4 py-8 sm:px-6">
      <Link to="/pools" className="text-sm text-muted">Pools</Link>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-semibold tracking-[-0.03em]">{coin.symbol} / ETH</h1>
          <p className="mt-2 text-sm text-muted">v3 · 1% · {shortAddr(coin.pool)}</p>
        </div>
        <div className="flex gap-2">
          <Link to="/coin/$address" params={{ address: coin.token }} className="rounded-full border border-line px-4 py-2 text-sm font-semibold">Swap</Link>
          <a href="#new" className="rounded-full bg-seal px-4 py-2 text-sm font-semibold text-onseal">New position</a>
        </div>
      </div>

      <div className="mt-6 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="rounded-3xl border border-line bg-chip p-5">
          <h2 className="text-base font-semibold">Volume</h2>
          <p className="mt-4 text-3xl font-semibold">{money(volUsd)}</p>
          <p className="text-sm text-muted">Past day</p>
          <div className="mt-6 flex h-40 items-end gap-1">
            {hours.map((value, i) => (
              <span key={i} className="flex-1 rounded-t bg-gold" style={{ height: `${Math.max(2, (value / maxBar) * 100)}%` }} />
            ))}
          </div>
        </section>
        <section className="rounded-3xl border border-line bg-chip p-5">
          <h2 className="text-lg font-semibold">Stats</h2>
          <p className="mt-4 text-sm text-muted">Pool balances</p>
          <p className="mt-1 text-sm">{fmt(wethBal, 4)} ETH · {fmt(tokenBal, 2)} {coin.symbol}</p>
          <p className="mt-4 text-sm text-muted">Fee APR</p>
          <p className="text-3xl font-semibold">{apr.toFixed(2)}%</p>
          <p className="mt-4 text-sm text-muted">TVL</p>
          <p className="text-2xl font-semibold">{money(tvlUsd)}</p>
          <p className="mt-4 text-sm text-muted">24h volume</p>
          <p className="text-2xl font-semibold">{money(volUsd)}</p>
        </section>
      </div>

      <PositionDesk
        coin={coin}
        deployment={deployment}
        account={account}
        connect={connect}
        swaps={swaps}
        onChanged={() => setReload((n) => n + 1)}
      />
    </main>
  );
}
