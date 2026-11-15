// npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { atSpot, impactLevel, impactText, minimumOut, priceImpact } from "../src/lib/chimi/quote-rules.ts";

const ETH = 10n ** 18n;
/** 0.00001 ETH a coin. */
const PRICE = 10n ** 13n;
const FEE = 10_000; // 1%

test("the price on the screen says what an amount would fetch with no fee and no movement", () => {
  assert.equal(atSpot(ETH, PRICE, true), 100_000n * ETH, "1 ETH buys 100,000 coins");
  assert.equal(atSpot(100_000n * ETH, PRICE, false), ETH, "and 100,000 coins sell for 1 ETH");
  assert.equal(atSpot(0n, PRICE, true), 0n);
  assert.equal(atSpot(ETH, 0n, true), 0n);
});

test("price impact is what the trade loses to its own weight, beyond the pool's fee", () => {
  const ideal = 100_000n * ETH;
  const afterFee = (ideal * 99n) / 100n;
  assert.equal(priceImpact(ETH, afterFee, PRICE, true, FEE), 0, "paying only the fee is no impact");
  assert.equal(priceImpact(ETH, afterFee + 5n, PRICE, true, FEE), 0, "never negative");
  const impact = priceImpact(ETH, (afterFee * 95n) / 100n, PRICE, true, FEE);
  assert.ok(Math.abs(impact - 0.05) < 1e-6);
  // The same on the way out.
  const sold = priceImpact(100_000n * ETH, (((ETH * 99n) / 100n) * 80n) / 100n, PRICE, false, FEE);
  assert.ok(Math.abs(sold - 0.2) < 1e-6);
  assert.equal(priceImpact(ETH, 0n, PRICE, true, FEE), 0, "nothing to compare");
});

test("the floor is the quote less the slippage allowed", () => {
  assert.equal(minimumOut(1_000_000n, 200), 980_000n);
  assert.equal(minimumOut(1_000_000n, 0), 1_000_000n);
  assert.equal(minimumOut(0n, 500), 0n);
});

test("impact is said plainly, and louder as it grows", () => {
  assert.deepEqual([impactLevel(0), impactLevel(0.0099), impactLevel(0.01), impactLevel(0.0499), impactLevel(0.05), impactLevel(0.4)], ["fine", "fine", "caution", "caution", "warning", "warning"]);
  assert.deepEqual([impactText(0), impactText(0.00004), impactText(0.0042), impactText(0.0123), impactText(0.25)], ["0%", "<0.01%", "0.42%", "1.2%", "25%"]);
});
