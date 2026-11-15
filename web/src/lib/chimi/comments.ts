import { useCallback, useEffect, useRef, useState } from "react";
import { PASS_TTL_MS, checkPass, commentMessage, likePassMessage, type CommentsView, type SignedAction } from "@/lib/chimi/comment-rules";
import { useChimi } from "@/components/chimi/provider";

const PAGE = 50;
const EVERY_MS = 30_000;

export type CommentResult = { ok: true } | { ok: false; error: string; cancelled?: boolean };

const cancelled = (e: unknown) => /reject|denied|cancel/i.test(e instanceof Error ? `${e.name} ${e.message}` : String(e));

/*
 * The like pass: one signature that lets this browser like and unlike comments as the wallet for a week, so a like is
 * one press. It is kept in this browser only and allows nothing else (comment-rules.ts).
 */
type Pass = { until: number; signature: string };

const passKey = (wallet: string) => `chimi.likes.pass.${wallet.toLowerCase()}`;

function savedPass(wallet: string): Pass | null {
  try {
    const found = JSON.parse(localStorage.getItem(passKey(wallet)) ?? "null") as Pass | null;
    // A pass about to run out is renewed now rather than halfway through a like.
    if (!found || typeof found.signature !== "string" || checkPass(found.until, Date.now() + 60_000)) return null;
    return found;
  } catch {
    return null;
  }
}

function forgetPass(wallet: string) {
  try {
    localStorage.removeItem(passKey(wallet));
  } catch {
    /* private mode: there was nothing kept */
  }
}

async function passFor(wallet: string, sign: (message: string) => Promise<string>): Promise<Pass> {
  const saved = savedPass(wallet);
  if (saved) return saved;
  const until = Math.floor((Date.now() + PASS_TTL_MS) / 1000) * 1000;
  const pass = { until, signature: await sign(likePassMessage(wallet, until)) };
  try {
    localStorage.setItem(passKey(wallet), JSON.stringify(pass));
  } catch {
    /* private mode: the pass lasts for this page */
  }
  return pass;
}

export type LikeResult = { ok: true; view: CommentsView } | { ok: false; error: string; cancelled?: boolean };

/**
 * Likes or unlikes one comment as the connected wallet (connecting first if needed). The first like in a browser asks
 * the wallet for the pass; after that a like is sent at once.
 */
export function useLike() {
  const { account, connect, signMessage } = useChimi();
  return useCallback(
    async (token: string, id: string, on: boolean, limit = PAGE): Promise<LikeResult> => {
      let who: string | undefined;
      try {
        who = account ?? (await connect())?.who;
        if (!who) throw new Error("Connect a wallet first.");
      } catch (e) {
        if (cancelled(e)) return { ok: false, error: "You cancelled.", cancelled: true };
        return { ok: false, error: e instanceof Error && /No wallet|Connect/.test(e.message) ? e.message : "Couldn’t connect your wallet." };
      }
      // A pass the server no longer takes (it ran out, or the clock moved) is signed for again, once.
      for (let attempt = 0; attempt < 2; attempt++) {
        let pass: Pass;
        try {
          pass = await passFor(who, signMessage);
        } catch (e) {
          if (cancelled(e)) return { ok: false, error: "You cancelled the signature.", cancelled: true };
          return { ok: false, error: "Your wallet couldn’t sign the message." };
        }
        const res = await fetch("/api/comments", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: token.toLowerCase(), wallet: who, action: { type: on ? "like" : "unlike", id }, pass, limit }),
        }).catch(() => null);
        const body = (res ? await res.json().catch(() => ({})) : {}) as Partial<CommentsView> & { error?: string };
        if (res?.ok && body.items) return { ok: true, view: body as CommentsView };
        if (res?.status === 401 && attempt === 0) {
          forgetPass(who);
          continue;
        }
        return { ok: false, error: body.error ?? "Something went wrong. Try again." };
      }
      return { ok: false, error: "Something went wrong. Try again." };
    },
    [account, connect, signMessage],
  );
}

/**
 * One coin's comments, read again every half minute while the page is in view, and the ways to change them: write,
 * answer or delete with a message the connected wallet signs (connecting first if needed), and like with one press.
 * None of it is a transaction.
 */
export function useComments(token: string | undefined) {
  const { account, connect, signMessage } = useChimi();
  const sendLike = useLike();
  const key = token?.toLowerCase();
  const me = account?.toLowerCase();
  const [limit, setLimit] = useState(PAGE);
  const [state, setState] = useState<{ of?: string; view?: CommentsView; failed?: boolean }>({});
  /** "post" while a new comment is being signed and sent, "reply:<id>" for an answer, or the id of the one being deleted. */
  const [pending, setPending] = useState<string | null>(null);
  // The time of this browser's last change. It goes in the address so a cached, older page is never read after it,
  // and an answer that was already on its way when the change was made is dropped.
  const changed = useRef(0);
  /** Likes on their way to the server. The page isn't read again until they have landed, so a heart never flickers. */
  const liking = useRef(0);

  useEffect(() => {
    if (!key) return;
    let cancel = false;
    const read = async () => {
      if (document.visibilityState !== "visible" || liking.current > 0) return;
      const stamp = changed.current;
      try {
        const res = await fetch(`/api/comments?token=${key}&limit=${limit}${me ? `&wallet=${me}` : ""}${stamp ? `&v=${stamp}` : ""}`);
        const body = (await res.json().catch(() => null)) as CommentsView | null;
        if (cancel || stamp !== changed.current || liking.current > 0) return;
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
  }, [key, limit, me]);

  const send = useCallback(
    async (action: SignedAction): Promise<CommentResult> => {
      if (!key) return { ok: false, error: "This coin has no comments." };
      setPending(action.type === "delete" ? action.id : action.replyTo ? `reply:${action.replyTo}` : "post");
      try {
        const time = Date.now();
        let who: string | undefined;
        let signature: string;
        try {
          who = account ?? (await connect())?.who;
          if (!who) throw new Error("Connect a wallet first.");
          signature = await signMessage(commentMessage(action, key, who, time));
        } catch (e) {
          if (cancelled(e)) return { ok: false, error: "You cancelled the signature.", cancelled: true };
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

  /** Likes or unlikes a comment. The heart moves at once and moves back if the like doesn't land. */
  const like = useCallback(
    async (id: string, on: boolean): Promise<CommentResult> => {
      if (!key) return { ok: false, error: "This coin has no comments." };
      const patch = (to: boolean) =>
        setState((prev) => {
          if (prev.of !== key || !prev.view) return prev;
          const has = prev.view.liked.includes(id);
          if (has === to) return prev;
          const count = Math.max(0, (prev.view.likes[id] ?? 0) + (to ? 1 : -1));
          const likes = { ...prev.view.likes };
          if (count > 0) likes[id] = count;
          else delete likes[id];
          return { ...prev, view: { ...prev.view, likes, liked: to ? [...prev.view.liked, id] : prev.view.liked.filter((x) => x !== id) } };
        });
      liking.current += 1;
      changed.current = Date.now();
      patch(on);
      try {
        const out = await sendLike(key, id, on, limit);
        if (!out.ok) {
          patch(!on);
          return out;
        }
        // With several likes in flight, the last answer is the one that has them all.
        if (liking.current === 1) setState({ of: key, view: out.view });
        return { ok: true };
      } finally {
        liking.current -= 1;
      }
    },
    [key, limit, sendLike],
  );

  const mine = state.of === key ? state : {};
  return {
    view: mine.view,
    /** True when the first read failed and there is nothing to show. */
    failed: !!mine.failed && !mine.view,
    pending,
    send,
    like,
    /** Asks for older threads too, up to everything the coin keeps. */
    showOlder: useCallback(() => setLimit((n) => Math.min(500, n * 4)), []),
  };
}

export type CommentThread = ReturnType<typeof useComments>;
