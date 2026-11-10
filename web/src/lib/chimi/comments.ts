import { useCallback, useEffect, useRef, useState } from "react";
import { commentMessage, type CommentAction, type CommentsView } from "@/lib/chimi/comment-rules";
import { useChimi } from "@/components/chimi/provider";

const PAGE = 50;
const EVERY_MS = 30_000;

export type CommentResult = { ok: true } | { ok: false; error: string; cancelled?: boolean };

/**
 * One coin's comments, read again every half minute while the page is in view, and the way to add or delete one:
 * a message the connected wallet signs (connecting first if needed), not a transaction.
 */
export function useComments(token: string | undefined) {
  const { account, connect, signMessage } = useChimi();
  const key = token?.toLowerCase();
  const [limit, setLimit] = useState(PAGE);
  const [state, setState] = useState<{ of?: string; view?: CommentsView; failed?: boolean }>({});
  /** "post" while a new comment is being signed and sent, or the id of the one being deleted. */
  const [pending, setPending] = useState<string | null>(null);
  // The time of this browser's last change. It goes in the address so a cached, older page is never read after it,
  // and an answer that was already on its way when the change was made is dropped.
  const changed = useRef(0);

  useEffect(() => {
    if (!key) return;
    let cancel = false;
    const read = async () => {
      if (document.visibilityState !== "visible") return;
      const stamp = changed.current;
      try {
        const res = await fetch(`/api/comments?token=${key}&limit=${limit}${stamp ? `&v=${stamp}` : ""}`);
        const body = (await res.json().catch(() => null)) as CommentsView | null;
        if (cancel || stamp !== changed.current) return;
        if (res.ok && body?.items) setState({ of: key, view: body });
        else setState((prev) => (prev.of === key && prev.view ? prev : { of: key, failed: true }));
      } catch {
        if (!cancel) setState((prev) => (prev.of === key && prev.view ? prev : { of: key, failed: true }));
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
  }, [key, limit]);

  const send = useCallback(
    async (action: CommentAction): Promise<CommentResult> => {
      if (!key) return { ok: false, error: "This coin has no comments." };
      setPending(action.type === "post" ? "post" : action.id);
      try {
        const time = Date.now();
        let who: string | undefined;
        let signature: string;
        try {
          who = account ?? (await connect())?.who;
          if (!who) throw new Error("Connect a wallet first.");
          signature = await signMessage(commentMessage(action, key, who, time));
        } catch (e) {
          const text = e instanceof Error ? `${e.name} ${e.message}` : String(e);
          if (/reject|denied|cancel/i.test(text)) return { ok: false, error: "You cancelled the signature.", cancelled: true };
          return { ok: false, error: e instanceof Error && /No wallet|Connect/.test(e.message) ? e.message : "Your wallet couldn't sign the message." };
        }
        const res = await fetch("/api/comments", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: key, wallet: who, action, time, signature, limit }),
        });
        const body = (await res.json().catch(() => ({}))) as Partial<CommentsView> & { error?: string };
        if (!res.ok || !body.items) return { ok: false, error: body.error ?? "Something went wrong. Try again." };
        changed.current = time;
        setState({ of: key, view: body as CommentsView });
        return { ok: true };
      } finally {
        setPending(null);
      }
    },
    [key, limit, account, connect, signMessage],
  );

  const mine = state.of === key ? state : {};
  return {
    view: mine.view,
    /** True when the first read failed and there is nothing to show. */
    failed: !!mine.failed && !mine.view,
    pending,
    send,
    /** Asks for older comments too, up to everything the coin keeps. */
    showOlder: useCallback(() => setLimit((n) => Math.min(500, n * 4)), []),
  };
}

export type CommentThread = ReturnType<typeof useComments>;
