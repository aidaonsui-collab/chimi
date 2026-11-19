/**
 * The CHIMI holder rewards (contracts/src/ChimiFlywheel.sol). Each KST day the flywheel's holder half is paid out in
 * ETH to the wallets that held at least MIN_HOLD CHIMI on average over the day, in proportion to that average. An
 * average over the whole day, not a balance at one moment, so buying just before the payout and selling just after
 * earns next to nothing. Pure, so the keeper and node's tests share one copy.
 */
export const MIN_HOLD = 10_000n * 10n ** 18n;
/** Payouts smaller than this stay in the holder half for another day. */
export const DUST = 10n ** 12n;
/** Wallets paid in one transaction. */
export const BATCH = 150;
const KST_OFFSET_S = 9 * 3600;
const DAY_S = 86_400;

/** The KST day a unix time (seconds) falls in, as a day number since 1970-01-01 KST. The flywheel's `period`. */
export const periodOf = (ts: number) => Math.floor((ts + KST_OFFSET_S) / DAY_S);

/** Where a period starts and ends, in unix seconds: [start, end). */
export const periodBounds = (period: number) => {
  const start = period * DAY_S - KST_OFFSET_S;
  return { start, end: start + DAY_S };
};

/** A period's KST date, YYYY-MM-DD. */
export const periodDate = (period: number) => new Date((periodBounds(period).start + KST_OFFSET_S) * 1000).toISOString().slice(0, 10);

export type ChimiTransfer = { from: string; to: string; value: bigint; time: number; block: bigint; index: number };

const ZERO = "0x0000000000000000000000000000000000000000";

/**
 * Each wallet's average CHIMI balance over [start, end), worked backwards from what it held at a later moment and the
 * transfers between `start` and that moment. Wallets are lowercase. A wallet that held nothing all day is left out.
 */
export function averageBalances(balancesNow: Map<string, bigint>, transfers: readonly ChimiTransfer[], start: number, end: number): Map<string, bigint> {
  const balance = new Map<string, bigint>();
  for (const [wallet, amount] of balancesNow) balance.set(wallet.toLowerCase(), amount);
  const get = (w: string) => balance.get(w) ?? 0n;
  const newestFirst = [...transfers].sort((a, b) => (a.block === b.block ? b.index - a.index : a.block > b.block ? -1 : 1));

  // Undo everything from `end` on, to get the balances as the day closed.
  let i = 0;
  for (; i < newestFirst.length && newestFirst[i]!.time >= end; i++) undo(newestFirst[i]!);

  // Then walk back through the day, adding up balance × seconds held for each wallet a transfer touches.
  const area = new Map<string, bigint>();
  const since = new Map<string, number>();
  const settle = (w: string, at: number) => {
    const from = since.get(w) ?? end;
    if (from > at) area.set(w, (area.get(w) ?? 0n) + get(w) * BigInt(from - at));
    since.set(w, at);
  };
  for (; i < newestFirst.length && newestFirst[i]!.time >= start; i++) {
    const t = newestFirst[i]!;
    for (const w of [t.from.toLowerCase(), t.to.toLowerCase()]) if (w !== ZERO) settle(w, t.time);
    undo(t);
  }
  for (const w of new Set([...balance.keys(), ...since.keys()])) settle(w, start);

  const span = BigInt(end - start);
  const out = new Map<string, bigint>();
  for (const [w, a] of area) if (a > 0n) out.set(w, a / span);
  return out;

  function undo(t: ChimiTransfer) {
    const from = t.from.toLowerCase();
    const to = t.to.toLowerCase();
    if (to !== ZERO) balance.set(to, get(to) - t.value);
    if (from !== ZERO) balance.set(from, get(from) + t.value);
  }
}

/** The wallets a day's rewards go to: an average of at least `minHold`, and not one of `excluded`. */
export function eligible(averages: Map<string, bigint>, excluded: ReadonlySet<string>, minHold = MIN_HOLD): Map<string, bigint> {
  const out = new Map<string, bigint>();
  for (const [w, avg] of averages) if (avg >= minHold && !excluded.has(w.toLowerCase())) out.set(w.toLowerCase(), avg);
  return out;
}

export type Payout = { wallet: string; amount: bigint };

/**
 * `total` shared in proportion to `weights`, rounded down, so the payouts never add up to more than `total`.
 * Payouts under `dust` are left out (they stay for another day). Biggest first, then by address, so the same inputs
 * always give the same batches.
 */
export function shareOut(total: bigint, weights: Map<string, bigint>, dust = DUST): Payout[] {
  let sum = 0n;
  for (const w of weights.values()) sum += w;
  if (total <= 0n || sum === 0n) return [];
  const out: Payout[] = [];
  for (const [wallet, weight] of weights) {
    const amount = (total * weight) / sum;
    if (amount >= dust) out.push({ wallet, amount });
  }
  return out.sort((a, b) => (a.amount === b.amount ? (a.wallet < b.wallet ? -1 : 1) : a.amount > b.amount ? -1 : 1));
}

export function batches<T>(list: readonly T[], size = BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** True for an account with code that is a contract, not an EOA with an EIP-7702 delegation (0xef0100…). */
export function isContractCode(code: string | undefined): boolean {
  if (!code || code === "0x") return false;
  return !code.toLowerCase().startsWith("0xef0100");
}
