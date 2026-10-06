import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { createWalletClient, custom, encodeFunctionData, type Address, type EIP1193Provider } from "viem";
import { erc20Abi, giwaSepolia, positionManagerAbi } from "@/lib/chimi/chain";
import { publicClient } from "@/lib/chimi/client";
import { loadSwaps, shortAddr, wethPerToken, type Coin } from "@/lib/chimi/market";
import { readTokenMeta } from "@/lib/chimi/meta";
import { tickFromSqrtPriceX96 } from "@/lib/chimi/range";
import { PairMark } from "@/components/chimi/pair-mark";
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
  tickLower: number;
  tickUpper: number;
  owed0: bigint;
  owed1: bigint;
  token0: Address;
  token1: Address;
};

type SortKey = "tvl" | "vol" | "ratio" | "apr";

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
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("tvl");
  const [images, setImages] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

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
        next.push({
          id,
          coin,
          liquidity: pos[7],
          tickLower: Number(pos[5]),
          tickUpper: Number(pos[6]),
          owed0: pos[10],
          owed1: pos[11],
          token0: pos[2],
          token1: pos[3],
        });
      }
      if (!cancel) setPositions(next);
    })().catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [deployment, account, coins]);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const coin of coins) {
      const image = readTokenMeta(coin.token)?.image;
      if (image) next[coin.token.toLowerCase()] = image;
    }
    setImages(next);
  }, [coins]);

  const rowByToken = useMemo(() => new Map(rows.map((row) => [row.coin.token.toLowerCase(), row])), [rows]);
  const held = positions.filter((position) => position.coin);
  const feeUsd = held.reduce((sum, position) => sum + feeValue(position, rowByToken.get(position.coin!.token.toLowerCase()), ethUsd), 0);
  const liqUsd = held.reduce((sum, position) => sum + liquidityValue(position, rowByToken.get(position.coin!.token.toLowerCase())), 0);
  const filtered = [...rows]
    .filter((row) => {
      const q = query.trim().toLowerCase();
      return !q || row.coin.symbol.toLowerCase().includes(q) || row.coin.name.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      if (sort === "ratio") return (b.tvlUsd > 0 ? b.volUsd / b.tvlUsd : 0) - (a.tvlUsd > 0 ? a.volUsd / a.tvlUsd : 0);
      if (sort === "vol") return b.volUsd - a.volUsd;
      if (sort === "apr") return b.apr - a.apr;
      return b.tvlUsd - a.tvlUsd;
    });
  const first = filtered[0] ?? rows[0];

  async function collectAll() {
    if (!account || !deployment) return;
    const due = held.filter((position) => position.owed0 > 0n || position.owed1 > 0n);
    if (due.length === 0) return;
    const ethereum = (window as Window & { ethereum?: EIP1193Provider }).ethereum;
    if (!ethereum) {
      setNote("No wallet found in this browser.");
      return;
    }
    const wallet = createWalletClient({ account, chain: giwaSepolia, transport: custom(ethereum) });
    try {
      setBusy(true);
      for (const position of due) {
        const calls = [
          encodeFunctionData({
            abi: positionManagerAbi,
            functionName: "collect",
            args: [{ tokenId: position.id, recipient: deployment.positionManager, amount0Max: 2n ** 128n - 1n, amount1Max: 2n ** 128n - 1n }],
          }),
          encodeFunctionData({ abi: positionManagerAbi, functionName: "unwrapWETH9", args: [0n, account] }),
          encodeFunctionData({ abi: positionManagerAbi, functionName: "sweepToken", args: [position.coin!.token, 0n, account] }),
        ];
        const hash = await wallet.writeContract({
          account,
          chain: giwaSepolia,
          address: deployment.positionManager,
          abi: positionManagerAbi,
          functionName: "multicall",
          args: [calls],
        });
        await publicClient.waitForTransactionReceipt({ hash });
      }
      setNote("Fees collected.");
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not collect fees.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-[1180px] px-4 pt-14 pb-24 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-xl">
          <p className="text-[13px] font-semibold tracking-[0.14em] text-gold">YOUR DEX</p>
          <h1 className="mt-2 text-[clamp(36px,5vw,56px)] leading-none font-semibold tracking-[-0.04em]">Supply liquidity to collect fees</h1>
          <p className="mt-3.5 text-[17px] text-muted">Add a position on a Chimi pool and earn a share of the 1% swap fee. Launch liquidity stays locked.</p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {first ? (
            <Link to="/pool/$address" params={{ address: first.coin.token }} hash="new" className="flex items-center gap-2 rounded-full bg-seal px-5 py-3 text-[15px] font-semibold text-onseal shadow-[inset_0_1px_0_rgba(255,255,255,.22),0_10px_30px_rgba(210,74,46,.3)]">
              + New position
            </Link>
          ) : null}
          <Link to="/launch" className="rounded-full border border-line bg-chip/60 px-5 py-3 text-[15px] font-medium">Launch token</Link>
        </div>
      </div>

      <div className="mt-10 grid gap-3.5 sm:grid-cols-3">
        <Metric label="Total liquidity" value={account ? money(liqUsd) : "$0.00"} dim={!account} />
        <div className="rounded-3xl border border-line bg-chip/85 px-6 py-5 shadow-[inset_0_1px_0_rgba(255,255,255,.04)]">
          <div className="flex h-7 items-center justify-between text-sm text-muted">
            <span>Unclaimed fees</span>
            <button type="button" disabled={!account || feeUsd <= 0 || busy} onClick={() => void collectAll()} className="rounded-full bg-fg/9 px-3.5 py-1.5 text-[13px] text-fg disabled:opacity-45">
              {busy ? "Collecting…" : "Collect"}
            </button>
          </div>
          <div className={`mt-3.5 text-[40px] leading-none font-semibold tracking-[-0.035em] tabular-nums ${account ? "" : "text-[#7d6f5a]"}`}>{account ? money(feeUsd) : "$0.00"}</div>
        </div>
        <Metric label="Open positions" value={String(held.length)} dim={!account} />
      </div>

      {held.length === 0 ? (
        <div className="relative mt-3.5 overflow-hidden rounded-[28px] border border-gold/20 bg-[#1e1712] px-6 py-14 text-center">
          <img src="/seal.jpg" alt="" className="absolute -bottom-10 -left-8 size-[150px] rotate-[-14deg] rounded-full object-cover opacity-15" />
          <div className="relative flex flex-col items-center">
            <h3 className="text-[26px] font-semibold tracking-[-0.025em]">No positions</h3>
            <p className="mt-2 max-w-md text-[15px] text-muted">
              {account ? "You don’t have any liquidity positions. Add one to a Chimi pool to start earning the 1% swap fee." : "Connect a wallet to see positions you can collect from."}
            </p>
            {account ? null : (
              <button type="button" onClick={() => void connect()} className="mt-5 rounded-full border border-line bg-chip px-5 py-2.5 text-sm font-medium">Connect wallet</button>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-3.5 grid gap-2.5">
          {held.map((position) => {
            const coin = position.coin!;
            const row = rowByToken.get(coin.token.toLowerCase());
            const tick = tickFromSqrtPriceX96(coin.sqrtPriceX96);
            const inside = tick >= position.tickLower && tick < position.tickUpper;
            return (
              <div key={position.id.toString()} className="flex flex-wrap items-center gap-5 rounded-3xl border border-line bg-chip/85 px-6 py-5">
                <PairMark symbol={coin.symbol} image={images[coin.token.toLowerCase()]} />
                <div className="min-w-0 flex-[1_1_180px]">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="text-lg font-semibold">{coin.symbol} / ETH</span>
                    <span className="rounded-md bg-fg/7 px-2 py-0.5 text-xs text-muted">v3 · 1%</span>
                    <span className={`flex items-center gap-1.5 text-[13px] ${inside ? "text-ok" : "text-muted"}`}><span className={`size-1.5 rounded-full ${inside ? "bg-ok" : "bg-muted"}`} />{inside ? "In range" : "Out of range"}</span>
                  </div>
                  <div className="mt-1 text-[13px] text-muted">Position #{position.id.toString()}</div>
                </div>
                <div className="flex gap-7">
                  <div><div className="text-xs text-muted">Value</div><div className="text-[17px] font-semibold tabular-nums">{money(liquidityValue(position, row))}</div></div>
                  <div><div className="text-xs text-muted">Fees</div><div className="text-[17px] font-semibold text-gold tabular-nums">{money(feeValue(position, row, ethUsd))}</div></div>
                </div>
                <Link to="/pool/$address" params={{ address: coin.token }} hash="new" className="rounded-full bg-seal px-4 py-2.5 text-sm font-semibold text-onseal">Manage</Link>
              </div>
            );
          })}
        </div>
      )}
      {note ? <p className="mt-3 text-sm text-muted">{note}</p> : null}

      <div className="mt-14 flex flex-wrap items-end justify-between gap-4">
        <h2 className="text-[28px] font-semibold tracking-[-0.03em]">Top pools</h2>
        <label className="flex w-[260px] max-w-full items-center gap-2.5 rounded-xl border border-line bg-chip px-3.5 py-2">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search pools" aria-label="Search pools" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
        </label>
      </div>
      <div className="mt-4 overflow-x-auto rounded-3xl border border-line bg-chip/85">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-[3rem_minmax(0,1fr)_7.5rem_7.5rem_7.5rem_6.5rem] items-center gap-3 border-b border-line bg-fg/3 px-6 py-3.5 text-[13px] text-muted">
            <span>#</span><span>Pool</span>
            {([["tvl", "TVL"], ["vol", "1D vol"], ["ratio", "1D vol/TVL"], ["apr", "Fee APR"]] as const).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setSort(key)} className={`justify-self-end text-[13px] ${sort === key ? "font-semibold text-fg" : ""}`}>{sort === key ? "↓ " : ""}{label}</button>
            ))}
          </div>
          {filtered.map((row, i) => (
            <Link key={row.coin.token} to="/pool/$address" params={{ address: row.coin.token }} className="grid grid-cols-[3rem_minmax(0,1fr)_7.5rem_7.5rem_7.5rem_6.5rem] items-center gap-3 border-b border-line/55 px-6 py-4 text-[15px]">
              <span className="text-muted tabular-nums">{i + 1}</span>
              <span className="flex min-w-0 items-center gap-3.5">
                <PairMark symbol={row.coin.symbol} image={images[row.coin.token.toLowerCase()]} size={40} />
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{row.coin.symbol} / ETH</span>
                  <span className="block truncate text-[13px] text-muted">v3 · 1% · {shortAddr(row.coin.pool)}</span>
                </span>
              </span>
              <span className="text-right font-medium tabular-nums">{money(row.tvlUsd)}</span>
              <span className="text-right tabular-nums">{money(row.volUsd)}</span>
              <span className="text-right text-muted tabular-nums">{row.tvlUsd > 0 ? (row.volUsd / row.tvlUsd).toFixed(3) : "—"}</span>
              <span className="text-right font-medium text-ok tabular-nums">{row.apr.toFixed(2)}%</span>
            </Link>
          ))}
          {filtered.length === 0 ? <p className="px-6 py-10 text-center text-[15px] text-muted">{query ? `No pool matches “${query}”.` : "No Chimi pools yet."}</p> : null}
        </div>
      </div>
    </main>
  );
}

function Metric({ label, value, dim }: { label: string; value: string; dim?: boolean }) {
  return (
    <div className="rounded-3xl border border-line bg-chip/85 px-6 py-5 shadow-[inset_0_1px_0_rgba(255,255,255,.04)]">
      <div className="flex h-7 items-center text-sm text-muted">{label}</div>
      <div className={`mt-3.5 text-[40px] leading-none font-semibold tracking-[-0.035em] tabular-nums ${dim ? "text-[#7d6f5a]" : ""}`}>{value}</div>
    </div>
  );
}

function feeValue(position: Position, row: Row | undefined, ethUsd?: number) {
  if (!row || !ethUsd || !position.coin) return 0;
  const wethIs0 = position.token0.toLowerCase() !== position.coin.token.toLowerCase();
  const eth = Number(wethIs0 ? position.owed0 : position.owed1) / 1e18;
  const token = Number(wethIs0 ? position.owed1 : position.owed0) / 1e18;
  const price = Number(wethPerToken(position.coin.sqrtPriceX96, position.coin.tokenIs0)) / 1e18;
  return eth * ethUsd + token * price * ethUsd;
}

function liquidityValue(position: Position, row: Row | undefined) {
  if (!row || !position.coin || position.coin.liquidity === 0n || position.liquidity === 0n) return 0;
  const tick = tickFromSqrtPriceX96(position.coin.sqrtPriceX96);
  if (tick < position.tickLower || tick >= position.tickUpper) return 0;
  const share = Number((position.liquidity * 1_000_000n) / position.coin.liquidity) / 1_000_000;
  return share * row.tvlUsd;
}
