import { useEffect, useState, type CSSProperties } from "react";
import { CHIMI_PATH } from "@/components/chimi/icons";

type LogoProps = {
  symbol: string;
  image?: string;
  size?: number;
  /** A hairline around the picture so it holds its edge on dark art. */
  ring?: boolean;
  shape?: "circle" | "rounded";
  className?: string;
  style?: CSSProperties;
};

/** A hue that is always the same for the same symbol, so a coin without a picture keeps one look everywhere. */
export function hueOf(text: string) {
  let h = 7;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
  return h;
}

function tint(symbol: string) {
  const h = hueOf(symbol || "?");
  return `linear-gradient(140deg, hsl(${h} 46% 30%), hsl(${(h + 38) % 360} 52% 14%))`;
}

/**
 * A token's real picture, lazy-loaded. Falls back to its initials on a tint of its own when the
 * token has no picture or the picture fails to load.
 */
export function TokenLogo({ symbol, image, size = 40, ring = true, shape = "circle", className = "", style }: LogoProps) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [image]);
  const radius = shape === "circle" ? "rounded-full" : size >= 72 ? "rounded-2xl" : size >= 40 ? "rounded-xl" : "rounded-lg";
  const box: CSSProperties = { width: size, height: size, ...style };
  const hairline = ring ? "inset 0 0 0 1px rgba(255,255,255,.1)" : undefined;

  if (image && !broken) {
    return (
      <span className={`relative block shrink-0 overflow-hidden bg-raise ${radius} ${className}`} style={box}>
        <img
          src={image}
          alt={`${symbol} logo`}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
          onError={() => setBroken(true)}
          className="size-full object-cover"
        />
        {ring ? <span className={`pointer-events-none absolute inset-0 ${radius}`} style={{ boxShadow: hairline }} /> : null}
      </span>
    );
  }
  // A very small mark only has room for one letter.
  const tiny = size < 22;
  return (
    <span
      aria-label={`${symbol} logo`}
      role="img"
      className={`grid shrink-0 place-items-center overflow-hidden font-semibold leading-none tracking-[-0.02em] text-white/90 ${radius} ${className}`}
      style={{ ...box, background: tint(symbol), fontSize: tiny ? Math.round(size * 0.56) : Math.max(8, Math.round(size * (symbol.length > 3 ? 0.24 : 0.3))), boxShadow: hairline }}
    >
      {tiny ? symbol.slice(0, 1) : symbol.slice(0, 4)}
    </span>
  );
}

/**
 * A coin's picture as a cover: fills whatever box it is given. Without a picture it draws a tinted tile
 * with the chimi ornament pressed into it and the ticker across the front.
 */
export function TokenArt({ symbol, image, className = "" }: { symbol: string; image?: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [image]);
  if (image && !broken) {
    return (
      <img
        src={image}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        draggable={false}
        onError={() => setBroken(true)}
        className={`size-full object-cover ${className}`}
      />
    );
  }
  return (
    <span className={`relative grid size-full place-items-center overflow-hidden ${className}`} style={{ background: tint(symbol) }} aria-hidden>
      <svg viewBox="0 0 32 32" className="absolute -right-[12%] -bottom-[16%] w-[78%] opacity-[.13]">
        <path d={CHIMI_PATH} fill="#fff" />
      </svg>
      <span className="relative max-w-[88%] truncate text-[clamp(18px,22cqw,44px)] leading-none font-semibold tracking-[-0.03em] text-white/90">{symbol.slice(0, 6)}</span>
    </span>
  );
}

/** Native ETH mark used for the quote side of every Chimi pool. */
export function EthLogo({ size = 40, className = "", style }: { size?: number; className?: string; style?: CSSProperties }) {
  return (
    <span
      role="img"
      aria-label="ETH logo"
      className={`grid shrink-0 place-items-center rounded-full bg-[#232838] shadow-[inset_0_0_0_1px_rgba(255,255,255,.1)] ${className}`}
      style={{ width: size, height: size, ...style }}
    >
      <svg width={size * 0.3} height={size * 0.48} viewBox="0 0 14 22" aria-hidden>
        <path d="M7 0 0 11.2 7 15.3l7-4.1z" fill="#fff" opacity=".92" />
        <path d="M7 16.6 0 12.5 7 22l7-9.5z" fill="#fff" opacity=".6" />
      </svg>
    </span>
  );
}
