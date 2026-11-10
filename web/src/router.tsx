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

// A cross-fade that gets skipped (a second click before the first has finished) rejects its `ready` promise.
// Nothing is wrong when that happens, so it shouldn't show up in the console as an unhandled error.
if (typeof document !== "undefined" && typeof document.startViewTransition === "function") {
  const start = document.startViewTransition.bind(document);
  document.startViewTransition = ((...args: Parameters<typeof start>) => {
    const transition = start(...args);
    transition.ready.catch(() => {});
    return transition;
  }) as typeof document.startViewTransition;
}

export function getRouter() {
  // Hovering a link warms up its page, so the click feels instant. Pages cross-fade (styles.css) when the path
  // changes; a page changing its own search params does not.
  return createRouter({
    routeTree,
    defaultErrorComponent: AppError,
    defaultPreload: "intent",
    scrollRestoration: true,
    defaultViewTransition: { types: ({ pathChanged }) => (pathChanged && document.visibilityState === "visible" ? ["page"] : false) },
  });
}
