import { useEffect, useState, type CSSProperties } from "react";

type LogoProps = {
  symbol: string;
  image?: string;
  size?: number;
  /** Seal ring around the picture, matching the board's stamp marks. */
  ring?: boolean;
  shape?: "circle" | "rounded";
  className?: string;
  style?: CSSProperties;
};

/**
 * A token's real picture, lazy-loaded. Falls back to the seal-style initials mark when the
 * token has no picture or the picture fails to load.
 */
export function TokenLogo({ symbol, image, size = 40, ring = true, shape = "circle", className = "", style }: LogoProps) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [image]);
  const radius = shape === "circle" ? "rounded-full" : "rounded-2xl";
  const box: CSSProperties = { width: size, height: size, ...style };
  const ringShadow = ring ? `0 0 0 ${size >= 56 ? 2 : 1.5}px var(--color-seal)` : undefined;

  if (image && !broken) {
    return (
      <img
        src={image}
        alt={`${symbol} logo`}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        draggable={false}
        onError={() => setBroken(true)}
        className={`block shrink-0 bg-chip object-cover ${radius} ${className}`}
        style={{ ...box, boxShadow: ringShadow }}
      />
    );
  }
  return (
    <span
      aria-label={`${symbol} logo`}
      role="img"
      className={`grid shrink-0 place-items-center bg-[radial-gradient(circle_at_35%_30%,rgba(210,74,46,.18),rgba(23,18,14,.6))] font-display leading-none text-seal ${radius} ${className}`}
      style={{ ...box, fontSize: Math.max(7, Math.round(size * 0.22)), boxShadow: `inset 0 0 0 ${size >= 56 ? 2 : 1.5}px var(--color-seal)` }}
    >
      {symbol.slice(0, 4)}
    </span>
  );
}

/** Native ETH mark used for the quote side of every Chimi pool. */
export function EthLogo({ size = 40, className = "", style }: { size?: number; className?: string; style?: CSSProperties }) {
  return (
    <span
      role="img"
      aria-label="ETH logo"
      className={`grid shrink-0 place-items-center rounded-full bg-[#2a231d] shadow-[inset_0_0_0_1.5px_var(--color-line)] ${className}`}
      style={{ width: size, height: size, ...style }}
    >
      <svg width={size * 0.3} height={size * 0.48} viewBox="0 0 14 22" aria-hidden>
        <path d="M7 0 0 11.2 7 15.3l7-4.1z" fill="var(--color-fg)" opacity=".9" />
        <path d="M7 16.6 0 12.5 7 22l7-9.5z" fill="var(--color-fg)" opacity=".6" />
      </svg>
    </span>
  );
}
