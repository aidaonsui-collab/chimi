import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/streams")({
  server: {
    handlers: {
      GET: async ({ request }) => (await import("@/server/streams")).getStreams(request),
      POST: async ({ request }) => (await import("@/server/streams")).postStreams(request),
    },
  },
});
