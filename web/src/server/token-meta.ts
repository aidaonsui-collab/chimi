import { createPublicClient, getAddress, http, isAddress, type Address } from "viem";
import { factoryAbi, giwaSepolia } from "@/lib/chimi/chain";
import {
  AUTH_NONCE_RE,
  PROFILE_LIMITS,
  cleanProfile,
  hashPayload,
  registerPayload,
  tokenRegisterMessage,
  type StoredProfile,
  type TokenProfile,
} from "@/lib/chimi/profile";
import { clientIp, env } from "@/server/env";
import { kv, kvGetJson, kvMGetJson, kvReady, rateLimited } from "@/server/kv";
import deployment from "../../public/deployments.json";

/**
 * Token profiles, stored the way eve.fun stores them (Arcfun lib/arc-token-meta.ts):
 * one JSON record per token in Upstash Redis under `chimi:token:meta:<lowercase address>`,
 * written by the coin's creator with a signed register, read back in a single MGET.
 * The picture itself is a Vercel Blob URL from POST /api/upload.
 */

type TokenMetaRecord = {
  description?: string;
  imageUrl?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
  creator?: Address;
  updatedAt?: number;
};

const KEY = (token: string) => `chimi:token:meta:${token.toLowerCase()}`;
const NONCE_KEY = (nonce: string) => `chimi:auth:nonce:${nonce.toLowerCase()}`;
const client = createPublicClient({ chain: giwaSepolia, transport: http() });
const factory = deployment.factory as Address;
const explorer = giwaSepolia.blockExplorers.default.url;
const MAX_TOKENS = 50;

/** Last good record per warm instance, so a KV blip doesn't blank a picture (same idea as eve.fun). */
const lastGood = new Map<string, TokenMetaRecord>();

function json(body: unknown, status = 200, cache = "no-store") {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache },
  });
}

async function readExplorerIcon(token: Address): Promise<string | undefined> {
  try {
    const res = await fetch(`${explorer}/api/v2/tokens/${token}`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { icon_url?: string | null };
    return body.icon_url || undefined;
  } catch {
    return undefined;
  }
}

export async function getTokenMeta(request: Request) {
  const url = new URL(request.url);
  const tokens = [
    ...new Set(
      (url.searchParams.get("tokens") ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter((t) => isAddress(t, { strict: false })),
    ),
  ]
    .slice(0, MAX_TOKENS)
    .map((t) => getAddress(t));

  let records: (TokenMetaRecord | null)[] = tokens.map(() => null);
  if (kvReady() && tokens.length) {
    try {
      records = await kvMGetJson<TokenMetaRecord>(tokens.map(KEY));
      records.forEach((r, i) => r && lastGood.set(tokens[i].toLowerCase(), r));
    } catch (err) {
      console.error("token-meta read failed", err instanceof Error ? err.message : err);
      records = tokens.map((t) => lastGood.get(t.toLowerCase()) ?? null);
    }
  }

  const entries = await Promise.all(
    tokens.map(async (token, i): Promise<[string, StoredProfile | null]> => {
      const rec = records[i];
      const image = rec?.imageUrl || (await readExplorerIcon(token));
      if (!rec && !image) return [token.toLowerCase(), null];
      return [
        token.toLowerCase(),
        {
          token,
          image,
          description: rec?.description,
          twitter: rec?.twitter,
          telegram: rec?.telegram,
          website: rec?.website,
          creator: rec?.creator,
          source: rec ? "chimi" : "explorer",
        },
      ];
    }),
  );
  const profiles = Object.fromEntries(entries.filter(([, v]) => v));
  // Browsers always ask the CDN (max-age=0). If any requested token has no Chimi profile yet, keep the
  // CDN copy short so a creator's new picture shows up within seconds instead of after a long stale window.
  const complete = tokens.every((t) => profiles[t.toLowerCase()]?.source === "chimi");
  const cache = complete
    ? "public, max-age=0, s-maxage=60, stale-while-revalidate=300"
    : "public, max-age=0, s-maxage=10, stale-while-revalidate=20";
  return json({ storage: kvReady() && Boolean(env("BLOB_READ_WRITE_TOKEN")), profiles }, 200, cache);
}

type PostBody = TokenProfile & {
  token?: string;
  signature?: `0x${string}`;
  timestamp?: number;
  nonce?: string;
};

export async function postTokenMeta(request: Request) {
  if (!kvReady()) {
    return json({ error: "Shared token profiles aren't switched on yet. Connect an Upstash Redis (KV) store to this project." }, 503);
  }
  if (await rateLimited("register", clientIp(request), 10, 60, true)) {
    return json({ error: "Too many requests. Wait a minute and try again." }, 429);
  }
  const body = (await request.json().catch(() => ({}))) as PostBody;
  if (!body.token || !isAddress(body.token, { strict: false })) return json({ error: "invalid token" }, 400);
  if (!body.signature || !/^0x[0-9a-f]+$/i.test(body.signature)) return json({ error: "missing signature" }, 400);
  if (!body.nonce || !AUTH_NONCE_RE.test(body.nonce)) return json({ error: "invalid nonce" }, 400);
  const timestamp = Number(body.timestamp);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > PROFILE_LIMITS.maxSkewMs) {
    return json({ error: "Signature expired. Sign again." }, 400);
  }
  const token = getAddress(body.token);
  const cleaned = cleanProfile(body);
  if ("error" in cleaned) return json({ error: cleaned.error }, 400);

  let creator: Address;
  try {
    const pool = await client.readContract({ address: factory, abi: factoryAbi, functionName: "getPool", args: [token] });
    creator = pool.creator;
  } catch {
    return json({ error: "Token is not on the Chimi factory." }, 404);
  }
  if (!creator || /^0x0{40}$/i.test(creator)) return json({ error: "Token is not on the Chimi factory." }, 404);

  const message = tokenRegisterMessage({
    token,
    payloadHash: hashPayload(registerPayload(token, cleaned.profile)),
    nonce: body.nonce,
    timestamp,
  });
  const valid = await client.verifyMessage({ address: creator, message, signature: body.signature }).catch(() => false);
  if (!valid) return json({ error: "Only the coin's creator can set its picture." }, 401);

  // Single-use nonce so a captured signature can't be replayed.
  const fresh = await kv<string | null>("SET", NONCE_KEY(body.nonce), "1", "NX", "EX", 60 * 60);
  if (fresh !== "OK") return json({ error: "signature already used — sign again" }, 401);

  // Same merge rule as eve.fun: if the read fails, write nothing rather than wiping fields.
  let prev: TokenMetaRecord;
  try {
    prev = (await kvGetJson<TokenMetaRecord>(KEY(token))) ?? {};
  } catch {
    return json({ error: "could not save token" }, 503);
  }
  const next: TokenMetaRecord = { ...prev, creator, updatedAt: Date.now() };
  for (const [k, v] of Object.entries(cleaned.profile) as [keyof TokenProfile, string][]) {
    if (v) next[k] = v;
    else delete next[k];
  }
  try {
    await kv("SET", KEY(token), JSON.stringify(next));
  } catch {
    return json({ error: "could not save token" }, 503);
  }
  lastGood.set(token.toLowerCase(), next);
  const profile: StoredProfile = {
    token,
    image: next.imageUrl,
    description: next.description,
    twitter: next.twitter,
    telegram: next.telegram,
    website: next.website,
    creator,
    source: "chimi",
  };
  return json({ ok: true, profile });
}
