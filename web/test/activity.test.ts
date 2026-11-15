// npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { RUN_GAP_S, timelineOf, type ActivityTrade } from "../src/lib/chimi/activity-rules.ts";

const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const NOW = 1_800_000_000;

let n = 0;
const trade = (time: number, over: Partial<ActivityTrade> = {}): ActivityTrade => {
  n++;
  return { key: `0xtx${n}:0`, time, wallet: A, buy: true, eth: 0.01, tokens: 1000, tx: `0xtx${n}`, ...over };
};

test("the trades between two threads are one line, newest first", () => {
  const before = [trade(NOW - 900), trade(NOW - 800, { wallet: B, eth: 0.5, buy: false })];
  const after = [trade(NOW - 100)];
  const list = timelineOf(
    [
      { time: NOW - 50, thread: "newest" },
      { time: NOW - 500, thread: "older" },
    ],
    [...before, ...after],
  );
  assert.deepEqual(
    list.map((e) => (e.kind === "thread" ? e.thread : e.trades.length)),
    ["newest", 1, "older", 2],
  );
  const run = list[3]!;
  assert.ok(run.kind === "trades");
  assert.deepEqual([run.time, run.since, run.buys, run.sells], [NOW - 800, NOW - 900, 1, 1]);
  assert.ok(Math.abs(run.eth - 0.51) < 1e-9);
  assert.deepEqual(run.wallets, [B, A], "biggest spender first");
  assert.deepEqual(
    run.trades.map((t) => t.key),
    [before[1]!.key, before[0]!.key],
  );
});

test("a long pause between trades starts a new line", () => {
  const list = timelineOf([], [trade(NOW - 10), trade(NOW - 20), trade(NOW - 20 - RUN_GAP_S - 1), trade(NOW - 30 - RUN_GAP_S)]);
  assert.deepEqual(
    list.map((e) => (e.kind === "trades" ? e.trades.length : 0)),
    [2, 2],
  );
});

test("a line of trades keeps its name as newer trades join it", () => {
  const first = [trade(NOW - 300), trade(NOW - 200)];
  const a = timelineOf([], first)[0]!;
  const b = timelineOf([], [...first, trade(NOW - 100)])[0]!;
  assert.ok(a.kind === "trades" && b.kind === "trades");
  assert.equal(a.key, b.key);
  assert.equal(b.trades.length, 3);
});

test("with nothing traded the list is the threads, and with nothing at all it is empty", () => {
  assert.deepEqual(timelineOf([{ time: NOW, thread: 1 }], []), [{ kind: "thread", time: NOW, thread: 1 }]);
  assert.deepEqual(timelineOf([], []), []);
  // A thread and a trade in the same second: the thread reads first.
  assert.equal(timelineOf([{ time: NOW, thread: 1 }], [trade(NOW)])[0]!.kind, "thread");
});
