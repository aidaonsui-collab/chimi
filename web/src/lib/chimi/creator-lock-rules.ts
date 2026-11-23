/*
 * Creator first-buy locks (contracts/src/ChimiCreatorLock.sol). A creator can lock their first buy at launch: it goes
 * straight from the pool into the public lock, nothing unlocks before the cliff, then it releases in a straight line
 * until the vesting end (all at once at the cliff when there is no vesting). Only the creator claims, only what has
 * unlocked; a lock can be pushed later, never earlier. The same design as nil.city's.
 *
 * Nothing here imports anything, so node can test it directly. The hooks are in creator-lock.ts.
 */

export const DAY = 86_400;
/** Mirrors ChimiPadV3.MAX_LOCK_DURATION: cliff plus vesting, at most. */
export const MAX_LOCK_DAYS = 4 * 365;

export const CLIFF_PRESETS = [30, 90, 180, 365] as const;
export const VEST_PRESETS = [0, 90, 180, 365] as const;

/** Every coin's supply. */
const SUPPLY = 1_000_000_000n * 10n ** 18n;

export type CreatorLock = {
  id: bigint;
  token: string;
  creator: string;
  amount: bigint;
  claimed: bigint;
  /** Unix seconds. */
  start: number;
  cliffEnd: number;
  vestEnd: number;
};

/** Same maths as ChimiCreatorLock.unlocked. */
export function unlockedAt(l: Pick<CreatorLock, "amount" | "cliffEnd" | "vestEnd">, nowSec: number): bigint {
  if (nowSec < l.cliffEnd) return 0n;
  if (nowSec >= l.vestEnd) return l.amount;
  return (l.amount * BigInt(nowSec - l.cliffEnd)) / BigInt(l.vestEnd - l.cliffEnd);
}

export function claimableAt(l: CreatorLock, nowSec: number): bigint {
  const u = unlockedAt(l, nowSec);
  return u > l.claimed ? u - l.claimed : 0n;
}

/** Share of a coin's 1B supply, in percent. */
export function pctOfSupply(amount: bigint): number {
  return Number((amount * 1_000_000n) / SUPPLY) / 10_000;
}

/** "Mar 30, 2027". */
export function fmtDay(sec: number): string {
  return new Date(sec * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** A whole number of days as people say it: "90 days", "1 year", "2 years", "1 year and 30 days". */
export function fmtDays(n: number): string {
  if (n >= 365) {
    const y = Math.floor(n / 365);
    const rest = n % 365;
    const years = `${y} year${y === 1 ? "" : "s"}`;
    return rest ? `${years} and ${rest} day${rest === 1 ? "" : "s"}` : years;
  }
  return `${n} day${n === 1 ? "" : "s"}`;
}

/** A lock's dates as a sentence: "All unlocks Mar 30, 2027." / "Nothing until …, then releases evenly until …". */
export function describeSchedule(cliffEnd: number, vestEnd: number, start?: number): string {
  if (vestEnd <= cliffEnd) return `All unlocks ${fmtDay(cliffEnd)}.`;
  if (start !== undefined && cliffEnd <= start) return `Releases evenly until ${fmtDay(vestEnd)}.`;
  return `Nothing until ${fmtDay(cliffEnd)}, then releases evenly until ${fmtDay(vestEnd)}.`;
}

/** The launch form's plan, in days from launch: "all unlocks after 90 days" … */
export function describePlan(cliffDays: number, vestDays: number): string {
  if (cliffDays <= 0 && vestDays <= 0) return "not locked";
  if (vestDays <= 0) return `all unlocks after ${fmtDays(cliffDays)}`;
  if (cliffDays <= 0) return `releases evenly over ${fmtDays(vestDays)} from launch`;
  return `nothing for ${fmtDays(cliffDays)}, then releases evenly over ${fmtDays(vestDays)}`;
}

/** Whether a plan can be sent: something to lock, and four years at most. */
export function planProblem(cliffDays: number, vestDays: number): string | null {
  if (!Number.isFinite(cliffDays) || !Number.isFinite(vestDays) || cliffDays < 0 || vestDays < 0) return "Days are whole numbers.";
  if (cliffDays + vestDays <= 0) return "Pick a cliff or a vesting period.";
  if (cliffDays + vestDays > MAX_LOCK_DAYS) return `Four years at most, cliff and vesting together.`;
  return null;
}

export type LockState = { label: string; tone: "locked" | "vesting" | "done" };

export function lockState(l: CreatorLock, nowSec: number): LockState {
  const u = unlockedAt(l, nowSec);
  if (u === 0n) return { label: "Locked", tone: "locked" };
  if (u >= l.amount) return { label: l.claimed >= l.amount ? "Fully claimed" : "Fully unlocked", tone: "done" };
  return { label: `${(Number((u * 10_000n) / l.amount) / 100).toFixed(1)}% unlocked`, tone: "vesting" };
}

/** Whether `token` has a lock that still holds something, for the "Dev locked" tag. */
export function stillLockedFor(locks: CreatorLock[], token: string, nowSec: number): boolean {
  const t = token.toLowerCase();
  return locks.some((l) => l.token.toLowerCase() === t && unlockedAt(l, nowSec) < l.amount);
}

/** A token amount (18 decimals) for reading: "12,345,678", "0.5". */
export function lockTokens(raw: bigint): string {
  const whole = Number(raw) / 1e18;
  if (!Number.isFinite(whole) || whole <= 0) return "0";
  return whole.toLocaleString("en-US", { maximumFractionDigits: whole >= 1000 ? 0 : 2 });
}
