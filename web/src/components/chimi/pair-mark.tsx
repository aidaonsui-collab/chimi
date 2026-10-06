import { EthLogo, TokenLogo } from "@/components/chimi/token-logo";

/** Overlapping pair logos (token over ETH), like a DEX pool row. */
export function PairMark({ symbol, image, size = 42 }: { symbol: string; image?: string; size?: number }) {
  const overlap = Math.round(size * 0.62);
  const gap = size >= 40 ? 2 : 1.5;
  return (
    <span className="relative block shrink-0" style={{ width: size + overlap, height: size }}>
      <EthLogo size={size} className="absolute top-0" style={{ left: overlap }} />
      <span className="absolute top-0 left-0 rounded-full" style={{ boxShadow: `0 0 0 ${gap}px var(--color-chip)` }}>
        <TokenLogo symbol={symbol} image={image} size={size} />
      </span>
    </span>
  );
}
