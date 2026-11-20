import assert from "node:assert/strict";
import { test } from "node:test";
import { BURNS_ITSELF, PLAIN, bpsLabel, splitFromLock, splitLine } from "../src/lib/chimi/fee-rules.ts";

const FLYWHEEL = "0x" + "f".repeat(40);
const BURNER = "0x" + "b".repeat(40);
const COIN_BURNER = "0x" + "c".repeat(40);
const ZERO = "0x" + "0".repeat(40);
const sinks = { flywheel: FLYWHEEL };

test("a coin that burns itself: 70% creator, 10% its own burn, 5% CHIMI burn, 15% platform", () => {
  const split = splitFromLock({ creatorBps: 7_000, stakerWallet: BURNER, stakerBps: 500, backingWallet: COIN_BURNER, backingBps: 1_000 }, 20_000, sinks);
  assert.deepEqual(split, { fee: 20_000, ...BURNS_ITSELF });
  assert.equal(splitLine(split, "FLYT"), "70% creator · 15% platform · 10% FLYT burn · 5% CHIMI burn");
});

test("a coin that doesn't: 80% creator, 5% CHIMI burn, 15% platform", () => {
  const split = splitFromLock({ creatorBps: 8_000, stakerWallet: BURNER, stakerBps: 500, backingWallet: ZERO, backingBps: 0 }, 20_000, sinks);
  assert.deepEqual(split, { fee: 20_000, ...PLAIN });
  assert.equal(splitLine(split, "FLYT"), "80% creator · 15% platform · 5% CHIMI burn");
});

test("the four shares always add up to the whole fee", () => {
  for (const s of [BURNS_ITSELF, PLAIN]) assert.equal(s.creatorBps + s.platformBps + s.ownBurnBps + s.chimiBurnBps + s.holdersBps, 10_000);
});

test("a coin from before the choice still on the flywheel: half burn, half holders", () => {
  const split = splitFromLock({ creatorBps: 7_000, stakerWallet: FLYWHEEL.toUpperCase().replace("0X", "0x"), stakerBps: 1_500, backingWallet: ZERO, backingBps: 0 }, 20_000, sinks);
  assert.equal(split.chimiBurnBps, 750);
  assert.equal(split.holdersBps, 750);
  assert.equal(split.platformBps, 1_500);
  assert.equal(splitLine(split), "70% creator · 15% platform · 7.5% CHIMI burn · 7.5% CHIMI holders");
});

test("a coin from before the choice whose 15% now goes to the CHIMI burn", () => {
  const split = splitFromLock({ creatorBps: 7_000, stakerWallet: BURNER, stakerBps: 1_500, backingWallet: ZERO, backingBps: 0 }, 20_000, sinks);
  assert.equal(splitLine(split), "70% creator · 15% platform · 15% CHIMI burn");
});

test("a first-DEX coin: 70% creator, 30% platform", () => {
  const split = splitFromLock({ creatorBps: 7_000, stakerWallet: ZERO, stakerBps: 0, backingWallet: ZERO, backingBps: 0 }, 10_000, sinks);
  assert.equal(splitLine(split), "70% creator · 30% platform");
});

test("labels", () => {
  assert.equal(bpsLabel(750), "7.5%");
  assert.equal(bpsLabel(1_000), "10%");
});
