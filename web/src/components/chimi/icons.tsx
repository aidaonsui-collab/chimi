import type { ReactNode, SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & { size?: number };

function Svg({ size = 20, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  );
}

/** The chimi ornament from the seal, drawn in a 32-unit box. */
export const CHIMI_PATH =
  "M17.2 3.3 21.6 3.4 24.2 5.3 23.6 7.6 20.8 8.6 18.4 8.2 18.6 10 21 14.6 21.6 19.6 23.5 21 24.1 24.4 23.2 26.9 20.6 28.8 17.8 29.3 12.2 29 8.5 26.8 7.6 24.6 7.5 21.2 8.4 19 10.4 17.2 15.6 16.6 16.6 14.4 15.4 12.4 11 12.2 6.8 11 7.2 8 11.4 4.8Z";

export const IconBoard = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 17l5-5 4 3 8-9" />
    <path d="M15 6h5v5" />
  </Svg>
);
export const IconSwap = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 4v15M7 19l-3.5-3.5M7 19l3.5-3.5" />
    <path d="M17 20V5M17 5l-3.5 3.5M17 5l3.5 3.5" />
  </Svg>
);
export const IconPools = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.5c3.2 3.6 6 6.7 6 10a6 6 0 0 1-12 0c0-3.3 2.8-6.4 6-10Z" />
    <path d="M9.5 14.5a2.7 2.7 0 0 0 2.5 2.3" />
  </Svg>
);
export const IconChart = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20V10M10 20V4M16 20v-7M21 20H3" />
  </Svg>
);
export const IconCandles = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 3v3M7 15v4M17 5v4M17 17v4" />
    <rect x="4.5" y="6" width="5" height="9" rx="1" />
    <rect x="14.5" y="9" width="5" height="8" rx="1" />
  </Svg>
);
export const IconLine = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 17l5-6 4 3 4-7 5 5" />
  </Svg>
);
export const IconMinus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14" />
  </Svg>
);
export const IconReset = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 12a8 8 0 1 0 2.6-5.9" />
    <path d="M4 4v4.5h4.5" />
  </Svg>
);
export const IconPoints = (p: IconProps) => (
  <Svg {...p}>
    <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9Z" />
  </Svg>
);
/** A hanok roof, for Houses. */
export const IconHouse = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 11c3.5-.2 6.5-2 9.5-6 3 4 6 5.8 9.5 6" />
    <path d="M5.5 11.5V20h13v-8.5" />
    <path d="M10 20v-4.5h4V20" />
  </Svg>
);
export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const IconSearch = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </Svg>
);
export const IconWallet = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3" />
    <path d="M4 7.5V17a2.5 2.5 0 0 0 2.5 2.5H20V8H6.5A2.5 2.5 0 0 1 4 5.5" />
    <path d="M16 13.7h.01" />
  </Svg>
);
export const IconCopy = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2.5" />
    <path d="M15 9V6.5A2.5 2.5 0 0 0 12.5 4h-6A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15H9" />
  </Svg>
);
export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
);
export const IconExternal = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 5h5v5M19 5l-8 8" />
    <path d="M18 14v3.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 17.5v-10A1.5 1.5 0 0 1 6.5 6H10" />
  </Svg>
);
export const IconChevronRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="m9 5 7 7-7 7" />
  </Svg>
);
export const IconChevronLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="m15 5-7 7 7 7" />
  </Svg>
);
export const IconChevronDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="m5 9 7 7 7-7" />
  </Svg>
);
export const IconArrowDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4v16M6 14l6 6 6-6" />
  </Svg>
);
export const IconArrowLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 12H4M10 6l-6 6 6 6" />
  </Svg>
);
export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
export const IconMenu = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Svg>
);
export const IconGrid = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
  </Svg>
);
export const IconList = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8.5 6.5H20M8.5 12H20M8.5 17.5H20M4.2 6.5h.01M4.2 12h.01M4.2 17.5h.01" />
  </Svg>
);
export const IconLock = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="10.5" width="14" height="9.5" rx="2.5" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
  </Svg>
);
export const IconGlobe = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.5 2.6 3.7 5.4 3.7 8.5s-1.2 5.9-3.7 8.5c-2.5-2.6-3.7-5.4-3.7-8.5s1.2-5.9 3.7-8.5Z" />
  </Svg>
);
export const IconShare = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 15V4M12 4 8 8M12 4l4 4" />
    <path d="M5 13v4.5A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5V13" />
  </Svg>
);
export const IconSliders = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="17" r="2" />
  </Svg>
);
export const IconPower = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4v8" />
    <path d="M7.5 7a7 7 0 1 0 9 0" />
  </Svg>
);
export const IconImage = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <circle cx="9.5" cy="9.5" r="1.5" />
    <path d="m5 17 4.5-4.5 3.5 3.5 2.5-2.5L20 18" />
  </Svg>
);
export const IconFlame = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.5c.5 3-1.5 4.5-3 6.5a5.8 5.8 0 1 0 9.5 1.5c-.8 1.2-1.8 1.8-2.8 1.8.6-3.3-.7-7.3-3.7-9.8Z" />
  </Svg>
);
export const IconClock = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
);
export const IconTrophy = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 4.5h8V10a4 4 0 0 1-8 0Z" />
    <path d="M8 6H5v1.5A3 3 0 0 0 8 10.5M16 6h3v1.5a3 3 0 0 1-3 3M12 14v3.5M8.5 20h7M9.5 17.5h5" />
  </Svg>
);
export const IconInfo = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5.5M12 7.7h.01" />
  </Svg>
);

export const IconX = ({ size = 20, ...rest }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden {...rest}>
    <path d="M17.75 3h3.07l-6.71 7.67L22 21h-6.18l-4.84-6.33L5.44 21H2.37l7.18-8.2L2 3h6.34l4.37 5.78Zm-1.08 16.17h1.7L7.4 4.74H5.58Z" />
  </svg>
);
export const IconTelegram = ({ size = 20, ...rest }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden {...rest}>
    <path d="M20.66 4.34 2.96 11.17c-1.2.48-1.2 1.16-.22 1.46l4.54 1.42 1.74 5.32c.21.58.11.81.72.81.47 0 .68-.21.94-.47l2.21-2.15 4.6 3.4c.85.47 1.46.23 1.67-.79l3.02-14.25c.31-1.24-.47-1.8-1.52-1.58ZM8 13.76l9.72-6.13c.46-.28.88-.13.53.18l-8.05 7.27-.31 3.34Z" />
  </svg>
);

/** Chimi's mark: the vermilion ornament pressed on a paper tile, the same as the site icon. */
export function ChimiMark({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={`shrink-0 ${className}`} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#f4efe4" />
      <path d={CHIMI_PATH} fill="#c8402b" />
    </svg>
  );
}
