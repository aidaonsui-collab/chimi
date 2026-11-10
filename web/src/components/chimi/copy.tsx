import { isFollowing } from "@/lib/chimi/follow-rules";
import { useFollows } from "@/lib/chimi/follows";
import { ethText } from "@/lib/chimi/format";
import { FollowButton } from "@/components/chimi/follow";
import { IconClose } from "@/components/chimi/icons";
import { useChimi } from "@/components/chimi/provider";
import { TraderLink } from "@/components/chimi/ui";

const SIZE_KEY = "chimi.copy.eth";
const SIZES = ["0.01", "0.05", "0.1"];

/** The ETH amount this browser last chose when copying a trade; a small default the first time. */
export function copySize(): string {
  try {
    const saved = localStorage.getItem(SIZE_KEY);
    if (saved && Number(saved) > 0) return saved;
  } catch {
    /* private mode */
  }
  return SIZES[0]!;
}

function rememberSize(eth: string) {
  try {
    localStorage.setItem(SIZE_KEY, eth);
  } catch {
    /* private mode */
  }
}

/**
 * Sits above the trade fields when the page was opened by pressing Copy on someone's buy. It says whose buy it is,
 * offers a few sizes, and explains who earns from it. Nothing is sent until the buy button is pressed.
 */
export function CopyNotice({
  leader,
  theirEth,
  symbol,
  amount,
  onAmount,
  onDismiss,
}: {
  leader: string;
  /** What the trader being copied paid, if the link carried it. */
  theirEth?: number;
  symbol: string;
  amount: string;
  onAmount: (eth: string) => void;
  onDismiss: () => void;
}) {
  const { account } = useChimi();
  const { data: follows } = useFollows();
  const mine = account?.toLowerCase() === leader.toLowerCase();
  const following = isFollowing(follows?.state, account, leader);
  const same = theirEth ? String(Number(theirEth.toPrecision(4))) : undefined;
  const sizes = same && !SIZES.includes(same) ? [...SIZES, same] : SIZES;
  const pick = (eth: string) => {
    rememberSize(eth);
    onAmount(eth);
  };
  return (
    <div className="mt-2 rounded-xl border border-gold/25 bg-gold/8 px-3.5 py-3">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-[13px] leading-relaxed">
          <span className="text-muted">Copying </span>
          <TraderLink address={leader} size={14} className="gap-1.5 align-middle font-semibold" />
          {theirEth ? (
            <span className="text-muted">
              , who put <span className="num text-fg">{ethText(theirEth)} ETH</span> into {symbol}.
            </span>
          ) : (
            <span className="text-muted">’s buy of {symbol}.</span>
          )}
        </p>
        <button type="button" onClick={onDismiss} aria-label="Stop copying" title="Stop copying" className="btn btn-icon btn-ghost -mt-0.5 -mr-1.5 size-6 rounded-md">
          <IconClose size={12} />
        </button>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5" role="group" aria-label="Your size">
        <span className="mr-0.5 text-xs text-muted">Your size</span>
        {sizes.map((eth) => (
          <button
            key={eth}
            type="button"
            aria-pressed={amount === eth}
            onClick={() => pick(eth)}
            className={`num h-7 rounded-lg border px-2.5 text-xs font-medium transition-colors ${amount === eth ? "border-fg bg-fg text-bg" : "border-line bg-bg text-muted hover:text-fg"}`}
          >
            {eth === same ? `Same · ${eth}` : eth}
          </button>
        ))}
      </div>
      {mine ? null : following ? (
        <p className="mt-2.5 text-xs text-muted">You follow them, so they earn points for leading this buy. It costs you nothing.</p>
      ) : (
        <div className="mt-2.5 flex items-center justify-between gap-3">
          <p className="text-xs text-muted">Follow them and they earn points when you buy a coin after they did.</p>
          <FollowButton wallet={leader} size="sm" className="h-7 px-2.5 text-xs" />
        </div>
      )}
    </div>
  );
}
