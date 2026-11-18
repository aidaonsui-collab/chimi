import { test } from "node:test";
import assert from "node:assert/strict";
import { poolKey, taxToFeeTier, v4PoolDelta } from "../src/lib/chimi/v4-rules.ts";

test("a v4 tax in basis points is the same 1% the v3 fee tier uses", () => {
  assert.equal(taxToFeeTier(100), 10_000);
  assert.equal(taxToFeeTier(500), 50_000);
});

test("v4 swap amounts are flipped into the pool-delta sign the rest of the app uses", () => {
  // A buy: the trader is owed tokens (positive amount1) and owes ETH (negative amount0).
  const buy = v4PoolDelta(-1_000n, 50n);
  assert.equal(buy.amount0, 1_000n);
  assert.equal(buy.amount1, -50n);
  const sell = v4PoolDelta(40n, -50n);
  assert.equal(sell.amount0, -40n);
  assert.equal(sell.amount1, 50n);
});

test("trades are keyed by the v4 pool id, and by the v3 pool address otherwise", () => {
  assert.equal(poolKey({ pool: "0xABC", poolId: "0xDEF" }), "0xdef");
  assert.equal(poolKey({ pool: "0xABC" }), "0xabc");
});
