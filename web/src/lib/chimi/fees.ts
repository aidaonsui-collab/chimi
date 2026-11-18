import { zeroAddress, type Address } from "viem";
import { isV4Live, lockerAbi, v4HookAbi, type Deployment } from "@/lib/chimi/chain";
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
  /** The creator's share of the ETH-side fees not yet swept, in wei. v3 pays wrapped ETH; v4 pays ETH. */
  creator: bigint;
  /** All ETH-side fees not yet swept, in wei: the creator's share and the platform's. */
  eth: bigint;
  /** Coin-side fees not yet swept. A v3 sweep burns them. A v4 tax is taken in ETH, so this is zero. */
  coins: bigint;
  /** v3 fees are swept from the locker. v4 fees are claimed on the hook, in ETH, for every taxed coin at once. */
  source: "v3" | "v4";
};

/** What a sweep of this coin's launch position would pay out right now. */
export async function loadCreatorFees(dep: Deployment, coin: Coin): Promise<CreatorFees | null> {
  if (coin.preview) return null;
  if (coin.poolId && isV4Live(dep)) {
    const tax = await publicClient.readContract({ address: dep.v4.hook, abi: v4HookAbi, functionName: "taxOf", args: [coin.token] });
    if (tax.token === zeroAddress) return null;
    const creator = await publicClient.readContract({
      address: dep.v4.hook,
      abi: v4HookAbi,
      functionName: "creatorFeesOf",
      args: [coin.token, tax.creator],
    });
    const rest = 10_000 - tax.platformBps - tax.stakerBps;
    const shareBps = Math.floor((rest * tax.creatorBps) / 10_000);
    return { positionId: 0n, wallet: tax.creator, shareBps, creator, eth: creator, coins: 0n, source: "v4" };
  }
  if (coin.positionId === undefined) return null;
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
  return { positionId: coin.positionId, wallet, shareBps, creator: creatorShare(eth, shareBps), eth, coins, source: "v3" };
}

/** The creator's part of an ETH-side fee, rounded down the way the locker rounds it. */
export function creatorShare(eth: bigint, shareBps: number): bigint {
  return (eth * BigInt(shareBps)) / 10_000n;
}

/** "70%" from 7000. */
export function shareLabel(shareBps: number): string {
  return `${Number((shareBps / 100).toFixed(2))}%`;
}
