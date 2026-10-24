import { createFileRoute } from "@tanstack/react-router";
import { currentPoints } from "@/server/points";
import { json } from "@/server/store";

/** GET /api/points: { file, writable }, the points book (lib/chimi/points-rules.ts), caught up with the chain first when it's stale. */
export const Route = createFileRoute("/api/points")({
  server: {
    handlers: {
      GET: async () => {
        try {
          return json(await currentPoints(), 200, { "cache-control": "public, max-age=10, s-maxage=10, stale-while-revalidate=50" });
        } catch (e) {
          console.error("[points]", e instanceof Error ? e.message : e);
          return json({ error: "points unavailable" }, 503);
        }
      },
    },
  },
});
