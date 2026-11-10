import { useState } from "react";
import { NEED_DOJANG, isFollowing } from "@/lib/chimi/follow-rules";
import { useFollowAction, useFollows } from "@/lib/chimi/follows";
import { DOJANG_URL } from "@/lib/chimi/identity";
import type { Profile } from "@/lib/chimi/points-rules";
import { shortWallet } from "@/lib/chimi/rewards";
import { IconCheck, IconPlus } from "@/components/chimi/icons";
import { useChimi } from "@/components/chimi/provider";
import { DojangMark } from "@/components/chimi/rewards-bits";
import { toast } from "@/components/chimi/toast";
import { Empty, Modal, TraderLink } from "@/components/chimi/ui";

const label = (wallet: string, name?: string | null) => (name ? name.replace(/\.up\.id$/, "") : shortWallet(wallet));

/**
 * Follow or stop following a wallet. Following is a signature, not a transaction. Shows nothing on your own wallet,
 * or while the site has nowhere to keep follows.
 */
export function FollowButton({ wallet, name, size = "md", className = "" }: { wallet: string; name?: string | null; size?: "sm" | "md" | "lg"; className?: string }) {
  const { account } = useChimi();
  const { data } = useFollows();
  const { run, pending } = useFollowAction();
  const [hover, setHover] = useState(false);
  const target = wallet.toLowerCase();
  // Nothing until the list has loaded, so the button never shows "Follow" for someone you already follow.
  if (!data || account?.toLowerCase() === target || data.writable === false) return null;
  const on = isFollowing(data?.state, account, target);
  const busy = pending === target;
  const sizing = size === "sm" ? "btn-sm" : size === "lg" ? "btn-lg" : "";

  async function toggle() {
    const out = await run({ type: on ? "unfollow" : "follow", wallet: target });
    if (out.ok) {
      toast({ kind: "good", title: on ? `Stopped following ${label(target, name)}` : `Following ${label(target, name)}`, body: on ? undefined : "Their trades now show under Following on the home page." });
    } else if (!out.cancelled) {
      const needsDojang = out.error === NEED_DOJANG;
      toast({
        kind: "bad",
        title: needsDojang ? "Following needs a Dojang" : "Couldn’t save that",
        body: needsDojang ? "Only verified wallets can follow, so a follower count is a count of people. It’s free on GIWA." : out.error,
        href: needsDojang ? DOJANG_URL : undefined,
        linkLabel: "Get a Dojang",
      });
    }
  }

  return (
    <button
      type="button"
      disabled={busy}
      aria-pressed={on}
      onClick={(e) => {
        // The button often sits inside a row that is itself a link.
        e.preventDefault();
        e.stopPropagation();
        void toggle();
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      className={`btn ${sizing} ${on ? (hover ? "border-down/50 bg-down/10 text-down" : "btn-secondary") : "btn-light"} ${className}`}
    >
      {busy ? (
        "Sign in your wallet…"
      ) : on ? (
        hover ? (
          "Stop following"
        ) : (
          <>
            <IconCheck size={size === "sm" ? 13 : 15} />
            Following
          </>
        )
      ) : (
        <>
          <IconPlus size={size === "sm" ? 13 : 15} />
          Follow
        </>
      )}
    </button>
  );
}

/** A list of wallets, each with its name and a follow button: who someone follows, or who follows them. */
export function WalletListModal({ title, kicker, wallets, profiles, emptyText, onClose }: { title: string; kicker?: string; wallets: string[]; profiles: Record<string, Profile>; emptyText: string; onClose: () => void }) {
  return (
    <Modal title={title} kicker={kicker} onClose={onClose} width={460}>
      {wallets.length === 0 ? (
        <Empty title="Nobody yet">{emptyText}</Empty>
      ) : (
        <ul className="-mx-2 mt-4 max-h-[60dvh] overflow-y-auto">
          {wallets.map((wallet) => (
            <li key={wallet} className="flex items-center justify-between gap-3 rounded-xl px-2 py-2 hover:bg-raise">
              <span className="flex min-w-0 items-center gap-1.5 text-[15px] font-medium" onClick={onClose}>
                <TraderLink address={wallet} name={profiles[wallet]?.name} size={28} className="gap-3" />
                <DojangMark verified={profiles[wallet]?.verified} />
              </span>
              <FollowButton wallet={wallet} name={profiles[wallet]?.name} size="sm" />
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
