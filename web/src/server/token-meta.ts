import { createPublicClient, getAddress, http, isAddress, type Address } from "viem";
import { factoryAbi, giwaSepolia } from "@/lib/chimi/chain";
import {
  PROFILE_LIMITS,
  cleanProfile,
  profileHash,
  profileMessage,
  type StoredProfile,
  type TokenProfile,
} from "@/lib/chimi/profile";
import deployment from "../../public/deployments.json";

/**
 * Token profile storage.
 *
 * Reads: the Chimi profile stored in Vercel Blob (if the project has a Blob store),
 * then the explorer's token icon (Blockscout `icon_url`) as a fallback.
 * Writes: only the coin's creator (from the factory's getPool) can publish, by signing
 * the profile hash with their wallet. Writes need BLOB_READ_WRITE_TOKEN, which Vercel adds
 * automatically when a Blob store is connected to the project.
 */

const client = createPublicClient({ chain: giwaSepolia, transport: http() });
const factory = deployment.factory as Address;
const explorer = giwaSepolia.blockExplorers.default.url;
const MAX_TOKENS = 50;

function json(body: unknown, status = 200, cache = "no-store") {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache },
  });
}

function env(name: string): string | undefined {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name];
}

function storageReady() {
  return Boolean(env("BLOB_READ_WRITE_TOKEN"));
}

const metaPath = (token: Address) => `token-meta/${token.toLowerCase()}.json`;

async function readStored(token: Address): Promise<StoredProfile | null> {
  if (!storageReady()) return null;
  const { head, BlobNotFoundError } = await import("@vercel/blob");
  try {
    const found = await head(metaPath(token));
    const res = await fetch(`${found.url}?v=${encodeURIComponent(found.uploadedAt.toISOString())}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as StoredProfile;
  } catch (err) {
    if (err instanceof BlobNotFoundError) return null;
    console.error("token-meta read failed", token, err);
    return null;
  }
}

async function readExplorerIcon(token: Address): Promise<StoredProfile | null> {
  try {
    const res = await fetch(`${explorer}/api/v2/tokens/${token}`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { icon_url?: string | null };
    return body.icon_url ? { token, image: body.icon_url, source: "explorer" } : null;
  } catch {
    return null;
  }
}

export async function getTokenMeta(request: Request) {
  const url = new URL(request.url);
  const tokens = [...new Set((url.searchParams.get("tokens") ?? "").split(",").map((t) => t.trim()).filter((t) => isAddress(t, { strict: false })))]
    .slice(0, MAX_TOKENS)
    .map((t) => getAddress(t));
  const entries = await Promise.all(
    tokens.map(async (token) => {
      const stored = await readStored(token);
      const icon = stored?.image ? null : await readExplorerIcon(token);
      const merged = stored ? { ...stored, image: stored.image || icon?.image } : icon;
      return [token.toLowerCase(), merged] as const;
    }),
  );
  const profiles = Object.fromEntries(entries.filter(([, v]) => v));
  return json({ storage: storageReady(), profiles }, 200, "public, max-age=15, s-maxage=30, stale-while-revalidate=300");
}

type PostBody = {
  token?: string;
  profile?: TokenProfile;
  issuedAt?: string;
  signature?: `0x${string}`;
};

export async function postTokenMeta(request: Request) {
  if (!storageReady()) {
    return json({ error: "Shared token pictures aren't switched on yet. Connect a Vercel Blob store to this project." }, 503);
  }
  let body: PostBody;
  try {
    const raw = await request.text();
    if (raw.length > PROFILE_LIMITS.imageBytes + 10_000) return json({ error: "Profile is too large." }, 413);
    body = JSON.parse(raw) as PostBody;
  } catch {
    return json({ error: "Bad request." }, 400);
  }
  if (!body.token || !isAddress(body.token, { strict: false })) return json({ error: "Missing token." }, 400);
  if (!body.signature || !body.issuedAt || !body.profile) return json({ error: "Missing signature." }, 400);
  const token = getAddress(body.token);
  const issued = Date.parse(body.issuedAt);
  if (!Number.isFinite(issued) || Math.abs(Date.now() - issued) > PROFILE_LIMITS.maxAgeMs) {
    return json({ error: "Signature expired. Try again." }, 400);
  }
  const cleaned = cleanProfile(body.profile);
  if ("error" in cleaned) return json({ error: cleaned.error }, 400);

  let creator: Address;
  try {
    const pool = await client.readContract({ address: factory, abi: factoryAbi, functionName: "getPool", args: [token] });
    creator = pool.creator;
  } catch {
    return json({ error: "Token is not on the Chimi factory." }, 404);
  }
  if (!creator || /^0x0{40}$/i.test(creator)) return json({ error: "Token is not on the Chimi factory." }, 404);

  const message = profileMessage(token, giwaSepolia.id, profileHash(cleaned.profile), body.issuedAt);
  const valid = await client.verifyMessage({ address: creator, message, signature: body.signature }).catch(() => false);
  if (!valid) return json({ error: "Only the coin's creator can set its picture." }, 403);

  const existing = await readStored(token);
  if (existing?.issuedAt && Date.parse(existing.issuedAt) >= issued) {
    return json({ error: "A newer profile is already published." }, 409);
  }

  const { put } = await import("@vercel/blob");
  const profile: StoredProfile = { ...cleaned.profile, token, creator, issuedAt: body.issuedAt, source: "chimi" };
  const image = cleaned.profile.image;
  if (image?.startsWith("data:")) {
    const [, mime = "image/jpeg", b64 = ""] = /^data:([^;]+);base64,(.*)$/.exec(image) ?? [];
    const ext = mime.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const blob = await put(`token-meta/${token.toLowerCase()}/${profileHash(cleaned.profile).slice(2, 14)}.${ext}`, new Blob([bytes], { type: mime }), {
      access: "public",
      contentType: mime,
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60 * 60 * 24 * 365,
    });
    profile.image = blob.url;
  }
  await put(metaPath(token), JSON.stringify(profile), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
  return json({ ok: true, profile });
}
