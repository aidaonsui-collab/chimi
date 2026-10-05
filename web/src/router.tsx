import { createRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

function AppError({ error }: ErrorComponentProps) {
  const message = error instanceof Error && error.message ? error.message : "Something went wrong.";
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6">
      <h1 className="font-display text-4xl">Something went wrong</h1>
      <p className="mt-3 text-sm text-muted">{message}</p>
    </main>
  );
}

export function getRouter() {
  return createRouter({ routeTree, defaultErrorComponent: AppError });
}
