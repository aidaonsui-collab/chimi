import { useId, useMemo, useRef, useState, type ReactNode } from "react";

export type ChartPoint = { t: number; v: number };

const TONES = {
  up: "var(--color-ok)",
  down: "var(--color-down)",
  gold: "var(--color-gold)",
} as const;

/**
 * A value over time as a filled line. Time runs left to right from `from` to `to` (unix seconds), so quiet
 * stretches look quiet. Hovering reads out the nearest point; `onHover` lets the page show it in its headline.
 */
export function AreaChart({
  points,
  from,
  to,
  format,
  tone = "gold",
  height = 300,
  onHover,
  empty,
}: {
  points: ChartPoint[];
  from: number;
  to: number;
  format: (v: number) => string;
  tone?: keyof typeof TONES;
  height?: number;
  onHover?: (p: ChartPoint | null) => void;
  empty?: ReactNode;
}) {
  const id = useId().replace(/:/g, "");
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const color = TONES[tone];
  const W = 1000;
  const H = 300;

  const geo = useMemo(() => {
    if (points.length === 0) return null;
    const span = Math.max(1, to - from);
    const vs = points.map((p) => p.v);
    const min = Math.min(...vs);
    const max = Math.max(...vs);
    const pad = (max - min) * 0.14 || Math.abs(max) * 0.05 || 1;
    const lo = min - pad;
    const hi = max + pad;
    const xy = points.map((p) => {
      const x = Math.min(1, Math.max(0, (p.t - from) / span));
      const y = 1 - (p.v - lo) / (hi - lo);
      return { x, y };
    });
    const line = xy.map((p, i) => `${i ? "L" : "M"}${(p.x * W).toFixed(1)} ${(p.y * H).toFixed(1)}`).join(" ");
    const first = xy[0]!;
    const last = xy[xy.length - 1]!;
    const area = `${line} L${(last.x * W).toFixed(1)} ${H} L${(first.x * W).toFixed(1)} ${H} Z`;
    return { xy, line, area, lo, hi };
  }, [points, from, to]);

  const pick = (clientX: number) => {
    const el = box.current;
    if (!el || !geo) return;
    const rect = el.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width;
    let best = 0;
    for (let i = 1; i < geo.xy.length; i++) if (Math.abs(geo.xy[i]!.x - x) < Math.abs(geo.xy[best]!.x - x)) best = i;
    if (best !== hover) {
      setHover(best);
      onHover?.(points[best] ?? null);
    }
  };
  const leave = () => {
    setHover(null);
    onHover?.(null);
  };

  const when = (t: number) => {
    const d = new Date(t * 1000);
    return to - from > 86_400 * 2
      ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  };
  const stamp = (t: number) =>
    new Date(t * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  const ticks = geo ? [geo.hi - (geo.hi - geo.lo) * 0.12, (geo.hi + geo.lo) / 2, geo.lo + (geo.hi - geo.lo) * 0.12] : [];
  const at = hover !== null && geo ? geo.xy[hover] : undefined;

  return (
    <div>
      <div
        ref={box}
        className="relative touch-pan-y select-none"
        style={{ height }}
        onPointerMove={(e) => pick(e.clientX)}
        onPointerDown={(e) => pick(e.clientX)}
        onPointerLeave={leave}
        onPointerCancel={leave}
      >
        {geo ? (
          <>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
              <defs>
                <linearGradient id={`area-${id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={color} stopOpacity=".26" />
                  <stop offset="1" stopColor={color} stopOpacity="0" />
                </linearGradient>
              </defs>
              {[0.12, 0.5, 0.88].map((y) => (
                <line key={y} x1="0" x2={W} y1={y * H} y2={y * H} stroke="var(--color-line)" strokeDasharray="2 6" vectorEffect="non-scaling-stroke" />
              ))}
              <path d={geo.area} fill={`url(#area-${id})`} />
              <path d={geo.line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            </svg>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex flex-col justify-between py-[9%] text-right text-[11px] text-faint">
              {ticks.map((v, i) => (
                <span key={i} className="num rounded bg-chip/70 px-1">
                  {format(v)}
                </span>
              ))}
            </div>
            {at ? (
              <>
                <span className="pointer-events-none absolute inset-y-0 w-px bg-edge" style={{ left: `${at.x * 100}%` }} />
                <span
                  className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-chip"
                  style={{ left: `${at.x * 100}%`, top: `${at.y * 100}%`, background: color }}
                />
                <span
                  className="glass num pointer-events-none absolute top-1 z-10 rounded-lg px-2.5 py-1.5 text-xs whitespace-nowrap"
                  style={at.x > 0.6 ? { right: `${(1 - at.x) * 100 + 1.5}%` } : { left: `${at.x * 100 + 1.5}%` }}
                >
                  <span className="block font-semibold text-fg">{format(points[hover!]!.v)}</span>
                  <span className="block text-muted">{stamp(points[hover!]!.t)}</span>
                </span>
              </>
            ) : null}
          </>
        ) : (
          <div className="absolute inset-0 grid place-items-center text-sm text-muted">{empty ?? "Nothing to chart yet."}</div>
        )}
      </div>
      <div className="num mt-2 flex justify-between text-[11px] text-faint">
        <span>{when(from)}</span>
        <span>{when(from + (to - from) / 2)}</span>
        <span>{to - from > 86_400 * 2 ? when(to) : "now"}</span>
      </div>
    </div>
  );
}

/** Bars for counts or volume per bucket. Hovering a bar lights it and reads it out through `onHover`. */
export function BarChart({
  values,
  labels,
  format,
  height = 240,
  onHover,
  tone = "gold",
}: {
  values: number[];
  labels: string[];
  format: (v: number) => string;
  height?: number;
  onHover?: (index: number | null) => void;
  tone?: keyof typeof TONES;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...values, 0);
  const color = TONES[tone];
  const set = (i: number | null) => {
    setHover(i);
    onHover?.(i);
  };
  return (
    <div>
      <div className="relative" style={{ height }} onPointerLeave={() => set(null)}>
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
          {[0, 1, 2].map((i) => (
            <span key={i} className="border-t border-dashed border-line" />
          ))}
        </div>
        <div className="num pointer-events-none absolute inset-y-0 right-0 flex flex-col justify-between text-right text-[11px] text-faint">
          <span className="rounded bg-chip/70 px-1">{format(max)}</span>
          <span className="rounded bg-chip/70 px-1">{max > 0 ? format(max / 2) : ""}</span>
          <span />
        </div>
        <div className="absolute inset-0 flex items-end gap-[3px] sm:gap-1.5">
          {values.map((value, i) => (
            <button
              key={i}
              type="button"
              aria-label={`${labels[i]}: ${format(value)}`}
              onPointerEnter={() => set(i)}
              onFocus={() => set(i)}
              onBlur={() => set(null)}
              className="group relative flex h-full flex-1 items-end outline-none"
            >
              <span
                className="w-full rounded-t-[4px] transition-opacity duration-150"
                style={{
                  height: `${max > 0 ? Math.max(value > 0 ? 3 : 1, (value / max) * 100) : 1}%`,
                  background: value > 0 ? color : "var(--color-edge)",
                  opacity: hover === null || hover === i ? 1 : 0.35,
                }}
              />
              {hover === i ? (
                <span className="glass num pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 rounded-lg px-2.5 py-1.5 text-xs whitespace-nowrap">
                  <span className="block font-semibold text-fg">{format(value)}</span>
                  <span className="block text-muted">{labels[i]}</span>
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>
      <div className="num mt-2 flex justify-between text-[11px] text-faint">
        <span>{labels[0]}</span>
        <span>{labels[Math.floor(labels.length / 2)]}</span>
        <span>{labels[labels.length - 1]}</span>
      </div>
    </div>
  );
}
