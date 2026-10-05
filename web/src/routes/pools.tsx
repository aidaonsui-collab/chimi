import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { erc20Abi, FULL_RANGE, positionManagerAbi } from "@/lib/chimi/chain";
import { publicClient } from "@/lib/chimi/client";
import { fmt, loadSwaps, shortAddr, wethPerToken, type Coin } from "@/lib/chimi/market";
import { useChimi } from "@/components/chimi/provider";

export const Route = createFileRoute("/pools")({ component: PoolsPage });

type Row = {
  coin: Coin;
  tvlUsd: number;
  volUsd: number;
  apr: number;
};

type Position = {
  id: bigint;
  coin?: Coin;
  liquidity: bigint;
  owed0: bigint;
  owed1: bigint;
};

function money(n: number) {
  if (!Number.isFinite(n) || n <= 0) return "$0.00";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `$${Math.round(n).toLocaleString("en-US")}`;
  return `$${n.toFixed(2)}`;
}

function PoolsPage() {
  const { coins, deployment, account, connect } = useChimi();
  const live = coins.filter((coin) => !coin.preview);
  const [ethUsd, setEthUsd] = useState<number>();
  const [rows, setRows] = useState<Row[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);

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
    const listed = coins.filter((coin) => !coin.preview);
    if (!deployment || !ethUsd || listed.length === 0) return;
    let cancel = false;
    void Promise.all(
      listed.map(async (coin) => {
        const [weth, token, swaps] = await Promise.all([
          publicClient.readContract({ address: deployment.weth, abi: erc20Abi, functionName: "balanceOf", args: [coin.pool] }),
          publicClient.readContract({ address: coin.token, abi: erc20Abi, functionName: "balanceOf", args: [coin.pool] }),
          loadSwaps(coin.pool, coin.tokenIs0),
        ]);
        const price = Number(wethPerToken(coin.sqrtPriceX96, coin.tokenIs0)) / 1e18;
        const tvlUsd = (Number(weth) / 1e18) * ethUsd + (Number(token) / 1e18) * price * ethUsd;
        const now = Math.floor(Date.now() / 1000);
        const volEth = swaps.filter((swap) => now - swap.time <= 86400).reduce((sum, swap) => sum + Number(swap.ethAmount) / 1e18, 0);
        const volUsd = volEth * ethUsd;
        const apr = tvlUsd > 0 ? ((volUsd * 0.01) / tvlUsd) * 365 * 100 : 0;
        return { coin, tvlUsd, volUsd, apr };
      }),
    )
      .then((next) => {
        if (!cancel) setRows(next.sort((a, b) => b.tvlUsd - a.tvlUsd));
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [deployment, ethUsd, coins]);

  useEffect(() => {
    if (!deployment || !account) {
      setPositions([]);
      return;
    }
    let cancel = false;
    void (async () => {
      const count = await publicClient.readContract({
        address: deployment.positionManager,
        abi: positionManagerAbi,
        functionName: "balanceOf",
        args: [account],
      });
      const next: Position[] = [];
      for (let i = 0n; i < count; i++) {
        const id = await publicClient.readContract({
          address: deployment.positionManager,
          abi: positionManagerAbi,
          functionName: "tokenOfOwnerByIndex",
          args: [account, i],
        });
        const pos = await publicClient.readContract({
          address: deployment.positionManager,
          abi: positionManagerAbi,
          functionName: "positions",
          args: [id],
        });
        const token0 = pos[2];
        const token1 = pos[3];
        const coin = coins.find((item) => !item.preview && (item.token.toLowerCase() === token0.toLowerCase() || item.token.toLowerCase() === token1.toLowerCase()));
        next.push({ id, coin, liquidity: pos[7], owed0: pos[10], owed1: pos[11] });
      }
      if (!cancel) setPositions(next);
    })().catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [deployment, account, coins]);

  return (
    <main className="mx-auto max-w-[1180px] px-4 py-8 sm:px-6">
      <p className="text-[13px] font-semibold tracking-[0.14em] text-gold">YOUR DEX</p>
      <h1 className="mt-1.5 text-[44px] leading-none font-semibold tracking-[-0.035em]">Supply liquidity to collect fees</h1>
      <p className="mt-3 max-w-xl text-sm text-muted">Add a position on a Chimi pool and earn a share of the 1% swap fee. Launch liquidity stays locked.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link to="/pools" className="rounded-full bg-seal px-4 py-2.5 text-sm font-semibold text-onseal">Your positions</Link>
        <Link to="/launch" className="rounded-full border border-line px-4 py-2.5 text-sm font-semibold">Launch token</Link>
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Your positions</h2>
        {!account ? (
          <button type="button" onClick={() => void connect()} className="mt-4 rounded-3xl border border-line bg-chip px-6 py-10 text-sm text-muted">
            Connect a wallet to see positions you can collect from.
          </button>
        ) : positions.length === 0 ? (
          <p className="mt-4 rounded-3xl border border-line bg-chip px-6 py-10 text-sm text-muted">No liquidity positions in this wallet yet.</p>
        ) : (
          <div className="mt-4 grid gap-3">
            {positions.map((position) => (
              <div key={position.id.toString()} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-chip px-4 py-3">
                <div>
                  <p className="font-medium">{position.coin ? `${position.coin.symbol}/ETH` : `Position ${position.id.toString()}`}</p>
                  <p className="text-xs text-muted">Liquidity {position.liquidity.toString()} · owed {position.owed0.toString()} / {position.owed1.toString()}</p>
                </div>
                {position.coin ? (
                  <Link to="/pool/$address" params={{ address: position.coin.token }} className="rounded-full bg-seal px-4 py-2 text-sm font-semibold text-onseal">
                    Manage
                  </Link>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Top pools</h2>
        <div className="mt-4 overflow-hidden rounded-3xl border border-line">
          <div className="grid grid-cols-[2rem_minmax(0,1fr)_6rem_6rem_5rem] gap-3 px-4 py-3 text-xs text-muted sm:grid-cols-[2rem_minmax(0,1fr)_7rem_7rem_6rem]">
            <span>#</span>
            <span>Pool</span>
            <span className="text-right">TVL</span>
            <span className="text-right">1D vol</span>
            <span className="text-right">Fee APR</span>
          </div>
          {rows.map((row, i) => (
            <Link
              key={row.coin.token}
              to="/pool/$address"
              params={{ address: row.coin.token }}
              className="grid grid-cols-[2rem_minmax(0,1fr)_6rem_6rem_5rem] items-center gap-3 border-t border-line px-4 py-3 text-sm sm:grid-cols-[2rem_minmax(0,1fr)_7rem_7rem_6rem]"
            >
              <span className="text-muted">{i + 1}</span>
              <span>
                <span className="font-medium">{row.coin.symbol}/ETH</span>
                <span className="mt-0.5 block text-xs text-muted">v3 · 1% · {shortAddr(row.coin.pool)}</span>
              </span>
              <span className="text-right tabular-nums">{money(row.tvlUsd)}</span>
              <span className="text-right tabular-nums">{money(row.volUsd)}</span>
              <span className="text-right tabular-nums">{row.apr.toFixed(2)}%</span>
            </Link>
          ))}
          {rows.length === 0 ? <p className="border-t border-line px-4 py-8 text-sm text-muted">No Chimi pools yet.</p> : null}
        </div>
      </section>
    </main>
  );
}
