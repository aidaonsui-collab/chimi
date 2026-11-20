import assert from "node:assert/strict";
import { test } from "node:test";
import { MIN_TIP_WEI, cleanTipMessage, ethAmount, messageBytes, shownMessage, splitTip, tipAmount, tipMessageProblem } from "../src/lib/chimi/tip-rules.ts";

const ETH = 10n ** 18n;

test("a tip splits 90% to the creator and 10% to the platform, adding up exactly", () => {
  assert.deepEqual(splitTip(ETH), { creator: (ETH * 9n) / 10n, platform: ETH / 10n });
  for (const wei of [MIN_TIP_WEI, 123_456_789_012_345n, 7n * ETH + 3n]) {
    const { creator, platform } = splitTip(wei);
    assert.equal(creator + platform, wei);
    assert.equal(platform, (wei * 1000n) / 10_000n);
  }
});

test("amounts: presets, decimals, the minimum and the balance", () => {
  assert.deepEqual(tipAmount("0.01"), { wei: ETH / 100n });
  assert.deepEqual(tipAmount(".5"), { wei: ETH / 2n });
  assert.deepEqual(tipAmount("1."), { wei: ETH });
  assert.deepEqual(tipAmount(" 0.0001 "), { wei: MIN_TIP_WEI });
  assert.ok("error" in tipAmount("0.00009"));
  assert.ok("error" in tipAmount(""));
  assert.ok("error" in tipAmount("abc"));
  assert.ok("error" in tipAmount("1e18"));
  assert.ok("error" in tipAmount("0.0000000000000000001"));
  assert.ok("error" in tipAmount("1", ETH / 2n));
  assert.deepEqual(tipAmount("0.5", ETH / 2n), { wei: ETH / 2n });
});

test("messages: up to 280 bytes, no links", () => {
  assert.equal(tipMessageProblem(""), null);
  assert.equal(tipMessageProblem("화이팅! 오늘 방송 최고"), null);
  assert.equal(tipMessageProblem("a".repeat(280)), null);
  assert.ok(tipMessageProblem("a".repeat(281)));
  assert.equal(messageBytes("가"), 3);
  assert.ok(tipMessageProblem("가".repeat(94)), "94 Korean characters are 282 bytes");
  assert.equal(tipMessageProblem("가".repeat(93)), null);
  assert.ok(tipMessageProblem("free coins at https://scam.example"));
  assert.ok(tipMessageProblem("check scam.xyz now"));
});

test("a message is tidied before it's sent", () => {
  assert.equal(cleanTipMessage("  hi\n\n there​  "), "hi there");
  assert.equal(cleanTipMessage("‮gnp.exe"), "gnp.exe");
});

test("whatever is on the chain, a shown message has no links and is cut short", () => {
  assert.equal(shownMessage("go to https://scam.example now"), "go to … now");
  assert.equal(shownMessage("visit SCAM.XYZ"), "visit …");
  assert.equal(shownMessage("a".repeat(200), 10), "aaaaaaaaa…");
  assert.equal(shownMessage("  좋아요  "), "좋아요");
});

test("wei shows as plain ETH", () => {
  assert.equal(ethAmount(ETH / 100n), "0.01");
  assert.equal(ethAmount(ETH), "1");
  assert.equal(ethAmount(MIN_TIP_WEI), "0.0001");
  assert.equal(ethAmount((ETH * 9n) / 1000n), "0.009");
});
