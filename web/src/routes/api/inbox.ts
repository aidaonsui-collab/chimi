/**
 * GET /api/inbox?wallet=0x…: { items, writable }. What other wallets did that concerns this one, newest first:
 * answers to and likes of its comments, comments on coins it launched, new followers, and buys made after its own
 * (rules in lib/chimi/inbox-rules.ts). All of it is public already, so reading takes no signature.
 */
import { createFileRoute } from "@tanstack/react-router";
import { isAddress } from "viem";
import { readInbox } from "@/server/inbox";
import { json, rateLimited } from "@/server/store";

export const Route = createFileRoute("/api/inbox")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const wallet = new URL(request.url).searchParams.get("wallet") ?? "";
        if (!isAddress(wallet, { strict: false })) return json({ error: "wallet must be a 0x address" }, 400);
        if (await rateLimited(request, "inbox", 60, 60)) return json({ error: "slow down" }, 429);
        try {
          const { items, writable } = await readInbox(wallet);
          return json({ items: [...items].reverse(), writable }, 200, { "cache-control": "public, max-age=5, s-maxage=5, stale-while-revalidate=20" });
        } catch (e) {
          console.error("[inbox]", e instanceof Error ? e.message : e);
          return json({ error: "inbox unavailable" }, 503);
        }
      },
    },
  },
});
