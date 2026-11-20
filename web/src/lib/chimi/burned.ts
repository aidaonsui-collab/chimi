import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { erc20Abi } from "@/lib/chimi/chain";
import { publicClient } from "@/lib/chimi/client";
import { SUPPLY } from "@/lib/chimi/live";
import type { Coin } from "@/lib/chimi/market";

/*
 * How much of each coin has been burned: what the burn address holds. Chimi burns by sending coins to 0x…dEaD (the
 * locker with the coin side of every trade's fee, each coin's own burner with what it buys back), and Chimi coins have
 * no other way to burn, so the address's balance is the whole of it. Every coin's supply is 1 billion.
 */

export const BURN_ADDRESS: Address = "0x000000000000000000000000000000000000dEaD";
const EVERY_MS = 60_000;

/** Each coin's burned share of its supply (0..1), by lowercase token; absent until read. */
export function useBurned(coins: Coin[]): Record<string, number> {
  const tokens = useMemo(() => [...new Set(coins.filter((c) => !c.preview).map((c) => c.token.toLowerCase() as Address))].sort(), [coins]);
  const key = tokens.join(",");
  const [burned, setBurned] = useState<Record<string, number>>({});
  useEffect(() => {
    if (tokens.length === 0) return;
    let off = false;
    let busy = false;
    // When the last read landed; 0 until one has.
    let readAt = 0;
    const read = async () => {
      if (busy || (typeof document !== "undefined" && document.visibilityState !== "visible")) return;
      busy = true;
      try {
        const out = await publicClient.multicall({
          allowFailure: true,
          contracts: tokens.map((t) => ({ address: t, abi: erc20Abi, functionName: "balanceOf", args: [BURN_ADDRESS] }) as const),
        });
        if (off) return;
        const next: Record<string, number> = {};
        out.forEach((r, i) => {
          if (r.status === "success") next[tokens[i]!] = Number(r.result as bigint) / 1e18 / SUPPLY;
        });
        readAt = Date.now();
        setBurned((was) => ({ ...was, ...next }));
      } finally {
        busy = false;
      }
    };
    const run = () => void read().catch(() => undefined);
    // A page opened in a background tab skips its first read; read as soon as it is shown, and on coming back to a
    // tab whose figures are older than a refresh.
    const shown = () => {
      if (document.visibilityState === "visible" && Date.now() - readAt >= EVERY_MS) run();
    };
    run();
    const timer = setInterval(run, EVERY_MS);
    document.addEventListener("visibilitychange", shown);
    return () => {
      off = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", shown);
    };
    // `tokens` is keyed by `key`.
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return burned;
}

/** A burned share as the board shows it: "0%", "<0.01%", "1.25%". */
export function burnedText(share: number | undefined): string {
  if (share === undefined) return "—";
  if (share <= 0) return "0%";
  const pct = share * 100;
  if (pct < 0.01) return "<0.01%";
  return `${pct < 10 ? pct.toFixed(2) : pct.toFixed(1)}%`;
}
