import { env } from "@/server/env";

/**
 * Upstash Redis over its REST API — the store eve.fun/Arcfun use through `@vercel/kv`.
 * Same env names: KV_REST_API_URL + KV_REST_API_TOKEN (Vercel KV / Upstash integration),
 * or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (Upstash console).
 */
function creds() {
  const url = env("KV_REST_API_URL") ?? env("UPSTASH_REDIS_REST_URL");
  const token = env("KV_REST_API_TOKEN") ?? env("UPSTASH_REDIS_REST_TOKEN");
  return url && token ? { url: url.replace(/\/+$/, ""), token } : null;
}

export function kvReady() {
  return Boolean(creds());
}

export async function kv<T = unknown>(...command: (string | number)[]): Promise<T> {
  const c = creds();
  if (!c) throw new Error("KV is not configured");
  const res = await fetch(c.url, {
    method: "POST",
    headers: { authorization: `Bearer ${c.token}`, "content-type": "application/json" },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(5000),
  });
  const body = (await res.json().catch(() => ({}))) as { result?: T; error?: string };
  if (!res.ok || body.error) throw new Error(body.error || `KV ${res.status}`);
  return body.result as T;
}

export async function kvGetJson<T>(key: string): Promise<T | null> {
  const raw = await kv<string | null>("GET", key);
  return raw ? (JSON.parse(raw) as T) : null;
}

export async function kvMGetJson<T>(keys: string[]): Promise<(T | null)[]> {
  if (keys.length === 0) return [];
  const raws = await kv<(string | null)[]>("MGET", ...keys);
  return raws.map((raw) => {
    try {
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  });
}

/** Fixed-window limiter, same shape as Arcfun lib/rate-limit.ts (`<app>:rl:<bucket>:<ip>`). */
export async function rateLimited(bucket: string, ip: string, limit: number, windowSec = 60, failClosed = false) {
  const key = `chimi:rl:${bucket}:${ip}`;
  try {
    const n = await kv<number>("INCR", key);
    if (n === 1) await kv("EXPIRE", key, windowSec);
    return n > limit;
  } catch {
    return failClosed;
  }
}
