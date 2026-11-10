import { Link, useLocation } from "@tanstack/react-router";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { giwaSepolia } from "@/lib/chimi/chain";
import { useBlockNumber, useEthUsd } from "@/lib/chimi/live";
import { shortAddr } from "@/lib/chimi/market";
import { PageBackdrop } from "@/components/chimi/backdrop";
import { CommandPalette } from "@/components/chimi/command";
import {
  ChimiMark,
  IconBoard,
  IconChart,
  IconExternal,
  IconHouse,
  IconMenu,
  IconPlus,
  IconPoints,
  IconPools,
  IconSearch,
  IconSwap,
} from "@/components/chimi/icons";
import { useChimi } from "@/components/chimi/provider";
import { Toaster } from "@/components/chimi/toast";
import { Modal } from "@/components/chimi/ui";
import { WalletButton } from "@/components/chimi/wallet-menu";

type NavItem = {
  to: "/" | "/swap" | "/pools" | "/analytics" | "/points" | "/houses" | "/launch";
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  on: (path: string) => boolean;
};

const NAV: NavItem[] = [
  { to: "/", label: "Board", icon: IconBoard, on: (p) => p === "/" || p.startsWith("/coin/") },
  { to: "/swap", label: "Swap", icon: IconSwap, on: (p) => p === "/swap" },
  { to: "/pools", label: "Pools", icon: IconPools, on: (p) => p === "/pools" || p.startsWith("/pool/") },
  { to: "/analytics", label: "Analytics", icon: IconChart, on: (p) => p === "/analytics" },
  { to: "/points", label: "Points", icon: IconPoints, on: (p) => p === "/points" },
  { to: "/houses", label: "Houses", icon: IconHouse, on: (p) => p.startsWith("/houses") },
];

const LAUNCH: NavItem = { to: "/launch", label: "Launch", icon: IconPlus, on: (p) => p === "/launch" };

/** The side rail: icons only, opening to show labels when the pointer or keyboard is on it. */
function Rail({ path }: { path: string }) {
  const explorer = giwaSepolia.blockExplorers.default.url;
  const label = "ml-3.5 whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover/rail:opacity-100 group-focus-within/rail:opacity-100";
  return (
    <aside className="vt-rail group/rail fixed inset-y-0 left-0 z-40 hidden w-[68px] flex-col overflow-hidden border-r border-line bg-bg transition-[width,box-shadow] duration-200 ease-out hover:w-[224px] hover:shadow-[24px_0_60px_-20px_rgba(0,0,0,.8)] focus-within:w-[224px] lg:flex">
      <Link to="/" className="flex h-16 shrink-0 items-center pl-[16px]" aria-label="Chimi home">
        <ChimiMark size={36} />
        <span className={`${label} flex items-baseline gap-2`}>
          <span className="text-[19px] font-bold tracking-[0.02em]">Chimi</span>
          <span className="font-serif text-[15px] text-gold">치미</span>
        </span>
      </Link>
      <nav className="mt-2 flex flex-1 flex-col gap-1 px-3" aria-label="Main">
        {NAV.map((item) => (
          <RailLink key={item.to} item={item} on={item.on(path)} label={label} />
        ))}
        <div className="mx-1 my-2 h-px bg-line" />
        <RailLink item={LAUNCH} on={LAUNCH.on(path)} label={label} accent />
      </nav>
      <div className="px-3 pb-12">
        <a href={explorer} target="_blank" rel="noreferrer" className="flex h-11 items-center rounded-xl pl-[11px] text-muted hover:bg-raise hover:text-fg">
          <IconExternal size={20} className="shrink-0" />
          <span className={`${label} text-sm font-medium`}>GIWA explorer</span>
        </a>
      </div>
    </aside>
  );
}

function RailLink({ item, on, label, accent }: { item: NavItem; on: boolean; label: string; accent?: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      aria-current={on ? "page" : undefined}
      className={`relative flex h-11 items-center rounded-xl pl-[11px] transition-colors ${on ? "bg-raise text-fg" : "text-muted hover:bg-raise hover:text-fg"}`}
    >
      {accent ? (
        <span className="grid size-[22px] shrink-0 place-items-center rounded-md bg-seal text-onseal">
          <Icon size={15} />
        </span>
      ) : (
        <Icon size={21} className={`shrink-0 ${on ? "text-fg" : ""}`} />
      )}
      <span className={`${label} text-[15px] font-medium ${accent ? "!ml-[13px]" : ""}`}>{item.label}</span>
      {on ? <span className="absolute top-2.5 bottom-2.5 -left-3 w-[3px] rounded-r-full bg-seal" /> : null}
    </Link>
  );
}

/** Phone: a tab bar along the bottom, with Launch in the middle and the rest behind More. */
function TabBar({ path }: { path: string }) {
  const [more, setMore] = useState(false);
  useEffect(() => setMore(false), [path]);
  const tabs = [NAV[0]!, NAV[1]!];
  const after = [NAV[4]!];
  const hidden = [NAV[2]!, NAV[3]!, NAV[5]!];
  const moreOn = hidden.some((h) => h.on(path));
  const tab = (item: NavItem) => {
    const Icon = item.icon;
    const on = item.on(path);
    return (
      <Link key={item.to} to={item.to} aria-current={on ? "page" : undefined} className={`flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium ${on ? "text-fg" : "text-faint"}`}>
        <Icon size={21} />
        {item.label}
      </Link>
    );
  };
  return (
    <>
      <nav className="vt-tabs fixed inset-x-0 bottom-0 z-40 flex h-[64px] items-stretch border-t border-line bg-bg/92 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden" aria-label="Main">
        {tabs.map(tab)}
        <Link to="/launch" aria-label="Launch a coin" className="flex flex-1 items-center justify-center">
          <span className="grid size-11 place-items-center rounded-2xl bg-seal text-onseal shadow-seal">
            <IconPlus size={22} />
          </span>
        </Link>
        {after.map(tab)}
        <button type="button" onClick={() => setMore(true)} className={`flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium ${moreOn ? "text-fg" : "text-faint"}`}>
          <IconMenu size={21} />
          More
        </button>
      </nav>
      {more ? (
        <Modal title="More" onClose={() => setMore(false)}>
          <div className="mt-4 grid gap-1.5">
            {hidden.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.to} to={item.to} onClick={() => setMore(false)} className="flex items-center gap-3.5 rounded-xl bg-raise px-4 py-3.5 text-[15px] font-medium">
                  <Icon size={20} className="text-muted" />
                  {item.label}
                </Link>
              );
            })}
            <a href={giwaSepolia.blockExplorers.default.url} target="_blank" rel="noreferrer" className="flex items-center gap-3.5 rounded-xl bg-raise px-4 py-3.5 text-[15px] font-medium">
              <IconExternal size={20} className="text-muted" />
              GIWA explorer
            </a>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

/** Desktop: a thin line along the bottom saying the chain is live, like a trading terminal. */
function StatusBar() {
  const { deployment, note, loading, coins } = useChimi();
  const block = useBlockNumber();
  const ethUsd = useEthUsd();
  const explorer = giwaSepolia.blockExplorers.default.url;
  const down = !loading && !!note && coins.length === 0;
  return (
    <div className="vt-status fixed right-0 bottom-0 left-[68px] z-30 hidden h-9 items-center justify-between gap-4 border-t border-line bg-bg/92 px-5 text-xs text-muted backdrop-blur-xl lg:flex">
      <div className="flex min-w-0 items-center gap-4">
        <span className={`flex items-center gap-2 font-medium ${down ? "text-down" : "text-ok"}`}>
          <span className="live-dot" />
          {down ? "Offline" : "Live"}
        </span>
        <span className="h-3.5 w-px bg-line" />
        <span>GIWA Sepolia</span>
        {block !== undefined ? (
          <a href={`${explorer}/block/${block}`} target="_blank" rel="noreferrer" className="num hover:text-fg">
            Block {block.toLocaleString("en-US")}
          </a>
        ) : null}
        {ethUsd ? <span className="num">ETH ${ethUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span> : null}
      </div>
      <div className="flex shrink-0 items-center gap-4">
        {deployment ? (
          <a href={`${explorer}/address/${deployment.factory}`} target="_blank" rel="noreferrer" className="num hover:text-fg">
            Factory {shortAddr(deployment.factory)}
          </a>
        ) : null}
        <span className="rounded-md border border-line px-1.5 py-0.5 text-[11px] font-medium tracking-wide text-faint uppercase">Testnet</span>
      </div>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const path = location.pathname;
  const [search, setSearch] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // "/" or Cmd/Ctrl+K opens search from anywhere, unless the user is typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey)) {
        e.preventDefault();
        setSearch(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => setSearch(false), [path]);

  // The soft light on a card that can be opened follows the pointer (.card-lift in styles.css).
  useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      const card = e.target instanceof Element ? e.target.closest<HTMLElement>(".card-lift") : null;
      if (!card) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = card.getBoundingClientRect();
        card.style.setProperty("--mx", `${Math.round(e.clientX - box.left)}px`);
        card.style.setProperty("--my", `${Math.round(e.clientY - box.top)}px`);
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="relative isolate flex min-h-dvh flex-col lg:pl-[68px]">
      <PageBackdrop path={path} />
      <Rail path={path} />
      <header className={`vt-top sticky top-0 z-30 border-b transition-colors duration-200 ${scrolled ? "border-line bg-bg/85 backdrop-blur-xl" : "border-transparent bg-transparent"}`}>
        <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-2.5 lg:hidden" aria-label="Chimi home">
            <ChimiMark size={34} />
            <span className="hidden text-[18px] font-bold tracking-[0.02em] min-[400px]:inline">Chimi</span>
          </Link>
          <button
            type="button"
            onClick={() => setSearch(true)}
            className="hidden h-10 w-full max-w-[440px] items-center gap-2.5 rounded-xl border border-line bg-chip/70 px-3.5 text-left text-sm text-faint transition-colors hover:border-edge hover:text-muted md:flex"
          >
            <IconSearch size={17} />
            <span className="flex-1 truncate">Search coins, houses or an address</span>
            <span className="kbd">/</span>
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={() => setSearch(true)} aria-label="Search" className="btn btn-icon btn-secondary md:hidden">
              <IconSearch size={18} />
            </button>
            <span className="chip hidden h-10 rounded-xl px-3 text-[13px] xl:inline-flex">
              <span className="live-dot text-ok" />
              GIWA Sepolia
            </span>
            <Link to="/launch" className="btn btn-primary hidden sm:inline-flex">
              <IconPlus size={17} />
              Launch
            </Link>
            <WalletButton />
          </div>
        </div>
      </header>

      <div className="flex-1">{children}</div>

      <Footer />
      <StatusBar />
      <TabBar path={path} />
      <Toaster />
      {search ? <CommandPalette onClose={() => setSearch(false)} /> : null}
    </div>
  );
}

function Footer() {
  const { deployment } = useChimi();
  const explorer = giwaSepolia.blockExplorers.default.url;
  const link = "text-muted transition-colors hover:text-fg";
  return (
    <footer className="mt-10 border-t border-line pb-[64px] lg:pb-9">
      <div className="page grid gap-8 py-10 sm:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
        <div>
          <div className="flex items-center gap-2.5">
            <ChimiMark size={30} />
            <span className="text-[17px] font-bold tracking-[0.02em]">Chimi</span>
            <span className="font-serif text-sm text-gold">치미</span>
          </div>
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted">The pool is the market. Every coin opens straight into a locked pool on GIWA, with no bonding curve.</p>
        </div>
        <div className="grid content-start gap-2.5 text-sm">
          <p className="th uppercase">Trade</p>
          <Link to="/" className={link}>
            Board
          </Link>
          <Link to="/swap" className={link}>
            Swap
          </Link>
          <Link to="/pools" className={link}>
            Pools
          </Link>
          <Link to="/analytics" className={link}>
            Analytics
          </Link>
        </div>
        <div className="grid content-start gap-2.5 text-sm">
          <p className="th uppercase">Earn</p>
          <Link to="/launch" className={link}>
            Launch a coin
          </Link>
          <Link to="/points" className={link}>
            Points
          </Link>
          <Link to="/houses" className={link}>
            Houses
          </Link>
        </div>
        <div className="grid content-start gap-2.5 text-sm">
          <p className="th uppercase">Chain</p>
          <a href={explorer} target="_blank" rel="noreferrer" className={link}>
            GIWA explorer
          </a>
          {deployment ? (
            <a href={`${explorer}/address/${deployment.factory}`} target="_blank" rel="noreferrer" className={`${link} num`}>
              Factory {shortAddr(deployment.factory)}
            </a>
          ) : (
            <span className="text-faint">Factory not deployed</span>
          )}
          <span className="text-faint">GIWA Sepolia testnet</span>
        </div>
      </div>
    </footer>
  );
}
