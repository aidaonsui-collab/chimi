import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCandles, pickBubbles, pickInterval, stackBubbles, type Mark, type Tick } from "../src/lib/chimi/chart-rules.ts";

const tick = (time: number, after: number, extra: Partial<Tick> = {}): Tick => ({ time, after, volume: 1, buy: true, ...extra });

test("trades in one interval make one candle", () => {
  const candles = buildCandles([tick(60, 10, { before: 8 }), tick(70, 14, { volume: 2 }), tick(110, 9, { buy: false, volume: 3 })], 60, 119);
  assert.equal(candles.length, 1);
  assert.deepEqual(candles[0], { time: 60, open: 8, high: 14, low: 8, close: 9, volume: 6, trades: 3 });
});

test("the first candle opens at its trade's own value when the start is unknown", () => {
  const [first] = buildCandles([tick(60, 10)], 60, 60);
  assert.equal(first!.open, 10);
  assert.equal(first!.low, 10);
});

test("a candle opens where the one before it closed", () => {
  const candles = buildCandles([tick(0, 10, { before: 9 }), tick(60, 12, { before: 99 })], 60, 119);
  assert.equal(candles.length, 2);
  assert.equal(candles[1]!.open, 10);
  assert.equal(candles[1]!.low, 10);
  assert.equal(candles[1]!.high, 12);
});

test("quiet stretches are filled with flat candles, up to now", () => {
  const candles = buildCandles([tick(0, 10), tick(185, 12)], 60, 310);
  assert.deepEqual(
    candles.map((c) => [c.time, c.open, c.close, c.trades]),
    [
      [0, 10, 10, 1],
      [60, 10, 10, 0],
      [120, 10, 10, 0],
      [180, 10, 12, 1],
      [240, 12, 12, 0],
      [300, 12, 12, 0],
    ],
  );
  assert.equal(candles[1]!.volume, 0);
});

test("only the latest candles are kept, without making the ones that would be dropped", () => {
  // A trade a year ago and one now, on one-minute candles: half a million flat candles are never built.
  const year = 365 * 86_400;
  const candles = buildCandles([tick(0, 10), tick(year, 20)], 60, year, 100);
  assert.equal(candles.length, 100);
  assert.equal(candles[candles.length - 1]!.close, 20);
  assert.equal(candles[0]!.close, 10);
  assert.equal(candles[0]!.time, year - 99 * 60);
});

test("no trades, no candles", () => {
  assert.deepEqual(buildCandles([], 60, 1000), []);
  assert.deepEqual(buildCandles([tick(0, 0)], 60, 1000), []);
});

test("candle times are whole intervals", () => {
  const candles = buildCandles([tick(1_700_000_123, 5), tick(1_700_001_999, 6)], 900, 1_700_002_000);
  for (const c of candles) assert.equal(c.time % 900, 0);
  assert.equal(candles[0]!.time, 1_700_000_100);
});

test("a chart opens on an interval that fits the coin's life", () => {
  const now = 10_000_000;
  assert.equal(pickInterval(undefined, now), "15m");
  assert.equal(pickInterval(now - 3 * 3600, now), "1m");
  assert.equal(pickInterval(now - 20 * 3600, now), "5m");
  assert.equal(pickInterval(now - 3 * 86_400, now), "15m");
  assert.equal(pickInterval(now - 10 * 86_400, now), "1h");
  assert.equal(pickInterval(now - 40 * 86_400, now), "4h");
  assert.equal(pickInterval(now - 400 * 86_400, now), "1D");
  assert.equal(pickInterval(now - 4000 * 86_400, now), "1D");
});

const ME = "0x" + "a".repeat(40);
const DEV = "0x" + "d".repeat(40);
const FRIEND = "0x" + "f".repeat(40);
const wallet = (n: number) => "0x" + n.toString(16).padStart(40, "0");
const mark = (key: string, time: number, w: string, eth = 1, buy = true): Mark => ({ key, time, wallet: w, buy, eth });

test("bubbles say whose trade it is", () => {
  const out = pickBubbles(
    [mark("a", 1, ME.toUpperCase().replace("0X", "0x")), mark("b", 2, DEV), mark("c", 3, FRIEND), mark("d", 4, wallet(9))],
    { me: ME, creator: DEV, following: [FRIEND.toUpperCase().replace("0X", "0x")] },
    "all",
  );
  assert.deepEqual(
    out.map((b) => b.kind),
    ["you", "dev", "following", "other"],
  );
});

test("following mode leaves strangers out, and off shows nothing", () => {
  const marks = [mark("a", 1, ME), mark("b", 2, DEV), mark("c", 3, FRIEND), mark("d", 4, wallet(9))];
  const who = { me: ME, creator: DEV, following: [FRIEND] };
  assert.deepEqual(
    pickBubbles(marks, who, "following").map((b) => b.key),
    ["a", "b", "c"],
  );
  assert.deepEqual(pickBubbles(marks, who, "off"), []);
});

test("when there are too many, strangers' smallest trades go first", () => {
  const marks = [mark("dev", 5, DEV, 0.001), mark("me", 6, ME, 0.001), ...Array.from({ length: 10 }, (_, i) => mark(`s${i}`, 10 + i, wallet(i + 1), i + 1))];
  const out = pickBubbles(marks, { me: ME, creator: DEV }, "all", 5);
  assert.equal(out.length, 5);
  assert.deepEqual(
    out.map((b) => b.key),
    ["dev", "me", "s7", "s8", "s9"],
  );
});

test("bubbles in one column stack upward instead of covering each other", () => {
  const ys = stackBubbles(
    [
      { x: 100, y: 200 },
      { x: 101, y: 198 },
      { x: 100, y: 150 },
      { x: 300, y: 199 },
    ],
    20,
  );
  // The lowest keeps its place, the one beside it is lifted a full step, the far one above is left alone.
  assert.deepEqual(ys, [200, 180, 150, 199]);
});

test("a tall stack keeps every bubble a step apart", () => {
  const ys = stackBubbles(
    Array.from({ length: 5 }, () => ({ x: 50, y: 100 })),
    10,
  );
  assert.deepEqual([...ys].sort((a, b) => b - a), [100, 90, 80, 70, 60]);
});

test("a stack too tall for the chart is squeezed to fit under the top", () => {
  const ys = stackBubbles(
    Array.from({ length: 11 }, () => ({ x: 50, y: 100 })),
    20,
    20,
    50,
  );
  const sorted = [...ys].sort((a, b) => b - a);
  assert.equal(sorted[0], 100);
  assert.equal(sorted[sorted.length - 1], 50);
  assert.equal(sorted[0]! - sorted[1]!, 5);
});

test("a short stack is left at full spacing even when a top is given", () => {
  const ys = stackBubbles(
    [
      { x: 10, y: 300 },
      { x: 10, y: 300 },
    ],
    20,
    20,
    50,
  );
  assert.deepEqual(ys, [300, 280]);
});
