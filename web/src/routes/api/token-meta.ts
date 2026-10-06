import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/token-meta")({
  server: {
    handlers: {
      GET: async ({ request }) => (await import("@/server/token-meta")).getTokenMeta(request),
      POST: async ({ request }) => (await import("@/server/token-meta")).postTokenMeta(request),
    },
  },
});
