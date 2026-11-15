// npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_KEPT,
  MAX_LENGTH,
  MAX_LIKES,
  MIN_GAP_MS,
  NEED_DOJANG,
  NEED_DOJANG_TO_LIKE,
  PASS_TTL_MS,
  applyComment,
  checkPass,
  checkText,
  cleanText,
  commentMessage,
  emptyComments,
  likePassMessage,
  likesOf,
  pageOf,
  removeComment,
  stance,
  threadsOf,
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

const C = "0x00000000000000000000000000000000000000c3";

/** A, then B answering A, then C answering B: one thread, three comments. */
function thread() {
  let d = ok(applyComment(emptyComments(COIN), A, { type: "post", text: "is the pool locked?" }, T0, yes));
  const root = d.items[0]!;
  const first = applyComment(d, B, { type: "post", text: "yes, 100 years", replyTo: root.id }, T0 + 1_000, yes);
  d = ok(first);
  const reply = d.items[1]!;
  const second = applyComment(d, C, { type: "post", text: "good to know", replyTo: reply.id }, T0 + 2_000, yes);
  d = ok(second);
  return { d, root, reply, nested: d.items[2]!, first, second };
}

test("an answer joins its thread, and an answer to an answer stays in the same thread", () => {
  const { d, root, reply, nested, first, second } = thread();
  assert.equal(reply.replyTo, root.id);
  assert.equal(reply.to, undefined, "answering the top comment needs no name");
  assert.equal(nested.replyTo, root.id, "one level deep: it hangs off the top comment");
  assert.equal(nested.to, B, "and remembers whose answer it answers");
  // What happened, for whoever should hear of it.
  assert.ok("effect" in first && first.effect?.type === "reply" && first.effect.parent.id === root.id && first.effect.root.id === root.id);
  assert.ok("effect" in second && second.effect?.type === "reply" && second.effect.parent.id === reply.id && second.effect.root.id === root.id);
  const top = applyComment(d, B, { type: "post", text: "new thread" }, T0 + 60_000, yes);
  assert.ok("effect" in top && top.effect?.type === "comment");
  refused(applyComment(d, B, { type: "post", text: "to nobody", replyTo: "gone" }, T0 + 60_000, yes), 404);
  refused(applyComment(d, B, { type: "post", text: "no dojang", replyTo: root.id }, T0 + 60_000, no), 403);
});

test("comments read as threads, newest thread first, answers oldest first", () => {
  let { d, root, reply, nested } = thread();
  d = ok(applyComment(d, B, { type: "post", text: "second thread" }, T0 + 60_000, yes));
  const later = d.items[3]!;
  const threads = threadsOf(d.items);
  assert.deepEqual(
    threads.map((t) => [t.root.id, t.replies.map((r) => r.id)]),
    [
      [later.id, []],
      [root.id, [reply.id, nested.id]],
    ],
  );
  // A page is whole threads: the newest one alone, or both with every answer.
  assert.deepEqual(pageOf(d, 1), { items: [later], threads: 2 });
  assert.deepEqual(
    pageOf(d, 5).items.map((c) => c.id),
    [later.id, nested.id, reply.id, root.id],
  );
  assert.deepEqual(pageOf(null, 5), { items: [], threads: 0 });
});

test("when a comment is deleted its answers stay, as a thread of their own", () => {
  const { d, root, reply, nested } = thread();
  const after = ok(applyComment(d, A, { type: "delete", id: root.id }, T0 + 5_000, no));
  assert.deepEqual(
    after.items.map((c) => c.id),
    [reply.id, nested.id],
  );
  const threads = threadsOf(after.items);
  assert.deepEqual(
    threads.map((t) => t.root.id),
    [nested.id, reply.id],
    "nothing that was said disappears with someone else's comment",
  );
});

test("a wallet with a Dojang likes a comment once, and can take it back", () => {
  const { d, root } = thread();
  refused(applyComment(d, A, { type: "like", id: root.id }, T0 + 9_000, yes), 400);
  assert.equal(refused(applyComment(d, B, { type: "like", id: root.id }, T0 + 9_000, no), 403), NEED_DOJANG_TO_LIKE);
  refused(applyComment(d, B, { type: "like", id: "gone" }, T0 + 9_000, yes), 404);
  const liked = applyComment(d, B, { type: "like", id: root.id }, T0 + 9_000, yes);
  let next = ok(liked);
  assert.ok("effect" in liked && liked.effect?.type === "like" && liked.effect.by === B && liked.effect.comment.wallet === A);
  // Liking again changes nothing and tells nobody twice.
  const again = applyComment(next, B, { type: "like", id: root.id }, T0 + 9_500, yes);
  assert.deepEqual(ok(again).likes, next.likes);
  assert.ok("doc" in again && again.effect === undefined);
  next = ok(applyComment(next, C, { type: "like", id: root.id }, T0 + 10_000, yes));
  assert.deepEqual(likesOf(next, [root.id, "other"], C), { likes: { [root.id]: 2 }, liked: [root.id] });
  assert.deepEqual(likesOf(next, [root.id], A.toUpperCase().replace("0X", "0x")), { likes: { [root.id]: 2 }, liked: [] });
  // Taking a like back needs no Dojang, and taking back one never given is not an error.
  next = ok(applyComment(next, B, { type: "unlike", id: root.id }, T0 + 11_000, no));
  next = ok(applyComment(next, B, { type: "unlike", id: root.id }, T0 + 11_500, no));
  assert.deepEqual(next.likes, { [root.id]: [C] });
  next = ok(applyComment(next, C, { type: "unlike", id: root.id }, T0 + 12_000, no));
  assert.deepEqual(next.likes, {});
});

test("likes go when their comment goes, and a comment holds only so many", () => {
  const { d, root, reply } = thread();
  let next = ok(applyComment(d, B, { type: "like", id: root.id }, T0 + 9_000, yes));
  next = ok(applyComment(next, A, { type: "like", id: reply.id }, T0 + 9_000, yes));
  const after = ok(applyComment(next, A, { type: "delete", id: root.id }, T0 + 10_000, no));
  assert.deepEqual(Object.keys(after.likes ?? {}), [reply.id]);
  assert.deepEqual(Object.keys(removeComment(next, reply.id)!.likes ?? {}), [root.id]);
  const full = structuredClone(d);
  full.likes = { [root.id]: Array.from({ length: MAX_LIKES }, (_, n) => `0x${(n + 0x1000).toString(16).padStart(40, "0")}`) };
  refused(applyComment(full, B, { type: "like", id: root.id }, T0 + 9_000, yes), 409);
});

test("an answer is signed for with the comment it answers, and a like pass names what it allows", () => {
  const { root } = thread();
  assert.equal(
    commentMessage({ type: "post", text: " yes ", replyTo: root.id }, COIN, B, T0),
    `Chimi comments: reply to ${root.id} on ${COIN.toLowerCase()}:\nyes\n\nWallet: ${B}\nTime: 2026-11-10T12:00:00.000Z`,
  );
  // The same words signed as a top-level comment can't be passed off as an answer, or the other way round.
  assert.notEqual(commentMessage({ type: "post", text: "yes", replyTo: root.id }, COIN, B, T0), commentMessage({ type: "post", text: "yes" }, COIN, B, T0));
  const until = T0 + PASS_TTL_MS;
  const pass = likePassMessage(A.toUpperCase().replace("0X", "0x"), until);
  assert.match(pass, /^Chimi likes: let this browser like and unlike comments as me until 2026-11-17T12:00:00.000Z/);
  assert.match(pass, /can't post, follow, trade or move anything/);
  assert.ok(pass.endsWith(`Wallet: ${A}`));
  assert.equal(checkPass(until, T0), null);
  assert.match(checkPass(until, until)!, /run out/);
  assert.match(checkPass(T0 + PASS_TTL_MS * 3, T0)!, /too long/);
  assert.match(checkPass(Number.NaN, T0)!, /run out/);
});
