// npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SORT, NEW_WINDOW_S, highlights, hourTrades, inFilter, matchesQuery, sortBoard, type BoardFacts } from "../src/lib/chimi/board-rules.ts";

const NOW = 1_800_000_000;
const coin = (over: Partial<BoardFacts> & { token: string }): BoardFacts => ({
  name: over.token.toUpperCase(),
  symbol: over.token.toUpperCase(),
  order: 0,
  capEth: 1,
  hour: 0,
  ...over,
});

const a = coin({ token: "0xaa", name: "Alpha", symbol: "ALP", order: 2, capEth: 5, change: 12, volEth: 3, trades: 4, born: NOW - 40 * 86_400, last: { buy: true, eth: 0.1, time: NOW - 600 }, hour: 2, burned: 0.01 });
const b = coin({ token: "0xbb", name: "Bravo", symbol: "BRV", order: 1, capEth: 9, change: -3, volEth: 0, trades: 0, born: NOW - 3 * 86_400, hour: 0 });
const c = coin({ token: "0xcc", name: "Charlie", symbol: "CHA", order: 0, capEth: 2, born: NOW - 3_600, last: { buy: false, eth: 0.2, time: NOW - 60 }, trades: 1, volEth: 0.2, hour: 1 });

test("the last hour's trades", () => {
  assert.equal(hourTrades([{ time: NOW - 10 }, { time: NOW - 3_599 }, { time: NOW - 3_600 }, { time: NOW - 9_000 }], NOW), 2);
  assert.equal(hourTrades([], NOW), 0);
});

test("filters keep the right coins", () => {
  const ctx = { now: NOW, live: new Set(["0xbb"]), locked: new Set(["0xcc"]) };
  const keep = (f: Parameters<typeof inFilter>[1]) => [a, b, c].filter((r) => inFilter(r, f, ctx)).map((r) => r.symbol);
  assert.deepEqual(keep("all"), ["ALP", "BRV", "CHA"]);
  assert.deepEqual(keep("new"), ["BRV", "CHA"]);
  assert.deepEqual(keep("trending"), ["ALP", "CHA"]);
  assert.deepEqual(keep("live"), ["BRV"]);
  assert.deepEqual(keep("locked"), ["CHA"]);
  // A launch exactly a week old is no longer new; one without a known time never is.
  assert.equal(inFilter(coin({ token: "0x1", born: NOW - NEW_WINDOW_S }), "new", ctx), false);
  assert.equal(inFilter(coin({ token: "0x2" }), "new", ctx), false);
});

test("search matches name, ticker (with or without $) and the start of an address", () => {
  assert.equal(matchesQuery(a, "alp"), true);
  assert.equal(matchesQuery(a, "$ALP"), true);
  assert.equal(matchesQuery(b, "rav"), true);
  assert.equal(matchesQuery(a, "0xa"), true);
  assert.equal(matchesQuery(a, "0xb"), false);
  assert.equal(matchesQuery(a, "  "), true);
  assert.equal(matchesQuery(a, "zzz"), false);
});

test("the default order is the latest trade, then the launch for coins without one", () => {
  assert.deepEqual(
    sortBoard([a, b, c], DEFAULT_SORT).map((r) => r.symbol),
    ["CHA", "ALP", "BRV"],
  );
});

test("sorts run both ways and unknown values go last either way", () => {
  const sym = (rows: BoardFacts[]) => rows.map((r) => r.symbol);
  assert.deepEqual(sym(sortBoard([a, b, c], { key: "cap", dir: "desc" })), ["BRV", "ALP", "CHA"]);
  assert.deepEqual(sym(sortBoard([a, b, c], { key: "cap", dir: "asc" })), ["CHA", "ALP", "BRV"]);
  // Charlie's day's move isn't known yet.
  assert.deepEqual(sym(sortBoard([a, b, c], { key: "chg", dir: "desc" })), ["ALP", "BRV", "CHA"]);
  assert.deepEqual(sym(sortBoard([a, b, c], { key: "chg", dir: "asc" })), ["BRV", "ALP", "CHA"]);
  assert.deepEqual(sym(sortBoard([a, b, c], { key: "newest", dir: "desc" })), ["CHA", "BRV", "ALP"]);
  assert.deepEqual(sym(sortBoard([a, b, c], { key: "burned", dir: "desc" })), ["ALP", "BRV", "CHA"]);
  // Without launch times, "newest" keeps the factory's own order (newest first).
  const x = coin({ token: "0x1", order: 1 });
  const y = coin({ token: "0x2", order: 0 });
  assert.deepEqual(sym(sortBoard([x, y], { key: "newest", dir: "desc" })), ["0X2", "0X1"]);
  assert.deepEqual(sym(sortBoard([x, y], { key: "newest", dir: "asc" })), ["0X1", "0X2"]);
});

test("the four short lists", () => {
  const top = highlights([a, b, c]);
  assert.deepEqual(top.biggest.map((r) => r.symbol), ["BRV", "ALP", "CHA"]);
  assert.deepEqual(top.volume.map((r) => r.symbol), ["ALP", "CHA"]);
  assert.deepEqual(top.gainers.map((r) => r.symbol), ["ALP"]);
  assert.deepEqual(top.hot.map((r) => r.symbol), ["ALP", "CHA"]);
  assert.equal(highlights([a, b, c], 1).biggest.length, 1);
  assert.deepEqual(highlights([]), { biggest: [], volume: [], gainers: [], hot: [] });
});
