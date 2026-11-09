import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { compactUsd } from "@/lib/chimi/format";
import { SUPPLY, useEthUsd } from "@/lib/chimi/live";
import { shortAddr, wethPerToken } from "@/lib/chimi/market";
import { useHouses } from "@/lib/chimi/rewards";
import { useTokenImages } from "@/lib/chimi/token-image";
import { HouseSeal } from "@/components/chimi/house-seal";
import { IconBoard, IconChart, IconHouse, IconPlus, IconPoints, IconPools, IconSearch, IconSwap } from "@/components/chimi/icons";
import { useChimi } from "@/components/chimi/provider";
import { TokenLogo } from "@/components/chimi/token-logo";
import { Modal } from "@/components/chimi/ui";

type Item = {
  key: string;
  group: "Coins" | "Houses" | "Pages";
  title: string;
  sub?: string;
  right?: string;
  mark: ReactNode;
  go: () => void;
};

const PAGES = [
  { to: "/", title: "Board", sub: "Every coin on Chimi", icon: IconBoard },
  { to: "/launch", title: "Launch a coin", sub: "One transaction, straight into a locked pool", icon: IconPlus },
  { to: "/swap", title: "Swap", sub: "Buy or sell any coin", icon: IconSwap },
  { to: "/pools", title: "Pools", sub: "Add liquidity and collect fees", icon: IconPools },
  { to: "/analytics", title: "Analytics", sub: "Volume and launches", icon: IconChart },
  { to: "/points", title: "Points", sub: "The daily pool and the season board", icon: IconPoints },
  { to: "/houses", title: "Houses", sub: "Trade under one seal", icon: IconHouse },
] as const;

/** Search everything: coins by name, ticker or address, houses by name or tag, and the pages themselves. */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const { coins } = useChimi();
  const { data: houses } = useHouses();
  const ethUsd = useEthUsd();
  const navigate = useNavigate();
  const images = useTokenImages(useMemo(() => coins.map((c) => c.token), [coins]));
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: Item[] = [];
    const close = (fn: () => void) => () => {
      onClose();
      fn();
    };
    const matched = coins.filter((c) => !q || c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q) || c.token.toLowerCase() === q || c.pool.toLowerCase() === q);
    for (const c of matched.slice(0, 8)) {
      const cap = (Number(wethPerToken(c.sqrtPriceX96, c.tokenIs0)) / 1e18) * SUPPLY;
      out.push({
        key: `coin:${c.token}`,
        group: "Coins",
        title: c.name,
        sub: `$${c.symbol}${c.preview ? " · preview" : ""}`,
        right: ethUsd ? compactUsd(cap * ethUsd) : undefined,
        mark: <TokenLogo symbol={c.symbol} image={images[c.token.toLowerCase()]} size={36} />,
        go: close(() => void navigate({ to: "/coin/$address", params: { address: c.token } })),
      });
    }
    // A pasted address that isn't on the board yet still opens its coin page, which reads the factory.
    if (/^0x[0-9a-f]{40}$/.test(q) && matched.length === 0) {
      out.push({
        key: `addr:${q}`,
        group: "Coins",
        title: `Open ${shortAddr(q)}`,
        sub: "Look this address up on the factory",
        mark: (
          <span className="grid size-9 place-items-center rounded-full bg-raise2 text-muted">
            <IconSearch size={16} />
          </span>
        ),
        go: close(() => void navigate({ to: "/coin/$address", params: { address: q } })),
      });
    }
    const open = Object.values(houses?.state.houses ?? {}).filter((h) => !h.closedAt);
    for (const h of open.filter((h) => q && (h.name.toLowerCase().includes(q) || h.tag.toLowerCase().includes(q))).slice(0, 5)) {
      out.push({
        key: `house:${h.tag}`,
        group: "Houses",
        title: h.name,
        sub: `[${h.tag}]${h.motto ? ` · ${h.motto}` : ""}`,
        mark: <HouseSeal seal={h.seal} ink={h.ink} size={36} />,
        go: close(() => void navigate({ to: "/houses/$tag", params: { tag: h.tag } })),
      });
    }
    for (const p of PAGES.filter((p) => !q || p.title.toLowerCase().includes(q) || p.sub.toLowerCase().includes(q))) {
      const Icon = p.icon;
      out.push({
        key: `page:${p.to}`,
        group: "Pages",
        title: p.title,
        sub: p.sub,
        mark: (
          <span className="grid size-9 place-items-center rounded-xl bg-raise2 text-muted">
            <Icon size={18} />
          </span>
        ),
        go: close(() => void navigate({ to: p.to })),
      });
    }
    return out;
  }, [query, coins, houses, images, ethUsd, navigate, onClose]);

  useEffect(() => setCursor(0), [query]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>("[data-on]")?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  let lastGroup = "";
  return (
    <Modal bare onClose={onClose} width={620}>
      <div className="flex items-center gap-3 border-b border-line px-4 sm:px-5">
        <IconSearch size={18} className="shrink-0 text-muted" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setCursor((c) => Math.min(items.length - 1, c + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor((c) => Math.max(0, c - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              items[cursor]?.go();
            }
          }}
          placeholder="Search coins, houses, or paste an address"
          aria-label="Search Chimi"
          role="combobox"
          aria-expanded="true"
          aria-controls="chimi-search-results"
          className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-faint"
        />
        <button type="button" onClick={onClose} className="kbd hover:text-fg" aria-label="Close search">
          esc
        </button>
      </div>
      <div ref={list} id="chimi-search-results" role="listbox" className="max-h-[min(60dvh,460px)] overflow-y-auto p-2">
        {items.length === 0 ? <p className="px-3 py-10 text-center text-sm text-muted">Nothing matches “{query.trim()}”.</p> : null}
        {items.map((item, i) => {
          const head = item.group !== lastGroup;
          lastGroup = item.group;
          return (
            <div key={item.key}>
              {head ? <p className="th px-3 pt-3 pb-1.5 uppercase">{item.group}</p> : null}
              <button
                type="button"
                role="option"
                aria-selected={i === cursor}
                data-on={i === cursor || undefined}
                onMouseMove={() => setCursor(i)}
                onClick={item.go}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left ${i === cursor ? "bg-raise2" : ""}`}
              >
                {item.mark}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">{item.title}</span>
                  {item.sub ? <span className="block truncate text-[13px] text-muted">{item.sub}</span> : null}
                </span>
                {item.right ? <span className="num shrink-0 text-sm text-muted">{item.right}</span> : null}
              </button>
            </div>
          );
        })}
      </div>
      <div className="hidden items-center gap-4 border-t border-line px-5 py-2.5 text-xs text-faint sm:flex">
        <span className="flex items-center gap-1.5">
          <span className="kbd">↑</span>
          <span className="kbd">↓</span> to move
        </span>
        <span className="flex items-center gap-1.5">
          <span className="kbd">↵</span> to open
        </span>
      </div>
    </Modal>
  );
}
