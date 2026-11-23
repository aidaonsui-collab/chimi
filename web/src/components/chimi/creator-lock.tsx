import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { giwaChain } from "@/lib/chimi/chain";
import { claimableAt, describeSchedule, lockState, lockTokens, pctOfSupply, unlockedAt, type CreatorLock } from "@/lib/chimi/creator-lock-rules";
import { useCreatorLockAddress, useTokenLocks } from "@/lib/chimi/creator-lock";
import { short, shortAddr } from "@/lib/chimi/market";
import { IconExternal, IconLock } from "@/components/chimi/icons";
import { useChimi } from "@/components/chimi/provider";
import { toast } from "@/components/chimi/toast";
import { Blockie, Note } from "@/components/chimi/ui";

/*
 * Creator first-buy locks on the page: the coin page's card (CreatorLockCard), the rows it and the /locks page share
 * (LockRow), and the "Dev locked" tag. The creator sees Claim on their own lock once something has unlocked.
 */

/** "Dev locked": the coin's creator has a first buy in the lock that hasn't fully unlocked. */
export function DevLockedTag({ className = "" }: { className?: string }) {
  return (
    <span className={`dev-locked-tag ${className}`} title="The creator’s first buy is in the public creator lock">
      <IconLock size={11} />
      Dev locked
    </span>
  );
}

/** On a coin's page: the creator's locked first buy, its schedule and progress, and Claim for the creator. */
export function CreatorLockCard({ token, symbol }: { token: string; symbol: string }) {
  const { locks, refresh } = useTokenLocks(token);
  if (!locks || locks.length === 0) return null;
  return (
    <section className="card p-5" aria-label="Creator lock">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-1.5 text-[15px] font-semibold">
          <IconLock size={15} className="text-gold" />
          Creator lock
        </h3>
        <Link to="/locks" className="text-xs font-medium text-muted hover:text-fg">
          All locks →
        </Link>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-faint">The creator’s first buy went straight into this lock at launch. Nobody can release it early, the creator included.</p>
      <div className="mt-4 grid gap-5">
        {locks.map((l) => (
          <LockRow key={l.id.toString()} lock={l} symbol={symbol} onClaimed={refresh} />
        ))}
      </div>
    </section>
  );
}

/** One lock: amount, share of supply, schedule, progress, and Claim when it's yours. `coin` shows which coin (on /locks). */
export function LockRow({
  lock: l,
  symbol,
  onClaimed,
  coin,
}: {
  lock: CreatorLock;
  symbol: string;
  onClaimed: () => void;
  coin?: { name: string; image?: string };
}) {
  const { account, claimLock } = useChimi();
  const lockAddress = useCreatorLockAddress();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = Math.floor(Date.now() / 1000);
  const unlocked = unlockedAt(l, now);
  const claimable = claimableAt(l, now);
  const state = lockState(l, now);
  const mine = !!account && account.toLowerCase() === l.creator;
  const pctUnlocked = l.amount > 0n ? Number((unlocked * 10_000n) / l.amount) / 100 : 0;

  async function claim() {
    setBusy(true);
    setError(null);
    try {
      const { amount } = await claimLock(l.id);
      toast({ kind: "good", title: `Claimed ${lockTokens(amount)} ${symbol}`, body: "It’s in your wallet." });
      onClaimed();
    } catch (e) {
      const text = short(e);
      setError(/reject|denied|cancel/i.test(text) ? "You cancelled the claim." : text);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lock-row">
      {coin ? (
        <Link to="/coin/$address" params={{ address: l.token }} className="mb-2 flex min-w-0 items-center gap-2 text-sm font-semibold hover:text-gold">
          <span className="truncate">{coin.name}</span>
          <span className="shrink-0 text-xs font-medium text-muted">${symbol}</span>
        </Link>
      ) : null}
      <div className="flex items-baseline justify-between gap-3">
        <span className="num text-[20px] font-semibold tracking-[-0.02em]">
          {lockTokens(l.amount)} <span className="text-sm font-medium text-muted">{symbol}</span>
        </span>
        <span className="num text-xs text-muted">{pctOfSupply(l.amount).toFixed(2)}% of supply</span>
      </div>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">{describeSchedule(l.cliffEnd, l.vestEnd, l.start)}</p>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-raise2" role="progressbar" aria-valuenow={pctUnlocked} aria-valuemin={0} aria-valuemax={100} aria-label="Unlocked">
        <div className="h-full rounded-full bg-gold/80 transition-[width]" style={{ width: `${pctUnlocked}%` }} />
      </div>
      <div className="num mt-1.5 flex flex-wrap justify-between gap-x-3 text-xs">
        <span className={state.tone === "locked" ? "text-gold" : state.tone === "vesting" ? "text-fg" : "text-ok"}>{state.label}</span>
        <span className="text-faint">Claimed {lockTokens(l.claimed)}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
        <Link to="/u/$address" params={{ address: l.creator }} className="flex items-center gap-1.5 hover:text-fg">
          <Blockie address={l.creator} size={14} />
          <span className="num">Creator {shortAddr(l.creator)}</span>
        </Link>
        {lockAddress ? (
          <a href={`${giwaChain.blockExplorers.default.url}/address/${lockAddress}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-fg">
            Lock contract
            <IconExternal size={11} />
          </a>
        ) : null}
      </div>
      {mine ? (
        <div className="mt-3">
          <button type="button" disabled={claimable === 0n || busy} onClick={() => void claim()} className="btn btn-sm btn-primary disabled:opacity-40">
            {busy ? "Claiming…" : claimable > 0n ? `Claim ${lockTokens(claimable)} ${symbol}` : "Nothing to claim yet"}
          </button>
          {error ? (
            <Note kind="bad" className="mt-1.5">
              {error}
            </Note>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
