export type TokenMeta = {
  description: string;
  image?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
};

const KEY = "chimi.tokenMeta.v1";

function readAll(): Record<string, TokenMeta> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, TokenMeta>) : {};
  } catch {
    return {};
  }
}

export function readTokenMeta(token: string): TokenMeta | null {
  return readAll()[token.toLowerCase()] ?? null;
}

export function saveTokenMeta(token: string, meta: TokenMeta) {
  const all = readAll();
  all[token.toLowerCase()] = meta;
  localStorage.setItem(KEY, JSON.stringify(all));
}

export async function shrinkImage(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const max = 256;
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not read that image.");
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return canvas.toDataURL("image/jpeg", 0.82);
}
