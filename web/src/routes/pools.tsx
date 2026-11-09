import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createWalletClient, custom, encodeFunctionData, type Address, type EIP1193Provider } from "viem";
import { erc20Abi, giwaSepolia, positionManagerAbi } from "@/lib/chimi/chain";
import { publicClient } from "@/lib/chimi/client";
import { feeLabel, loadSwapWindow, wethPerToken, type Coin } from "@/lib/chimi/market";
import { compactUsd, pct } from "@/lib/chimi/format";
import { useEthUsd } from "@/lib/chimi/live";
import { useTokenImages } from "@/lib/chimi/token-image";
import { POOL_FEE } from "@/lib/chimi/chain";
import { tickFromSqrtPriceX96 } from "@/lib/chimi/range";
import { IconArrowDown, IconChevronLeft, IconChevronRight, IconPlus, IconSearch } from "@/components/chimi/icons";
import { PairMark } from "@/components/chimi/pair-mark";
import { useChimi } from "@/components/chimi/provider";
import { toast } from "@/components/chimi/toast";
import { Empty, PageHead } from "@/components/chimi/ui";

export const Route = createFileRoute("/pools")({
  head: () => ({ meta: [{ title: "Pools · Chimi" }] }),
  component: PoolsPage,
});

type Row = {
  coin: Coin;
  /** undefined = not known (no ETH price or no swap history for that window). Never guessed. */
  tvlUsd?: number;
  vol1d?: number;
  vol30d?: number;
  ratio?: number;
  apr?: number;
  source: "explorer" | "rpc";
};

const DAY = 86_400;

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

type SortKey = "tvl" | "vol1d" | "vol30d" | "ratio" | "apr";

const COLUMNS: [SortKey, string][] = [
  ["tvl", "TVL"],
  ["vol1d", "1D vol"],
  ["vol30d", "30D vol"],
  ["ratio", "1D vol/TVL"],
  ["apr", "Pool APR"],
];

const sortValue = (row: Row, key: SortKey) =>
  key === "tvl" ? row.tvlUsd : key === "vol1d" ? row.vol1d : key === "vol30d" ? row.vol30d : key === "ratio" ? row.ratio : row.apr;

function money(n: number) {
  if (!Number.isFinite(n) || n <= 0) return "$0.00";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `$${Math.round(n).toLocaleString("en-US")}`;
  return `$${n.toFixed(2)}`;
}

function PoolsPage() {
  const { coins, deployment, account, connect, ensureChain, loading } = useChimi();
  const live = coins.filter((coin) => !coin.preview);
  const ethUsd = useEthUsd();
  const [rows, setRows] = useState<Row[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("vol1d");
  const [desc, setDesc] = useState(true);
  const [loadingRows, setLoadingRows] = useState(true);
  const images = useTokenImages(useMemo(() => coins.map((coin) => coin.token), [coins]));
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const listed = coins.filter((coin) => !coin.preview);
    if (!deployment || listed.length === 0) {
      setLoadingRows(!deployment);
      return;
    }
    let cancel = false;
    setLoadingRows(true);
    void Promise.all(
      listed.map(async (coin): Promise<Row> => {
        const [weth, token, history] = await Promise.all([
          publicClient.readContract({ address: deployment.weth, abi: erc20Abi, functionName: "balanceOf", args: [coin.pool] }),
          publicClient.readContract({ address: coin.token, abi: erc20Abi, functionName: "balanceOf", args: [coin.pool] }),
          loadSwapWindow(coin.pool, coin.tokenIs0, 30 * DAY),
        ]);
        const now = Math.floor(Date.now() / 1000);
        const price = Number(wethPerToken(coin.sqrtPriceX96, coin.tokenIs0)) / 1e18;
        const ethIn = (since: number) =>
          history.swaps.filter((swap) => swap.time >= since).reduce((sum, swap) => sum + Number(swap.ethAmount) / 1e18, 0);
        const covered = (seconds: number) => history.coveredFrom <= now - seconds + 60;
        if (!ethUsd) return { coin, source: history.source };
        const tvlUsd = (Number(weth) / 1e18) * ethUsd + (Number(token) / 1e18) * price * ethUsd;
        const vol1d = covered(DAY) ? ethIn(now - DAY) * ethUsd : undefined;
        const vol30d = covered(30 * DAY) ? ethIn(now - 30 * DAY) * ethUsd : undefined;
        const feeRate = (coin.fee ?? POOL_FEE) / 1_000_000;
        const ratio = vol1d !== undefined && tvlUsd > 0 ? vol1d / tvlUsd : undefined;
        const apr = vol1d !== undefined && tvlUsd > 0 ? ((vol1d * feeRate * 365) / tvlUsd) * 100 : undefined;
        return { coin, tvlUsd, vol1d, vol30d, ratio, apr, source: history.source };
      }),
    )
      .then((next) => {
        if (!cancel) setRows(next);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancel) setLoadingRows(false);
      });
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
    const el = scroller.current;
    if (!el) return;
    const update = () => setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [rows.length]);

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
      const av = sortValue(a, sort);
      const bv = sortValue(b, sort);
      if (av === undefined && bv === undefined) return 0;
      if (av === undefined) return 1;
      if (bv === undefined) return -1;
      return desc ? bv - av : av - bv;
    });
  const missing30d = rows.some((row) => row.tvlUsd !== undefined && row.vol30d === undefined);
  const noPrice = rows.length > 0 && rows.every((row) => row.tvlUsd === undefined);

  function sortBy(key: SortKey) {
    if (key === sort) setDesc((v) => !v);
    else {
      setSort(key);
      setDesc(true);
    }
  }
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
      await ensureChain();
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
      toast({ kind: "good", title: "Fees collected", body: "They’re in your wallet as ETH and tokens." });
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not collect fees.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page pt-4 pb-16">
      <PageHead
        eyebrow="Liquidity"
        title="Supply liquidity, collect fees"
        actions={
          <>
            <Link to="/launch" className="btn btn-lg btn-secondary">
              Launch a coin
            </Link>
            {first ? (
              <Link to="/pool/$address" params={{ address: first.coin.token }} hash="new" className="btn btn-lg btn-primary">
                <IconPlus size={18} />
                New position
              </Link>
            ) : null}
          </>
        }
      >
        Add a position on a Chimi pool and earn a share of the 1% swap fee. The launch liquidity itself stays locked.
      </PageHead>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <Metric label="Your liquidity" value={account ? money(liqUsd) : "$0.00"} dim={!account} />
        <Metric
          label="Unclaimed fees"
          value={account ? money(feeUsd) : "$0.00"}
          dim={!account}
          gold={feeUsd > 0}
          action={
            <button type="button" disabled={!account || feeUsd <= 0 || busy} onClick={() => void collectAll()} className="btn btn-sm btn-secondary">
              {busy ? "Collecting…" : "Collect"}
            </button>
          }
        />
        <Metric label="Open positions" value={String(held.length)} dim={!account} />
      </div>

      {held.length === 0 ? (
        <div className="card relative mt-4 overflow-hidden">
          <div className="pointer-events-none absolute -bottom-24 -left-10 size-72 rounded-full bg-[radial-gradient(closest-side,rgba(227,184,102,.1),transparent)]" />
          <Empty
            mark="유동성"
            title="No positions yet"
            action={
              account ? null : (
                <button type="button" onClick={() => void connect().catch(() => undefined)} className="btn btn-secondary">
                  Connect wallet
                </button>
              )
            }
          >
            {account ? "You don’t have any liquidity positions. Add one to a Chimi pool to start earning the 1% swap fee." : "Connect a wallet to see positions you can collect from."}
          </Empty>
        </div>
      ) : (
        <div className="mt-4 grid gap-3">
          {held.map((position) => {
            const coin = position.coin!;
            const row = rowByToken.get(coin.token.toLowerCase());
            const tick = tickFromSqrtPriceX96(coin.sqrtPriceX96);
            const inside = tick >= position.tickLower && tick < position.tickUpper;
            return (
              <div key={position.id.toString()} className="card flex flex-wrap items-center gap-x-6 gap-y-4 p-4 sm:px-6 sm:py-5">
                <PairMark symbol={coin.symbol} image={images[coin.token.toLowerCase()]} />
                <div className="min-w-0 flex-[1_1_180px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[17px] font-semibold">{coin.symbol} / ETH</span>
                    <span className="chip h-6">v3 · {feeLabel(coin.fee)}</span>
                    <span className={`chip h-6 ${inside ? "border-ok/25 bg-ok/10 text-ok" : ""}`}>
                      <span className={`size-1.5 rounded-full ${inside ? "bg-ok" : "bg-muted"}`} />
                      {inside ? "In range" : "Out of range"}
                    </span>
                  </div>
                  <div className="num mt-1 text-[13px] text-muted">Position #{position.id.toString()}</div>
                </div>
                <div className="flex gap-8">
                  <div>
                    <div className="text-xs text-muted">Value</div>
                    <div className="num text-[17px] font-semibold">{money(liquidityValue(position, row))}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">Fees</div>
                    <div className="num text-[17px] font-semibold text-gold">{money(feeValue(position, row, ethUsd))}</div>
                  </div>
                </div>
                <Link to="/pool/$address" params={{ address: coin.token }} hash="new" className="btn btn-secondary">
                  Manage
                </Link>
              </div>
            );
          })}
        </div>
      )}
      {note ? <p className="mt-3 text-sm text-muted">{note}</p> : null}

      <div className="mt-12 flex flex-wrap items-end justify-between gap-4">
        <h2 className="text-[26px] leading-none font-semibold tracking-[-0.03em]">Top pools</h2>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <label className="field flex min-h-0 min-w-0 flex-1 items-center gap-2.5 bg-chip py-0 sm:w-[260px] sm:flex-none">
            <IconSearch size={16} className="shrink-0 text-faint" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search pools" aria-label="Search pools" className="h-[38px] min-w-0 flex-1 bg-transparent text-sm outline-none" />
          </label>
          {edges.left || edges.right ? (
            <div className="flex shrink-0 gap-1.5">
              {(["left", "right"] as const).map((dir) => (
                <button
                  key={dir}
                  type="button"
                  aria-label={dir === "left" ? "Scroll table left" : "Scroll table right"}
                  disabled={!edges[dir]}
                  onClick={() => scroller.current?.scrollBy({ left: dir === "left" ? -180 : 180, behavior: "smooth" })}
                  className="btn btn-icon btn-secondary"
                >
                  {dir === "left" ? <IconChevronLeft size={16} /> : <IconChevronRight size={16} />}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="card mt-4 overflow-hidden">
        <div ref={scroller} className="no-scrollbar overflow-x-auto overscroll-x-contain">
          <div className="min-w-max">
            <div className={`${POOL_GRID} th border-b border-line`}>
              <span className="hidden py-3 pl-5 sm:block">#</span>
              <span className={`${STICKY} bg-chip py-3 pl-4 sm:pl-2 ${edges.left ? STICKY_SHADOW : ""}`}>Pool</span>
              {COLUMNS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => sortBy(key)}
                  aria-sort={sort === key ? (desc ? "descending" : "ascending") : "none"}
                  className={`flex items-center justify-end gap-1 py-3 pr-4 text-right whitespace-nowrap transition-colors last:pr-5 hover:text-fg ${sort === key ? "font-semibold text-fg" : ""}`}
                >
                  {sort === key ? <IconArrowDown size={11} className={desc ? "" : "rotate-180"} /> : null}
                  {label}
                </button>
              ))}
            </div>
            {filtered.map((row, i) => (
              <Link key={row.coin.token} to="/pool/$address" params={{ address: row.coin.token }} className={`${POOL_GRID} group border-b border-line/70 text-[15px] last:border-0`}>
                <span className="num hidden py-4 pl-5 text-faint sm:block">{i + 1}</span>
                <span className={`${STICKY} flex items-center gap-3 bg-chip py-3.5 pl-4 transition-colors group-hover:bg-raise sm:pl-2 ${edges.left ? STICKY_SHADOW : ""}`}>
                  <PairMark symbol={row.coin.symbol} image={images[row.coin.token.toLowerCase()]} size={32} />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{row.coin.symbol}/ETH</span>
                    <span className="block truncate text-[13px] text-muted">v3 · {feeLabel(row.coin.fee)}</span>
                  </span>
                </span>
                <Cell value={compactUsd(row.tvlUsd)} strong />
                <Cell value={compactUsd(row.vol1d)} />
                <Cell value={compactUsd(row.vol30d)} />
                <Cell value={row.ratio === undefined ? "—" : row.ratio.toFixed(row.ratio < 0.1 ? 3 : 2)} muted />
                <Cell value={pct(row.apr)} tone={row.apr !== undefined && row.apr > 0 ? "text-ok" : undefined} last />
              </Link>
            ))}
            {filtered.length === 0 ? (
              (loading || loadingRows) && (loading || live.length > 0) ? (
                <div className="divide-y divide-line/70">
                  {Array.from({ length: 4 }, (_, i) => (
                    <div key={i} className="flex items-center gap-4 px-5 py-4">
                      <span className="skeleton size-8 rounded-full" />
                      <span className="skeleton h-4 w-32" />
                      <span className="skeleton ml-auto h-4 w-40" />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="px-6 py-12 text-center text-[15px] text-muted">{query ? `No pool matches “${query}”.` : "No Chimi pools yet."}</p>
              )
            ) : null}
          </div>
        </div>
      </div>
      <p className="mt-3 max-w-4xl text-xs leading-relaxed text-faint">
        TVL is each pool’s ETH and token reserves at the pool price. Volume is the ETH side of on-chain swaps, read from the GIWA explorer. Pool APR is 1D fees × 365 ÷ TVL at the pool’s fee tier.
        {noPrice ? " The ETH price didn’t load, so USD columns show —." : ""}
        {missing30d ? " The explorer couldn’t be reached, so 30D volume shows — (the chain RPC only returns about a day of swaps)." : ""}
      </p>
    </main>
  );
}

const POOL_GRID = "grid grid-cols-[minmax(11.5rem,1fr)_repeat(5,6.5rem)] items-center sm:grid-cols-[3rem_minmax(14rem,1fr)_repeat(5,7.25rem)] row-hover";
const STICKY = "sticky left-0 z-10 min-w-0 pr-3";
const STICKY_SHADOW = "shadow-[8px_0_12px_-8px_rgba(0,0,0,.6)]";

function Cell({ value, strong, muted, tone, last }: { value: string; strong?: boolean; muted?: boolean; tone?: string; last?: boolean }) {
  return <span className={`num py-4 pr-4 text-right whitespace-nowrap ${last ? "pr-5" : ""} ${strong ? "font-medium" : ""} ${muted ? "text-muted" : ""} ${tone ?? ""}`}>{value}</span>;
}

function Metric({ label, value, dim, gold, action }: { label: string; value: string; dim?: boolean; gold?: boolean; action?: ReactNode }) {
  return (
    <div className="card px-5 py-5 sm:px-6">
      <div className="flex h-8 items-center justify-between text-sm text-muted">
        <span>{label}</span>
        {action}
      </div>
      <div className={`num mt-3 text-[34px] leading-none font-semibold tracking-[-0.035em] ${dim ? "text-faint" : gold ? "text-gold" : ""}`}>{value}</div>
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
  return share * (row.tvlUsd ?? 0);
}
