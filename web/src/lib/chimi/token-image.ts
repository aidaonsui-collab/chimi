import { useEffect, useMemo, useState } from "react";
import { giwaSepolia } from "@/lib/chimi/chain";
import { readTokenMeta, saveTokenMeta, type TokenMeta } from "@/lib/chimi/meta";
import { cleanProfile, profileHash, profileMessage, type StoredProfile, type TokenProfile } from "@/lib/chimi/profile";

const IPFS_GATEWAY = "https://ipfs.io/ipfs/";
const ARWEAVE_GATEWAY = "https://arweave.net/";

/** Turns a stored image URI (ipfs://, ar://, https://, data:) into something an <img> can load. */
export function resolveImage(uri?: string | null): string | undefined {
  if (!uri) return undefined;
  const value = uri.trim();
  if (!value) return undefined;
  if (value.startsWith("data:image/")) return value;
  if (/^ipfs:\/\//i.test(value)) return IPFS_GATEWAY + value.replace(/^ipfs:\/\/(ipfs\/)?/i, "");
  if (/^ar:\/\//i.test(value)) return ARWEAVE_GATEWAY + value.replace(/^ar:\/\//i, "");
  if (/^https?:\/\//i.test(value)) return value;
  if (/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-z2-7]{20,})/.test(value)) return IPFS_GATEWAY + value;
  return undefined;
}

/* Shared profile cache. Every page that shows a token picture reads through here. */
const shared = new Map<string, StoredProfile | null>();
const inflight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
let storageOn: boolean | undefined;

function notify() {
  for (const fn of listeners) fn();
}

async function fetchProfiles(tokens: string[]) {
  const missing = tokens.filter((t) => !shared.has(t) && !inflight.has(t));
  if (missing.length === 0) return;
  const job = (async () => {
    try {
      const res = await fetch(`/api/token-meta?tokens=${missing.join(",")}`);
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { storage?: boolean; profiles?: Record<string, StoredProfile> };
      storageOn = Boolean(body.storage);
      for (const t of missing) shared.set(t, body.profiles?.[t] ?? null);
    } catch {
      for (const t of missing) shared.set(t, null);
    } finally {
      for (const t of missing) inflight.delete(t);
      notify();
    }
  })();
  for (const t of missing) inflight.set(t, job);
  await job;
}

export type ResolvedMeta = TokenMeta & { shared: boolean };

function merge(token: string): ResolvedMeta | null {
  const remote = shared.get(token) ?? null;
  const local = readTokenMeta(token);
  if (!remote && !local) return null;
  return {
    description: remote?.description || local?.description || "",
    image: resolveImage(remote?.image) ?? resolveImage(local?.image),
    twitter: remote?.twitter || local?.twitter,
    telegram: remote?.telegram || local?.telegram,
    website: remote?.website || local?.website,
    shared: remote?.source === "chimi",
  };
}

/**
 * Profiles (picture, description, links) for a list of tokens, keyed by lowercase address.
 * Shared profiles come from /api/token-meta; the launching browser's local copy fills any gaps.
 */
export function useTokenProfiles(tokens: readonly string[]) {
  const key = useMemo(() => [...new Set(tokens.map((t) => t.toLowerCase()))].sort().join(","), [tokens]);
  const [tick, setTick] = useState(0);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const fn = () => setTick((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  useEffect(() => {
    // Preview coins (0xaaa1…) are layout placeholders and have no profile to fetch.
    const list = key ? key.split(",").filter((t) => !t.startsWith("0xaaa1")) : [];
    if (list.length) void fetchProfiles(list);
  }, [key]);
  return useMemo(() => {
    const out: Record<string, ResolvedMeta> = {};
    // Render nothing on the server and on the hydration pass so markup matches.
    if (!mounted) return out;
    for (const t of key ? key.split(",") : []) {
      const m = merge(t);
      if (m) out[t] = m;
    }
    return out;
  }, [key, tick, mounted]);
}

/** Lowercase address -> resolved picture URL. */
export function useTokenImages(tokens: readonly string[]): Record<string, string> {
  const profiles = useTokenProfiles(tokens);
  return useMemo(() => {
    const out: Record<string, string> = {};
    for (const [t, m] of Object.entries(profiles)) if (m.image) out[t] = m.image;
    return out;
  }, [profiles]);
}

export function useTokenProfile(token?: string) {
  const list = useMemo(() => (token ? [token] : []), [token]);
  const profiles = useTokenProfiles(list);
  return token ? profiles[token.toLowerCase()] ?? null : null;
}

export function sharedStorageEnabled() {
  return storageOn;
}

/**
 * Publishes a token profile for everyone. The creator wallet signs the profile hash;
 * the server checks the signer against the factory's recorded creator.
 */
export async function publishTokenProfile(
  token: string,
  input: TokenProfile,
  sign: (message: string) => Promise<`0x${string}`>,
): Promise<void> {
  const cleaned = cleanProfile(input);
  if ("error" in cleaned) throw new Error(cleaned.error);
  const issuedAt = new Date().toISOString();
  const message = profileMessage(token, giwaSepolia.id, profileHash(cleaned.profile), issuedAt);
  const signature = await sign(message);
  const res = await fetch("/api/token-meta", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, profile: cleaned.profile, issuedAt, signature }),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; profile?: StoredProfile };
  if (!res.ok || !body.profile) throw new Error(body.error || `Could not publish (${res.status}).`);
  shared.set(token.toLowerCase(), body.profile);
  storageOn = true;
  saveTokenMeta(token, { description: cleaned.profile.description ?? "", ...cleaned.profile });
  notify();
}

/** Re-reads localStorage-backed profiles (after a launch saves one). */
export function refreshTokenProfiles() {
  notify();
}
