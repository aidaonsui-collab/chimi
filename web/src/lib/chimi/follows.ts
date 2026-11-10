import { useCallback, useEffect, useState } from "react";
import { emptyFollows, followMessage, followingOf, type FollowAction, type FollowsState } from "@/lib/chimi/follow-rules";
import type { Trade } from "@/lib/chimi/ledger-rules";
import { shared } from "@/lib/chimi/rewards";
import { useChimi } from "@/components/chimi/provider";

type FollowsResponse = { state: FollowsState; writable: boolean };

const follows = shared(async (): Promise<FollowsResponse> => {
  const res = await fetch("/api/follows");
  const body = (await res.json().catch(() => null)) as FollowsResponse | null;
  if (!res.ok || !body?.state) return { state: emptyFollows(), writable: false };
  return body;
}, 30_000);

/** Who follows whom, shared by every component that asks and refreshed while any of them is open. */
export const useFollows = follows.use;

/** Signs one follow or unfollow with the connected wallet (connecting first if needed) and sends it. */
export function useFollowAction() {
  const { account, connect, signMessage } = useChimi();
  const [pending, setPending] = useState<string | null>(null);
  const run = useCallback(
    async (action: FollowAction): Promise<{ ok: true } | { ok: false; error: string; cancelled?: boolean }> => {
      setPending(action.wallet.toLowerCase());
      try {
        const time = Date.now();
        let who: string | undefined;
        let signature: string;
        try {
          who = account ?? (await connect())?.who;
          if (!who) throw new Error("Connect a wallet first.");
          signature = await signMessage(followMessage(action, who, time));
        } catch (e) {
          const text = e instanceof Error ? `${e.name} ${e.message}` : String(e);
          if (/reject|denied|cancel/i.test(text)) return { ok: false, error: "You cancelled the signature.", cancelled: true };
          return { ok: false, error: e instanceof Error && /No wallet|Connect/.test(e.message) ? e.message : "Your wallet couldn't sign the message." };
        }
        const res = await fetch("/api/follows", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ wallet: who, action, time, signature }),
        });
        const body = (await res.json().catch(() => ({}))) as Partial<FollowsResponse> & { error?: string };
        if (!res.ok || !body.state) return { ok: false, error: body.error ?? "Something went wrong. Try again." };
        follows.put(body as FollowsResponse);
        return { ok: true };
      } finally {
        setPending(null);
      }
    },
    [account, connect, signMessage],
  );
  /** The wallet whose follow is being signed right now, lowercase, or null. */
  return { run, pending };
}

/** A trade in the feed: the trade itself and who made it. */
export type FeedTrade = Trade & { wallet: string };

type FeedState = { trades?: FeedTrade[]; loading: boolean };

/**
 * The latest trades by the wallets this one follows, from the server's trade record. It reaches further back than a
 * day but stops a few minutes short of now, so the page puts the trades it has read live on top.
 */
export function useFeed(wallet: string | undefined, state: FollowsState | undefined): FeedState {
  const following = followingOf(state, wallet);
  // The address changes with the list, so following someone new never shows a cached, older feed.
  const stamp = `${following.length}-${following[0]?.slice(2, 10) ?? ""}`;
  const [feed, setFeed] = useState<FeedState & { of?: string }>({ loading: true });
  useEffect(() => {
    if (!wallet || following.length === 0) return;
    let cancel = false;
    const key = `${wallet}:${stamp}`;
    const read = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/feed?wallet=${wallet.toLowerCase()}&f=${stamp}`);
        const body = (await res.json().catch(() => null)) as { trades?: FeedTrade[] } | null;
        if (!cancel && res.ok && body?.trades) setFeed({ trades: body.trades, loading: false, of: key });
        else if (!cancel) setFeed((prev) => ({ ...prev, loading: false, of: key }));
      } catch {
        if (!cancel) setFeed((prev) => ({ ...prev, loading: false, of: key }));
      }
    };
    void read();
    const timer = setInterval(() => void read(), 60_000);
    return () => {
      cancel = true;
      clearInterval(timer);
    };
    // `stamp` stands in for the list itself.
  }, [wallet, stamp]);
  if (!wallet || following.length === 0) return { trades: [], loading: false };
  return feed.of === `${wallet}:${stamp}` ? { trades: feed.trades, loading: feed.loading } : { loading: true };
}
