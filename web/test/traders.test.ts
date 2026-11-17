import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyFollows } from "../src/lib/chimi/follow-rules.ts";
import { summarize, type PointsFile } from "../src/lib/chimi/points-rules.ts";
import { defaultTraderSort, orderTraders, traderRows } from "../src/lib/chimi/trader-rules.ts";

const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const C = "0xcccccccccccccccccccccccccccccccccccccccc";
const D = "0xdddddddddddddddddddddddddddddddddddddddd";

const NOW = 1_800_000_000;
const DAY = 24 * 60 * 60;

function book(over: Partial<PointsFile> = {}): PointsFile {
  return {
    version: 1,
    chainId: 91342,
    factory: "0x0000000000000000000000000000000000000001",
    dailyPool: 100_000,
    creatorShare: 0.1,
    seasonStart: "2026-11-01",
    updatedAt: NOW * 1000,
    through: 1,
    throughTs: NOW,
    tokens: 1,
    pools: {},
    days: [],
    open: [],
    profiles: {},
    ...over,
  };
}

test("a wallet shows up whether it earned points, traded without a Dojang, or is only followed", () => {
  const points = summarize(
    book({
      days: [{ day: "2026-11-02", points: { [A]: 60_000, [B]: 40_000 }, volume: 3, unverified: [C] }],
      led: { [A]: { n: 2, eth: 0.5 } },
    }),
  );
  const follows = { ...emptyFollows(), following: { [B]: [A, D] } };
  const rows = traderRows(points, follows, [], NOW - DAY);
  const by = new Map(rows.map((r) => [r.wallet, r]));

  assert.equal(rows.length, 4);
  assert.deepEqual({ points: by.get(A)!.points, rank: by.get(A)!.rank, followers: by.get(A)!.followers, led: by.get(A)!.led, ledEth: by.get(A)!.ledEth }, { points: 60_000, rank: 1, followers: 1, led: 2, ledEth: 0.5 });
  assert.equal(by.get(B)!.rank, 2);
  // No Dojang: it traded, so it is listed, with no points.
  assert.deepEqual({ points: by.get(C)!.points, rank: by.get(C)!.rank }, { points: 0, rank: undefined });
  // Never traded, only followed.
  assert.deepEqual({ points: by.get(D)!.points, followers: by.get(D)!.followers }, { points: 0, followers: 1 });
});

test("only trades since the given time count toward the day, whatever the address's case", () => {
  const rows = traderRows(
    null,
    undefined,
    [
      { wallet: A.toUpperCase().replace("0X", "0x"), eth: 0.4, time: NOW - 100 },
      { wallet: A, eth: 0.1, time: NOW - 200 },
      { wallet: A, eth: 9, time: NOW - 2 * DAY },
      { wallet: B, eth: 0.2, time: NOW - 50 },
    ],
    NOW - DAY,
  );
  const a = rows.find((r) => r.wallet === A)!;
  assert.equal(rows.length, 2);
  assert.equal(a.trades, 2);
  assert.ok(Math.abs(a.todayEth - 0.5) < 1e-9);
});

test("the list opens on points once a season has any, and on the day's trading before that", () => {
  const trades = [
    { wallet: A, eth: 0.1, time: NOW - 10 },
    { wallet: B, eth: 0.7, time: NOW - 10 },
  ];
  const before = traderRows(null, undefined, trades, NOW - DAY);
  assert.equal(defaultTraderSort(before), "today");
  assert.deepEqual(
    orderTraders(before, "today").map((r) => r.wallet),
    [B, A],
  );

  const points = summarize(book({ days: [{ day: "2026-11-02", points: { [A]: 100_000 }, volume: 1, unverified: [] }] }));
  const after = traderRows(points, undefined, trades, NOW - DAY);
  assert.equal(defaultTraderSort(after), "points");
  assert.deepEqual(
    orderTraders(after, "points").map((r) => r.wallet),
    [A, B],
  );
});

test("ties fall back to points, then the day's trading, then the address, so the order never shuffles", () => {
  const follows = { ...emptyFollows(), following: { [D]: [A, B, C] } };
  const points = summarize(book({ days: [{ day: "2026-11-02", points: { [C]: 10 }, volume: 1, unverified: [] }] }));
  const rows = traderRows(points, follows, [{ wallet: B, eth: 1, time: NOW }], NOW - DAY);
  assert.deepEqual(
    orderTraders(rows, "followers").map((r) => r.wallet),
    [C, B, A],
  );
  // Following others doesn't put a wallet on the list; trading or being followed does.
  assert.equal(
    rows.some((r) => r.wallet === D),
    false,
  );
});
