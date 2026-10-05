import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { loadLaunches, loadSwaps, type Launch, type PoolSwap } from "@/lib/chimi/market";
import { useChimi } from "@/components/chimi/provider";

export const Route = createFileRoute("/analytics")({ component: AnalyticsPage });

const DAYS = 14;

function money(n: number) {
  if (!Number.isFinite(n) || n <= 0) return "$0.00";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `$${Math.round(n).toLocaleString("en-US")}`;
  return `$${n.toFixed(2)}`;
}

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

function AnalyticsPage() {
  const { coins, deployment, preview } = useChimi();
  const live = coins.filter((coin) => !coin.preview);
  const [ethUsd, setEthUsd] = useState<number>();
  const [launches, setLaunches] = useState<Launch[]>([]);
  const [swaps, setSwaps] = useState<PoolSwap[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoverVol, setHoverVol] = useState<number | null>(null);
  const [hoverLaunch, setHoverLaunch] = useState<number | null>(null);

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
    if (!deployment || preview) {
      setLoading(preview);
      return;
    }
    let cancel = false;
    setLoading(true);
    const pools = coins.filter((coin) => !coin.preview);
    void (async () => {
      const created = await loadLaunches(deployment.factory);
      const rows = await Promise.all(pools.map((coin) => loadSwaps(coin.pool, coin.tokenIs0)));
      if (cancel) return;
      setLaunches(created);
      setSwaps(rows.flat());
      setLoading(false);
    })().catch(() => {
      if (!cancel) setLoading(false);
    });
    return () => {
      cancel = true;
    };
  }, [deployment, preview, coins]);

  const days = recentDays();
  const volumeByDay = new Map(days.map((day) => [day, 0]));
  for (const swap of swaps) {
    const key = dayKey(swap.time);
    if (!volumeByDay.has(key) || !ethUsd) continue;
    volumeByDay.set(key, (volumeByDay.get(key) ?? 0) + (Number(swap.ethAmount) / 1e18) * ethUsd);
  }
  const launchesByDay = new Map(days.map((day) => [day, 0]));
  for (const launch of launches) {
    const key = dayKey(launch.time);
    if (!launchesByDay.has(key)) continue;
    launchesByDay.set(key, (launchesByDay.get(key) ?? 0) + 1);
  }
  const volumes = days.map((day) => volumeByDay.get(day) ?? 0);
  const counts = days.map((day) => launchesByDay.get(day) ?? 0);
  const totalVolume = volumes.reduce((sum, n) => sum + n, 0);
  const knownLaunches = Math.max(live.length, launches.length);

  return (
    <main className="mx-auto max-w-[1180px] px-4 py-8 sm:px-6 sm:py-10">
      <p className="text-[13px] font-semibold tracking-[0.14em] text-gold">GIWA SEPOLIA</p>
      <h1 className="mt-1.5 text-[44px] leading-none font-semibold tracking-[-0.035em]">Analytics</h1>
      <p className="mt-3 max-w-2xl text-sm text-muted">
        Volume and launches across Chimi pools. Every coin opens straight into a locked pool.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <article className="rounded-3xl border border-line bg-chip px-5 py-5">
          <p className="text-3xl font-semibold tracking-[-0.03em]">{ethUsd ? money(totalVolume) : "—"}</p>
          <p className="mt-2 text-sm text-muted">Total volume</p>
          <p className="mt-1 text-sm text-gold">lifetime of the trades we can read</p>
        </article>
        <article className="rounded-3xl border border-line bg-chip px-5 py-5">
          <p className="text-3xl font-semibold tracking-[-0.03em]">{loading ? "…" : knownLaunches}</p>
          <p className="mt-2 text-sm text-muted">Tokens launched</p>
          <p className="mt-1 text-sm text-gold">{loading ? "Reading the factory" : `${live.length} live now`}</p>
        </article>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ChartCard title="Daily volume (USD)">
          <LineChart
            values={volumes}
            labels={days.map(labelDay)}
            hover={hoverVol}
            onHover={setHoverVol}
            format={(n) => `Volume : ${money(n)}`}
          />
        </ChartCard>
        <ChartCard title="Tokens launched (per day)">
          <BarChart values={counts} labels={days.map(labelDay)} hover={hoverLaunch} onHover={setHoverLaunch} />
        </ChartCard>
      </div>
    </main>
  );
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl border border-line bg-chip p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function LineChart({
  values,
  labels,
  hover,
  onHover,
  format,
}: {
  values: number[];
  labels: string[];
  hover: number | null;
  onHover: (index: number | null) => void;
  format: (n: number) => string;
}) {
  const width = 640;
  const height = 260;
  const max = Math.max(...values, 1);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const pts = values.map((value, i) => {
    const x = i * step;
    const y = height - 24 - (value / max) * (height - 48);
    return [x, y] as const;
  });
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height - 16} L0,${height - 16} Z`;
  const ticks = [0, 0.5, 1].map((t) => Math.round(max * t));
  return (
    <div className="relative h-[280px]">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full">
        {ticks.map((tick, i) => (
          <line key={tick} x1="0" y1={16 + i * ((height - 40) / 2)} x2={width} y2={16 + i * ((height - 40) / 2)} stroke="#3f3325" strokeDasharray="3 6" />
        ))}
        <path d={area} fill="#e0b45a" opacity="0.18" />
        <path d={line} fill="none" stroke="#e0b45a" strokeWidth="2" />
        {pts.map((p, i) => (
          <circle
            key={labels[i]}
            cx={p[0]}
            cy={p[1]}
            r={hover === i ? 5 : 3}
            fill="#e0b45a"
            onMouseEnter={() => onHover(i)}
            onMouseLeave={() => onHover(null)}
          />
        ))}
      </svg>
      <div className="pointer-events-none absolute top-0 left-0 flex h-[85%] flex-col justify-between text-[11px] text-muted">
        <span>{money(max)}</span>
        <span>{money(max / 2)}</span>
        <span>0</span>
      </div>
      <div className="absolute right-0 bottom-0 left-8 flex justify-between text-[11px] text-muted">
        <span>{labels[0]}</span>
        <span>{labels[Math.floor(labels.length / 2)]}</span>
        <span>{labels[labels.length - 1]}</span>
      </div>
      {hover !== null ? (
        <div className="pointer-events-none absolute top-8 left-1/2 -translate-x-1/2 rounded-2xl border border-line bg-bg px-3 py-2 text-sm">
          <div>{labels[hover]}</div>
          <div className="font-medium">{format(values[hover] ?? 0)}</div>
        </div>
      ) : null}
    </div>
  );
}

function BarChart({
  values,
  labels,
  hover,
  onHover,
}: {
  values: number[];
  labels: string[];
  hover: number | null;
  onHover: (index: number | null) => void;
}) {
  const max = Math.max(...values, 1);
  return (
    <div className="relative h-[280px]">
      <div className="flex h-[230px] items-end gap-1">
        {values.map((value, i) => (
          <button
            key={labels[i]}
            type="button"
            aria-label={`${labels[i]}: ${value}`}
            onMouseEnter={() => onHover(i)}
            onMouseLeave={() => onHover(null)}
            className="flex h-full flex-1 items-end"
          >
            <span
              className="block w-full rounded-t bg-gold"
              style={{ height: `${Math.max(2, (value / max) * 100)}%`, opacity: hover === null || hover === i ? 1 : 0.45 }}
            />
          </button>
        ))}
      </div>
      <div className="pointer-events-none absolute top-0 left-0 flex h-[230px] flex-col justify-between text-[11px] text-muted">
        <span>{max}</span>
        <span>{max > 1 ? Math.round(max / 2) : ""}</span>
        <span>0</span>
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-muted">
        <span>{labels[0]}</span>
        <span>{labels[Math.floor(labels.length / 2)]}</span>
        <span>{labels[labels.length - 1]}</span>
      </div>
      {hover !== null ? (
        <div className="pointer-events-none absolute top-8 left-1/2 -translate-x-1/2 rounded-2xl border border-line bg-bg px-3 py-2 text-sm">
          <div>{labels[hover]}</div>
          <div className="font-medium">{values[hover] ?? 0} launched</div>
        </div>
      ) : null}
    </div>
  );
}
