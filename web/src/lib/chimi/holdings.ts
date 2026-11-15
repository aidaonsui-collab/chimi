import { useEffect, useState } from "react";
import type { Address } from "viem";
import { erc20Abi } from "@/lib/chimi/chain";
import { publicClient } from "@/lib/chimi/client";
import { SUPPLY } from "@/lib/chimi/live";

/*
 * What a wallet holds of a coin, as a share of the supply: the proof beside a name in the feed ("holds 1.2%",
 * "sold"). The balances of every row on screen are read together (the client sends them as one call), kept for a
 * short while, and read again when the feed changes, since a new trade is exactly when a balance moves.
 */

const KEEP_MS = 20_000;
const known = new Map<string, { at: number; share: number }>();

export const heldKey = (token: string, wallet: string) => `${token.toLowerCase()}:${wallet.toLowerCase()}`;

/**
 * The share of each coin's supply each wallet holds, by `heldKey`. A pair that hasn't been read yet is absent.
 * `stamp` is anything that changes when the feed does; it asks for balances older than a few seconds again.
 */
export function useHeldShares(pairs: readonly { token: string; wallet: string }[], stamp: string | number = 0): Record<string, number> {
  const keys = [...new Set(pairs.map((p) => heldKey(p.token, p.wallet)))].sort().join(",");
  const [, bump] = useState(0);
  useEffect(() => {
    if (!keys) return;
    const now = Date.now();
    const stale = keys.split(",").filter((key) => now - (known.get(key)?.at ?? 0) > KEEP_MS);
    if (stale.length === 0) return;
    let cancel = false;
    void Promise.all(
      stale.map((key) => {
        const [token, wallet] = key.split(":") as [Address, Address];
        return publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }).then(
          (balance) => known.set(key, { at: Date.now(), share: Number(balance) / 1e18 / SUPPLY }),
          () => undefined,
        );
      }),
    ).then(() => !cancel && bump((n) => n + 1));
    return () => {
      cancel = true;
    };
  }, [keys, stamp]);
  const out: Record<string, number> = {};
  if (keys) for (const key of keys.split(",")) if (known.has(key)) out[key] = known.get(key)!.share;
  return out;
}
