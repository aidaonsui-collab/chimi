import { getAddress, keccak256, stringToHex, type Address, type Hex } from "viem";

/**
 * Shared token profile (picture, description, links).
 *
 * Same path as eve.fun / Arcfun (aidaonsui-collab/Arcfun):
 *   1. the browser uploads the picture to POST /api/upload, which stores it in the public
 *      Vercel Blob store and returns its https URL;
 *   2. the creator signs the profile (payload hash + single-use nonce + timestamp) and
 *      POST /api/token-meta stores the record, imageUrl included, in Upstash Redis (Vercel KV);
 *   3. tiles and token pages read it back with GET /api/token-meta?tokens=…
 * Name and symbol stay on-chain.
 */
export type TokenProfile = {
  description?: string;
  imageUrl?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
};

/** What GET /api/token-meta returns per token. */
export type StoredProfile = {
  token: Address;
  image?: string;
  description?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
  creator?: Address;
  source: "chimi" | "explorer";
};

export const PROFILE_LIMITS = {
  description: 280,
  handle: 64,
  website: 200,
  url: 500,
  /** Signed registers older or newer than this are rejected (same window as eve.fun). */
  maxSkewMs: 10 * 60 * 1000,
} as const;

/** Trims and bounds every field. Returns an error string when the profile can't be stored. */
export function cleanProfile(input: TokenProfile): { profile: Required<TokenProfile> } | { error: string } {
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const profile = {
    description: str(input.description, PROFILE_LIMITS.description),
    imageUrl: str(input.imageUrl, PROFILE_LIMITS.url),
    twitter: str(input.twitter, PROFILE_LIMITS.handle).replace(/^@/, ""),
    telegram: str(input.telegram, PROFILE_LIMITS.handle),
    website: str(input.website, PROFILE_LIMITS.website),
  };
  if (profile.imageUrl && !/^https:\/\//i.test(profile.imageUrl)) return { error: "Image must be an https URL." };
  if (profile.website && !/^https?:\/\//i.test(profile.website)) return { error: "Website must start with http:// or https://" };
  return { profile };
}

/* ---- Register signature, mirrored from Arcfun lib/arc-auth.ts ---- */

export const AUTH_NONCE_RE = /^[0-9a-f]{32}$/i;

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

export function hashPayload(value: unknown): Hex {
  return keccak256(stringToHex(stableStringify(value)));
}

export function newAuthNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function tokenRegisterMessage(opts: { token: string; payloadHash: Hex; nonce: string; timestamp: number }) {
  return [
    "Chimi token register",
    `Token: ${getAddress(opts.token)}`,
    "Action: register-token",
    `Payload: ${opts.payloadHash}`,
    `Nonce: ${opts.nonce.toLowerCase()}`,
    `Timestamp: ${opts.timestamp}`,
  ].join("\n");
}

/** The exact object the creator signs and the server re-hashes. */
export function registerPayload(token: string, profile: Required<TokenProfile>) {
  return { token: getAddress(token), ...profile };
}
