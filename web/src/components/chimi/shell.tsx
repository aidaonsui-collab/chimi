import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { giwaSepolia } from "@/lib/chimi/chain";
import { shortAddr } from "@/lib/chimi/market";
import { PressModal } from "@/components/chimi/press-modal";
import { useChimi } from "@/components/chimi/provider";

const tape = "NO CURVE  ·  1,000,000,000 SUPPLY  ·  LOCKED 100 YEARS  ·  QUOTED IN WETH  ·  GIWA SEPOLIA  ·  ONE LAUNCH, ONE POOL  ·  ";

export function Shell({ children }: { children: ReactNode }) {
  const { account, connect, deployment, pressOpen, setPressOpen } = useChimi();
  const location = useLocation();
  const navigate = useNavigate();
  const explorer = giwaSepolia.blockExplorers.default.url;

  useEffect(() => {
    if (location.searchStr.includes("press=1")) setPressOpen(true);
  }, [location.searchStr, setPressOpen]);

  function closePress() {
    setPressOpen(false);
    if (location.searchStr.includes("press=1")) {
      void navigate({ to: location.pathname, replace: true });
    }
  }

  return (
    <div className="min-h-screen">
      <div className="overflow-hidden border-b border-line bg-seal text-onseal">
        <div className="marquee-track py-2 text-xs font-semibold tracking-[0.18em]">
          <span className="px-2">{tape.repeat(2)}</span>
          <span className="px-2">{tape.repeat(2)}</span>
        </div>
      </div>
      <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur-md">
        <div className="mx-auto flex h-[4.25rem] max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-3">
            <img
              src="/brands/chimi-seal.jpg"
              alt=""
              className="size-10 rounded-full border border-seal object-cover"
            />
            <span className="leading-none">
              <span className="block font-display text-xl tracking-wide">CHIMI</span>
              <span className="font-serif text-sm text-gold">치미</span>
            </span>
          </Link>
          <nav className="flex items-center gap-2">
            <Link to="/" className="hidden px-3 text-sm tracking-wide text-muted sm:inline">
              BOARD
            </Link>
            <button
              type="button"
              onClick={() => setPressOpen(true)}
              className="rounded-full bg-seal px-4 py-2 text-sm font-semibold tracking-wide text-onseal"
            >
              LAUNCH
            </button>
            <button
              type="button"
              onClick={() => void connect().catch(() => undefined)}
              className="rounded-full border border-line bg-chip px-4 py-2 text-sm tracking-wide"
            >
              {account ? shortAddr(account) : "CONNECT"}
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
      {pressOpen ? <PressModal onClose={closePress} /> : null}
    </div>
  );
}