import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { burnerAbi, erc20Abi, flywheelAbi } from "@/lib/chimi/chain";
import { publicClient } from "@/lib/chimi/client";
import { periodBounds, periodOf } from "@/lib/chimi/flywheel-rules";
import { amountText, money } from "@/lib/chimi/format";
import { useEthUsd } from "@/lib/chimi/live";
import { useChimi } from "@/components/chimi/provider";
import { duration, useNow } from "@/components/chimi/rewards-bits";

/*
 * The CHIMI burn (contracts/src/ChimiBurner.sol): 5% of the ETH fees of every coin launched since the fee choice buys
 * CHIMI and burns it, once a day at 00:10 KST. Coins launched on the 2% pools before it send their 15% here too. The
 * totals include what the flywheel burned before, so the count is all-time. Everything is read from the contracts.
 */

type State = {
  burned: bigint;
  spent: bigint;
  waiting: bigint;
  burningCoins: bigint;
  mine?: bigint;
};

function useBurns(me?: Address) {
  const { deployment } = useChimi();
  const burner = deployment?.burner;
  const fw = deployment?.flywheel;
  const [state, setState] = useState<State | null>(null);
  useEffect(() => {
    if (!burner) return;
    let off = false;
    const read = async () => {
      if (document.visibilityState !== "visible") return;
      const base = { address: burner.address, abi: burnerAbi } as const;
      const fly = fw ? ({ address: fw.address, abi: flywheelAbi } as const) : null;
      const [burned, spent, waiting, coins, flyBurned, flySpent, flyPending, mine] = await Promise.all([
        publicClient.readContract({ ...base, functionName: "totalChimiBurned" }),
        publicClient.readContract({ ...base, functionName: "totalSpentOnChimi" }),
        publicClient.readContract({ ...base, functionName: "pendingChimi" }),
        publicClient.readContract({ ...base, functionName: "burningCoinsLength" }),
        fly ? publicClient.readContract({ ...fly, functionName: "totalChimiBurned" }) : Promise.resolve(0n),
        fly ? publicClient.readContract({ ...fly, functionName: "totalSpentOnBurns" }) : Promise.resolve(0n),
        fly ? publicClient.readContract({ ...fly, functionName: "pending" }) : Promise.resolve([0n, 0n] as const),
        me ? publicClient.readContract({ address: burner.chimi, abi: erc20Abi, functionName: "balanceOf", args: [me] }) : Promise.resolve(undefined),
      ]);
      if (off) return;
      setState({ burned: burned + flyBurned, spent: spent + flySpent, waiting: waiting + flyPending[0], burningCoins: coins, mine });
    };
    void read().catch(() => undefined);
    const timer = setInterval(() => void read().catch(() => undefined), 60_000);
    return () => {
      off = true;
      clearInterval(timer);
    };
  }, [burner?.address, burner?.chimi, fw?.address, me]); // eslint-disable-line react-hooks/exhaustive-deps
  return { burner, state };
}

/** When the next burn runs: 00:10 KST, daily. */
const nextBurnMs = (nowMs: number) => (periodBounds(periodOf(Math.floor(nowMs / 1000))).end + 600) * 1000;

const chimiText = (wei: bigint) => {
  const n = Number(wei) / 1e18;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return amountText(wei, 2);
};

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line/80 bg-raise/40 px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="num mt-1 truncate text-[16.5px] leading-tight font-semibold tracking-[-0.02em] sm:text-[19px]">{value}</div>
      {sub ? <div className="num mt-0.5 truncate text-[12px] text-faint">{sub}</div> : null}
    </div>
  );
}

/** The CHIMI burn at a glance. Nothing before the burner is deployed. */
export function BurnCard({ compact = false }: { compact?: boolean }) {
  const { account } = useChimi();
  const me = account as Address | undefined;
  const { burner, state } = useBurns(me);
  const ethUsd = useEthUsd();
  const now = useNow(30_000);
  if (!burner) return null;

  const usd = (wei: bigint) => (ethUsd && wei >= 10n ** 12n ? money((Number(wei) / 1e18) * ethUsd) : undefined);
  // Rounding leaves a few wei behind; anything under a millionth of an ETH reads as such.
  const eth = (wei: bigint) => {
    if (wei === 0n) return "0 ETH";
    if (wei < 10n ** 12n) return "<0.000001 ETH";
    const n = Number(wei) / 1e18;
    return `${n >= 1 ? amountText(wei, 4) : n.toLocaleString("en-US", { maximumSignificantDigits: 3, maximumFractionDigits: 18 })} ETH`;
  };
  const untilBurn = now === null ? null : nextBurnMs(now) - now;

  return (
    <section className="card p-5" aria-labelledby="burn-title">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h2 id="burn-title" className="text-[16px] font-semibold tracking-[-0.01em]">
            CHIMI burn
          </h2>
          <p className="mt-1 max-w-[60ch] text-sm leading-relaxed text-muted">
            5% of the ETH fees on every new coin buys CHIMI and burns it. The more Chimi trades, the less CHIMI there is.
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xs text-muted">Next burn in</div>
          <div className="num text-[17px] font-semibold">{untilBurn === null ? "—" : duration(untilBurn)}</div>
        </div>
      </div>

      <div className={`mt-4 grid gap-2.5 ${compact ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-4"}`}>
        <Stat label="CHIMI burned" value={state ? chimiText(state.burned) : "—"} sub={state ? `for ${eth(state.spent)}` : undefined} />
        <Stat label="Waiting to burn" value={state ? eth(state.waiting) : "—"} sub={state ? usd(state.waiting) : undefined} />
        {compact ? null : (
          <>
            <Stat label="Spent on burns" value={state ? eth(state.spent) : "—"} sub={state ? usd(state.spent) : undefined} />
            <Stat label="Coins burning themselves" value={state ? state.burningCoins.toString() : "—"} sub="with 10% of their fees" />
          </>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line/80 px-4 py-3">
        {!me ? (
          <p className="text-sm text-muted">Connect a wallet to see your CHIMI.</p>
        ) : state?.mine === undefined ? (
          <span className="skeleton h-4 w-56" />
        ) : (
          <p className="min-w-0 text-sm">
            <span className="text-muted">You hold </span>
            <span className="num font-semibold">{chimiText(state.mine)} CHIMI</span>
          </p>
        )}
        <Link to="/coin/$address" params={{ address: burner.chimi }} className="btn btn-sm btn-secondary shrink-0">
          {state?.mine ? "View CHIMI" : "Get CHIMI"}
        </Link>
      </div>

      {compact ? null : (
        <p className="mt-3 text-xs leading-relaxed text-faint">
          The burn buys through CHIMI’s own pool, at most 0.25 ETH a day and never below 98% of the price checked just before, and every CHIMI it gets goes to
          the burn address.
        </p>
      )}
    </section>
  );
}
