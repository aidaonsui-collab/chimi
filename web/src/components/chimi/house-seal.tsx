import { useId } from "react";
import { INKS, type Ink, type Seal } from "@/lib/chimi/house-rules";

/**
 * A house's crest: its seal character stamped in its ink on a square of rice paper, grainy like Chimi's own seal.
 * The ink grain is drawn in the seal's own 100-unit box, so it looks the same at every size.
 */
export function HouseSeal({ seal, ink, size = 44, className = "", title }: { seal: Seal; ink: Ink; size?: number; className?: string; title?: string }) {
  const id = useId().replace(/:/g, "");
  const color = INKS[ink] ?? INKS.seal;
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        <radialGradient id={`paper-${id}`} cx="35%" cy="28%" r="90%">
          <stop offset="0" stopColor="#f3ead8" />
          <stop offset="1" stopColor="#ddd0b4" />
        </radialGradient>
        <filter id={`grain-${id}`} x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={seal.codePointAt(0)! % 97} result="noise" />
          <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.5 1.55" result="speckle" />
          <feComposite in="SourceGraphic" in2="speckle" operator="in" result="grained" />
          <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="3" result="warp" />
          <feDisplacementMap in="grained" in2="warp" scale="2.4" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
      <rect x="0" y="0" width="100" height="100" rx="14" fill={`url(#paper-${id})`} />
      <g filter={`url(#grain-${id})`} fill={color} stroke={color}>
        <rect x="12" y="12" width="76" height="76" rx="5" fill="none" strokeWidth="6.5" />
        <text
          x="50"
          y="53"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="54"
          strokeWidth="1.6"
          strokeLinejoin="round"
          style={{ fontFamily: '"Noto Serif KR", var(--font-serif)', fontWeight: 900 }}
        >
          {seal}
        </text>
      </g>
    </svg>
  );
}
