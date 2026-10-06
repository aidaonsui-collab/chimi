import { getAddress, keccak256, toHex, type Address } from "viem";

/**
 * Shared token profile (picture, description, links).
 *
 * Name and symbol live on-chain. Everything here is published by the coin's
 * creator through /api/token-meta, signed with the creator wallet, so every
 * visitor sees the same picture instead of only the browser that launched it.
 */
export type TokenProfile = {
  description?: string;
  image?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
};

export type StoredProfile = TokenProfile & {
  token: Address;
  creator?: Address;
  issuedAt?: string;
  source: "chimi" | "explorer";
};

export const PROFILE_LIMITS = {
  description: 280,
  handle: 64,
  website: 200,
  /** A 256px JPEG data URL from shrinkImage() is ~20-40 KB. */
  imageBytes: 400_000,
  /** Signed profiles older than this are rejected so stale payloads can't be replayed. */
  maxAgeMs: 10 * 60 * 1000,
} as const;

const IMAGE_DATA = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/;

/** Trims and bounds every field. Returns an error string when the profile can't be stored. */
export function cleanProfile(input: TokenProfile): { profile: TokenProfile } | { error: string } {
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const profile: TokenProfile = {
    description: str(input.description, PROFILE_LIMITS.description),
    twitter: str(input.twitter, PROFILE_LIMITS.handle).replace(/^@/, ""),
    telegram: str(input.telegram, PROFILE_LIMITS.handle),
    website: str(input.website, PROFILE_LIMITS.website),
  };
  if (profile.website && !/^https?:\/\//i.test(profile.website)) return { error: "Website must start with http:// or https://" };
  const image = typeof input.image === "string" ? input.image.trim() : "";
  if (image) {
    if (image.startsWith("data:")) {
      if (!IMAGE_DATA.test(image)) return { error: "Unsupported image format." };
      if (image.length > PROFILE_LIMITS.imageBytes) return { error: "Image is too large." };
    } else if (!/^(https:\/\/|ipfs:\/\/|ar:\/\/)/i.test(image) || image.length > 500) {
      return { error: "Image must be an uploaded picture, an https:// URL, or an ipfs:// URI." };
    }
    profile.image = image;
  }
  return { profile };
}

/** Stable hash of the cleaned profile; this is what the creator signs. */
export function profileHash(profile: TokenProfile): `0x${string}` {
  const ordered = {
    description: profile.description ?? "",
    image: profile.image ?? "",
    twitter: profile.twitter ?? "",
    telegram: profile.telegram ?? "",
    website: profile.website ?? "",
  };
  return keccak256(toHex(JSON.stringify(ordered)));
}

export function profileMessage(token: string, chainId: number, hash: string, issuedAt: string) {
  return [
    "Publish Chimi token profile",
    `Token: ${getAddress(token)}`,
    `Chain: ${chainId}`,
    `Profile: ${hash}`,
    `Issued: ${issuedAt}`,
  ].join("\n");
}
