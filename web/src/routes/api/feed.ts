import { createFileRoute } from "@tanstack/react-router";
import { isAddress } from "viem";
import { emptyFollows, followingOf, type FollowsState } from "@/lib/chimi/follow-rules";
import { tradeFeed } from "@/server/ledger";
import { docStore, json, rateLimited } from "@/server/store";

/**
 * GET /api/feed?wallet=0x…: { trades, following, through, throughTs, writable }. The latest trades made by the
 * wallets this one follows, newest first, from the trade record (server/ledger.ts). The record stops a few minutes
 * short of the chain's head, so the home page lays the very latest trades, which it reads itself, on top.
 */
export const Route = createFileRoute("/api/feed")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const wallet = new URL(request.url).searchParams.get("wallet") ?? "";
        if (!isAddress(wallet, { strict: false })) return json({ error: "wallet must be a 0x address" }, 400);
        if (await rateLimited(request, "feed", 90, 60)) return json({ error: "slow down" }, 429);
        try {
          const { doc } = await docStore<FollowsState>("chimi:follows:v1").load();
          const following = followingOf(doc ?? emptyFollows(), wallet);
          const feed = await tradeFeed(following);
          return json({ ...feed, following }, 200, { "cache-control": "public, max-age=10, s-maxage=15, stale-while-revalidate=45" });
        } catch (e) {
          console.error("[feed]", e instanceof Error ? e.message : e);
          return json({ error: "feed unavailable" }, 503);
        }
      },
    },
  },
});
