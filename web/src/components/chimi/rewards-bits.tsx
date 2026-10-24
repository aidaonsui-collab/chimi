import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import type { House } from "@/lib/chimi/house-rules";
import { dayLabel, type League, type Profile } from "@/lib/chimi/points-rules";
import { fmtPoints, shortWallet } from "@/lib/chimi/rewards";
import { HouseSeal } from "@/components/chimi/house-seal";

export function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="text-[13px] font-semibold tracking-[0.14em] text-gold">{children}</p>;
}

/** A wallet's up.id name when it has one, else its short address. */
export function WalletName({ wallet, profile, you }: { wallet: string; profile?: Profile | null; you?: boolean }) {
  const name = profile?.name;
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      {name ? (
        <span className="truncate font-medium">
          {name.replace(/\.up\.id$/, "")}
          <span className="font-normal text-muted">.up.id</span>
        </span>
      ) : (
        <span className="truncate font-medium tabular-nums">{shortWallet(wallet)}</span>
      )}
      {you ? <span className="shrink-0 rounded-full bg-seal/15 px-1.5 py-px text-[11px] font-semibold text-seal">you</span> : null}
    </span>
  );
}

/** The stamp next to a name: its house's seal, or a blank paper tile. */
export function WalletMark({ house, size = 34 }: { house?: House; size?: number }) {
  if (house) return <HouseSeal seal={house.seal} ink={house.ink} size={size} title={`${house.name} [${house.tag}]`} />;
  return (
    <span
      className="grid shrink-0 place-items-center rounded-[9px] border border-dashed border-line bg-bg/40"
      style={{ width: size, height: size }}
      aria-hidden
    />
  );
}

export function HouseTag({ house }: { house: House }) {
  return (
    <Link
      to="/houses/$tag"
      params={{ tag: house.tag }}
      className="shrink-0 rounded-md border border-line/90 bg-bg/50 px-1.5 py-px text-[11px] font-semibold tracking-[0.08em] text-muted hover:text-fg"
    >
      {house.tag}
    </Link>
  );
}

export function LeagueChip({ league, size = "sm" }: { league: League; size?: "sm" | "lg" }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border ${size === "lg" ? "px-3 py-1 text-sm" : "px-2 py-px text-[11px]"} font-medium`}
      style={{ borderColor: `${league.color}55`, background: `${league.color}14`, color: league.color }}
    >
      <span className="font-serif">{league.korean}</span>
      <span className={size === "lg" ? "opacity-80" : "hidden opacity-80 sm:inline"}>{league.name}</span>
    </span>
  );
}

export function Movement({ rank, prev }: { rank: number; prev: number | null }) {
  if (prev === null) return <span className="text-[11px] font-semibold text-gold">new</span>;
  const d = prev - rank;
  if (d === 0) return <span className="text-[11px] text-muted">–</span>;
  return (
    <span className={`text-[11px] font-semibold tabular-nums ${d > 0 ? "text-ok" : "text-seal"}`}>
      {d > 0 ? "▲" : "▼"}
      {Math.abs(d)}
    </span>
  );
}

/** Points per day as bars, oldest first; the last `highlight` bar is the open day's estimate. */
export function DayBars({ days, live, color = "#d24a2e", height = 64 }: { days: { day: string; points: number }[]; live?: { day: string; points: number } | null; color?: string; height?: number }) {
  const all = [...days.slice(-13), ...(live ? [live] : [])];
  const max = Math.max(1, ...all.map((d) => d.points));
  const [hover, setHover] = useState<number | null>(null);
  if (all.length === 0) return null;
  const shown = hover ?? all.length - 1;
  const item = all[shown]!;
  const isLive = !!live && shown === all.length - 1;
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs text-muted">
        <span>
          {dayLabel(item.day)}
          {isLive ? " · so far" : ""}
        </span>
        <span className="font-medium text-fg tabular-nums">{fmtPoints(item.points)} pts</span>
      </div>
      <div className="mt-2 flex items-end gap-[3px]" style={{ height }} onMouseLeave={() => setHover(null)}>
        {all.map((d, i) => {
          const lit = live && i === all.length - 1;
          return (
            <button
              key={d.day}
              type="button"
              aria-label={`${dayLabel(d.day)}: ${fmtPoints(d.points)} points${lit ? " so far" : ""}`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              className="group flex h-full flex-1 items-end"
            >
              <span
                className="w-full rounded-t-[3px] transition-opacity"
                style={{
                  height: `${Math.max(3, (d.points / max) * 100)}%`,
                  background: lit ? `repeating-linear-gradient(135deg, ${color}, ${color} 3px, ${color}66 3px, ${color}66 6px)` : color,
                  opacity: d.points === 0 ? 0.18 : shown === i ? 1 : 0.55,
                }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The time, ticking once a second; null until the page is running in the browser, so the server's render matches. */
export function useNow(everyMs = 1000) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

export function duration(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(s % 60).padStart(2, "0")}s`;
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-[10px] border border-line bg-chip p-[3px]" role="tablist">
      {options.map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={value === key}
          onClick={() => onChange(key)}
          className={`rounded-[7px] px-3.5 py-1.5 text-[13px] font-medium whitespace-nowrap ${value === key ? "bg-[#3a2d22] text-fg shadow-[0_1px_3px_rgba(0,0,0,.35),inset_0_1px_0_rgba(255,255,255,.06)]" : "text-muted hover:text-fg"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-0.5 truncate text-[22px] font-semibold tracking-[-0.02em] tabular-nums">{value}</div>
      {sub ? <div className="truncate text-xs text-muted">{sub}</div> : null}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <span className={`block animate-pulse rounded-md bg-fg/8 ${className}`} />;
}

/** The Dojang check mark next to a verified name. */
export function DojangMark({ verified }: { verified: boolean | undefined }) {
  if (!verified) return null;
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" className="shrink-0 text-ok" aria-label="Has a Dojang" role="img">
      <path d="M8 1.2 9.8 2.6l2.3-.2.7 2.2 1.9 1.3-.8 2.1.8 2.1-1.9 1.3-.7 2.2-2.3-.2L8 14.8l-1.8-1.4-2.3.2-.7-2.2-1.9-1.3.8-2.1-.8-2.1 1.9-1.3.7-2.2 2.3.2Z" fill="currentColor" opacity=".22" />
      <path d="m5.4 8.2 1.8 1.8 3.6-3.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
