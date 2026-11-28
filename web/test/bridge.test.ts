// npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { bridgeProblem, ethOf, maxBridge, mergeBridges, parseAmount, sameOwnerOnGiwa, stageOf, type BridgeItem } from "../src/lib/chimi/bridge-rules.ts";

const E = 10n ** 18n;

test("amounts are read as ETH, and only above zero", () => {
  assert.equal(parseAmount("0.05"), 5n * 10n ** 16n);
  assert.equal(parseAmount(".5"), 5n * 10n ** 17n);
  assert.equal(parseAmount("2"), 2n * E);
  assert.equal(parseAmount(" 1. "), E);
  assert.equal(parseAmount("0.000000000000000001"), 1n);
  assert.equal(parseAmount("0.0000000000000000001"), null);
  assert.equal(parseAmount("0"), null);
  assert.equal(parseAmount(""), null);
  assert.equal(parseAmount("1e3"), null);
  assert.equal(parseAmount("-1"), null);
  assert.equal(parseAmount("abc"), null);
});

test("ETH reads short", () => {
  assert.equal(ethOf(5n * 10n ** 16n), "0.05");
  assert.equal(ethOf(1234n * E), "1,234");
  assert.equal(ethOf(123_456_789n * 10n ** 9n, 4), "0.1235");
  assert.equal(ethOf(0n), "0");
});

test("the most that can be bridged leaves the gas, with room", () => {
  assert.equal(maxBridge(E, 10n ** 15n), E - (15n * 10n ** 14n));
  assert.equal(maxBridge(10n ** 14n, 10n ** 15n), 0n);
});

test("what stops a bridge", () => {
  const base = { gas: 10n ** 15n, l1Name: "Ethereum Sepolia" };
  assert.equal(bridgeProblem({ ...base, text: "" }), "Enter an amount");
  assert.equal(bridgeProblem({ ...base, text: "0" }), "Enter an amount above 0");
  assert.equal(bridgeProblem({ ...base, text: "1", balance: E }), "Not enough ETH on Ethereum Sepolia");
  assert.equal(bridgeProblem({ ...base, text: "0.5", balance: E }), null);
  // Before the balance is known, nothing stops it yet.
  assert.equal(bridgeProblem({ ...base, text: "5" }), null);
});

test("a smart-contract wallet may not own the same address on GIWA; a plain or EIP-7702 account does", () => {
  assert.equal(sameOwnerOnGiwa(undefined), true);
  assert.equal(sameOwnerOnGiwa("0x"), true);
  assert.equal(sameOwnerOnGiwa("0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b"), true);
  assert.equal(sameOwnerOnGiwa("0x6080604052"), false);
});

const item = (over: Partial<BridgeItem>): BridgeItem => ({ l1Hash: "0xaa", from: "0xme", amount: "1", time: 100, ...over });

test("a bridge's stage", () => {
  assert.equal(stageOf(item({})), "sending");
  assert.equal(stageOf(item({ l1Block: 5 })), "onItsWay");
  assert.equal(stageOf(item({ l1Block: 5, l2Hash: "0xbb" })), "onItsWay");
  assert.equal(stageOf(item({ l1Block: 5, l2Hash: "0xbb", arrived: true })), "arrived");
  assert.equal(stageOf(item({ failed: true })), "failed");
});

test("one row per deposit: the one that knows more wins, newest first", () => {
  const sent = item({ l1Hash: "0xAA", time: 100 });
  const seen = item({ l1Hash: "0xaa", time: 96, l1Block: 7, l2Hash: "0xbb", arrived: true });
  const other = item({ l1Hash: "0xcc", time: 200 });
  const merged = mergeBridges([sent, other], [seen]);
  assert.deepEqual(
    merged.map((m) => [m.l1Hash.toLowerCase(), m.arrived ?? false, m.time]),
    [
      ["0xcc", false, 200],
      ["0xaa", true, 96],
    ],
  );
  // A later, less-informed copy doesn't undo an arrival.
  assert.equal(mergeBridges([seen], [sent])[0]!.arrived, true);
});
