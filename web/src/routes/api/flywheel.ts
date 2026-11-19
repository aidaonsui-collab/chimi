import { createFileRoute } from "@tanstack/react-router";
import { lastFlywheelRun } from "@/server/flywheel";
import { json } from "@/server/store";

/** GET /api/flywheel: { lastRun }, what the keeper did last time (burn, payout), for the rewards panel. Public. */
export const Route = createFileRoute("/api/flywheel")({
  server: {
    handlers: {
      GET: async () => {
        try {
          return json({ lastRun: await lastFlywheelRun() }, 200, { "cache-control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300" });
        } catch (e) {
          console.error("[flywheel]", e instanceof Error ? e.message : e);
          return json({ error: "flywheel unavailable" }, 503);
        }
      },
    },
  },
});
