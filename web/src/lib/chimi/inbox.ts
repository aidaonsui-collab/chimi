import { useCallback, useEffect, useMemo, useState } from "react";
import { rowsOf, unreadCount, type InboxItem } from "@/lib/chimi/inbox-rules";
import { useChimi } from "@/components/chimi/provider";

const EVERY_MS = 45_000;
const seenKey = (wallet: string) => `chimi.inbox.seen.${wallet}`;

function readSeen(wallet: string): number {
  try {
    return Number(localStorage.getItem(seenKey(wallet))) || 0;
  } catch {
    return 0;
  }
}

/**
 * The connected wallet's inbox: read when the wallet connects, then every 45 seconds while the page is in view.
 * What has been seen is remembered in this browser, so reading takes no signature.
 */
export function useInbox() {
  const { account } = useChimi();
  const me = account?.toLowerCase();
  const [state, setState] = useState<{ of?: string; items: InboxItem[]; ready: boolean }>({ items: [], ready: false });
  const [seen, setSeen] = useState<{ of?: string; at: number }>({ at: 0 });

  useEffect(() => {
    if (!me) return;
    setSeen({ of: me, at: readSeen(me) });
    let cancel = false;
    const read = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/inbox?wallet=${me}`);
        const body = (await res.json().catch(() => null)) as { items?: InboxItem[] } | null;
        if (cancel) return;
        if (res.ok && body?.items) setState({ of: me, items: body.items, ready: true });
        else setState((prev) => (prev.of === me ? { ...prev, ready: true } : { of: me, items: [], ready: true }));
      } catch {
        if (!cancel) setState((prev) => (prev.of === me ? { ...prev, ready: true } : { of: me, items: [], ready: true }));
      }
    };
    void read();
    const timer = setInterval(() => void read(), EVERY_MS);
    document.addEventListener("visibilitychange", read);
    return () => {
      cancel = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", read);
    };
  }, [me]);

  const mine = me && state.of === me ? state : { items: [] as InboxItem[], ready: false };
  const seenAt = me && seen.of === me ? seen.at : 0;
  const rows = useMemo(() => rowsOf(mine.items), [mine.items]);

  /** Everything up to now has been seen. */
  const markSeen = useCallback(() => {
    if (!me) return;
    const at = Date.now();
    setSeen({ of: me, at });
    try {
      localStorage.setItem(seenKey(me), String(at));
    } catch {
      /* private mode: it lasts for this page */
    }
  }, [me]);

  return { me, rows, ready: mine.ready, seenAt, unread: unreadCount(mine.items, seenAt), markSeen };
}
