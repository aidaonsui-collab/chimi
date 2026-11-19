import { createFileRoute, redirect } from "@tanstack/react-router";

/** The board is the home page now; an old link to it lands there. */
export const Route = createFileRoute("/board")({
  beforeLoad: () => {
    throw redirect({ to: "/", hash: "board" });
  },
});
