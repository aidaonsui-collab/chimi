import { Link, useLocation } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ago, ethText } from "@/lib/chimi/format";
import { useInbox } from "@/lib/chimi/inbox";
import type { InboxRow } from "@/lib/chimi/inbox-rules";
import { shortAddr } from "@/lib/chimi/market";
import type { Profile } from "@/lib/chimi/points-rules";
import { shortWallet, usePoints, useProfiles } from "@/lib/chimi/rewards";
import { IconBell, IconBolt, IconComment, IconHeart, IconReply, IconTraders } from "@/components/chimi/icons";
import { useChimi } from "@/components/chimi/provider";
import { Blockie } from "@/components/chimi/ui";

const nameOf = (profiles: Record<string, Profile>, wallet: string) => profiles[wallet]?.name?.replace(/\.up\.id$/, "") ?? shortWallet(wallet);

const MARK: Record<InboxRow["kind"], { icon: ReactNode; tone: string }> = {
  reply: { icon: <IconReply size={11} />, tone: "bg-gold text-bg" },
  comment: { icon: <IconComment size={11} />, tone: "bg-gold text-bg" },
  like: { icon: <IconHeart size={11} fill="currentColor" />, tone: "bg-seal text-onseal" },
  follow: { icon: <IconTraders size={11} />, tone: "bg-fg text-bg" },
  led: { icon: <IconBolt size={11} />, tone: "bg-ok text-bg" },
};

/**
 * The bell in the top bar, for a connected wallet: answers to and likes of its comments, comments on its coins, new
 * followers, and buys made after its own. Opening it marks everything seen.
 */
export function InboxButton() {
  const { coins } = useChimi();
  const { me, rows, ready, seenAt, unread, markSeen } = useInbox();
  const { data: points } = usePoints();
  const [open, setOpen] = useState(false);
  /** What was seen before this opening, so the lines that are new stay marked while the panel is up. */
  const [before, setBefore] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const path = useLocation().pathname;

  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current && e.target instanceof Node && !wrap.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const shown = rows.slice(0, 40);
  const profiles = useProfiles(
    useMemo(() => (open ? [...new Set(shown.flatMap((r) => r.from.slice(0, 2)))] : []), [open, shown]),
    points?.file.profiles,
  );
  const symbols = useMemo(() => new Map(coins.map((c) => [c.token.toLowerCase(), c.symbol])), [coins]);

  if (!me) return null;

  const toggle = () => {
    if (!open) {
      setBefore(seenAt);
      markSeen();
    }
    setOpen((v) => !v);
  };

  return (
    <div ref={wrap} className="relative">
      <button type="button" onClick={toggle} aria-label={unread > 0 ? `Inbox, ${unread} new` : "Inbox"} aria-expanded={open} aria-haspopup="dialog" className={`btn btn-icon btn-secondary relative ${open ? "border-edge bg-raise2" : ""}`}>
        <IconBell size={18} />
        {unread > 0 ? <span className="inbox-badge num">{unread > 9 ? "9+" : unread}</span> : null}
      </button>
      {open ? (
        <div role="dialog" aria-label="Inbox" className="inbox-panel">
          <div className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-3">
            <h2 className="text-[15px] font-semibold">Inbox</h2>
            <span className="text-xs text-faint">Replies, likes, followers, buys after yours</span>
          </div>
          {!ready ? (
            <div className="divide-y divide-line/70" aria-busy="true">
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3.5">
                  <span className="skeleton size-8 shrink-0 rounded-full" />
                  <span className="flex-1 space-y-2">
                    <span className="skeleton block h-3.5 w-4/5" />
                    <span className="skeleton block h-3 w-2/5" />
                  </span>
                </div>
              ))}
            </div>
          ) : shown.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <p className="font-serif text-[15px] text-gold">조용함</p>
              <p className="mt-2 text-[15px] font-semibold">Nothing yet</p>
              <p className="mx-auto mt-1 max-w-[17rem] text-sm leading-relaxed text-muted">When someone answers or likes your comment, follows you, or buys a coin after you, it shows up here.</p>
            </div>
          ) : (
            <ul className="max-h-[min(30rem,calc(100dvh-10rem))] overflow-y-auto overscroll-contain">
              {shown.map((row) => (
                <Line key={row.key} row={row} fresh={row.time > before} profiles={profiles} symbol={row.token ? (symbols.get(row.token) ?? shortAddr(row.token)) : undefined} onPick={() => setOpen(false)} />
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Line({ row, fresh, profiles, symbol, onPick }: { row: InboxRow; fresh: boolean; profiles: Record<string, Profile>; symbol?: string; onPick: () => void }) {
  const who = row.from[0]!;
  const others = row.from.length - 1;
  const name = <span className="num font-semibold text-fg">{nameOf(profiles, who)}</span>;
  const coin = <span className="font-semibold text-fg">{symbol}</span>;
  const said =
    row.kind === "reply" ? (
      <>
        {name} replied {row.thread ? "in your thread" : "to you"} on {coin}
      </>
    ) : row.kind === "comment" ? (
      <>
        {name} commented on {coin}, your coin
      </>
    ) : row.kind === "like" ? (
      <>
        {name}
        {others > 0 ? ` and ${others} ${others === 1 ? "other" : "others"}` : ""} liked your comment on {coin}
      </>
    ) : row.kind === "follow" ? (
      <>{name} started following you</>
    ) : (
      <>
        {name} bought {coin} after you
      </>
    );
  const detail = row.kind === "led" ? `${ethText(row.eth)} ETH counts toward your points` : row.kind === "follow" ? "Their buys after yours earn you points" : row.text ? `“${row.text}”` : null;
  const body = (
    <>
      <span className="relative shrink-0">
        <Blockie address={who} size={34} />
        <span className={`absolute -right-1 -bottom-1 grid size-[18px] place-items-center rounded-full ring-2 ring-chip ${MARK[row.kind].tone}`}>{MARK[row.kind].icon}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] leading-snug text-fg/80 [overflow-wrap:anywhere]">{said}</span>
        {detail ? <span className="mt-0.5 block truncate text-[12.5px] text-muted">{detail}</span> : null}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1.5 self-start pt-0.5">
        <span className="num text-xs text-faint">{ago((Date.now() - row.time) / 1000)}</span>
        {fresh ? <span className="size-2 rounded-full bg-seal" aria-label="New" /> : null}
      </span>
    </>
  );
  const cls = `flex items-center gap-3 px-4 py-3 transition-colors hover:bg-raise ${fresh ? "bg-seal/[0.06]" : ""}`;
  return (
    <li className="border-b border-line/70 last:border-0">
      {row.kind === "follow" ? (
        <Link to="/u/$address" params={{ address: who }} onClick={onPick} className={cls}>
          {body}
        </Link>
      ) : row.kind === "led" ? (
        <Link to="/coin/$address" params={{ address: row.token! }} onClick={onPick} className={cls}>
          {body}
        </Link>
      ) : (
        <Link to="/coin/$address" params={{ address: row.token! }} search={{ tab: "comments", c: row.comment }} onClick={onPick} className={cls}>
          {body}
        </Link>
      )}
    </li>
  );
}
