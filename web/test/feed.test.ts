import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BURST_GAP_S,
  BURST_MIN,
  BURST_SPAN_S,
  CROWDED,
  buildFeed,
  buyCounts,
  copies,
  digest,
  forYou,
  freshnessKey,
  fromFollowed,
  groupBursts,
  isQuiet,
  largestBuy,
  launchesOnly,
  milestoneOf,
  ordinal,
  packBig,
  suggestTraders,
  unpackBig,
  type FeedTrade,
} from "../src/lib/chimi/feed-rules.ts";

const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const C = "0xcccccccccccccccccccccccccccccccccccccccc";
const ME = "0x1111111111111111111111111111111111111111";
const COIN = "0xc01c01c01c01c01c01c01c01c01c01c01c01c01c";
const OTHER = "0xd0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0";
const NOW = 1_800_000_000;

let n = 0;
const trade = (over: Partial<FeedTrade> = {}): FeedTrade => {
  n++;
  return { key: `0xtx${n}:0`, time: NOW - 600, wallet: A, token: COIN, buy: true, tokens: 1000, eth: 0.01, tx: `0xtx${n}`, ...over };
};

test("the largest buy of the day needs a few buys to be the largest of", () => {
  const two = [trade({ eth: 0.5 }), trade({ eth: 0.1 })];
  assert.equal(largestBuy(two, NOW - 86_400), undefined);
  const big = trade({ eth: 0.9 });
  assert.equal(largestBuy([...two, big, trade({ buy: false, eth: 5 })], NOW - 86_400), big.key, "a sale is never the largest buy");
  assert.equal(largestBuy([...two, trade({ eth: 9, time: NOW - 2 * 86_400 })], NOW - 86_400), undefined, "yesterday's buys don't count");
});

test("a wallet's buys of one coin are numbered in the order they happened", () => {
  const first = trade({ time: NOW - 300 });
  const sale = trade({ time: NOW - 250, buy: false });
  const second = trade({ time: NOW - 200 });
  const elsewhere = trade({ time: NOW - 150, token: OTHER });
  const counts = buyCounts([second, elsewhere, sale, first]);
  assert.equal(counts.get(first.key), 1);
  assert.equal(counts.get(second.key), 2);
  assert.equal(counts.get(elsewhere.key), 1, "another coin starts its own count");
  assert.equal(counts.has(sale.key), false);
});

test("a milestone is the highest round market cap climbed through and still held", () => {
  const points = [
    { time: 10, before: 4_000, after: 6_000 },
    { time: 20, before: 6_000, after: 12_000 },
    { time: 30, before: 12_000, after: 9_000 },
  ];
  assert.deepEqual(milestoneOf(points, 9_000), { cap: 5_000, time: 10 }, "it fell back under $10K, so $5K is the one it holds");
  assert.deepEqual(milestoneOf(points.slice(0, 2), 12_000), { cap: 10_000, time: 20 });
  assert.equal(milestoneOf([{ time: 10, before: 6_000, after: 7_000 }], 7_000), undefined, "no line was crossed");
  assert.equal(milestoneOf([{ time: 10, before: 12_000, after: 9_000 }], 9_000), undefined, "falling through a line is not a milestone");
});

test("a trade with no readable start uses the price the trade before it left", () => {
  const points = [
    { time: 10, before: 3_000, after: 4_500 },
    { time: 20, after: 5_200 },
  ];
  assert.deepEqual(milestoneOf(points, 5_200), { cap: 5_000, time: 20 });
});

test("followers who buy a coin within a day after you are counted against that buy", () => {
  const mine = trade({ wallet: ME, time: NOW - 5_000, eth: 0.05 });
  const fan = trade({ wallet: A, time: NOW - 4_000 });
  const fanAgain = trade({ wallet: A, time: NOW - 3_000 });
  const second = trade({ wallet: B, time: NOW - 2_000 });
  const stranger = trade({ wallet: C, time: NOW - 1_000 });
  const out = copies([mine, fan, fanAgain, second, stranger], ME, [A, B]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0]!.by, [A, B], "each follower once, and never a stranger");
  assert.equal(out[0]!.time, NOW - 2_000, "the card is as recent as the latest of them");
  assert.equal(out[0]!.eth, 0.05);
});

test("a buy before yours, a sale, or one more than a day later is not a copy", () => {
  const early = trade({ wallet: A, time: NOW - 9_000 });
  const mine = trade({ wallet: ME, time: NOW - 8_000 });
  const sale = trade({ wallet: A, time: NOW - 7_000, buy: false });
  assert.deepEqual(copies([early, mine, sale], ME, [A]), []);
  const old = trade({ wallet: ME, time: NOW - 3 * 86_400 });
  const late = trade({ wallet: A, time: NOW - 100 });
  assert.deepEqual(copies([old, late], ME, [A]), []);
  assert.deepEqual(copies([mine, late], undefined, [A]), [], "nobody is connected");
});

test("the feed is newest first and marks what is yours and what you follow", () => {
  const followed = trade({ wallet: A, time: NOW - 100 });
  const mine = trade({ wallet: ME, time: NOW - 300 });
  const items = buildFeed({
    trades: [mine, followed, followed],
    launches: [
      { token: OTHER, creator: B, time: NOW - 200 },
      { token: COIN, creator: B, time: NOW - 9_000 },
    ],
    comments: [{ id: "c1", token: COIN, wallet: A.toUpperCase().replace("0X", "0x"), text: "gm", time: NOW - 50 }],
    me: ME,
    following: [A],
    now: NOW,
  });
  assert.deepEqual(
    items.map((i) => i.kind),
    ["comment", "trade", "launch", "trade", "launch"],
  );
  assert.equal(items.filter((i) => i.kind === "trade").length, 2, "a trade read twice is one trade");
  const [comment, first, launch, own, older] = items;
  assert.equal(comment!.kind === "comment" && comment.followed, true, "addresses match whatever their case");
  assert.equal(first!.kind === "trade" && first.followed && !first.mine, true);
  assert.equal(own!.kind === "trade" && own.mine && !own.followed, true);
  assert.equal(launch!.kind === "launch" && launch.earlier, 1, "the creator's second coin");
  assert.equal(older!.kind === "launch" && older.earlier, 0);
});

test("a coin crossing a round market cap and a copied buy both get a card", () => {
  const mine = trade({ wallet: ME, time: NOW - 500 });
  const fan = trade({ wallet: A, time: NOW - 400 });
  const items = buildFeed({
    trades: [mine, fan],
    launches: [],
    comments: [],
    caps: { [COIN]: { points: [{ time: NOW - 400, before: 4_000, after: 5_500 }], now: 5_500 } },
    me: ME,
    followers: [A],
    now: NOW,
  });
  const milestone = items.find((i) => i.kind === "milestone");
  const copied = items.find((i) => i.kind === "copied");
  assert.equal(milestone?.kind === "milestone" && milestone.cap, 5_000);
  assert.deepEqual(copied?.kind === "copied" && copied.by, [A]);
});

test("For you keeps everything until the feed is crowded, then drops strangers' small trades", () => {
  const few = buildFeed({ trades: [trade(), trade({ buy: false })], launches: [], comments: [], now: NOW });
  assert.equal(forYou(few).length, 2);

  // Spread out over the day, so none of them is a burst.
  let at = NOW - 80_000;
  const apart = () => (at += BURST_GAP_S + 60);
  const small = Array.from({ length: CROWDED }, () => trade({ wallet: C, eth: 0.001, time: apart() }));
  // More usual trades than small ones, so the usual size is the middle of the day's trades.
  const usual = Array.from({ length: CROWDED + 5 }, () => trade({ wallet: C, eth: 0.02, time: apart() }));
  const followedSmall = trade({ wallet: A, eth: 0.0001 });
  const mineSmall = trade({ wallet: ME, eth: 0.0001, buy: false });
  const items = buildFeed({
    trades: [...small, ...usual, followedSmall, mineSmall],
    launches: [{ token: OTHER, creator: B, time: NOW - 10 }],
    comments: [],
    me: ME,
    following: [A],
    now: NOW,
  });
  const kept = forYou(items);
  const keys = new Set(kept.map((i) => i.key));
  assert.equal(small.some((t) => keys.has(t.key)), false, "strangers' small trades are gone");
  assert.equal(usual.every((t) => keys.has(t.key)), true);
  assert.equal(keys.has(followedSmall.key) && keys.has(mineSmall.key), true, "yours and your follows' stay, whatever their size");
  assert.equal(kept.some((i) => i.kind === "launch"), true);
});

test("the Following and New tabs pick from the same feed", () => {
  const items = buildFeed({
    trades: [trade({ wallet: A }), trade({ wallet: C })],
    launches: [
      { token: COIN, creator: A, time: NOW - 30 },
      { token: OTHER, creator: C, time: NOW - 20 },
    ],
    comments: [
      { id: "1", token: COIN, wallet: A, text: "one", time: NOW - 10 },
      { id: "2", token: COIN, wallet: C, text: "two", time: NOW - 5 },
    ],
    following: [A],
    now: NOW,
  });
  assert.deepEqual(
    fromFollowed(items).map((i) => i.kind),
    ["comment", "launch", "trade"],
  );
  assert.equal(launchesOnly(items).length, 2);
});

test("the feed is quiet when nothing has happened for an hour", () => {
  const old = buildFeed({ trades: [trade({ time: NOW - 7_200 })], launches: [], comments: [], now: NOW });
  assert.equal(isQuiet(old, NOW), true);
  assert.equal(isQuiet(buildFeed({ trades: [trade({ time: NOW - 60 })], launches: [], comments: [], now: NOW }), NOW), false);
  assert.equal(isQuiet([], NOW), true);
});

test("the digest counts the last day only", () => {
  const out = digest([trade({ wallet: A, eth: 0.01 }), trade({ wallet: A, eth: 0.02, buy: false }), trade({ wallet: B, eth: 1, time: NOW - 2 * 86_400 })], NOW);
  assert.equal(out.trades, 2);
  assert.equal(out.wallets, 1);
  assert.ok(Math.abs(out.eth - 0.03) < 1e-12);
});

test("suggestions are the season's leaders, or the busiest traders, never you or someone you follow", () => {
  const season = [
    { wallet: ME, points: 900 },
    { wallet: A, points: 800 },
    { wallet: B, points: 700 },
  ];
  assert.deepEqual(
    suggestTraders(season, [], [ME, A]).map((s) => s.wallet),
    [B],
  );
  const trades = [trade({ wallet: A, eth: 0.1 }), trade({ wallet: B, eth: 0.5 }), trade({ wallet: B, eth: 0.5 }), trade({ wallet: C, eth: 0.2 })];
  const busiest = suggestTraders([], trades, [C], 2);
  assert.deepEqual(
    busiest.map((s) => s.wallet),
    [B, A],
  );
  assert.equal(busiest[0]!.eth, 1);
});

test("small numbers read as words", () => {
  assert.equal(ordinal(3), "third");
  assert.equal(ordinal(14), "14th");
});

test("the remembered feed keeps the chain's big numbers exactly", () => {
  const price = 2395425843860388930955047330205051n;
  const kept = { coins: [{ symbol: "GIWAMI", sqrtPriceX96: price, positionId: 2n }], swaps: [{ tokenAmount: 1806759748498150929715812n, buy: true, note: "#big: not a number" }] };
  const back = unpackBig<typeof kept>(packBig(kept));
  assert.equal(back.coins[0]!.sqrtPriceX96, price);
  assert.equal(typeof back.coins[0]!.positionId, "bigint");
  assert.equal(back.swaps[0]!.tokenAmount, 1806759748498150929715812n);
  assert.equal(back.swaps[0]!.note, "#big: not a number", "text that only looks marked stays text");
  assert.throws(() => unpackBig("not json"));
});


test("a run of trades on one coin becomes one card", () => {
  const t0 = NOW - 3_000;
  const run = [
    trade({ wallet: A, eth: 0.05, time: t0 }),
    trade({ wallet: B, eth: 0.2, time: t0 + 60 }),
    trade({ wallet: C, eth: 0.01, time: t0 + 200, buy: false }),
    trade({ wallet: B, eth: 0.1, time: t0 + 260 }),
  ];
  // The day's largest buy is on another coin, so every trade of the run can fold.
  const elsewhere = trade({ wallet: A, token: OTHER, time: t0 + 100, eth: 5 });
  const late = trade({ wallet: A, eth: 0.03, time: t0 + 260 + BURST_GAP_S + 1 });
  const items = groupBursts(buildFeed({ trades: [...run, elsewhere, late], launches: [], comments: [], now: NOW }));
  assert.deepEqual(
    items.map((i) => i.kind),
    ["trade", "burst", "trade"],
    "newest first: the late trade, the burst, the other coin's trade",
  );
  const burst = items[1]!;
  assert.ok(burst.kind === "burst");
  assert.equal(burst.token, COIN);
  assert.equal(burst.time, t0 + 260, "it sits in the feed where its newest trade does");
  assert.equal(burst.since, t0);
  assert.deepEqual([burst.buys, burst.sells], [3, 1]);
  assert.ok(Math.abs(burst.eth - 0.36) < 1e-9);
  assert.deepEqual(burst.wallets, [B, A, C], "biggest spender first, each wallet once");
  assert.deepEqual(
    burst.trades.map((t) => t.key),
    [...run].reverse().map((t) => t.key),
    "the trades inside are newest first",
  );
  assert.equal(items[0]!.key, late.key, "a trade after the gap is not part of it");
});

test("fewer trades than a burst needs stay cards of their own", () => {
  const few = Array.from({ length: BURST_MIN - 1 }, (_, i) => trade({ wallet: C, time: NOW - 500 + i }));
  const items = buildFeed({ trades: few, launches: [], comments: [], now: NOW });
  assert.equal(groupBursts(items), items, "nothing to fold, so the same list comes back");
});

test("your trades, your follows' and the largest buy are never folded into a burst", () => {
  const t0 = NOW - 900;
  const strangers = [trade({ wallet: C, time: t0 }), trade({ wallet: C, time: t0 + 10 }), trade({ wallet: B, time: t0 + 20 })];
  const followed = trade({ wallet: A, time: t0 + 5, eth: 0.001 });
  const mine = trade({ wallet: ME, time: t0 + 15, eth: 0.001 });
  const biggest = trade({ wallet: B, time: t0 + 25, eth: 3 });
  const items = forYou(buildFeed({ trades: [...strangers, followed, mine, biggest], launches: [], comments: [], me: ME, following: [A], now: NOW }));
  const kinds = items.map((i) => (i.kind === "trade" ? i.key : i.kind));
  assert.deepEqual(kinds, [biggest.key, "burst", mine.key, followed.key]);
  const burst = items.find((i) => i.kind === "burst");
  assert.ok(burst?.kind === "burst");
  assert.equal(burst.trades.length, 3);
  assert.equal(
    fromFollowed(buildFeed({ trades: [...strangers, followed], launches: [], comments: [], following: [A], now: NOW })).length,
    1,
    "the Following tab never groups: it only has trades you asked to see",
  );
});

test("a coin that trades without a pause reads as several bursts, not one", () => {
  const t0 = NOW - 20_000;
  // Sales, so none of them is the day's largest buy (which would stay a card of its own).
  const steady = Array.from({ length: 40 }, (_, i) => trade({ wallet: i % 2 ? B : C, time: t0 + i * 120, buy: false }));
  const bursts = groupBursts(buildFeed({ trades: steady, launches: [], comments: [], now: NOW })).filter((i) => i.kind === "burst");
  assert.ok(bursts.length >= 2);
  for (const b of bursts) assert.ok(b.kind === "burst" && b.time - b.since <= BURST_SPAN_S);
  assert.equal(
    bursts.reduce((sum, b) => sum + (b.kind === "burst" ? b.trades.length : 0), 0),
    40,
    "every trade is in exactly one burst",
  );
});

test("a burst keeps its key as trades join it, and counts as new each time one does", () => {
  const t0 = NOW - 600;
  const first = [trade({ wallet: B, time: t0, buy: false }), trade({ wallet: C, time: t0 + 30, buy: false }), trade({ wallet: B, time: t0 + 60, buy: false })];
  const before = groupBursts(buildFeed({ trades: first, launches: [], comments: [], now: NOW }))[0]!;
  const after = groupBursts(buildFeed({ trades: [...first, trade({ wallet: C, time: t0 + 90, buy: false })], launches: [], comments: [], now: NOW }))[0]!;
  assert.equal(before.key, after.key);
  assert.notEqual(freshnessKey(before), freshnessKey(after));
  const single = buildFeed({ trades: [trade()], launches: [], comments: [], now: NOW })[0]!;
  assert.equal(freshnessKey(single), single.key);
});
