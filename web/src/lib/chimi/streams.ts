import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useChimi } from "@/components/chimi/provider";
import { streamMessage, type StreamAction, type StreamLink, type StreamStatus, type StreamView } from "@/lib/chimi/stream-rules";

/*
 * The coins with a linked stream and whether each is live, read from /api/streams once for every component that asks
 * and again every EVERY_MS while the page is in view.
 */

const EVERY_MS = 45_000;
/** How long a change made in this browser outranks the server's cached list. */
const MINE_MS = 120_000;

let value: Record<string, StreamView> | undefined;
let loadedAt = 0;
let job: Promise<void> | undefined;
const listeners = new Set<() => void>();
const mine = new Map<string, { view: StreamView | null; until: number }>();

const emit = () => listeners.forEach((l) => l());
const visible = () => typeof document === "undefined" || document.visibilityState === "visible";

function withMine(streams: Record<string, StreamView>) {
  const now = Date.now();
  const out = { ...streams };
  for (const [token, { view, until }] of mine) {
    if (until < now) mine.delete(token);
    else if (view) out[token] = view;
    else delete out[token];
  }
  return out;
}

function load(force = false) {
  if (job || (!force && Date.now() - loadedAt < EVERY_MS - 1_000)) return;
  job = fetch("/api/streams")
    .then((r) => (r.ok ? (r.json() as Promise<{ streams?: Record<string, StreamView> }>) : null))
    .then((body) => {
      if (!body?.streams) return;
      value = withMine(body.streams);
      loadedAt = Date.now();
      emit();
    })
    .catch(() => undefined)
    .finally(() => {
      job = undefined;
    });
}

function subscribe(l: () => void) {
  listeners.add(l);
  if (listeners.size > 1) return () => listeners.delete(l);
  load();
  const timer = setInterval(() => visible() && load(), EVERY_MS);
  const onShow = () => visible() && load();
  document.addEventListener("visibilitychange", onShow);
  return () => {
    listeners.delete(l);
    if (listeners.size === 0) {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
    }
  };
}

/** Every coin with a linked stream, by lowercase address; undefined until the first read. */
export function useStreams() {
  return useSyncExternalStore(
    subscribe,
    () => value,
    () => undefined,
  );
}

/** One coin's stream: null when it has none, undefined until known. */
export function useStream(token: string | undefined): StreamView | null | undefined {
  const streams = useStreams();
  if (!token || !streams) return undefined;
  return streams[token.toLowerCase()] ?? null;
}

/** The coins that are live right now. */
export function useLiveTokens(): ReadonlySet<string> {
  const streams = useStreams();
  return useMemo(() => new Set(Object.values(streams ?? {}).filter((s) => s.status.live).map((s) => s.token)), [streams]);
}

/** Shows a change made here at once, before the server's cached list catches up. */
export function noteStream(token: string, view: StreamView | null) {
  const key = token.toLowerCase();
  mine.set(key, { view, until: Date.now() + MINE_MS });
  value = withMine(value ?? {});
  emit();
}

export type LinkCheck = { ok: true; link: StreamLink; url: string; status: StreamStatus } | { ok: false; error: string };

/** What a pasted link points at and whether it's live now, asked of the server. */
export async function checkStreamLink(input: string, signal?: AbortSignal): Promise<LinkCheck> {
  const res = await fetch(`/api/streams?check=${encodeURIComponent(input.trim())}`, { signal }).catch((e) => {
    if (signal?.aborted) throw e;
    return null;
  });
  if (!res) return { ok: false, error: "Couldn't reach Chimi. Check your connection and try again." };
  const body = (await res.json().catch(() => ({}))) as Partial<Extract<LinkCheck, { ok: true }>> & { error?: string };
  if (!res.ok || !body.link || !body.status) return { ok: false, error: body.error ?? "Couldn't check that link. Try again." };
  return { ok: true, link: body.link, url: body.url ?? "", status: body.status };
}

export type StreamSendResult = { ok: true; stream: StreamView | null } | { ok: false; error: string; cancelled?: boolean };

const cancelled = (e: unknown) => /reject|denied|cancel/i.test(e instanceof Error ? `${e.name} ${e.message}` : String(e));

/** Links or removes a coin's stream with a message the connected wallet signs (connecting first if needed). */
export function useStreamSend() {
  const { account, connect, signMessage } = useChimi();
  return useCallback(
    async (token: string, action: StreamAction): Promise<StreamSendResult> => {
      const key = token.toLowerCase();
      const time = Date.now();
      let who: string | undefined;
      let signature: string;
      try {
        who = account ?? (await connect())?.who;
        if (!who) throw new Error("Connect a wallet first.");
        signature = await signMessage(streamMessage(action, key, who, time));
      } catch (e) {
        if (cancelled(e)) return { ok: false, error: "You cancelled the signature.", cancelled: true };
        return { ok: false, error: e instanceof Error && /No wallet|Connect/.test(e.message) ? e.message : "Your wallet couldn't sign the message." };
      }
      const res = await fetch("/api/streams", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: key, wallet: who, action, time, signature }),
      }).catch(() => null);
      if (!res) return { ok: false, error: "Couldn't reach Chimi. Check your connection and try again." };
      const body = (await res.json().catch(() => ({}))) as { stream?: StreamView | null; error?: string };
      if (!res.ok || body.stream === undefined) return { ok: false, error: body.error ?? "Something went wrong. Try again." };
      noteStream(key, body.stream);
      return { ok: true, stream: body.stream };
    },
    [account, connect, signMessage],
  );
}
