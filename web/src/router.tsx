import { createRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

function AppError({ error, reset }: ErrorComponentProps) {
  const message = error instanceof Error && error.message ? error.message : "Reloading usually fixes it.";
  return (
    <main className="page pt-10 pb-16">
      <div className="card flex flex-col items-center px-6 py-14 text-center">
        <p className="font-serif text-2xl text-gold">끊김</p>
        <h1 className="mt-4 text-lg font-semibold tracking-[-0.01em]">Something went wrong on this page</h1>
        <p className="mt-1.5 max-w-md text-sm leading-relaxed break-words text-muted">{message}</p>
        <button type="button" onClick={reset} className="btn btn-primary mt-5">
          Try again
        </button>
      </div>
    </main>
  );
}

export function getRouter() {
  // Hovering a link warms up its page, so the click feels instant.
  return createRouter({ routeTree, defaultErrorComponent: AppError, defaultPreload: "intent", scrollRestoration: true });
}
