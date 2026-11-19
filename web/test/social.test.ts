import assert from "node:assert/strict";
import { test } from "node:test";
import { DAY_S, mostActiveTrader, mostBought, mostTalkedAbout, type SocialComment, type SocialTrade } from "../src/lib/chimi/social-rules.ts";

const NOW = 2_000_000_000;
const A = "0x" + "a".repeat(40);
const B = "0x" + "b".repeat(40);
const C = "0x" + "c".repeat(40);
const T1 = "0x" + "1".repeat(40);
const T2 = "0x" + "2".repeat(40);

const trade = (wallet: string, token: string, buy: boolean, eth: number, ago = 60): SocialTrade => ({ wallet, token, buy, eth, time: NOW - ago });
const said = (wallet: string, token: string, ago = 60): SocialComment => ({ wallet, token, time: NOW - ago });

test("the most talked-about coin has the most comments, then the most people", () => {
  const out = mostTalkedAbout([said(A, T1), said(A, T1), said(B, T2), said(C, T2)], NOW);
  // Two comments each; T2's come from two people.
  assert.deepEqual(out, { token: T2, comments: 2, people: 2 });
});

test("comments older than a day don't count, and nothing said means no coin", () => {
  assert.equal(mostTalkedAbout([said(A, T1, DAY_S + 1)], NOW), undefined);
  assert.equal(mostTalkedAbout([], NOW), undefined);
  assert.deepEqual(mostTalkedAbout([said(A, T1, DAY_S - 1)], NOW), { token: T1, comments: 1, people: 1 });
});

test("the most bought coin counts buys only, by ETH", () => {
  const out = mostBought([trade(A, T1, true, 0.2), trade(B, T1, true, 0.1), trade(C, T2, true, 0.25), trade(A, T2, false, 5)], NOW);
  assert.deepEqual(out, { token: T1, eth: 0.30000000000000004, buyers: 2 });
});

test("no buys in the day means no most-bought coin", () => {
  assert.equal(mostBought([trade(A, T1, false, 1)], NOW), undefined);
  assert.equal(mostBought([trade(A, T1, true, 1, DAY_S + 5)], NOW), undefined);
});

test("the most active trader counts buys and sales together", () => {
  const out = mostActiveTrader([trade(A, T1, true, 0.1), trade(A, T2, false, 0.15), trade(B, T1, true, 0.2)], NOW);
  assert.deepEqual(out, { wallet: A, eth: 0.25, trades: 2 });
});

test("addresses are matched whatever their case", () => {
  const out = mostActiveTrader([trade(A.toUpperCase().replace("0X", "0x"), T1, true, 0.1), trade(A, T1, true, 0.1)], NOW);
  assert.equal(out?.wallet, A);
  assert.equal(out?.trades, 2);
});

test("a future time is not in the window", () => {
  assert.equal(mostActiveTrader([trade(A, T1, true, 1, -30)], NOW), undefined);
});
