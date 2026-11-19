import { Link, useLocation } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { giwaSepolia } from "@/lib/chimi/chain";
import { useTicker } from "@/lib/chimi/feed";
import { useBlockNumber, useEthUsd } from "@/lib/chimi/live";
import { shortAddr } from "@/lib/chimi/market";
import { useProfiles } from "@/lib/chimi/rewards";
import { useTokenImages } from "@/lib/chimi/token-image";
import { PageBackdrop } from "@/components/chimi/backdrop";
import { HowItWorks } from "@/components/chimi/how-it-works";
import { InboxButton } from "@/components/chimi/inbox";
import { CommandPalette } from "@/components/chimi/command";
import { Ticker } from "@/components/chimi/feed-rows";
import {
  ChimiMark,
  IconBoard,
  IconChart,
  IconChevronRight,
  IconExternal,
  IconHouse,
  IconMenu,
  IconPlus,
  IconPoints,
  IconPools,
  IconSearch,
  IconSwap,
  IconTraders,
} from "@/components/chimi/icons";
import { useChimi } from "@/components/chimi/provider";
import { useNow } from "@/components/chimi/rewards-bits";
import { Toaster } from "@/components/chimi/toast";
import { Modal } from "@/components/chimi/ui";
import { WalletButton } from "@/components/chimi/wallet-menu";

type NavItem = {
  to: "/" | "/traders" | "/swap" | "/pools" | "/analytics" | "/points" | "/houses" | "/launch";
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  on: (path: string) => boolean;
};

const HOME: NavItem = { to: "/", label: "Board", icon: IconBoard, on: (p) => p === "/" || p === "/board" || p.startsWith("/coin/") };
const TRADERS: NavItem = { to: "/traders", label: "Traders", icon: IconTraders, on: (p) => p === "/traders" || p.startsWith("/u/") };
const SWAP: NavItem = { to: "/swap", label: "Swap", icon: IconSwap, on: (p) => p === "/swap" };

const NAV: NavItem[] = [
  HOME,
  TRADERS,
  SWAP,
  { to: "/pools", label: "Pools", icon: IconPools, on: (p) => p === "/pools" || p.startsWith("/pool/") },
  { to: "/points", label: "Points", icon: IconPoints, on: (p) => p === "/points" },
  { to: "/houses", label: "Houses", icon: IconHouse, on: (p) => p.startsWith("/houses") },
  { to: "/analytics", label: "Analytics", icon: IconChart, on: (p) => p === "/analytics" },
];

/**
 * The side rail is a drawer: closed it is a strip of icons, and it slides open over the page, with Chimi beside the
 * logo and each page's name beside its icon, while the pointer is on it or the keyboard is in it (.rail in
 * styles.css). It closes when the pointer leaves, on a click (so the page you picked isn't left under it), and on
 * Escape.
 * Search opens with / or Cmd/Ctrl+K.
 */
/** The closed rail's width in px: .rail in styles.css and the page's lg:pl-[72px]. */
const RAIL_W = 72;

function Rail({ path }: { path: string }) {
  const explorer = giwaSepolia.blockExplorers.default.url;
  // Shut after a click with the pointer (detail > 0; a key press has none) until the pointer goes past the closed
  // rail, or out of the window. Not on the rail's own pointerleave: the page change after a click fires one while the
  // pointer is still on the icon, and the next nudge of the mouse would throw the drawer open again.
  const [shut, setShut] = useState(false);
  useEffect(() => {
    if (!shut) return;
    const onMove = (e: PointerEvent) => {
      if (e.clientX > RAIL_W) setShut(false);
    };
    const onOut = (e: PointerEvent) => {
      if (!e.relatedTarget) setShut(false);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerout", onOut);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerout", onOut);
    };
  }, [shut]);
  const closeOnClick = (e: React.MouseEvent<HTMLElement>) => {
    if (e.detail === 0 || !(e.target as HTMLElement).closest("a")) return;
    setShut(true);
    (document.activeElement as HTMLElement | null)?.blur();
  };
  const closeOnEscape = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") (document.activeElement as HTMLElement | null)?.blur();
  };
  return (
    <aside
      className="rail vt-rail fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-line bg-bg lg:flex"
      data-shut={shut ? "" : undefined}
      onClick={closeOnClick}
      onKeyDown={closeOnEscape}
    >
      <Link to="/" className="rail-brand" aria-label="Chimi home">
        <ChimiMark size={36} className="shrink-0" />
        <span className="rail-label rail-name">
          Chimi <span className="font-serif text-[15px] font-normal text-gold">치미</span>
        </span>
      </Link>
      <nav className="rail-nav mt-1 flex flex-1 flex-col gap-1.5" aria-label="Main">
        {NAV.map((item) => {
          const Icon = item.icon;
          const on = item.on(path);
          return (
            <Link key={item.to} to={item.to} aria-current={on ? "page" : undefined} className="rail-item">
              <Icon size={21} className="shrink-0" />
              <span className="rail-label">{item.label}</span>
            </Link>
          );
        })}
        <Link to="/launch" aria-current={path === "/launch" ? "page" : undefined} className="rail-launch">
          <IconPlus size={22} className="shrink-0" />
          <span className="rail-label">Launch a coin</span>
        </Link>
      </nav>
      <div className="rail-nav mb-12">
        <a href={explorer} target="_blank" rel="noreferrer" className="rail-item">
          <IconExternal size={19} className="shrink-0" />
          <span className="rail-label">GIWA explorer</span>
        </a>
      </div>
    </aside>
  );
}

/**
 * Phone: one floating bar along the bottom, a pill of icons over the page with Launch as the round button in the
 * middle. Everything that doesn't fit is behind More.
 */
function TabBar({ path }: { path: string }) {
  const [more, setMore] = useState(false);
  useEffect(() => setMore(false), [path]);
  const hidden = NAV.filter((item) => item !== HOME && item !== TRADERS && item !== SWAP);
  const moreOn = hidden.some((h) => h.on(path));
  const tab = (item: NavItem) => {
    const Icon = item.icon;
    const on = item.on(path);
    return (
      <Link key={item.to} to={item.to} aria-current={on ? "page" : undefined} aria-label={item.label} className="dock-item">
        <Icon size={22} />
      </Link>
    );
  };
  return (
    <>
      <nav className="dock vt-tabs lg:hidden" aria-label="Main">
        {tab(HOME)}
        {tab(TRADERS)}
        <Link to="/launch" aria-label="Launch a coin" className="dock-launch">
          <IconPlus size={24} />
        </Link>
        {tab(SWAP)}
        <button type="button" onClick={() => setMore(true)} aria-label="More" aria-current={moreOn ? "page" : undefined} className="dock-item">
          <IconMenu size={22} />
        </button>
      </nav>
      {more ? (
        <Modal title="More" onClose={() => setMore(false)}>
          <div className="mt-4 grid gap-1.5">
            {hidden.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.to} to={item.to} onClick={() => setMore(false)} className="flex items-center gap-3.5 rounded-2xl bg-raise px-4 py-3.5 text-[15px] font-medium">
                  <Icon size={20} className="text-muted" />
                  {item.label}
                </Link>
              );
            })}
            <a href={giwaSepolia.blockExplorers.default.url} target="_blank" rel="noreferrer" className="flex items-center gap-3.5 rounded-2xl bg-raise px-4 py-3.5 text-[15px] font-medium">
              <IconExternal size={20} className="text-muted" />
              GIWA explorer
            </a>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

/** The live strip in the top bar, on every page. */
function TopTicker({ className = "" }: { className?: string }) {
  const nowMs = useNow(30_000);
  const { items, byToken, now } = useTicker(nowMs);
  const images = useTokenImages(useMemo(() => [...new Set(items.map((i) => i.token))], [items]));
  const profiles = useProfiles(useMemo(() => [...new Set(items.map((i) => i.wallet))], [items]));
  return <Ticker items={items} byToken={byToken} images={images} profiles={profiles} now={now} className={className} />;
}

/** Desktop: a thin line along the bottom saying the chain is live, like a trading terminal. */
function StatusBar() {
  const { deployment, note, loading, coins } = useChimi();
  const block = useBlockNumber();
  const ethUsd = useEthUsd();
  const explorer = giwaSepolia.blockExplorers.default.url;
  const down = !loading && !!note && coins.length === 0;
  return (
    <div className="vt-status fixed right-0 bottom-0 left-[72px] z-30 hidden h-9 items-center justify-between gap-4 border-t border-line bg-bg/92 px-5 text-xs text-muted backdrop-blur-xl lg:flex">
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
    <div className="relative isolate flex min-h-dvh flex-col lg:pl-[72px]">
      <PageBackdrop path={path} />
      <Rail path={path} />
      <header className={`vt-top sticky top-0 z-30 border-b transition-colors duration-200 ${scrolled ? "border-line bg-bg/85 backdrop-blur-xl" : "border-transparent bg-transparent"}`}>
        <TopTicker className="ticker-phone" />
        <div className="flex h-14 items-center gap-3 px-4 sm:px-6 lg:h-16 lg:px-8">
          <Link to="/" className="flex shrink-0 items-center gap-2.5 lg:hidden" aria-label="Chimi home">
            <ChimiMark size={32} />
            <span className="hidden text-[18px] font-bold tracking-[0.02em] min-[400px]:inline md:hidden">Chimi</span>
          </Link>
          <TopTicker className="ticker-wide" />
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <button type="button" onClick={() => setSearch(true)} aria-label="Search" className="btn btn-icon btn-secondary lg:hidden">
              <IconSearch size={18} />
            </button>
            <InboxButton />
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
    <footer className="mt-10 border-t border-line pb-[96px] lg:pb-9">
      <div className="page grid gap-8 py-10 sm:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
        <div>
          <div className="flex items-center gap-2.5">
            <ChimiMark size={30} />
            <span className="text-[17px] font-bold tracking-[0.02em]">Chimi</span>
            <span className="font-serif text-sm text-gold">치미</span>
          </div>
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted">The pool is the market. Every coin opens straight into a locked pool on GIWA, with no bonding curve.</p>
          <HowItWorks className={`mt-3 inline-flex items-center gap-1.5 text-sm ${link}`}>
            How Chimi works
            <IconChevronRight size={14} />
          </HowItWorks>
        </div>
        <div className="grid content-start gap-2.5 text-sm">
          <p className="th uppercase">Trade</p>
          <Link to="/" className={link}>
            Board
          </Link>
          <Link to="/traders" className={link}>
            Traders
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
