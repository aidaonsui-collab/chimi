import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { giwaSepolia } from "@/lib/chimi/chain";
import { publicClient } from "@/lib/chimi/client";
import { ethText, money } from "@/lib/chimi/format";
import { useEthUsd } from "@/lib/chimi/live";
import { short, shortAddr } from "@/lib/chimi/market";
import { useMyProfile } from "@/lib/chimi/rewards";
import { IconChevronDown, IconExternal, IconHouse, IconPoints, IconPower, IconWallet } from "@/components/chimi/icons";
import { useChimi } from "@/components/chimi/provider";
import { DojangMark } from "@/components/chimi/rewards-bits";
import { toast } from "@/components/chimi/toast";
import { Blockie, CopyButton } from "@/components/chimi/ui";

/** Connect, or the connected wallet with its menu: balance, shortcuts and disconnect. */
export function WalletButton() {
  const { account, connect, disconnect } = useChimi();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (!account) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void connect()
            .catch((err: unknown) => {
              const text = short(err);
              if (/reject|denied|cancel/i.test(text)) return;
              toast({
                kind: "bad",
                title: /No wallet/.test(text) ? "No wallet found" : "Couldn’t connect",
                body: /No wallet/.test(text) ? "Install a wallet such as MetaMask, or open Chimi inside your wallet’s browser." : text,
              });
            })
            .finally(() => setBusy(false));
        }}
        className="btn btn-light"
      >
        <IconWallet size={17} />
        <span>{busy ? "Connecting…" : "Connect"}</span>
      </button>
    );
  }

  return (
    <div ref={box} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="btn btn-secondary gap-2 pr-2.5 pl-2">
        <Blockie address={account} size={24} />
        <span className="num hidden sm:inline">{shortAddr(account)}</span>
        <IconChevronDown size={14} className={`text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <Menu
          account={account}
          onClose={() => setOpen(false)}
          onDisconnect={() => {
            setOpen(false);
            disconnect();
          }}
        />
      ) : null}
    </div>
  );
}

function Menu({ account, onClose, onDisconnect }: { account: `0x${string}`; onClose: () => void; onDisconnect: () => void }) {
  const ethUsd = useEthUsd();
  const { profile } = useMyProfile();
  const [balance, setBalance] = useState<bigint>();
  useEffect(() => {
    let cancel = false;
    void publicClient
      .getBalance({ address: account })
      .then((wei) => {
        if (!cancel) setBalance(wei);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [account]);
  const eth = balance === undefined ? undefined : Number(balance) / 1e18;
  const row = "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-fg hover:bg-raise2";
  return (
    <div role="menu" className="absolute top-[calc(100%+8px)] right-0 z-50 w-[300px] animate-pop rounded-2xl border border-edge bg-chip p-2 shadow-pop">
      <div className="flex items-center gap-3 px-3 pt-2.5 pb-3">
        <Blockie address={account} size={40} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-[15px] font-semibold">
            <span className="truncate">{profile?.name ?? shortAddr(account)}</span>
            <DojangMark verified={profile?.verified} />
          </p>
          <p className="num text-xs text-muted">{shortAddr(account)} · GIWA Sepolia</p>
        </div>
        <CopyButton text={account} label="Copy address" />
      </div>
      <div className="mx-1 mb-2 rounded-xl border border-line bg-bg px-3.5 py-3">
        <p className="text-xs text-muted">Balance</p>
        <p className="num mt-0.5 text-xl font-semibold tracking-[-0.02em]">{eth === undefined ? <span className="skeleton h-6 w-24" /> : `${ethText(eth)} ETH`}</p>
        {eth !== undefined && ethUsd ? <p className="num text-xs text-muted">{money(eth * ethUsd)}</p> : null}
      </div>
      <Link to="/points" role="menuitem" onClick={onClose} className={row}>
        <IconPoints size={17} className="text-muted" />
        Your points
      </Link>
      <Link to="/houses" role="menuitem" onClick={onClose} className={row}>
        <IconHouse size={17} className="text-muted" />
        Houses
      </Link>
      <a href={`${giwaSepolia.blockExplorers.default.url}/address/${account}`} target="_blank" rel="noreferrer" role="menuitem" className={row}>
        <IconExternal size={17} className="text-muted" />
        View on explorer
      </a>
      <div className="mx-2 my-1.5 h-px bg-line" />
      <button type="button" role="menuitem" onClick={onDisconnect} className={`${row} text-down hover:text-down`}>
        <IconPower size={17} />
        Disconnect
      </button>
    </div>
  );
}
