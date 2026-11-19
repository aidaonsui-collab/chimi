import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { erc20Abi, flywheelAbi } from "@/lib/chimi/chain";
import { publicClient } from "@/lib/chimi/client";
import { MIN_HOLD, periodBounds, periodOf } from "@/lib/chimi/flywheel-rules";
import { amountText, money } from "@/lib/chimi/format";
import { useEthUsd } from "@/lib/chimi/live";
import { useChimi } from "@/components/chimi/provider";
import { duration, useNow } from "@/components/chimi/rewards-bits";

/*
 * The CHIMI flywheel (contracts/src/ChimiFlywheel.sol): 15% of the ETH fees of every coin launched on the 2% pools.
 * Half buys CHIMI and burns it; half is paid in ETH, every day at 00:10 KST, to wallets that held 10,000+ CHIMI on
 * average over the day. Everything shown is read from the contract, except the last run, which the keeper reports.
 */

type State = {
  burned: bigint;
  spentOnBurns: bigint;
  paid: bigint;
  toBurn: bigint;
  toHolders: bigint;
  mine?: { paid: bigint; chimi: bigint };
};

type LastRun = {
  at: number;
  burn?: { ethIn?: string; chimiOut?: string };
  payout?: { date?: string; total?: string; wallets?: number };
};

function useFlywheel(me?: Address) {
  const { deployment } = useChimi();
  const fw = deployment?.flywheel;
  const [state, setState] = useState<State | null>(null);
  const [last, setLast] = useState<LastRun | null>(null);
  useEffect(() => {
    if (!fw) return;
    let off = false;
    const read = async () => {
      if (document.visibilityState !== "visible") return;
      const base = { address: fw.address, abi: flywheelAbi } as const;
      const [burned, spentOnBurns, paid, pending, mine, chimi] = await Promise.all([
        publicClient.readContract({ ...base, functionName: "totalChimiBurned" }),
        publicClient.readContract({ ...base, functionName: "totalSpentOnBurns" }),
        publicClient.readContract({ ...base, functionName: "totalPaid" }),
        publicClient.readContract({ ...base, functionName: "pending" }),
        me ? publicClient.readContract({ ...base, functionName: "paidTo", args: [me] }) : Promise.resolve(undefined),
        me ? publicClient.readContract({ address: fw.chimi, abi: erc20Abi, functionName: "balanceOf", args: [me] }) : Promise.resolve(undefined),
      ]);
      if (off) return;
      setState({
        burned,
        spentOnBurns,
        paid,
        toBurn: pending[0],
        toHolders: pending[1],
        mine: mine !== undefined && chimi !== undefined ? { paid: mine, chimi } : undefined,
      });
    };
    void read().catch(() => undefined);
    void fetch("/api/flywheel")
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { lastRun?: LastRun | null } | null) => !off && setLast(body?.lastRun ?? null))
      .catch(() => undefined);
    const timer = setInterval(() => void read().catch(() => undefined), 60_000);
    return () => {
      off = true;
      clearInterval(timer);
    };
  }, [fw?.address, fw?.chimi, me]); // eslint-disable-line react-hooks/exhaustive-deps
  return { fw, state, last };
}

/** When the next payout goes out: 00:10 KST after the current day closes. */
const nextPayoutMs = (nowMs: number) => (periodBounds(periodOf(Math.floor(nowMs / 1000))).end + 600) * 1000;

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

/** The flywheel at a glance and what it means for the connected wallet. Nothing before the flywheel is deployed. */
export function FlywheelCard({ compact = false }: { compact?: boolean }) {
  const { account } = useChimi();
  const me = account as Address | undefined;
  const { fw, state, last } = useFlywheel(me);
  const ethUsd = useEthUsd();
  const now = useNow(30_000);
  if (!fw) return null;

  const usd = (wei: bigint) => (ethUsd && wei >= 10n ** 12n ? money((Number(wei) / 1e18) * ethUsd) : undefined);
  // Rounding leaves a few wei behind; anything under a millionth of an ETH reads as such.
  const eth = (wei: bigint) => {
    if (wei === 0n) return "0 ETH";
    if (wei < 10n ** 12n) return "<0.000001 ETH";
    const n = Number(wei) / 1e18;
    return `${n >= 1 ? amountText(wei, 4) : n.toLocaleString("en-US", { maximumSignificantDigits: 3, maximumFractionDigits: 18 })} ETH`;
  };
  const eligible = state?.mine ? state.mine.chimi >= MIN_HOLD : false;
  const untilPayout = now === null ? null : nextPayoutMs(now) - now;

  return (
    <section className="card p-5" aria-labelledby="flywheel-title">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h2 id="flywheel-title" className="text-[16px] font-semibold tracking-[-0.01em]">
            CHIMI flywheel
          </h2>
          <p className="mt-1 max-w-[60ch] text-sm leading-relaxed text-muted">
            15% of the ETH fees on every new coin: half buys CHIMI and burns it, half is paid in ETH to wallets holding 10,000+ CHIMI.
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xs text-muted">Next payout in</div>
          <div className="num text-[17px] font-semibold">{untilPayout === null ? "—" : duration(untilPayout)}</div>
        </div>
      </div>

      <div className={`mt-4 grid gap-2.5 ${compact ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-4"}`}>
        <Stat label="CHIMI burned" value={state ? chimiText(state.burned) : "—"} sub={state ? `for ${eth(state.spentOnBurns)}` : undefined} />
        <Stat label="Paid to holders" value={state ? eth(state.paid) : "—"} sub={state ? usd(state.paid) : undefined} />
        <Stat label="For the next payout" value={state ? eth(state.toHolders) : "—"} sub={state ? usd(state.toHolders) : undefined} />
        <Stat label="Waiting to burn" value={state ? eth(state.toBurn) : "—"} sub={state ? usd(state.toBurn) : undefined} />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line/80 px-4 py-3">
        {!me ? (
          <p className="text-sm text-muted">Connect a wallet to see your CHIMI and what it has earned.</p>
        ) : !state?.mine ? (
          <span className="skeleton h-4 w-56" />
        ) : (
          <p className="min-w-0 text-sm">
            <span className="text-muted">You hold </span>
            <span className="num font-semibold">{chimiText(state.mine.chimi)} CHIMI</span>
            <span className="text-muted">{eligible ? " · enough for the daily payout while you hold it" : ` · ${chimiText(MIN_HOLD - state.mine.chimi)} more to join the payout`}</span>
            <span className="text-muted"> · paid you so far </span>
            <span className="num font-semibold text-ok">{eth(state.mine.paid)}</span>
          </p>
        )}
        <Link to="/coin/$address" params={{ address: fw.chimi }} className="btn btn-sm btn-secondary shrink-0">
          {eligible ? "View CHIMI" : "Get CHIMI"}
        </Link>
      </div>

      {compact ? null : (
        <p className="mt-3 text-xs leading-relaxed text-faint">
          A day's payout is shared by each wallet's average CHIMI over that day in Seoul, so buying just before it pays little. It goes straight to the wallet as ETH, with
          nothing to claim. Pools, the burn address and Chimi's own wallets are left out.
          {last?.payout?.date && last.payout.total
            ? ` Last payout: ${eth(BigInt(last.payout.total))} to ${last.payout.wallets ?? 0} ${last.payout.wallets === 1 ? "wallet" : "wallets"} for ${last.payout.date}.`
            : ""}
        </p>
      )}
    </section>
  );
}
