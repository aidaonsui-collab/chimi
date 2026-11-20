import { useEffect, useState } from "react";
import { zeroAddress, type Address } from "viem";
import { burnerAbi, coinBurnerAbi, dexOf, dexesOf, launchDex, lockerAbi, type Deployment } from "@/lib/chimi/chain";
import { publicClient } from "@/lib/chimi/client";
import { BURNS_ITSELF, FIRST_DEX, PLAIN, WITH_FLYWHEEL, splitFromLock, type FeeSplit } from "@/lib/chimi/fee-rules";

export { bpsLabel, splitLine, type FeeSplit } from "@/lib/chimi/fee-rules";

/*
 * Which split applies, for the pages that explain it (fee-rules.ts has the numbers). A coin's real split is on its
 * lock: `readSplit` reads it; `splitFor` is the split a coin launched now would get.
 */

/** Whether launches offer the choice to burn the coin with part of its fees. */
export const hasFeeChoice = (d: Deployment) => !!d.burner;

/** The split of a coin launched now. With the fee choice, `burnOwnCoin` picks which (ticked by default). */
export function splitFor(d: Deployment, burnOwnCoin = true): FeeSplit {
  const dex = launchDex(d);
  const fee = dex.fee;
  if (hasFeeChoice(d)) return { fee, ...(burnOwnCoin ? BURNS_ITSELF : PLAIN) };
  const later = !!d.flywheel && dexesOf(d).indexOf(dex) > 0;
  return { fee, ...(later ? WITH_FLYWHEEL : FIRST_DEX) };
}

/** A coin's split, read from its lock. */
export async function readSplit(d: Deployment, coin: { positionId?: bigint; uniFactory?: Address; fee?: number }): Promise<FeeSplit> {
  const dex = dexOf(d, coin);
  const fee = coin.fee ?? dex.fee;
  if (coin.positionId === undefined) return { fee, ...FIRST_DEX };
  const base = { address: dex.locker, abi: lockerAbi, args: [coin.positionId] } as const;
  const [creator, staker, lock] = await Promise.all([
    publicClient.readContract({ ...base, functionName: "creatorSplits" }),
    publicClient.readContract({ ...base, functionName: "stakerSplits" }),
    publicClient.readContract({ ...base, functionName: "locks" }),
  ]);
  return splitFromLock(
    { creatorBps: creator[1], stakerWallet: staker[0], stakerBps: staker[1], backingWallet: lock[3], backingBps: lock[4] },
    fee,
    { flywheel: d.flywheel?.address },
  );
}

export type CoinFees = {
  split: FeeSplit;
  /** For a coin that burns itself: its burner's totals and what is waiting to be spent. */
  burn?: { burner: Address; burned: bigint; spent: bigint; pending: bigint };
};

/** A coin's split as its lock has it, and what its own burn has done so far. Null until read. */
export function useCoinFees(d: Deployment | null | undefined, coin: { token: Address; positionId?: bigint; uniFactory?: Address; fee?: number; preview?: boolean } | null) {
  const [state, setState] = useState<CoinFees | null>(null);
  const token = coin?.token;
  useEffect(() => {
    setState(null);
    if (!d || !coin || coin.preview) return;
    let off = false;
    void (async () => {
      const split = await readSplit(d, coin);
      let burn: CoinFees["burn"];
      if (split.ownBurnBps && d.burner) {
        const burner = await publicClient.readContract({ address: d.burner.address, abi: burnerAbi, functionName: "burnerOf", args: [coin.token] });
        if (burner !== zeroAddress) {
          const base = { address: burner, abi: coinBurnerAbi } as const;
          const [burned, spent, pending] = await Promise.all([
            publicClient.readContract({ ...base, functionName: "totalBurned" }),
            publicClient.readContract({ ...base, functionName: "totalSpent" }),
            publicClient.readContract({ ...base, functionName: "pending" }),
          ]);
          burn = { burner, burned, spent, pending };
        }
      }
      if (!off) setState({ split, burn });
    })().catch(() => undefined);
    return () => {
      off = true;
    };
  }, [d?.factory, d?.burner?.address, token, coin?.positionId, coin?.uniFactory]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}
