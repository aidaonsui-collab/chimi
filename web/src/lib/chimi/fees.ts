import { zeroAddress, type Address } from "viem";
import { lockerAbi, type Deployment } from "@/lib/chimi/chain";
import { publicClient } from "@/lib/chimi/client";
import type { Coin } from "@/lib/chimi/market";

/*
 * Every coin's launch liquidity sits in the locker and earns the pool's 1% fee. The ETH side of what it
 * earns is split between the coin's creator and the platform; the coin side is burned. Nothing is paid
 * out until someone sweeps the position, which anyone may do: the money goes to the wallets on the lock.
 */

export type CreatorFees = {
  positionId: bigint;
  /** Where the creator's share is paid: the wallet put on the lock when the coin launched. */
  wallet: Address;
  /** The creator's share of the ETH side, in hundredths of a percent. */
  shareBps: number;
  /** The creator's share of the ETH-side fees not yet swept, in wei. It arrives as wrapped ETH. */
  creator: bigint;
  /** All ETH-side fees not yet swept, in wei: the creator's share and the platform's. */
  eth: bigint;
  /** Coin-side fees not yet swept. A sweep burns them. */
  coins: bigint;
};

/** What a sweep of this coin's launch position would pay out right now. */
export async function loadCreatorFees(dep: Deployment, coin: Coin): Promise<CreatorFees | null> {
  if (coin.preview || coin.positionId === undefined) return null;
  const [sweep, split] = await Promise.all([
    // A dry run of the sweep answers with what it would collect. Naming a sender keeps it out of the
    // shared multicall, where a second dry run of the same position would find the fees already taken.
    publicClient.simulateContract({
      address: dep.locker,
      abi: lockerAbi,
      functionName: "collectFees",
      args: [coin.positionId],
      account: zeroAddress,
    }),
    publicClient.readContract({ address: dep.locker, abi: lockerAbi, functionName: "creatorSplits", args: [coin.positionId] }),
  ]);
  const [amount0, amount1] = sweep.result;
  const eth = coin.tokenIs0 ? amount1 : amount0;
  const coins = coin.tokenIs0 ? amount0 : amount1;
  const [wallet, shareBps] = split;
  return { positionId: coin.positionId, wallet, shareBps, creator: creatorShare(eth, shareBps), eth, coins };
}

/** The creator's part of an ETH-side fee, rounded down the way the locker rounds it. */
export function creatorShare(eth: bigint, shareBps: number): bigint {
  return (eth * BigInt(shareBps)) / 10_000n;
}

/** "70%" from 7000. */
export function shareLabel(shareBps: number): string {
  return `${Number((shareBps / 100).toFixed(2))}%`;
}
