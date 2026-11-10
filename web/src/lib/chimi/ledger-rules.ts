/**
 * The trade record: what each wallet has bought and sold on Chimi, kept so a wallet's page can show its trades and
 * its profit. The server fills it (server/ledger.ts) and the pages read it; node can test it directly, so it imports
 * nothing.
 *
 * - One small document per wallet: a running tally for every coin it has traded, and its latest trades.
 * - Trades are counted in chain order. Each wallet remembers the last trade it counted, so reading the same stretch
 *   of chain twice changes nothing.
 * - Profit is what a wallet took out plus what it still holds, less what it put in. Tokens that arrived or left some
 *   other way (a transfer, a liquidity position) are not trades, so they show up only through the balance.
 */
export const LEDGER_VERSION = 1;

/** How many of a wallet's latest trades are kept in full. The tallies cover every trade, however old. */
export const RECENT_MAX = 200;

export type Trade = {
  /** Unix seconds. */
  t: number;
  /** Block, and position in the block. Together they order trades. */
  b: number;
  i: number;
  tx: string;
  /** The coin, lowercase. */
  token: string;
  buy: boolean;
  /** Whole tokens and whole ETH, not wei. */
  tokens: number;
  eth: number;
};

/** Everything a wallet has done in one coin. */
export type CoinTally = {
  bought: number; // tokens
  sold: number; // tokens
  spent: number; // ETH paid for buys
  got: number; // ETH received from sells
  buys: number;
  sells: number;
  last: number; // unix seconds
};

export type WalletBook = {
  version: number;
  wallet: string; // lowercase
  first: number; // unix seconds of the first trade
  last: number; // and of the latest
  trades: number;
  volume: number; // ETH, both sides
  coins: Record<string, CoinTally>; // by token, lowercase
  recent: Trade[]; // oldest first, at most RECENT_MAX
  /** The last trade counted, as [block, position]. Anything at or before it is skipped. */
  mark: [number, number];
};

/** Where the reader has got to on the chain, and the pools it watches. */
export type LedgerCursor = {
  version: number;
  chainId: number;
  factory: string; // lowercase
  start: number; // the first block read: the factory's own
  through: number; // every swap up to this block is in the wallet books
  throughTs: number; // that block's time, unix seconds
  tokens: number; // factory coins the reader knows
  pools: Record<string, { token: string; wethIs0: boolean }>; // by pool, lowercase
  updatedAt: number; // ms
};

export const emptyWallet = (wallet: string): WalletBook => ({
  version: LEDGER_VERSION,
  wallet: wallet.toLowerCase(),
  first: 0,
  last: 0,
  trades: 0,
  volume: 0,
  coins: {},
  recent: [],
  mark: [0, -1],
});

export const emptyTally = (): CoinTally => ({ bought: 0, sold: 0, spent: 0, got: 0, buys: 0, sells: 0, last: 0 });

/** Chain order: earlier block first, then earlier in the block. */
export const byChainOrder = (a: Pick<Trade, "b" | "i">, b: Pick<Trade, "b" | "i">) => a.b - b.b || a.i - b.i;

/** Counts one trade. Returns false, changing nothing, when the wallet has already counted it. Mutates `book`. */
export function record(book: WalletBook, trade: Trade): boolean {
  const [block, index] = book.mark;
  if (trade.b < block || (trade.b === block && trade.i <= index)) return false;
  const token = trade.token.toLowerCase();
  const tally = (book.coins[token] ??= emptyTally());
  if (trade.buy) {
    tally.bought += trade.tokens;
    tally.spent += trade.eth;
    tally.buys++;
  } else {
    tally.sold += trade.tokens;
    tally.got += trade.eth;
    tally.sells++;
  }
  tally.last = trade.t;
  if (book.trades === 0) book.first = trade.t;
  book.last = trade.t;
  book.trades++;
  book.volume += trade.eth;
  book.recent.push({ ...trade, token });
  if (book.recent.length > RECENT_MAX) book.recent.splice(0, book.recent.length - RECENT_MAX);
  book.mark = [trade.b, trade.i];
  return true;
}

export type Position = {
  /** ETH value of what the wallet holds now, at the pool price. */
  value: number;
  /** Average ETH paid per token, or undefined if it never bought. */
  avgBuy?: number;
  /** Profit already taken: what selling brought in, less what those tokens cost. */
  realized: number;
  /** Profit still on paper: what the rest is worth, less what it cost. */
  unrealized: number;
  /** Realized plus unrealized, which is always: received + value − spent. */
  pnl: number;
};

/**
 * A wallet's standing in one coin. `held` is its balance now (whole tokens) and `price` is ETH per token. Tokens are
 * costed at the wallet's average buy price; any it sold beyond what it bought here cost it nothing here.
 */
export function position(tally: CoinTally | undefined, held: number, price: number): Position {
  const t = tally ?? emptyTally();
  const value = held * price;
  const avgBuy = t.bought > 0 ? t.spent / t.bought : undefined;
  const costOfSold = avgBuy === undefined ? 0 : Math.min(t.sold, t.bought) * avgBuy;
  const costOfRest = t.spent - costOfSold;
  const realized = t.got - costOfSold;
  const unrealized = value - costOfRest;
  return { value, avgBuy, realized, unrealized, pnl: realized + unrealized };
}

export type Standing = { value: number; spent: number; got: number; realized: number; unrealized: number; pnl: number };

/** A wallet's standing across every coin it has traded or holds. `held` and `price` are keyed by token, lowercase. */
export function standing(book: WalletBook | null | undefined, held: Record<string, number>, price: Record<string, number>): Standing {
  const total: Standing = { value: 0, spent: 0, got: 0, realized: 0, unrealized: 0, pnl: 0 };
  const tokens = new Set([...Object.keys(book?.coins ?? {}), ...Object.keys(held)]);
  for (const token of tokens) {
    const tally = book?.coins[token];
    const p = position(tally, held[token] ?? 0, price[token] ?? 0);
    total.value += p.value;
    total.spent += tally?.spent ?? 0;
    total.got += tally?.got ?? 0;
    total.realized += p.realized;
    total.unrealized += p.unrealized;
    total.pnl += p.pnl;
  }
  return total;
}
