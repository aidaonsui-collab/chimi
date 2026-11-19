import assert from "node:assert/strict";
import { test } from "node:test";
import { DUST, MIN_HOLD, averageBalances, batches, eligible, isContractCode, periodBounds, periodDate, periodOf, shareOut, type ChimiTransfer } from "../src/lib/chimi/flywheel-rules.ts";

const A = "0x" + "a".repeat(40);
const B = "0x" + "b".repeat(40);
const C = "0x" + "c".repeat(40);
const POOL = "0x" + "9".repeat(40);
const ZERO = "0x" + "0".repeat(40);
const E = 10n ** 18n;

const START = 1_800_000_000;
const END = START + 86_400;
let n = 0;
const move = (from: string, to: string, chimi: bigint, time: number): ChimiTransfer => ({ from, to, value: chimi * E, time, block: BigInt(time), index: n++ });

test("a KST day runs from 15:00 UTC to 15:00 UTC", () => {
  const p = periodOf(Date.UTC(2026, 10, 19, 14, 59, 59) / 1000);
  assert.equal(periodDate(p), "2026-11-19");
  assert.equal(periodOf(Date.UTC(2026, 10, 19, 15, 0, 0) / 1000), p + 1);
  const { start, end } = periodBounds(p);
  assert.equal(new Date(start * 1000).toISOString(), "2026-11-18T15:00:00.000Z");
  assert.equal(end - start, 86_400);
});

test("a wallet that held all day averages what it held", () => {
  const avg = averageBalances(new Map([[A, 50_000n * E]]), [], START, END);
  assert.equal(avg.get(A), 50_000n * E);
});

test("buying halfway through the day counts half", () => {
  const mid = START + 43_200;
  const avg = averageBalances(new Map([[A, 20_000n * E]]), [move(POOL, A, 20_000n, mid)], START, END);
  assert.equal(avg.get(A), 10_000n * E);
});

test("buying just before the day ends and selling after earns next to nothing", () => {
  const transfers = [move(POOL, A, 1_000_000n, END - 60), move(A, POOL, 1_000_000n, END + 60)];
  const avg = averageBalances(new Map([[A, 0n]]), transfers, START, END);
  // a million CHIMI for one minute of the day is about 694 CHIMI on average
  assert.ok((avg.get(A) ?? 0n) < 700n * E);
  assert.equal(eligible(avg, new Set()).size, 0);
});

test("transfers after the day are undone to find the day's balances", () => {
  // A held 30k all day and sold 10k to B the next morning
  const avg = averageBalances(new Map([[A, 20_000n * E], [B, 10_000n * E]]), [move(A, B, 10_000n, END + 3_600)], START, END);
  assert.equal(avg.get(A), 30_000n * E);
  assert.equal(avg.has(B), false, "B held nothing during the day");
});

test("several moves in a day average by the seconds each balance was held", () => {
  const q = 21_600; // a quarter of a day
  const transfers = [move(POOL, A, 40_000n, START + q), move(A, C, 40_000n, START + 3 * q), move(POOL, B, 8_000n, START + 2 * q)];
  const avg = averageBalances(new Map([[C, 40_000n * E], [B, 8_000n * E]]), transfers, START, END);
  assert.equal(avg.get(A), 20_000n * E, "40k for half the day");
  assert.equal(avg.get(C), 10_000n * E, "40k for the last quarter");
  assert.equal(avg.get(B), 4_000n * E);
});

test("mints from the zero address aren't counted as anyone's balance", () => {
  const avg = averageBalances(new Map([[A, 10_000n * E]]), [move(ZERO, A, 10_000n, START - 10)], START, END);
  assert.equal(avg.get(A), 10_000n * E);
  assert.equal(avg.has(ZERO), false);
});

test("only wallets at or over 10,000 on average, and not excluded, are paid", () => {
  const avg = new Map([[A, MIN_HOLD], [B, MIN_HOLD - 1n], [POOL, 900_000n * E]]);
  const out = eligible(avg, new Set([POOL]));
  assert.deepEqual([...out.keys()], [A]);
});

test("the pot is shared by weight, rounded down, never more than the pot", () => {
  const out = shareOut(1_000_000n, new Map([[A, 2n], [B, 1n]]), 1n);
  assert.deepEqual(out, [
    { wallet: A, amount: 666_666n },
    { wallet: B, amount: 333_333n },
  ]);
  assert.ok(out.reduce((s, p) => s + p.amount, 0n) <= 1_000_000n);
});

test("dust payouts are left for another day, and an empty pot pays nobody", () => {
  const out = shareOut(DUST * 10n, new Map([[A, 1_000n], [B, 1n]]));
  assert.deepEqual(out.map((p) => p.wallet), [A]);
  assert.deepEqual(shareOut(0n, new Map([[A, 1n]])), []);
  assert.deepEqual(shareOut(10n ** 18n, new Map()), []);
});

test("equal shares come out in address order, so batches never shuffle", () => {
  const out = shareOut(10n ** 18n, new Map([[C, 1n], [A, 1n], [B, 1n]]));
  assert.deepEqual(out.map((p) => p.wallet), [A, B, C]);
});

test("payouts go out in batches", () => {
  assert.deepEqual(batches([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(batches([], 2), []);
});

test("a contract is excluded but a wallet with an EIP-7702 delegation is not", () => {
  assert.equal(isContractCode("0x"), false);
  assert.equal(isContractCode(undefined), false);
  assert.equal(isContractCode("0xef0100" + "1".repeat(40)), false);
  assert.equal(isContractCode("0x6080604052"), true);
});
