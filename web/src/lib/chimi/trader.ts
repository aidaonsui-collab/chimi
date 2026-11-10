import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { erc20Abi } from "@/lib/chimi/chain";
import { publicClient } from "@/lib/chimi/client";
import type { WalletBook } from "@/lib/chimi/ledger-rules";
import type { Coin } from "@/lib/chimi/market";

/** What GET /api/trader answers with (server/ledger.ts). */
export type TraderRecord = {
  wallet: string;
  book: WalletBook | null;
  through: number;
  throughTs: number;
  start: number;
  writable: boolean;
};

type State = { data?: TraderRecord; loading: boolean; error?: string };

/** One wallet's trade record, refreshed every minute while the tab is in view. */
export function useTrader(wallet: string | undefined): State {
  const [state, setState] = useState<State>({ loading: true });
  useEffect(() => {
    if (!wallet) {
      setState({ loading: false });
      return;
    }
    let cancel = false;
    setState({ loading: true });
    const read = async () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/trader?wallet=${wallet.toLowerCase()}`);
        const body = (await res.json().catch(() => null)) as (TraderRecord & { error?: string }) | null;
        if (cancel) return;
        if (!res.ok || !body || body.error) throw new Error(res.status === 429 ? "Too many requests. Try again in a minute." : "The trade record is unavailable right now.");
        setState({ data: body, loading: false });
      } catch (e) {
        if (!cancel) setState((prev) => ({ ...prev, loading: false, error: e instanceof Error ? e.message : String(e) }));
      }
    };
    void read();
    const timer = setInterval(() => void read(), 60_000);
    return () => {
      cancel = true;
      clearInterval(timer);
    };
  }, [wallet]);
  return state;
}

/**
 * How much of each coin a wallet holds right now, in whole tokens, keyed by lowercase token address. Undefined until
 * the first read lands. The reads travel together as one multicall.
 */
export function useBalances(wallet: string | undefined, coins: Coin[]): Record<string, number> | undefined {
  const key = useMemo(
    () =>
      coins
        .filter((c) => !c.preview)
        .map((c) => c.token.toLowerCase())
        .join(","),
    [coins],
  );
  const [held, setHeld] = useState<{ of: string; by: Record<string, number> }>();
  useEffect(() => {
    if (!wallet || !key) return;
    let cancel = false;
    const tokens = key.split(",") as Address[];
    const read = () =>
      void Promise.all(
        tokens.map((token) =>
          publicClient
            .readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [wallet as Address] })
            .then((wei) => [token, Number(wei) / 1e18] as const)
            .catch(() => [token, 0] as const),
        ),
      ).then((rows) => {
        if (!cancel) setHeld({ of: `${wallet}:${key}`, by: Object.fromEntries(rows) });
      });
    read();
    const timer = setInterval(() => document.visibilityState === "visible" && read(), 60_000);
    return () => {
      cancel = true;
      clearInterval(timer);
    };
  }, [wallet, key]);
  if (!wallet) return undefined;
  if (!key) return {};
  // Balances read for another wallet or another list of coins aren't this one's.
  return held?.of === `${wallet}:${key}` ? held.by : undefined;
}
