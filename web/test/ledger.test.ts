// npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { RECENT_MAX, byChainOrder, emptyWallet, position, record, standing, type Trade } from "../src/lib/chimi/ledger-rules.ts";

const COIN = "0xc0ffee0000000000000000000000000000000001";
const OTHER = "0xc0ffee0000000000000000000000000000000002";
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);

function trade(over: Partial<Trade>): Trade {
  return { t: 1_000, b: 100, i: 0, tx: "0xabc", token: COIN, buy: true, tokens: 1_000, eth: 1, ...over };
}

test("a buy and a sell land in the coin's tally and the wallet's totals", () => {
  const book = emptyWallet("0xABCD");
  assert.equal(book.wallet, "0xabcd");
  assert.ok(record(book, trade({ b: 100, t: 1_000, tokens: 1_000, eth: 1 })));
  assert.ok(record(book, trade({ b: 101, t: 1_060, buy: false, tokens: 400, eth: 0.6 })));
  assert.deepEqual(book.coins[COIN], { bought: 1_000, sold: 400, spent: 1, got: 0.6, buys: 1, sells: 1, last: 1_060 });
  assert.equal(book.trades, 2);
  near(book.volume, 1.6);
  assert.equal(book.first, 1_000);
  assert.equal(book.last, 1_060);
  assert.deepEqual(book.mark, [101, 0]);
  assert.equal(book.recent.length, 2);
});

test("reading the same stretch of chain twice changes nothing", () => {
  const book = emptyWallet("0xabcd");
  const trades = [trade({ b: 100, i: 3 }), trade({ b: 100, i: 7, eth: 2 }), trade({ b: 105, i: 0, eth: 3 })];
  for (const t of trades) assert.ok(record(book, t));
  const before = structuredClone(book);
  for (const t of trades) assert.equal(record(book, t), false);
  assert.deepEqual(book, before);
  // A later trade in the last block still counts; an earlier one in it does not.
  assert.equal(record(book, trade({ b: 105, i: 0 })), false);
  assert.ok(record(book, trade({ b: 105, i: 1 })));
  assert.equal(book.trades, 4);
});

test("two trades in one block are both counted, in order", () => {
  const book = emptyWallet("0xabcd");
  const trades = [trade({ b: 200, i: 9, eth: 2 }), trade({ b: 200, i: 2, eth: 1 })].sort(byChainOrder);
  for (const t of trades) assert.ok(record(book, t));
  assert.deepEqual(
    book.recent.map((t) => t.i),
    [2, 9],
  );
  near(book.volume, 3);
});

test("only the latest trades are kept in full, but the tallies keep counting", () => {
  const book = emptyWallet("0xabcd");
  for (let n = 0; n < RECENT_MAX + 25; n++) record(book, trade({ b: 1_000 + n, t: 5_000 + n, tokens: 10, eth: 0.01 }));
  assert.equal(book.recent.length, RECENT_MAX);
  assert.equal(book.recent[0]!.b, 1_025);
  assert.equal(book.recent.at(-1)!.b, 1_000 + RECENT_MAX + 24);
  assert.equal(book.trades, RECENT_MAX + 25);
  near(book.coins[COIN]!.bought, 10 * (RECENT_MAX + 25));
});

test("profit is what came out plus what is held, less what went in", () => {
  const book = emptyWallet("0xabcd");
  record(book, trade({ b: 1, tokens: 1_000, eth: 1 })); // paid 0.001 each
  record(book, trade({ b: 2, buy: false, tokens: 400, eth: 0.8 })); // sold 400 for 0.8
  const p = position(book.coins[COIN], 600, 0.003); // 600 left, now worth 0.003 each
  near(p.avgBuy!, 0.001);
  near(p.realized, 0.8 - 0.4);
  near(p.unrealized, 1.8 - 0.6);
  near(p.pnl, 0.8 + 1.8 - 1);
  near(p.value, 1.8);
});

test("tokens sold beyond what was bought here cost nothing here", () => {
  const book = emptyWallet("0xabcd");
  record(book, trade({ b: 1, tokens: 100, eth: 1 }));
  record(book, trade({ b: 2, buy: false, tokens: 250, eth: 5 })); // 150 of these arrived by transfer
  const p = position(book.coins[COIN], 0, 0.02);
  near(p.realized, 5 - 1);
  near(p.unrealized, 0);
  near(p.pnl, 4);
});

test("a coin that was never bought has no average price, and is worth its balance", () => {
  const p = position(undefined, 50, 0.1);
  assert.equal(p.avgBuy, undefined);
  near(p.pnl, 5);
  near(p.unrealized, 5);
  near(p.realized, 0);
});

test("a wallet's standing adds up every coin it traded or holds", () => {
  const book = emptyWallet("0xabcd");
  record(book, trade({ b: 1, token: COIN, tokens: 1_000, eth: 1 }));
  record(book, trade({ b: 2, token: OTHER, tokens: 10, eth: 2 }));
  record(book, trade({ b: 3, token: OTHER, buy: false, tokens: 10, eth: 1.5 }));
  const AIRDROP = "0xc0ffee0000000000000000000000000000000003";
  const total = standing(book, { [COIN]: 1_000, [AIRDROP]: 7 }, { [COIN]: 0.002, [OTHER]: 0.3, [AIRDROP]: 1 });
  near(total.spent, 3);
  near(total.got, 1.5);
  near(total.value, 2 + 7);
  near(total.pnl, 1.5 + 9 - 3);
  near(total.realized + total.unrealized, total.pnl);
  // A wallet nobody has heard of stands at zero.
  assert.deepEqual(standing(null, {}, {}), { value: 0, spent: 0, got: 0, realized: 0, unrealized: 0, pnl: 0 });
});
