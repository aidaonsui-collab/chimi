/** The red LIVE tag, on the board and over a stream. */
export function LivePill({ small, className = "" }: { small?: boolean; className?: string }) {
  return (
    <span className={`live-pill ${small ? "live-pill-sm" : ""} ${className}`}>
      <span className="live-pill-dot" aria-hidden />
      LIVE
    </span>
  );
}
