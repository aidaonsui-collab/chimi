/** v3 fee-tier units (hundredths of a bip) for a tax in basis points. 100 bps is 1%, the same as fee tier 10000. */
export function taxToFeeTier(bps: number): number {
  return bps * 100;
}

/**
 * Flip a v4 trader-delta into the pool-delta sign v3 swaps use.
 * On v4 a positive amount is what the trader is owed. On v3 a positive amount is what the pool received.
 */
export function v4PoolDelta(amount0: bigint, amount1: bigint): { amount0: bigint; amount1: bigint } {
  return { amount0: -amount0, amount1: -amount1 };
}

/** Trades and reserves are stored under the v4 pool id, or the v3 pool address when there is no id. */
export function poolKey(coin: { pool: string; poolId?: string }): string {
  return (coin.poolId ?? coin.pool).toLowerCase();
}
