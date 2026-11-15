// npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_INBOX, addToInbox, emptyInbox, inboxFor, rowsOf, snippet, unreadCount, type InboxItem } from "../src/lib/chimi/inbox-rules.ts";

const ME = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000b2";
const C = "0x00000000000000000000000000000000000000c3";
const COIN = "0xC0ffee0000000000000000000000000000000001";
const coin = COIN.toLowerCase();
const T0 = Date.UTC(2026, 10, 15, 12, 0, 0);

const follow = (from: string, time = T0): InboxItem => ({ kind: "follow", key: `follow:${from}`, time, from });

test("an inbox keeps what others did, oldest first, and never what you did yourself", () => {
  let box = emptyInbox(ME.toUpperCase().replace("0X", "0x"));
  assert.equal(box.wallet, ME);
  box = addToInbox(box, [follow(B, T0 + 2_000), follow(C, T0 + 1_000)])!;
  assert.deepEqual(
    box.items.map((i) => i.from),
    [C, B],
  );
  assert.equal(addToInbox(box, [follow(ME)]), null, "nothing you do lands in your own inbox");
  assert.equal(addToInbox(box, [follow(B, T0 + 9_000)]), null, "following again after unfollowing is not news twice");
  assert.equal(addToInbox(box, []), null);
});

test("an inbox holds only its latest items, and the old one is never changed", () => {
  let box = emptyInbox(ME);
  const many = Array.from({ length: MAX_INBOX + 7 }, (_, n) => follow(`0x${(n + 1000).toString(16).padStart(40, "0")}`, T0 + n));
  box = addToInbox(box, many)!;
  assert.equal(box.items.length, MAX_INBOX);
  assert.equal(box.items[0]!.time, T0 + 7);
  const before = structuredClone(box);
  addToInbox(box, [follow(B, T0 + 999_999)]);
  assert.deepEqual(box, before);
});

test("what is unread is whatever came after the last look", () => {
  const items = [follow(B, T0), follow(C, T0 + 5_000)];
  assert.equal(unreadCount(items, 0), 2);
  assert.equal(unreadCount(items, T0), 1);
  assert.equal(unreadCount(items, T0 + 5_000), 0);
});

test("likes of one comment read as one line, newest first with everything else", () => {
  const like = (from: string, time: number): InboxItem => ({ kind: "like", key: `like:${coin}:c1:${from}`, time, from, token: coin, comment: "c1", text: "gm" });
  const rows = rowsOf([
    like(B, T0 + 1_000),
    { kind: "reply", key: `reply:${coin}:c2`, time: T0 + 2_000, from: C, token: coin, comment: "c2", text: "hello" },
    like(C, T0 + 3_000),
    { kind: "led", key: `led:${coin}:${B}:1`, time: T0 + 500, from: B, token: coin, eth: 0.05 },
  ]);
  assert.deepEqual(
    rows.map((r) => [r.kind, r.from, r.time]),
    [
      ["like", [C, B], T0 + 3_000],
      ["reply", [C], T0 + 2_000],
      ["led", [B], T0 + 500],
    ],
  );
  assert.equal(rows[0]!.text, "gm");
  assert.equal(rows[2]!.eth, 0.05);
});

test("a comment action tells the right wallets", () => {
  const mine = { id: "c1", wallet: ME, text: "is the pool locked?" };
  const answer = { id: "c2", wallet: B, text: "yes, for 100 years" };
  // An answer to my comment: I hear of it.
  assert.deepEqual(inboxFor({ type: "reply", comment: answer, parent: mine, root: mine }, COIN, C, T0), [
    { wallet: ME, item: { kind: "reply", key: `reply:${coin}:c2`, time: T0, from: B, token: coin, comment: "c2", text: "yes, for 100 years" } },
  ]);
  // An answer to an answer in my thread: the wallet answered hears of it, and so do I, who started the thread.
  const deeper = inboxFor({ type: "reply", comment: { id: "c3", wallet: C, text: "thanks" }, parent: answer, root: mine }, COIN, C, T0);
  assert.deepEqual(
    deeper.map((n) => [n.wallet, n.item.kind === "reply" && n.item.thread]),
    [
      [B, undefined],
      [ME, true],
    ],
  );
  assert.equal(rowsOf(deeper.map((n) => n.item))[0]!.kind, "reply");
  assert.equal(rowsOf([deeper[1]!.item])[0]!.thread, true);
  // A like tells the comment's author; a new thread tells the coin's creator.
  assert.deepEqual(
    inboxFor({ type: "like", comment: mine, by: B }, COIN, C, T0).map((n) => [n.wallet, n.item.kind, n.item.key]),
    [[ME, "like", `like:${coin}:c1:${B}`]],
  );
  assert.deepEqual(
    inboxFor({ type: "comment", comment: answer }, COIN, ME.toUpperCase().replace("0X", "0x"), T0).map((n) => [n.wallet, n.item.kind]),
    [[ME, "comment"]],
  );
  assert.deepEqual(inboxFor({ type: "comment", comment: answer }, COIN, undefined, T0), []);
});

test("a quoted comment is one line and not too long", () => {
  assert.equal(snippet("  two\n\nlines  here "), "two lines here");
  const long = snippet("word ".repeat(80), 20);
  assert.equal([...long].length <= 20, true);
  assert.ok(long.endsWith("…"));
  assert.equal(snippet("🙂".repeat(30), 10), "🙂".repeat(9) + "…");
});
