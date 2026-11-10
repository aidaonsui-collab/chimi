import { Link } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { IconCheck, IconClose, IconCopy } from "@/components/chimi/icons";

/** A percent move, green up and red down. Shows a dash when there is nothing to measure. */
export function Change({ value, className = "" }: { value: number | undefined; className?: string }) {
  if (value === undefined || !Number.isFinite(value)) return <span className={`text-faint ${className}`}>—</span>;
  const flat = Math.abs(value) < 0.005;
  const tone = flat ? "text-muted" : value > 0 ? "text-ok" : "text-down";
  const body = Math.abs(value) >= 1000 ? `${Math.round(Math.abs(value)).toLocaleString("en-US")}%` : `${Math.abs(value).toFixed(Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2)}%`;
  return (
    <span className={`num inline-flex items-center gap-1 ${tone} ${className}`}>
      {flat ? null : (
        <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden className={value < 0 ? "rotate-180" : ""}>
          <path d="M4 1 7.5 7h-7Z" fill="currentColor" />
        </svg>
      )}
      <span className="sr-only">{flat ? "" : value > 0 ? "up " : "down "}</span>
      {body}
    </span>
  );
}

/** A small line of recent values. Green when it ends above where it began, red when below. */
export function Sparkline({ values, width = 112, height = 36, className = "" }: { values: number[]; width?: number; height?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  const series = values.length === 1 ? [values[0]!, values[0]!] : values;
  if (series.length === 0) return <span className={`block ${className}`} style={{ width, height }} />;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const flat = max === min;
  const pad = 3;
  const pts = series.map((v, i) => {
    const x = (i / (series.length - 1)) * width;
    const y = flat ? height / 2 : height - pad - ((v - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const first = series[0]!;
  const last = series[series.length - 1]!;
  const color = flat || last === first ? "var(--color-faint)" : last > first ? "var(--color-ok)" : "var(--color-down)";
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden>
      <defs>
        <linearGradient id={`sp-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity=".28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {flat ? null : <path d={`${line} L${width} ${height} L0 ${height} Z`} fill={`url(#sp-${id})`} />}
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function Seg<T extends string>({
  value,
  options,
  onChange,
  className = "",
  label,
}: {
  value: T;
  options: readonly (readonly [T, ReactNode])[];
  onChange: (v: T) => void;
  className?: string;
  label?: string;
}) {
  return (
    <div className={`seg ${className}`} role="tablist" aria-label={label}>
      {options.map(([key, text]) => (
        <button key={key} type="button" role="tab" aria-selected={value === key} onClick={() => onChange(key)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** Copies text and shows a check for a moment. */
export function CopyButton({ text, label = "Copy", className = "btn btn-sm btn-icon btn-ghost", size = 15 }: { text: string; label?: string; className?: string; size?: number }) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      aria-label={done ? "Copied" : label}
      title={done ? "Copied" : label}
      className={className}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setDone(false), 1400);
        });
      }}
    >
      {done ? <IconCheck size={size} className="text-ok" /> : <IconCopy size={size} />}
    </button>
  );
}

/** A wallet's picture: a gradient that is always the same for the same address. */
export function Blockie({ address, size = 24, className = "", shape = "circle" }: { address: string; size?: number; className?: string; shape?: "circle" | "rounded" }) {
  return (
    <span
      aria-hidden
      className={`block shrink-0 ${shape === "circle" ? "rounded-full" : size >= 72 ? "rounded-2xl" : "rounded-xl"} ${className}`}
      style={{
        width: size,
        height: size,
        background: walletGradient(address),
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,.14)",
      }}
    />
  );
}

/** The gradient behind a wallet's picture, so its page can be tinted to match. */
export function walletGradient(address: string) {
  const hex = address.toLowerCase().replace(/^0x/, "").padEnd(12, "0");
  const a = parseInt(hex.slice(0, 4), 16) % 360;
  const b = (a + 40 + (parseInt(hex.slice(4, 8), 16) % 140)) % 360;
  const angle = parseInt(hex.slice(8, 12), 16) % 360;
  return `linear-gradient(${angle}deg, hsl(${a} 72% 58%), hsl(${b} 68% 42%))`;
}

const shortWallet = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/** A wallet, shown by its picture and short address (or `name`), linking to its trader page. */
export function TraderLink({ address, name, size = 16, className = "" }: { address: string; name?: string | null; size?: number; className?: string }) {
  return (
    <Link to="/u/$address" params={{ address }} title={address} className={`inline-flex min-w-0 items-center gap-2 transition-colors hover:text-fg ${className}`}>
      <Blockie address={address} size={size} />
      <span className="num truncate">{name ? name.replace(/\.up\.id$/, "") : shortWallet(address)}</span>
    </Link>
  );
}

/** Page title block: a small gold line, the title, a sentence, and room for actions on the right. */
export function PageHead({ eyebrow, title, children, actions }: { eyebrow?: ReactNode; title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
      <div className="min-w-0 max-w-2xl">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1 className="mt-2 text-[34px] leading-[1.05] font-semibold tracking-[-0.03em] sm:text-[42px]">{title}</h1>
        {children ? <p className="mt-3 text-[15px] leading-relaxed text-muted">{children}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2.5">{actions}</div> : null}
    </div>
  );
}

export function Empty({ mark, title, children, action }: { mark?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {mark ? <div className="mb-4 font-serif text-2xl text-gold">{mark}</div> : null}
      <p className="text-lg font-semibold tracking-[-0.01em]">{title}</p>
      {children ? <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted">{children}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/** A dialog: a sheet from the bottom on a phone, centered on a desktop. Closes on Escape and on the backdrop. */
export function Modal({
  title,
  kicker,
  onClose,
  children,
  width = 560,
  bare,
}: {
  title?: ReactNode;
  kicker?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  /** No header or padding: the caller draws everything. */
  bare?: boolean;
}) {
  const titleId = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4" role="presentation">
      <button type="button" aria-label="Close" tabIndex={-1} className="absolute inset-0 animate-fade cursor-default bg-black/65 backdrop-blur-[3px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        style={{ maxWidth: width }}
        className={`relative max-h-[92dvh] w-full animate-pop overflow-y-auto rounded-t-3xl border border-edge bg-chip shadow-pop sm:rounded-3xl ${bare ? "" : "p-5 sm:p-7"}`}
      >
        {bare ? null : (
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              {kicker ? <p className="eyebrow">{kicker}</p> : null}
              {title ? (
                <h2 id={titleId} className="mt-1.5 text-[26px] leading-tight font-semibold tracking-[-0.025em]">
                  {title}
                </h2>
              ) : null}
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="btn btn-icon btn-sm btn-ghost -mt-1 -mr-1">
              <IconClose size={16} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/** A line of feedback under a form: plain while waiting, red on failure, green on success. */
export function Note({ kind, children, className = "" }: { kind?: "" | "bad" | "good"; children: ReactNode; className?: string }) {
  if (!children) return null;
  return (
    <p role={kind === "bad" ? "alert" : "status"} className={`text-sm ${kind === "bad" ? "text-down" : kind === "good" ? "text-ok" : "text-muted"} ${className}`}>
      {children}
    </p>
  );
}
