/**
 * GET /api/waitlist: how many wallets are on the mainnet waitlist, and with ?wallet= that wallet's place.
 * POST /api/waitlist: join, { wallet, time, signature } over waitlistMessage (lib/chimi/waitlist-rules.ts). Joining
 * again answers with the place the wallet already has.
 * GET /api/waitlist?export=csv (or =json) with `Authorization: Bearer $CHIMI_ADMIN_TOKEN`: the whole list in order,
 * for the admin page (/mainnet/admin) and the perks at mainnet (docs/MAINNET.md).
 *
 * Needs the project's Upstash Redis (KV_REST_API_URL / KV_REST_API_TOKEN) to take names.
 */
import { createFileRoute } from "@tanstack/react-router";
import { isAddress, isHex, recoverMessageAddress } from "viem";
import { csvRow, WAITLIST_SIGNATURE_TTL_MS, waitlistMessage, type WaitlistStatus } from "@/lib/chimi/waitlist-rules";
import { json, rateLimited } from "@/server/store";
import { waitlist } from "@/server/waitlist";

export const Route = createFileRoute("/api/waitlist")({
  server: {
    handlers: {
      GET: async ({ request }) => get(request),
      POST: async ({ request }) => post(request),
    },
  },
});

async function get(request: Request) {
  const url = new URL(request.url);
  const list = waitlist();
  try {
    const exported = url.searchParams.get("export");
    if (exported === "csv" || exported === "json") {
      // So the token can't be guessed by trying.
      if (await rateLimited(request, "waitlist-admin", 20, 60)) return json({ error: "Too many tries. Try again in a minute." }, 429, { "retry-after": "60" });
      const token = process.env.CHIMI_ADMIN_TOKEN;
      if (!token || request.headers.get("authorization") !== `Bearer ${token}`) return json({ error: "forbidden" }, 403);
      const all = await list.all();
      if (exported === "json") return json({ count: all.length, entries: all.map((e, i) => ({ wallet: e.wallet, position: i + 1, at: e.at })) }, 200, { "cache-control": "no-store" });
      const rows = all.map((e, i) => csvRow(e.wallet, i + 1, e.at));
      return new Response(["wallet,position,joined_at", ...rows].join("\n") + "\n", {
        headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store", "content-disposition": 'attachment; filename="chimi-mainnet-waitlist.csv"' },
      });
    }
    const asked = url.searchParams.get("wallet");
    const wallet = asked && isAddress(asked) ? asked.toLowerCase() : null;
    const [count, entry] = await Promise.all([list.count(), wallet ? list.entry(wallet) : Promise.resolve(null)]);
    const body: WaitlistStatus = { count, entry, open: list.open };
    // The count alone can be shared for a few seconds; a wallet's own place is never cached.
    return json(body, 200, { "cache-control": wallet ? "no-store" : "public, max-age=0, must-revalidate", "vercel-cdn-cache-control": wallet ? "no-store" : "max-age=5" });
  } catch (e) {
    console.error("[waitlist]", e instanceof Error ? e.message : e);
    return json({ error: "waitlist unavailable" }, 503);
  }
}

type Body = { wallet?: unknown; time?: unknown; signature?: unknown };

async function post(request: Request) {
  if (await rateLimited(request, "waitlist", 10, 60)) return json({ error: "Too many tries. Try again in a minute." }, 429, { "retry-after": "60" });
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body || typeof body.wallet !== "string" || !isAddress(body.wallet) || typeof body.time !== "number") return json({ error: "invalid request" }, 400);
  if (typeof body.signature !== "string" || !isHex(body.signature)) return json({ error: "invalid signature" }, 400);
  const list = waitlist();
  if (!list.open) return json({ error: "The waitlist isn't open yet." }, 503);
  const wallet = body.wallet.toLowerCase();
  if (Math.abs(Date.now() - body.time) > WAITLIST_SIGNATURE_TTL_MS) return json({ error: "That signature has expired. Try again." }, 401);
  const signer = await recoverMessageAddress({ message: waitlistMessage(wallet, body.time), signature: body.signature }).catch(() => null);
  if (signer?.toLowerCase() !== wallet) return json({ error: "The signature doesn't match the wallet." }, 401);
  try {
    const { entry } = await list.join(wallet, Date.now());
    const status: WaitlistStatus = { count: await list.count(), entry, open: true };
    return json(status);
  } catch (e) {
    console.error("[waitlist]", e instanceof Error ? e.message : e);
    return json({ error: "Couldn't add you just now. Try again." }, 503);
  }
}
