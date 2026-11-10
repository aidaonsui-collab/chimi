// npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_KEPT,
  MAX_LENGTH,
  MIN_GAP_MS,
  NEED_DOJANG,
  applyComment,
  checkText,
  cleanText,
  commentMessage,
  emptyComments,
  removeComment,
  stance,
  type CommentsDoc,
} from "../src/lib/chimi/comment-rules.ts";

const COIN = "0xC0ffee0000000000000000000000000000000001";
const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000b2";
const yes = { verified: true };
const no = { verified: false };
const T0 = Date.UTC(2026, 10, 10, 12, 0, 0);

function ok(out: ReturnType<typeof applyComment>): CommentsDoc {
  assert.ok("doc" in out, "error" in out ? out.error : "");
  return out.doc;
}

function refused(out: ReturnType<typeof applyComment>, status: number) {
  assert.ok("error" in out, "expected a refusal");
  assert.equal(out.status, status);
  return out.error;
}

test("a comment is kept with its author and time, oldest first", () => {
  let d = emptyComments(COIN);
  assert.equal(d.token, COIN.toLowerCase());
  d = ok(applyComment(d, A.toUpperCase().replace("0X", "0x"), { type: "post", text: "  still early  " }, T0, yes));
  d = ok(applyComment(d, B, { type: "post", text: "sold half" }, T0 + 1_000, yes));
  assert.deepEqual(
    d.items.map((c) => [c.wallet, c.text, c.time]),
    [
      [A, "still early", T0],
      [B, "sold half", T0 + 1_000],
    ],
  );
  assert.notEqual(d.items[0]!.id, d.items[1]!.id);
});

test("only a wallet with a Dojang can comment", () => {
  assert.equal(refused(applyComment(emptyComments(COIN), A, { type: "post", text: "gm" }, T0, no), 403), NEED_DOJANG);
});

test("text is tidied before it is checked and kept", () => {
  assert.equal(cleanText("  a \t b\r\n\r\n\r\n\r\nc \u{200b}\u{202e} "), "a b\n\nc");
  assert.equal(checkText(""), "Write something first.");
  assert.equal(checkText("x".repeat(MAX_LENGTH)), null);
  assert.match(checkText("x".repeat(MAX_LENGTH + 1))!, /280 characters at most/);
  // An emoji is one character, however many code units it takes.
  assert.equal(checkText("🙂".repeat(MAX_LENGTH)), null);
  refused(applyComment(emptyComments(COIN), A, { type: "post", text: " \n\t " }, T0, yes), 400);
});

test("links are refused, ordinary sentences with dots are not", () => {
  for (const text of ["claim at https://evil.example/x", "www.airdrop-chimi.com", "join t.me/chimipump", "go to chimi-claim.xyz now"]) {
    assert.equal(checkText(text), "Links aren't allowed in comments.", text);
  }
  for (const text of ["bought 0.5 ETH. holding.", "price is 0.0001 e.g. cheap", "v3 pool, 1% fee... nice"]) {
    assert.equal(checkText(text), null, text);
  }
});

test("one wallet waits between comments, and can't repeat itself", () => {
  let d = ok(applyComment(emptyComments(COIN), A, { type: "post", text: "first" }, T0, yes));
  refused(applyComment(d, A, { type: "post", text: "second" }, T0 + MIN_GAP_MS - 1, yes), 429);
  // Someone else isn't held up by A.
  d = ok(applyComment(d, B, { type: "post", text: "second" }, T0 + 1, yes));
  refused(applyComment(d, A, { type: "post", text: "first" }, T0 + MIN_GAP_MS, yes), 409);
  d = ok(applyComment(d, A, { type: "post", text: "second" }, T0 + MIN_GAP_MS, yes));
  assert.equal(d.items.length, 3);
});

test("a wallet deletes its own comments and nobody else's", () => {
  let d = ok(applyComment(emptyComments(COIN), A, { type: "post", text: "mine" }, T0, yes));
  d = ok(applyComment(d, B, { type: "post", text: "theirs" }, T0 + 1, yes));
  const [mine, theirs] = d.items;
  refused(applyComment(d, A, { type: "delete", id: theirs!.id }, T0 + 2, yes), 403);
  refused(applyComment(d, A, { type: "delete", id: "nope" }, T0 + 2, yes), 404);
  // Deleting needs no Dojang: it only ever removes your own words.
  d = ok(applyComment(d, A, { type: "delete", id: mine!.id }, T0 + 2, no));
  assert.deepEqual(
    d.items.map((c) => c.text),
    ["theirs"],
  );
  // The operator can take out anyone's.
  assert.deepEqual(removeComment(d, theirs!.id)!.items, []);
  assert.equal(removeComment(d, "nope"), null);
});

test("only the latest comments are kept, and the old document is never changed", () => {
  let d = emptyComments(COIN);
  const wallet = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
  for (let n = 0; n < MAX_KEPT + 5; n++) d = ok(applyComment(d, wallet(n + 1), { type: "post", text: `comment ${n}` }, T0 + n, yes));
  assert.equal(d.items.length, MAX_KEPT);
  assert.equal(d.items[0]!.text, "comment 5");
  const before = structuredClone(d);
  ok(applyComment(d, A, { type: "post", text: "one more" }, T0 + 60_000, yes));
  assert.deepEqual(d, before);
});

test("the signed message carries the coin, the cleaned text, the wallet and the time", () => {
  assert.equal(
    commentMessage({ type: "post", text: "  gm  " }, COIN, A, T0),
    `Chimi comments: say on ${COIN.toLowerCase()}:\ngm\n\nWallet: ${A}\nTime: 2026-11-10T12:00:00.000Z`,
  );
  assert.match(commentMessage({ type: "delete", id: "abc-123" }, COIN, A, T0), /^Chimi comments: delete my comment abc-123 on 0xc0ffee/);
  // The same words on another coin sign differently, so a signature can't be carried over.
  assert.notEqual(commentMessage({ type: "post", text: "gm" }, COIN, A, T0), commentMessage({ type: "post", text: "gm" }, B, A, T0));
});

test("a commenter's position is said in a few words", () => {
  assert.equal(stance(0.0124, true), "holds 1.2%");
  assert.equal(stance(0.25, true), "holds 25%");
  assert.equal(stance(0.0005, false), "holds 0.05%");
  assert.equal(stance(0.00001, true), "holds <0.01%");
  assert.equal(stance(0, true), "sold");
  assert.equal(stance(0, false), null);
});
