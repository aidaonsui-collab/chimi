// npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  closable,
  closeDays,
  dayEndMs,
  emptyBook,
  kstDay,
  leagueOf,
  sameSettings,
  score,
  summarize,
  type PointsSettings,
} from "../src/lib/chimi/points-rules.ts";

const settings: PointsSettings = {
  chainId: 91342,
  factory: "0x8d051f7FCf2F67f272b6ec96dAf2e9a847633394",
  dailyPool: 100_000,
  creatorShare: 0.1,
  seasonStart: "2026-10-24",
};
const A = "0x000000000000000000000000000000000000000a";
const B = "0x000000000000000000000000000000000000000b";
const C = "0x000000000000000000000000000000000000000c"; // a creator
const N = "0x00000000000000000000000000000000000000ee"; // no Dojang
const ts = (iso: string) => Date.parse(iso) / 1000;
const book = () => emptyBook(settings, 0, 0);
const at = (b: ReturnType<typeof book>, iso: string) => Object.assign(b, { throughTs: ts(iso) });
const dojang = (w: string) => w !== N;

test("days are KST dates", () => {
  assert.equal(kstDay(ts("2026-10-24T14:59:59Z")), "2026-10-24");
  assert.equal(kstDay(ts("2026-10-24T15:00:00Z")), "2026-10-25", "midnight in Seoul is 15:00 UTC");
  assert.equal(dayEndMs("2026-10-24"), Date.parse("2026-10-24T15:00:00Z"));
});

test("a day's pool is shared by weight, with the creator's cut", () => {
  const b = book();
  score(b, { wallet: A, creator: C, eth: 0.3, ts: ts("2026-10-24T01:00:00Z") });
  score(b, { wallet: B, creator: C, eth: 0.1, ts: ts("2026-10-24T05:00:00Z") });
  closeDays(at(b, "2026-10-24T14:59:59Z"), dojang);
  assert.equal(b.days.length, 0, "the day isn't over until midnight KST");
  closeDays(at(b, "2026-10-24T15:00:00Z"), dojang);
  const [day] = b.days;
  assert.equal(day!.day, "2026-10-24");
  assert.ok(Math.abs(day!.volume - 0.4) < 1e-12);
  // weights: A 0.3, B 0.1, C 0.04 → total 0.44
  assert.ok(Math.abs(day!.points[A]! - (100_000 * 0.3) / 0.44) < 1e-6);
  assert.ok(Math.abs(day!.points[C]! - (100_000 * 0.04) / 0.44) < 1e-6);
  const total = Object.values(day!.points).reduce((s, p) => s + p, 0);
  assert.ok(Math.abs(total - 100_000) < 1e-6);
  assert.equal(b.open.length, 0);
});

test("wallets without a Dojang are left out, and the rest share the whole pool", () => {
  const b = book();
  score(b, { wallet: A, creator: C, eth: 1, ts: ts("2026-10-24T01:00:00Z") });
  score(b, { wallet: N, creator: C, eth: 9, ts: ts("2026-10-24T02:00:00Z") });
  closeDays(at(b, "2026-10-25T00:00:00Z"), dojang);
  const [day] = b.days;
  assert.equal(day!.points[N], undefined);
  assert.deepEqual(day!.unverified, [N]);
  // A 1, C 0.1 + 0.9 (the creator still earns from an unverified trader's volume)
  assert.ok(Math.abs(day!.points[A]! - 50_000) < 1e-6);
  assert.ok(Math.abs(day!.points[C]! - 50_000) < 1e-6);
});

test("a creator's own trades on their coin don't count", () => {
  const b = book();
  score(b, { wallet: C, creator: C, eth: 5, ts: ts("2026-10-24T01:00:00Z") });
  assert.equal(b.open.length, 0);
});

test("days before the season and closed days don't change", () => {
  const b = book();
  score(b, { wallet: A, creator: C, eth: 5, ts: ts("2026-10-23T12:00:00Z") }); // 10-23 21:00 KST
  score(b, { wallet: A, creator: C, eth: 5, ts: ts("2026-10-23T16:00:00Z") }); // 10-24 01:00 KST
  closeDays(at(b, "2026-10-25T00:00:00Z"), dojang);
  score(b, { wallet: B, creator: C, eth: 100, ts: ts("2026-10-24T13:00:00Z") });
  assert.deepEqual(b.days.map((d) => d.day), ["2026-10-24"]);
  assert.equal(b.days[0]!.points[B], undefined);
  assert.equal(b.open.length, 0);
});

test("closable lists only days the book has read past", () => {
  const b = book();
  score(b, { wallet: A, creator: C, eth: 1, ts: ts("2026-10-24T01:00:00Z") });
  score(b, { wallet: A, creator: C, eth: 1, ts: ts("2026-10-25T01:00:00Z") });
  assert.deepEqual(closable(at(b, "2026-10-25T03:00:00Z")).map((d) => d.day), ["2026-10-24"]);
});

test("today's live estimate counts Dojang wallets only", () => {
  const b = book();
  score(b, { wallet: A, creator: C, eth: 1, ts: ts("2026-10-24T01:00:00Z") });
  score(b, { wallet: N, creator: C, eth: 1, ts: ts("2026-10-24T01:00:00Z") });
  b.profiles[A] = { name: "tile", verified: true, at: 0 };
  b.profiles[C] = { name: null, verified: true, at: 0 };
  b.profiles[N] = { name: null, verified: false, at: 0 };
  const live = summarize(b).live!;
  assert.deepEqual(live.standings.map((s) => s.wallet), [A, C]);
  assert.ok(Math.abs(live.standings.reduce((s, x) => s + x.points, 0) - 100_000) < 1e-6);
  assert.equal(live.volume, 2);
});

test("a book under other settings starts over", () => {
  const saved = JSON.parse(JSON.stringify(book()));
  assert.ok(sameSettings(saved, settings));
  assert.ok(!sameSettings(saved, { ...settings, seasonStart: "2026-11-01" }));
});

test("leagues by rank", () => {
  assert.equal(leagueOf(1, 500).name, "Chimi");
  assert.equal(leagueOf(6, 500).name, "Yongmaru");
  assert.equal(leagueOf(200, 500).name, "Seokkarae");
  assert.equal(leagueOf(201, 500).name, "Juchutdol");
  assert.equal(leagueOf(1, 3).name, "Chimi", "someone is always at the top");
});
