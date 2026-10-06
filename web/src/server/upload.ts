import { env, clientIp } from "@/server/env";
import { rateLimited } from "@/server/kv";

/**
 * POST /api/upload — store a public token picture in Vercel Blob, like eve.fun's
 * app/api/upload/route.ts. The browser already shrinks pictures to 256px JPEG
 * (lib/chimi/meta.ts shrinkImage), so files are ~20-40 KB and need no resize on delivery.
 * Needs BLOB_READ_WRITE_TOKEN (added by Vercel when a Blob store is connected).
 */
const MAX_BYTES = 1024 * 1024;
const TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"]);

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

function safeName(raw: string): string {
  const base = raw.split(/[/\\]/).pop() || "image";
  return base.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 80) || "image";
}

export async function postUpload(request: Request) {
  if (!env("BLOB_READ_WRITE_TOKEN")) {
    return json({ error: "Picture uploads aren't switched on yet. Connect a Vercel Blob store to this project." }, 503);
  }
  if (await rateLimited("upload", clientIp(request), 12, 60)) {
    return json({ error: "Too many uploads. Wait a minute and try again." }, 429, { "retry-after": "60" });
  }
  const form = await request.formData().catch(() => null);
  if (!form) return json({ error: "invalid form" }, 400);
  const file = form.get("file");
  if (!(file instanceof File) || file.size <= 0) return json({ error: "no file" }, 400);
  if (file.size > MAX_BYTES) return json({ error: "image too large (max 1 MB)" }, 413);
  const type = (file.type || "").toLowerCase();
  if (type && !TYPES.has(type)) return json({ error: "unsupported image type" }, 415);

  try {
    const { put } = await import("@vercel/blob");
    const blob = await put(`chimi/${safeName(file.name)}`, file, {
      access: "public",
      addRandomSuffix: true,
      contentType: TYPES.has(type) ? type : "image/jpeg",
      cacheControlMaxAge: 60 * 60 * 24 * 365,
    });
    if (!blob.url) return json({ error: "upload returned no URL" }, 502);
    return json({ url: blob.url });
  } catch (err) {
    console.error("[upload]", err instanceof Error ? err.message : "failed");
    return json({ error: "upload failed" }, 502);
  }
}
