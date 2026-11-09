import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { compactUsd, ethText } from "@/lib/chimi/format";
import { useEthUsd } from "@/lib/chimi/live";
import { loadLaunchWindow, loadSwapWindow, type Coin, type Launch, type PoolSwap } from "@/lib/chimi/market";
import { useTokenImages } from "@/lib/chimi/token-image";
import { BarChart } from "@/components/chimi/charts";
import { useChimi } from "@/components/chimi/provider";
import { TokenLogo } from "@/components/chimi/token-logo";
import { Empty, PageHead } from "@/components/chimi/ui";

export const Route = createFileRoute("/analytics")({
  head: () => ({ meta: [{ title: "Analytics · Chimi" }] }),
  component: AnalyticsPage,
});

const DAYS = 14;
const DAY = 86_400;

function dayKey(unix: number) {
  return new Date(unix * 1000).toISOString().slice(0, 10);
}

function recentDays() {
  const days: string[] = [];
  const now = new Date();
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

function labelDay(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

type PoolHistory = { coin: Coin; swaps: PoolSwap[] };

function AnalyticsPage() {
  const { coins, deployment, preview, loading: booting } = useChimi();
  const live = useMemo(() => coins.filter((coin) => !coin.preview), [coins]);
  const ethUsd = useEthUsd();
  const images = useTokenImages(useMemo(() => live.map((coin) => coin.token), [live]));
  const [launches, setLaunches] = useState<Launch[]>([]);
  const [history, setHistory] = useState<PoolHistory[]>([]);
  /** Unix time both lists are complete from; later than 14 days ago when the explorer couldn't be reached. */
  const [coveredFrom, setCoveredFrom] = useState<number>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (booting) return;
    if (!deployment || preview || live.length === 0) {
      setLoading(false);
      return;
    }
    let cancel = false;
    setLoading(true);
    void (async () => {
      const [created, rows] = await Promise.all([
        loadLaunchWindow(deployment.factory, DAYS * DAY),
        Promise.all(live.map(async (coin) => ({ coin, window: await loadSwapWindow(coin.pool, coin.tokenIs0, DAYS * DAY) }))),
      ]);
      if (cancel) return;
      setLaunches(created.launches);
      setHistory(rows.map((row) => ({ coin: row.coin, swaps: row.window.swaps })));
      setCoveredFrom(Math.max(created.coveredFrom, ...rows.map((row) => row.window.coveredFrom)));
      setLoading(false);
    })().catch(() => {
      if (!cancel) setLoading(false);
    });
    return () => {
      cancel = true;
    };
  }, [deployment, preview, live, booting]);

  const days = useMemo(recentDays, []);
  const labels = days.map(labelDay);
  const now = Math.floor(Date.now() / 1000);
  const cash = (eth: number) => (ethUsd ? compactUsd(eth * ethUsd) : `${ethText(eth)} ETH`);

  const { volumes, counts, tradeCounts, total, dayVolume, trades, traders, top } = useMemo(() => {
    const volumeByDay = new Map(days.map((day) => [day, 0]));
    const tradesByDay = new Map(days.map((day) => [day, 0]));
    const launchesByDay = new Map(days.map((day) => [day, 0]));
    const wallets = new Set<string>();
    let total = 0;
    let dayVolume = 0;
    let trades = 0;
    const perCoin: { coin: Coin; eth: number; trades: number }[] = [];
    for (const { coin, swaps } of history) {
      let coinEth = 0;
      for (const swap of swaps) {
        const eth = Number(swap.ethAmount) / 1e18;
        const key = dayKey(swap.time);
        if (!volumeByDay.has(key)) continue;
        volumeByDay.set(key, (volumeByDay.get(key) ?? 0) + eth);
        tradesByDay.set(key, (tradesByDay.get(key) ?? 0) + 1);
        wallets.add(swap.recipient.toLowerCase());
        total += eth;
        coinEth += eth;
        trades++;
        if (now - swap.time <= DAY) dayVolume += eth;
      }
      perCoin.push({ coin, eth: coinEth, trades: swaps.length });
    }
    for (const launch of launches) {
      const key = dayKey(launch.time);
      if (launchesByDay.has(key)) launchesByDay.set(key, (launchesByDay.get(key) ?? 0) + 1);
    }
    return {
      volumes: days.map((day) => volumeByDay.get(day) ?? 0),
      tradeCounts: days.map((day) => tradesByDay.get(day) ?? 0),
      counts: days.map((day) => launchesByDay.get(day) ?? 0),
      total,
      dayVolume,
      trades,
      traders: wallets.size,
      top: perCoin.sort((a, b) => b.eth - a.eth).slice(0, 6),
    };
    // `now` only decides which trades count as the last day; it doesn't need to re-run this.
  }, [history, launches, days]);

  const partial = coveredFrom !== undefined && coveredFrom > now - DAYS * DAY + 3600;
  const topMax = Math.max(...top.map((t) => t.eth), 0);

  return (
    <main className="page pt-4 pb-16">
      <PageHead eyebrow="GIWA Sepolia" title="Analytics">
        Volume, trades and launches across every Chimi pool over the last {DAYS} days, read from the chain.
      </PageHead>

      {partial ? (
        <p className="mt-6 rounded-xl border border-gold/25 bg-gold/8 px-4 py-3 text-sm">
          The explorer couldn’t be reached, so these numbers only cover trades since{" "}
          {new Date(coveredFrom * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}. The node itself only keeps about a day of logs.
        </p>
      ) : null}

      <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile label={`${DAYS}-day volume`} value={cash(total)} sub={`${trades.toLocaleString("en-US")} trades`} wait={loading} />
        <Tile label="24h volume" value={cash(dayVolume)} sub="Across every pool" wait={loading} />
        <Tile label="Coins launched" value={booting ? "—" : live.length.toLocaleString("en-US")} sub={`${counts.reduce((a, b) => a + b, 0)} in the last ${DAYS} days`} wait={booting} />
        <Tile label="Traders" value={traders.toLocaleString("en-US")} sub={`Wallets that traded in ${DAYS} days`} wait={loading} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <ChartCard title="Daily volume" note={ethUsd ? "USD at today’s ETH price" : "ETH"}>
          {loading ? <span className="skeleton h-[264px] w-full rounded-xl" /> : <BarChart values={volumes} labels={labels} format={cash} />}
        </ChartCard>
        <ChartCard title="Trades per day" note="Buys and sells">
          {loading ? <span className="skeleton h-[264px] w-full rounded-xl" /> : <BarChart values={tradeCounts} labels={labels} format={(n) => Math.round(n).toLocaleString("en-US")} tone="up" />}
        </ChartCard>
        <ChartCard title="Coins launched per day" note="UTC days">
          {loading ? <span className="skeleton h-[264px] w-full rounded-xl" /> : <BarChart values={counts} labels={labels} format={(n) => Math.round(n).toLocaleString("en-US")} />}
        </ChartCard>
        <ChartCard title="Most traded" note={`${DAYS}-day volume`}>
          {loading ? (
            <span className="skeleton h-[264px] w-full rounded-xl" />
          ) : top.length === 0 || topMax === 0 ? (
            <Empty mark="첫 거래" title="No trades yet">
              The busiest coins show up here once people start trading.
            </Empty>
          ) : (
            <ol className="grid gap-1">
              {top.map((row, i) => (
                <li key={row.coin.token}>
                  <Link to="/coin/$address" params={{ address: row.coin.token }} className="row-hover -mx-2 flex items-center gap-3 rounded-xl px-2 py-2">
                    <span className="num w-4 text-sm text-faint">{i + 1}</span>
                    <TokenLogo symbol={row.coin.symbol} image={images[row.coin.token.toLowerCase()]} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-sm font-semibold">{row.coin.name}</span>
                        <span className="num text-sm font-medium">{cash(row.eth)}</span>
                      </span>
                      <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-raise2">
                        <span className="block h-full rounded-full bg-gold" style={{ width: `${Math.max(2, (row.eth / topMax) * 100)}%` }} />
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </ChartCard>
      </div>
    </main>
  );
}

function Tile({ label, value, sub, wait }: { label: string; value: ReactNode; sub: string; wait?: boolean }) {
  return (
    <div className="card p-5">
      <p className="text-[13px] text-muted">{label}</p>
      <p className="num mt-2 truncate text-[28px] leading-none font-semibold tracking-[-0.03em] sm:text-[32px]">{wait ? <span className="skeleton h-8 w-28" /> : value}</p>
      <p className="mt-2 truncate text-xs text-faint">{sub}</p>
    </div>
  );
}

function ChartCard({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="card min-w-0 p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[17px] font-semibold tracking-[-0.01em]">{title}</h2>
        {note ? <span className="text-xs text-faint">{note}</span> : null}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}
