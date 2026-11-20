import { useEffect, useMemo, useState } from "react";
import { giwaChain } from "@/lib/chimi/chain";
import { loadCreatorFees, shareLabel, type CreatorFees, type LockedPosition } from "@/lib/chimi/fees";
import { amountText, money } from "@/lib/chimi/format";
import { useEthUsd } from "@/lib/chimi/live";
import { feeLabel, short, shortAddr, type Coin } from "@/lib/chimi/market";
import { useChimi } from "@/components/chimi/provider";
import { toast } from "@/components/chimi/toast";
import { Note } from "@/components/chimi/ui";

const explorer = giwaChain.blockExplorers.default.url;
const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** Fees waiting on each of these coins' launch positions, keyed by lowercase token. Read again when `bump` changes. */
export function useCreatorFees(coins: Coin[], on: boolean, bump = 0) {
  const { deployment } = useChimi();
  const [fees, setFees] = useState<Record<string, CreatorFees>>({});
  const [ready, setReady] = useState(false);
  const key = coins
    .filter((c) => !c.preview && c.positionId !== undefined)
    .map((c) => c.token.toLowerCase())
    .join(",");

  useEffect(() => {
    if (!on || !deployment || !key) {
      setFees({});
      setReady(!key);
      return;
    }
    let off = false;
    const wanted = new Set(key.split(","));
    void Promise.all(
      coins
        .filter((c) => wanted.has(c.token.toLowerCase()))
        .map(async (coin) => [coin.token.toLowerCase(), await loadCreatorFees(deployment, coin).catch(() => null)] as const),
    ).then((rows) => {
      if (off) return;
      setFees(Object.fromEntries(rows.filter((row): row is readonly [string, CreatorFees] => row[1] !== null)));
      setReady(true);
    });
    return () => {
      off = true;
    };
    // `coins` is read through `key`, so a new array with the same coins doesn't read the chain again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deployment, key, on, bump]);

  return { fees, ready };
}

/**
 * Sweeps the positions, then offers to turn what arrived into ETH. The sweep pays wrapped ETH, so a claim
 * is two confirmations; turning down the second leaves the wrapped ETH in the wallet.
 */
function useClaim(onDone: () => void) {
  const { claimFees, unwrap } = useChimi();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<"" | "bad" | "good">("");

  async function claim(positions: LockedPosition[]) {
    try {
      setBusy(true);
      setKind("");
      setNote("Confirm the claim in your wallet.");
      const { hash, received } = await claimFees(positions);
      if (received === 0n) {
        setKind("good");
        setNote("Fees sent.");
        toast({ kind: "good", title: "Fees sent to the wallets on the lock", href: `${explorer}/tx/${hash}` });
        return;
      }
      const amount = `${amountText(received, 6)} ETH`;
      try {
        setNote("Claimed. Now confirm turning it into ETH.");
        const unwrapped = await unwrap(received);
        setKind("good");
        setNote(`Claimed ${amount}.`);
        toast({ kind: "good", title: `Claimed ${amount}`, body: "It is in your wallet as ETH.", href: `${explorer}/tx/${unwrapped}` });
      } catch {
        setKind("good");
        setNote(`Claimed ${amount} as wrapped ETH.`);
        toast({ kind: "good", title: `Claimed ${amount}`, body: "It arrived as wrapped ETH. Unwrap it from any coin’s trade panel.", href: `${explorer}/tx/${hash}` });
      }
    } catch (err) {
      setKind("bad");
      setNote(short(err));
    } finally {
      setBusy(false);
      onDone();
    }
  }

  return { claim, busy, note, kind };
}

/** On a coin's page, for its creator: what the launch liquidity has earned them, and a button to take it. */
export function CreatorFeesCard({ coin, bump = 0 }: { coin: Coin; bump?: number }) {
  const { account } = useChimi();
  const ethUsd = useEthUsd();
  const [again, setAgain] = useState(0);
  const isCreator = same(account, coin.creator);
  // The creator sees it at once; a separate rewards wallet is only known after the lock has been read.
  const { fees } = useCreatorFees(useMemo(() => [coin], [coin]), !!account && !coin.preview, bump + again);
  const mine = fees[coin.token.toLowerCase()];
  const { claim, busy, note, kind } = useClaim(() => setAgain((n) => n + 1));

  if (!account || coin.preview) return null;
  const paidHere = same(account, mine?.wallet);
  if (!isCreator && !paidHere) return null;

  const nothing = !mine || mine.creator === 0n;
  return (
    <section className="card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold">Your creator fees</h2>
        {mine ? <span className="chip num">{shareLabel(mine.shareBps)} of ETH fees</span> : null}
      </div>
      {mine ? (
        <>
          <p className="num mt-3 text-[28px] leading-none font-semibold tracking-[-0.03em]">
            {amountText(mine.creator, 6)} <span className="text-[15px] font-medium text-muted">ETH</span>
          </p>
          <p className="mt-1.5 text-sm text-muted">
            {nothing ? "Nothing to claim yet." : ethUsd ? `${money((Number(mine.creator) / 1e18) * ethUsd)} waiting to be claimed.` : "Waiting to be claimed."}
          </p>
        </>
      ) : (
        <span className="skeleton mt-3 block h-[50px] w-40 rounded-lg" />
      )}
      <button type="button" disabled={busy || nothing} onClick={() => mine && void claim([{ locker: mine.locker, positionId: mine.positionId }])} className="btn btn-primary mt-4 w-full disabled:opacity-40">
        {busy ? "Confirming…" : paidHere || !mine ? "Claim" : `Send to ${shortAddr(mine.wallet)}`}
      </button>
      <Note kind={kind} className="mt-2.5 text-center">
        {note}
      </Note>
      <p className="mt-2 text-xs leading-relaxed text-faint">
        {mine && !paidHere
          ? `This coin pays its creator fees to ${shortAddr(mine.wallet)}, the wallet chosen at launch.`
          : `Every trade pays the pool ${feeLabel(coin.fee)}. You earn a share of the part paid in ETH on the locked launch liquidity; the part paid in the coin is burned when you claim. A claim is two confirmations: the claim, then turning it into ETH.`}
      </p>
    </section>
  );
}

/** On a trader's own page: the fees waiting across every coin they launched, with one button for all of them. */
export function LaunchedFeesBar({ fees, onDone }: { fees: Record<string, CreatorFees>; onDone: () => void }) {
  const { account } = useChimi();
  const ethUsd = useEthUsd();
  const { claim, busy, note, kind } = useClaim(onDone);
  const due = Object.values(fees).filter((f) => f.creator > 0n && same(account, f.wallet));
  const total = due.reduce((sum, f) => sum + f.creator, 0n);

  return (
    <div className="border-b border-line bg-raise/50 px-4 py-3 sm:px-5">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 text-sm text-muted">
          Creator fees to claim{" "}
          <span className="num font-semibold text-fg">
            {amountText(total, 6)} ETH{ethUsd && total > 0n ? ` · ${money((Number(total) / 1e18) * ethUsd)}` : ""}
          </span>
        </span>
        <button type="button" disabled={busy || total === 0n} onClick={() => void claim(due.map((f) => ({ locker: f.locker, positionId: f.positionId })))} className="btn btn-sm btn-primary shrink-0 disabled:opacity-40">
          {busy ? "Confirming…" : due.length > 1 ? "Claim all" : "Claim"}
        </button>
      </div>
      {note ? (
        <Note kind={kind} className="mt-2">
          {note}
        </Note>
      ) : null}
    </div>
  );
}

/** Beside the home feed: the fees waiting across the coins this wallet launched. Nothing for a wallet that launched none. */
export function CreatorFeesMini({ coins }: { coins: Coin[] }) {
  const { account } = useChimi();
  const ethUsd = useEthUsd();
  const [again, setAgain] = useState(0);
  const mine = useMemo(() => coins.filter((c) => same(account, c.creator)), [coins, account]);
  const { fees, ready } = useCreatorFees(mine, !!account && mine.length > 0, again);
  const { claim, busy, note, kind } = useClaim(() => setAgain((n) => n + 1));
  if (!account || mine.length === 0) return null;
  const due = Object.values(fees).filter((f) => f.creator > 0n && same(account, f.wallet));
  const total = due.reduce((sum, f) => sum + f.creator, 0n);
  return (
    <section className="card p-5">
      <h3 className="text-[15px] font-semibold">Your creator fees</h3>
      {ready ? (
        <p className="num mt-3 text-[26px] leading-none font-semibold tracking-[-0.03em]">
          {amountText(total, 6)} <span className="text-[14px] font-medium text-muted">ETH</span>
        </p>
      ) : (
        <span className="skeleton mt-3 block h-7 w-32 rounded-lg" />
      )}
      <p className="mt-1.5 text-sm text-muted">
        {total === 0n ? "Nothing to claim yet" : ethUsd ? `${money((Number(total) / 1e18) * ethUsd)} waiting` : "Waiting"} across the {mine.length === 1 ? "coin" : `${mine.length} coins`} you launched.
      </p>
      <button type="button" disabled={busy || total === 0n} onClick={() => void claim(due.map((f) => ({ locker: f.locker, positionId: f.positionId })))} className="btn btn-primary mt-4 w-full disabled:opacity-40">
        {busy ? "Confirming…" : due.length > 1 ? "Claim all" : "Claim"}
      </button>
      {note ? (
        <Note kind={kind} className="mt-2.5 text-center">
          {note}
        </Note>
      ) : null}
    </section>
  );
}
