import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/tips")({
  server: {
    handlers: {
      POST: async ({ request }) => (await import("@/server/tips")).postTip(request),
    },
  },
});
