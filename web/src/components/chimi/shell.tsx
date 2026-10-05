import { Link, useLocation } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { giwaSepolia } from "@/lib/chimi/chain";
import { shortAddr } from "@/lib/chimi/market";
import { useChimi } from "@/components/chimi/provider";

export function Shell({ children }: { children: ReactNode }) {
  const { account, connect, deployment } = useChimi();
  const location = useLocation();
  const explorer = giwaSepolia.blockExplorers.default.url;
  const here = location.pathname;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:h-[4.25rem] sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-0">
          <Link to="/" className="flex items-center gap-3">
            <img
              src="/brands/chimi-seal.jpg"
              alt=""
              className="size-10 rounded-full border border-seal object-cover"
            />
            <span className="hidden leading-none sm:block">
              <span className="block font-display text-xl tracking-wide">CHIMI</span>
              <span className="font-serif text-sm text-gold">치미</span>
            </span>
          </Link>
          <nav className="flex w-full items-center justify-end gap-2 sm:w-auto">
            <Link to="/" className={`px-1.5 text-xs tracking-wide sm:px-3 sm:text-sm ${here === "/" ? "text-fg" : "text-muted"}`}>
              Board
            </Link>
            <Link
              to="/swap"
              className={`px-1.5 text-xs tracking-wide sm:px-3 sm:text-sm ${here === "/swap" ? "text-fg" : "text-muted"}`}
            >
              Swap
            </Link>
            <Link
              to="/launch"
              className="rounded-full bg-seal px-2.5 py-1.5 text-xs font-semibold tracking-wide text-onseal sm:px-4 sm:py-2 sm:text-sm"
            >
              Launch
            </Link>
            <button
              type="button"
              onClick={() => void connect().catch(() => undefined)}
              className="rounded-full border border-line bg-chip px-2.5 py-1.5 text-xs tracking-wide sm:px-4 sm:py-2 sm:text-sm"
            >
              {account ? shortAddr(account) : "Connect"}
            </button>
          </nav>
        </div>
      </header>
      {children}
      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-8 text-sm text-muted sm:px-6">
        <p>치미 · GIWA Sepolia · the pool is the market</p>
        {deployment ? (
          <a className="text-gold" href={`${explorer}/address/${deployment.factory}`}>
            Factory {shortAddr(deployment.factory)}
          </a>
        ) : null}
      </footer>
    </div>
  );
}