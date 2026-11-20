/*
 * How a coin's ETH trading fees are shared, as plain numbers (no app imports, so tests can run it directly).
 *
 * Each coin's split is written into its lock when it launches and can't change afterwards:
 *  - coins on the first DEX: 70% creator, 30% platform;
 *  - coins launched on the 2% DEX before the fee choice: 70% creator, 15% platform, 15% to the CHIMI flywheel (half
 *    burned CHIMI, half paid to holders; that 15% now goes to the CHIMI burn);
 *  - coins launched with the fee choice: 70% creator, 10% buys the coin itself and burns it, 5% CHIMI burn, 15%
 *    platform when the creator ticked "burn my coin"; 80% creator, 5% CHIMI burn, 15% platform when they didn't.
 * The coin side of every fee is burned in the locker.
 */

export type FeeSplit = {
  /** The pool's fee, in hundredths of a bip (20000 = 2%). */
  fee: number;
  creatorBps: number;
  platformBps: number;
  /** Buys the coin itself and burns it. */
  ownBurnBps: number;
  /** Buys CHIMI and burns it. */
  chimiBurnBps: number;
  /** Paid in ETH to wallets holding 10,000+ CHIMI (the flywheel's half, coins from before the fee choice). */
  holdersBps: number;
};

type Shares = Omit<FeeSplit, "fee">;

export const FIRST_DEX: Shares = { creatorBps: 7_000, platformBps: 3_000, ownBurnBps: 0, chimiBurnBps: 0, holdersBps: 0 };
export const WITH_FLYWHEEL: Shares = { creatorBps: 7_000, platformBps: 1_500, ownBurnBps: 0, chimiBurnBps: 750, holdersBps: 750 };
/** "Burn my coin" ticked: the default on the launch form. */
export const BURNS_ITSELF: Shares = { creatorBps: 7_000, platformBps: 1_500, ownBurnBps: 1_000, chimiBurnBps: 500, holdersBps: 0 };
export const PLAIN: Shares = { creatorBps: 8_000, platformBps: 1_500, ownBurnBps: 0, chimiBurnBps: 500, holdersBps: 0 };

/** What a coin's lock says, as read from its locker. */
export type LockShares = {
  creatorBps: number;
  stakerWallet: string;
  stakerBps: number;
  backingWallet: string;
  backingBps: number;
};

const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/**
 * The split a lock pays. The staker leg goes to the flywheel (half burn, half holders) or the CHIMI burn; the backing
 * leg is a coin's own burner (Chimi uses it for nothing else); the platform gets what's left.
 */
export function splitFromLock(lock: LockShares, fee: number, sinks: { flywheel?: string }): FeeSplit {
  const toFlywheel = same(lock.stakerWallet, sinks.flywheel);
  const staker = lock.stakerBps;
  const holdersBps = toFlywheel ? staker - Math.floor(staker / 2) : 0;
  return {
    fee,
    creatorBps: lock.creatorBps,
    ownBurnBps: lock.backingBps,
    chimiBurnBps: staker - holdersBps,
    holdersBps,
    platformBps: Math.max(0, 10_000 - lock.creatorBps - staker - lock.backingBps),
  };
}

/** "7.5%" from 750. */
export const bpsLabel = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;

/** One line: "70% creator · 15% platform · 10% FLYT burn · 5% CHIMI burn". */
export function splitLine(split: FeeSplit, symbol?: string): string {
  const parts = [`${bpsLabel(split.creatorBps)} creator`, `${bpsLabel(split.platformBps)} platform`];
  if (split.ownBurnBps) parts.push(`${bpsLabel(split.ownBurnBps)} ${symbol ? symbol : "coin"} burn`);
  if (split.chimiBurnBps) parts.push(`${bpsLabel(split.chimiBurnBps)} CHIMI burn`);
  if (split.holdersBps) parts.push(`${bpsLabel(split.holdersBps)} CHIMI holders`);
  return parts.join(" · ");
}
