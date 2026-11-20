import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/x")({
  server: {
    handlers: {
      GET: async ({ request }) => (await import("@/server/x-posts")).getX(request),
      POST: async ({ request }) => (await import("@/server/x-posts")).postX(request),
    },
  },
});
