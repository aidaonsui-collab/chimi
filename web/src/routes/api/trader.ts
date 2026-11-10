import { createFileRoute } from "@tanstack/react-router";
import { isAddress } from "viem";
import { traderRecord } from "@/server/ledger";
import { json, rateLimited } from "@/server/store";

/**
 * GET /api/trader?wallet=0x…: { wallet, book, through, throughTs, start, writable }. `book` is the wallet's trade
 * record (lib/chimi/ledger-rules.ts), or null if it has never traded on Chimi. The reader catches up with the chain
 * first when it has fallen behind, so a wallet's page is never more than a minute or so stale.
 */
export const Route = createFileRoute("/api/trader")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const wallet = new URL(request.url).searchParams.get("wallet") ?? "";
        if (!isAddress(wallet, { strict: false })) return json({ error: "wallet must be a 0x address" }, 400);
        // Each wallet is its own cache entry, so this caps how fast one visitor can walk through made-up addresses.
        if (await rateLimited(request, "trader", 90, 60)) return json({ error: "slow down" }, 429);
        try {
          return json(await traderRecord(wallet), 200, { "cache-control": "public, max-age=10, s-maxage=15, stale-while-revalidate=45" });
        } catch (e) {
          console.error("[ledger]", e instanceof Error ? e.message : e);
          return json({ error: "trade record unavailable" }, 503);
        }
      },
    },
  },
});
