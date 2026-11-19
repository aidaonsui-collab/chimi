/**
 * The post box on the Traders feed (post-box.tsx). A post is a comment on one coin, so it needs that coin: the one
 * picked, or else the first listed coin the text names with a $ (like $CHIMI). Pure, so node can test it.
 */
export type PostCoin = { token: string; symbol: string; name: string };

const MENTION = /\$([\p{L}\p{N}_]+)/gu;

/**
 * The first listed coin the text names as $SYMBOL, in any case. Only a whole symbol counts: "$CHIMIX" doesn't name
 * $CHIMI. Where two coins share a symbol, the one earlier in `coins` wins, so pass them biggest first.
 */
export function mentionedCoin<C extends PostCoin>(text: string, coins: readonly C[]): C | undefined {
  const bySymbol = new Map<string, C>();
  for (const coin of coins) {
    const key = coin.symbol.toLowerCase();
    if (!bySymbol.has(key)) bySymbol.set(key, coin);
  }
  for (const match of text.matchAll(MENTION)) {
    const hit = bySymbol.get(match[1]!.toLowerCase());
    if (hit) return hit;
  }
  return undefined;
}

/**
 * The coins a search in the picker finds: symbol or name starting with what was typed first, then the ones that only
 * contain it, each group in the order given. A leading $ is ignored, and a pasted address finds its coin.
 */
export function searchCoins<C extends PostCoin>(query: string, coins: readonly C[]): C[] {
  const q = query.trim().replace(/^\$/, "").toLowerCase();
  if (!q) return [...coins];
  const starts: C[] = [];
  const contains: C[] = [];
  for (const coin of coins) {
    const symbol = coin.symbol.toLowerCase();
    const name = coin.name.toLowerCase();
    if (symbol.startsWith(q) || name.startsWith(q)) starts.push(coin);
    else if (symbol.includes(q) || name.includes(q) || coin.token.toLowerCase() === q) contains.push(coin);
  }
  return [...starts, ...contains];
}
