import { useEffect, useState, useSyncExternalStore } from "react";
import type { XPost } from "@/lib/chimi/x-rules";

/*
 * Posts on X about Chimi coins, read from /api/x (server/x-posts.ts). The feed's list is read once for every
 * component that asks and again every EVERY_MS while the page is in view; a coin page reads its own coin's.
 */

const EVERY_MS = 60_000;

let value: XPost[] | undefined;
let loadedAt = 0;
let job: Promise<void> | undefined;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());
const visible = () => typeof document === "undefined" || document.visibilityState === "visible";

async function read(path: string): Promise<XPost[] | null> {
  try {
    const res = await fetch(path);
    const body = (await res.json().catch(() => null)) as { posts?: XPost[] } | null;
    return res.ok && Array.isArray(body?.posts) ? body.posts : null;
  } catch {
    return null;
  }
}

function load() {
  if (job || Date.now() - loadedAt < EVERY_MS - 1_000) return;
  job = read("/api/x")
    .then((posts) => {
      if (!posts) return;
      value = posts;
      loadedAt = Date.now();
      emit();
    })
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

/** The newest posts about any coin, newest first; undefined until the first read. */
export function useXPosts(): XPost[] | undefined {
  return useSyncExternalStore(
    subscribe,
    () => value,
    () => undefined,
  );
}

/** One coin's posts, newest first; undefined until read. */
export function useCoinXPosts(token: string | undefined): XPost[] | undefined {
  const [found, setFound] = useState<{ of: string; posts: XPost[] }>();
  useEffect(() => {
    if (!token) return;
    const of = token.toLowerCase();
    let off = false;
    const once = async () => {
      if (!visible()) return;
      const posts = await read(`/api/x?token=${of}`);
      if (!off && posts) setFound({ of, posts });
    };
    void once();
    const timer = setInterval(() => void once(), EVERY_MS);
    return () => {
      off = true;
      clearInterval(timer);
    };
  }, [token]);
  return token && found?.of === token.toLowerCase() ? found.posts : undefined;
}
