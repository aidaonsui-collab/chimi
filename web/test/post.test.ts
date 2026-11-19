import assert from "node:assert/strict";
import { test } from "node:test";
import { mentionedCoin, searchCoins, type PostCoin } from "../src/lib/chimi/post-rules.ts";

const coin = (n: number, symbol: string, name = symbol.toLowerCase()): PostCoin => ({ token: "0x" + String(n).repeat(40).slice(0, 40), symbol, name });
const CHIMI = coin(1, "CHIMI", "chimi");
const GIWAMI = coin(2, "GIWAMI", "GIWAMI");
const CHIMI2 = coin(3, "CHIMI", "Another chimi");
const ROOF = coin(4, "ROOF", "Roof tile");

test("a $symbol in the text names that coin, in any case", () => {
  assert.equal(mentionedCoin("loading up on $giwami today", [CHIMI, GIWAMI]), GIWAMI);
  assert.equal(mentionedCoin("$Chimi to the roof", [CHIMI, GIWAMI]), CHIMI);
});

test("only a whole symbol counts, and the first coin named wins", () => {
  assert.equal(mentionedCoin("$CHIMIX is not a coin here", [CHIMI]), undefined);
  assert.equal(mentionedCoin("sold $GIWAMI for $CHIMI", [CHIMI, GIWAMI]), GIWAMI);
  assert.equal(mentionedCoin("no dollar sign: CHIMI", [CHIMI]), undefined);
});

test("two coins with one symbol: the one listed first wins", () => {
  assert.equal(mentionedCoin("$CHIMI", [CHIMI2, CHIMI]), CHIMI2);
});

test("search finds symbols and names starting with the text first, then ones containing it", () => {
  assert.deepEqual(searchCoins("chi", [ROOF, GIWAMI, CHIMI, CHIMI2]), [CHIMI, CHIMI2]);
  assert.deepEqual(searchCoins("mi", [ROOF, GIWAMI, CHIMI]), [GIWAMI, CHIMI]);
  assert.deepEqual(searchCoins("tile", [ROOF, CHIMI]), [ROOF]);
});

test("search ignores a leading $, finds a pasted address, and an empty search lists everything", () => {
  assert.deepEqual(searchCoins("$roof", [CHIMI, ROOF]), [ROOF]);
  assert.deepEqual(searchCoins(ROOF.token.toUpperCase().replace("0X", "0x"), [CHIMI, ROOF]), [ROOF]);
  assert.deepEqual(searchCoins("  ", [CHIMI, ROOF]), [CHIMI, ROOF]);
});
