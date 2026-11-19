import { dexOf, dexesOf, launchDex, type Deployment } from "@/lib/chimi/chain";

/*
 * How a coin's ETH trading fees are shared, for the pages that explain it. The real split is stamped on each coin's
 * lock when it launches (read it from the locker for a payout); this says which of the two it is. Coins on the first
 * DEX: 70% creator, 30% platform. Coins on the later DEX: 70% creator, 15% platform, and 15% to the CHIMI flywheel,
 * half of which buys and burns CHIMI and half of which is paid in ETH to CHIMI holders. The coin side always burns.
 */

export type FeeSplit = {
  /** The pool's fee, in hundredths of a bip (20000 = 2%). */
  fee: number;
  creatorBps: number;
  platformBps: number;
  /** Buys CHIMI and burns it. */
  burnBps: number;
  /** Paid in ETH to wallets holding 10,000+ CHIMI. */
  holdersBps: number;
  flywheel: boolean;
};

const FIRST = { creatorBps: 7_000, platformBps: 3_000, burnBps: 0, holdersBps: 0 };
const WITH_FLYWHEEL = { creatorBps: 7_000, platformBps: 1_500, burnBps: 750, holdersBps: 750 };

/** The split of `coin`, or of a coin launched now when no coin is given. */
export function splitFor(d: Deployment, coin?: { uniFactory?: string; fee?: number }): FeeSplit {
  const all = dexesOf(d);
  const dex = coin ? dexOf(d, coin) : launchDex(d);
  const later = !!d.flywheel && all.indexOf(dex) > 0;
  return { fee: coin?.fee ?? dex.fee, ...(later ? WITH_FLYWHEEL : FIRST), flywheel: later };
}

/** "7.5%" from 750. */
export const bpsLabel = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;

/** One line: "70% creator · 15% platform · 7.5% CHIMI burn · 7.5% CHIMI holders". */
export function splitLine(split: FeeSplit): string {
  const parts = [`${bpsLabel(split.creatorBps)} creator`, `${bpsLabel(split.platformBps)} platform`];
  if (split.burnBps) parts.push(`${bpsLabel(split.burnBps)} CHIMI burn`);
  if (split.holdersBps) parts.push(`${bpsLabel(split.holdersBps)} CHIMI holders`);
  return parts.join(" · ");
}
