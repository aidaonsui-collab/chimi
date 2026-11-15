/*
 * Who sold, when a sale is paid out in ETH. Such a sale is addressed to the router, which unwraps the pool's
 * wrapped ETH and passes it on, so the pool's Swap log names the router as both sender and recipient. The seller
 * is the wallet whose coins went into the pool in that same transaction, which the coin's Transfer log records.
 * This file imports nothing, so the rules can be tested on their own.
 */

type Hex = `0x${string}`;

/** The parts of a trade these rules read. `recipient` is rewritten to the seller once one is found. */
export type Sale = { tx: string; block: bigint; buy: boolean; recipient: Hex; tokenAmount: bigint };

/** A sale whose log names the router, and the pool it happened on. */
export type Unnamed<S extends Sale = Sale> = { swap: S; pool: string };

/** True for a sale whose output the router kept: the Swap log's sender and recipient are the same contract. */
export function routerKept(swap: Pick<Sale, "buy" | "recipient">, sender: string | undefined): boolean {
  return !swap.buy && !!sender && sender.toLowerCase() === swap.recipient.toLowerCase();
}

/** One sale: the transaction, the pool the coins went into, and how many. */
export const sellKey = (tx: string, pool: string, tokens: bigint) => `${tx.toLowerCase()}:${pool.toLowerCase()}:${tokens}`;

/** The first and last block these sales cover, so only that stretch of the chain is read. */
export function blocksOf(unnamed: Unnamed[]): { from: bigint; to: bigint } {
  const blocks = unnamed.map((u) => u.swap.block);
  return { from: blocks.reduce((a, b) => (a < b ? a : b)), to: blocks.reduce((a, b) => (a > b ? a : b)) };
}

/** Sellers from the node's decoded Transfer logs: each transfer into a pool, by transaction and amount. */
export function sellersFromTransfers(logs: { transactionHash: string | null; args: { from?: Hex; to?: Hex; value?: bigint } }[]): Map<string, Hex> {
  const sellers = new Map<string, Hex>();
  for (const log of logs) {
    const { from, to, value } = log.args;
    if (log.transactionHash && from && to && value !== undefined) sellers.set(sellKey(log.transactionHash, to, value), from);
  }
  return sellers;
}

/** The same from the explorer's raw logs for one pool: topic 1 is the sender, the data is the amount. */
export function sellersFromRawTransfers(logs: { transactionHash: string; data: string; topics: (string | null)[] }[], pool: string): Map<string, Hex> {
  const sellers = new Map<string, Hex>();
  for (const log of logs) {
    const from = log.topics[1];
    if (!from || from.length < 42) continue;
    // The explorer writes zero as a bare "0x".
    const value = log.data === "0x" ? 0n : BigInt(log.data);
    sellers.set(sellKey(log.transactionHash, pool, value), `0x${from.slice(-40)}`);
  }
  return sellers;
}

/** Puts each seller's address on their sale. A sale with no matching transfer keeps the router's address. */
export function nameSellers<S extends Sale>(unnamed: Unnamed<S>[], sellers: Map<string, Hex>): void {
  for (const { swap, pool } of unnamed) {
    const seller = sellers.get(sellKey(swap.tx, pool, swap.tokenAmount));
    if (seller) swap.recipient = seller;
  }
}
