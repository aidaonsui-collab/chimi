/*
 * The three tiles at the top of the Traders page: the coin people are talking about, the coin being bought, and the
 * wallet trading the most, each over the last day. Pure, so it can be tested without a browser.
 */

export const DAY_S = 24 * 60 * 60;

/** A trade as these tiles need it. `time` is unix seconds. */
export type SocialTrade = { wallet: string; token: string; buy: boolean; eth: number; time: number };
/** A comment as these tiles need it. `time` is unix seconds. */
export type SocialComment = { wallet: string; token: string; time: number };

export type Talked = { token: string; comments: number; people: number };
export type Bought = { token: string; eth: number; buyers: number };
export type Active = { wallet: string; eth: number; trades: number };

const inWindow = (time: number, now: number, windowS: number) => time <= now && now - time < windowS;

/** The coin with the most comments in the window, then the most people commenting. Undefined when nobody said anything. */
export function mostTalkedAbout(comments: readonly SocialComment[], now: number, windowS = DAY_S): Talked | undefined {
  const by = new Map<string, { comments: number; people: Set<string> }>();
  for (const c of comments) {
    if (!inWindow(c.time, now, windowS)) continue;
    const token = c.token.toLowerCase();
    const row = by.get(token) ?? { comments: 0, people: new Set<string>() };
    row.comments += 1;
    row.people.add(c.wallet.toLowerCase());
    by.set(token, row);
  }
  const best = [...by].sort(([ta, a], [tb, b]) => b.comments - a.comments || b.people.size - a.people.size || (ta < tb ? -1 : 1))[0];
  return best ? { token: best[0], comments: best[1].comments, people: best[1].people.size } : undefined;
}

/** The coin that took the most ETH in buys in the window. Sales don't count: this is what people are buying. */
export function mostBought(trades: readonly SocialTrade[], now: number, windowS = DAY_S): Bought | undefined {
  const by = new Map<string, { eth: number; buyers: Set<string> }>();
  for (const t of trades) {
    if (!t.buy || !inWindow(t.time, now, windowS)) continue;
    const token = t.token.toLowerCase();
    const row = by.get(token) ?? { eth: 0, buyers: new Set<string>() };
    row.eth += t.eth;
    row.buyers.add(t.wallet.toLowerCase());
    by.set(token, row);
  }
  const best = [...by].sort(([ta, a], [tb, b]) => b.eth - a.eth || b.buyers.size - a.buyers.size || (ta < tb ? -1 : 1))[0];
  return best && best[1].eth > 0 ? { token: best[0], eth: best[1].eth, buyers: best[1].buyers.size } : undefined;
}

/** The wallet that traded the most ETH, buys and sales together, in the window. */
export function mostActiveTrader(trades: readonly SocialTrade[], now: number, windowS = DAY_S): Active | undefined {
  const by = new Map<string, { eth: number; trades: number }>();
  for (const t of trades) {
    if (!inWindow(t.time, now, windowS)) continue;
    const wallet = t.wallet.toLowerCase();
    const row = by.get(wallet) ?? { eth: 0, trades: 0 };
    row.eth += t.eth;
    row.trades += 1;
    by.set(wallet, row);
  }
  const best = [...by].sort(([wa, a], [wb, b]) => b.eth - a.eth || b.trades - a.trades || (wa < wb ? -1 : 1))[0];
  return best ? { wallet: best[0], ...best[1] } : undefined;
}
