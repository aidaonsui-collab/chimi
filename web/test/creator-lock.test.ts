// npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  claimableAt,
  describePlan,
  describeSchedule,
  fmtDays,
  lockState,
  lockTokens,
  MAX_LOCK_DAYS,
  pctOfSupply,
  planProblem,
  stillLockedFor,
  unlockedAt,
  type CreatorLock,
} from "../src/lib/chimi/creator-lock-rules.ts";

const E18 = 10n ** 18n;
const lock = (over: Partial<CreatorLock> = {}): CreatorLock => ({
  id: 0n,
  token: "0xabc",
  creator: "0xdef",
  amount: 1_000n * E18,
  claimed: 0n,
  start: 1_000,
  cliffEnd: 2_000,
  vestEnd: 3_000,
  ...over,
});

test("nothing unlocks before the cliff, then it releases in a straight line, like the contract", () => {
  const l = lock();
  assert.equal(unlockedAt(l, 1_999), 0n);
  assert.equal(unlockedAt(l, 2_000), 0n);
  assert.equal(unlockedAt(l, 2_500), 500n * E18);
  assert.equal(unlockedAt(l, 3_000), 1_000n * E18);
  assert.equal(unlockedAt(l, 9_999), 1_000n * E18);
});

test("a cliff without vesting releases everything at once", () => {
  const l = lock({ vestEnd: 2_000 });
  assert.equal(unlockedAt(l, 1_999), 0n);
  assert.equal(unlockedAt(l, 2_000), 1_000n * E18);
});

test("claimable is unlocked minus claimed, never below zero", () => {
  const l = lock({ claimed: 300n * E18 });
  assert.equal(claimableAt(l, 2_500), 200n * E18);
  assert.equal(claimableAt(l, 2_100), 0n);
});

test("share of the 1B supply", () => {
  assert.equal(pctOfSupply(10_000_000n * E18), 1);
  assert.equal(pctOfSupply(401_700_000n * E18), 40.17);
});

test("the plan reads as a sentence", () => {
  assert.equal(describePlan(0, 0), "not locked");
  assert.equal(describePlan(90, 0), "all unlocks after 90 days");
  assert.equal(describePlan(0, 365), "releases evenly over 1 year from launch");
  assert.equal(describePlan(30, 730), "nothing for 30 days, then releases evenly over 2 years");
  assert.equal(fmtDays(395), "1 year and 30 days");
  assert.equal(fmtDays(1), "1 day");
});

test("a schedule's dates read as a sentence", () => {
  // Midday UTC, so the date reads the same in any timezone (the page shows dates in the reader's own).
  const day = Date.UTC(2027, 2, 30, 12) / 1000;
  assert.match(describeSchedule(day, day), /^All unlocks Mar 30, 2027\.$/);
  assert.match(describeSchedule(day, day + 86_400 * 30), /^Nothing until Mar 30, 2027, then releases evenly until Apr 29, 2027\.$/);
  assert.match(describeSchedule(day, day + 86_400, day), /^Releases evenly until Mar 31, 2027\.$/);
});

test("a plan needs something to lock and four years at most", () => {
  assert.equal(planProblem(90, 0), null);
  assert.equal(planProblem(0, 0), "Pick a cliff or a vesting period.");
  assert.equal(planProblem(365, MAX_LOCK_DAYS - 365), null);
  assert.ok(planProblem(365, MAX_LOCK_DAYS - 364));
  assert.ok(planProblem(-1, 10));
});

test("state, the Dev locked tag, and amounts", () => {
  assert.equal(lockState(lock(), 1_500).label, "Locked");
  assert.equal(lockState(lock(), 2_250).label, "25.0% unlocked");
  assert.equal(lockState(lock(), 3_000).label, "Fully unlocked");
  assert.equal(lockState(lock({ claimed: 1_000n * E18 }), 3_000).label, "Fully claimed");
  assert.equal(stillLockedFor([lock()], "0xABC", 2_500), true);
  assert.equal(stillLockedFor([lock()], "0xabc", 3_000), false);
  assert.equal(stillLockedFor([lock()], "0x999", 1_500), false);
  assert.equal(lockTokens(12_345_678n * E18), "12,345,678");
  assert.equal(lockTokens(0n), "0");
});
