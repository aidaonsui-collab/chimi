export function PairMark({ symbol, image, size = 42 }: { symbol: string; image?: string; size?: number }) {
  const overlap = Math.round(size * 0.62);
  return (
    <span className="relative block shrink-0" style={{ width: size + overlap, height: size }}>
      <span
        className="absolute top-0 grid place-items-center rounded-full bg-[#2a231d] shadow-[0_0_0_2px_#221a14,0_0_0_3px_#3f3325]"
        style={{ left: overlap, width: size, height: size }}
      >
        <svg width={size * 0.28} height={size * 0.46} viewBox="0 0 14 22" aria-hidden>
          <path d="M7 0 0 11.2 7 15.3l7-4.1z" fill="#e8ddc8" opacity=".9" />
          <path d="M7 16.6 0 12.5 7 22l7-9.5z" fill="#e8ddc8" opacity=".6" />
        </svg>
      </span>
      {image ? (
        <img
          src={image}
          alt=""
          className="absolute top-0 left-0 rounded-full object-cover shadow-[0_0_0_2px_#221a14,0_0_0_3px_#d24a2e]"
          style={{ width: size, height: size }}
        />
      ) : (
        <span
          className="absolute top-0 left-0 grid place-items-center rounded-full bg-[radial-gradient(circle_at_35%_30%,rgba(210,74,46,.2),transparent_70%),#221a14] font-display text-seal shadow-[0_0_0_2px_#221a14,0_0_0_3.5px_#d24a2e]"
          style={{ width: size, height: size, fontSize: Math.max(8, size * 0.22) }}
        >
          {symbol.slice(0, 4)}
        </span>
      )}
    </span>
  );
}
