import { Link, useLocation } from "@tanstack/react-router";
import { useEffect, useRef, type ReactNode } from "react";
import { giwaSepolia } from "@/lib/chimi/chain";
import { shortAddr } from "@/lib/chimi/market";
import { useChimi } from "@/components/chimi/provider";

const tabs = [
  { to: "/", label: "Board" },
  { to: "/swap", label: "Swap" },
  { to: "/analytics", label: "Analytics" },
  { to: "/pools", label: "Pools" },
  { to: "/points", label: "Points" },
  { to: "/houses", label: "Houses" },
] as const;

function TabPill({ here }: { here: string }) {
  const bar = useRef<HTMLDivElement>(null);
  // On a phone the tabs scroll sideways; keep the current one in view.
  useEffect(() => {
    bar.current?.querySelector<HTMLElement>("[data-on]")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [here]);
  return (
    <div ref={bar} className="flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-line/80 bg-chip/80 p-1 [scrollbar-width:none]">
      {tabs.map((tab) => {
        const on =
          tab.to === "/pools"
            ? here === "/pools" || here.startsWith("/pool/")
            : tab.to === "/houses"
              ? here.startsWith("/houses")
              : here === tab.to;
        return (
          <Link
            key={tab.to}
            to={tab.to}
            data-on={on || undefined}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium sm:px-4 ${on ? "bg-fg/10 text-fg shadow-[inset_0_1px_0_rgba(255,255,255,.06)]" : "text-muted"}`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { account, connect, deployment } = useChimi();
  const location = useLocation();
  const explorer = giwaSepolia.blockExplorers.default.url;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-bg/70 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[1180px] items-center justify-between gap-2 px-3 py-3 sm:h-16 sm:gap-3 sm:px-6 sm:py-0">
          <Link to="/" className="flex min-w-0 items-center gap-2 text-fg sm:gap-3">
            <img
              src="/seal.jpg"
              alt=""
              className="size-9 rounded-full object-cover shadow-[0_0_0_1px_rgba(210,74,46,.8),0_4px_14px_rgba(210,74,46,.25)]"
            />
            <span className="hidden items-baseline gap-2 leading-none sm:flex">
              <span className="font-display text-lg tracking-[0.06em]">CHIMI</span>
              <span className="font-serif text-[15px] text-gold">치미</span>
            </span>
          </Link>
          <nav className="hidden lg:block">
            <TabPill here={location.pathname} />
          </nav>
          <div className="flex items-center gap-2">
            <Link
              to="/launch"
              className="shrink-0 rounded-full bg-seal px-3 py-1.5 text-sm font-semibold text-onseal shadow-[inset_0_1px_0_rgba(255,255,255,.22),0_6px_20px_rgba(210,74,46,.35)] sm:px-4 sm:py-2"
            >
              Launch
            </Link>
            <button
              type="button"
              onClick={() => void connect().catch(() => undefined)}
              className="flex shrink-0 items-center gap-2 rounded-full border border-line bg-chip px-3 py-1.5 text-sm font-medium tabular-nums sm:px-4 sm:py-2"
            >
              {account ? <span className="size-1.5 rounded-full bg-ok shadow-[0_0_8px_#8fbfae]" /> : null}
              {account ? shortAddr(account) : "Connect"}
            </button>
          </div>
        </div>
        <nav className="flex justify-center px-3 pb-3 lg:hidden">
          <TabPill here={location.pathname} />
        </nav>
      </header>
      <div className="flex-1">{children}</div>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-3 px-4 py-7 text-sm text-muted sm:px-6">
          <p className="flex items-center gap-2.5">
            <span className="font-serif text-base text-gold">치미</span>
            <span>GIWA Sepolia · the pool is the market</span>
          </p>
          {deployment ? (
            <a href={`${explorer}/address/${deployment.factory}`}>Factory {shortAddr(deployment.factory)}</a>
          ) : (
            <span>Factory not deployed</span>
          )}
        </div>
      </footer>
    </div>
  );
}
