import { createFileRoute } from "@tanstack/react-router";
import { runFlywheel } from "@/server/flywheel";
import { env } from "@/server/env";
import { json } from "@/server/store";

/**
 * GET /api/keeper/flywheel: the fee flywheel's daily run (server/flywheel.ts). Vercel Cron calls it at 00:10 KST with
 * `Authorization: Bearer $CRON_SECRET`; nothing else may. `?dry=1` reads and plans the run without sending anything.
 */
export const Route = createFileRoute("/api/keeper/flywheel")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = env("CRON_SECRET");
        if (!secret) return json({ error: "CRON_SECRET is not set" }, 503);
        if (request.headers.get("authorization") !== `Bearer ${secret}`) return json({ error: "unauthorized" }, 401);
        const dry = new URL(request.url).searchParams.get("dry") === "1";
        const report = await runFlywheel({ dry });
        if (report.errors.length) console.error("[flywheel]", report.errors.join(" | "));
        return json(report, report.errors.length ? 207 : 200, { "cache-control": "no-store" });
      },
    },
  },
});
