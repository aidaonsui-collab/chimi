// npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_FOLLOWING,
  NEED_DOJANG,
  applyFollow,
  emptyFollows,
  followMessage,
  followerCounts,
  followersOf,
  followingOf,
  isFollowing,
  type FollowsState,
} from "../src/lib/chimi/follow-rules.ts";

const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000b2";
const C = "0x00000000000000000000000000000000000000c3";
const yes = { verified: true };
const no = { verified: false };

function ok(out: ReturnType<typeof applyFollow>): FollowsState {
  assert.ok("state" in out, "error" in out ? out.error : "");
  return out.state;
}

function refused(out: ReturnType<typeof applyFollow>, status: number) {
  assert.ok("error" in out, "expected a refusal");
  assert.equal(out.status, status);
  return out.error;
}

test("following adds the newest wallet first and shows up as a follower", () => {
  let s = emptyFollows();
  s = ok(applyFollow(s, A, { type: "follow", wallet: B }, yes));
  s = ok(applyFollow(s, A, { type: "follow", wallet: C }, yes));
  s = ok(applyFollow(s, B, { type: "follow", wallet: C }, yes));
  assert.deepEqual(followingOf(s, A), [C, B]);
  assert.deepEqual(followersOf(s, C).sort(), [A, B]);
  assert.deepEqual(followersOf(s, A), []);
  assert.ok(isFollowing(s, A, B));
  assert.ok(!isFollowing(s, B, A));
  assert.deepEqual([...followerCounts(s)].sort(), [
    [B, 1],
    [C, 2],
  ]);
});

test("addresses are matched whatever their capitals", () => {
  const upper = (w: string) => `0x${w.slice(2).toUpperCase()}`;
  const s = ok(applyFollow(emptyFollows(), upper(A), { type: "follow", wallet: upper(B) }, yes));
  assert.deepEqual(s.following, { [A]: [B] });
  assert.ok(isFollowing(s, upper(A), upper(B)));
  assert.deepEqual(followersOf(s, upper(B)), [A]);
});

test("only a wallet with a Dojang can follow, but anyone can stop", () => {
  assert.equal(refused(applyFollow(emptyFollows(), A, { type: "follow", wallet: B }, no), 403), NEED_DOJANG);
  const s = ok(applyFollow(emptyFollows(), A, { type: "follow", wallet: B }, yes));
  // The Dojang has since gone: unfollowing still works.
  assert.deepEqual(ok(applyFollow(s, A, { type: "unfollow", wallet: B }, no)).following, {});
});

test("a wallet can't follow itself, and following twice changes nothing", () => {
  refused(applyFollow(emptyFollows(), A, { type: "follow", wallet: A }, yes), 400);
  const once = ok(applyFollow(emptyFollows(), A, { type: "follow", wallet: B }, yes));
  // Already following: fine even without a Dojang now, because nothing changes.
  assert.deepEqual(ok(applyFollow(once, A, { type: "follow", wallet: B }, no)), once);
});

test("unfollowing someone you don't follow is not an error, and an empty list is dropped", () => {
  const s = ok(applyFollow(emptyFollows(), A, { type: "follow", wallet: B }, yes));
  assert.deepEqual(ok(applyFollow(s, A, { type: "unfollow", wallet: C }, yes)), s);
  assert.deepEqual(ok(applyFollow(s, C, { type: "unfollow", wallet: B }, yes)).following, { [A]: [B] });
  assert.deepEqual(ok(applyFollow(s, A, { type: "unfollow", wallet: B }, yes)).following, {});
});

test("there is a limit to how many wallets one can follow", () => {
  let s = emptyFollows();
  const wallet = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
  for (let n = 1; n <= MAX_FOLLOWING; n++) s = ok(applyFollow(s, A, { type: "follow", wallet: wallet(n) }, yes));
  assert.equal(followingOf(s, A).length, MAX_FOLLOWING);
  refused(applyFollow(s, A, { type: "follow", wallet: wallet(MAX_FOLLOWING + 1) }, yes), 409);
  // Room again after dropping one.
  s = ok(applyFollow(s, A, { type: "unfollow", wallet: wallet(1) }, yes));
  ok(applyFollow(s, A, { type: "follow", wallet: wallet(MAX_FOLLOWING + 1) }, yes));
});

test("anything that isn't an address is refused, and the old state is never changed", () => {
  const s = ok(applyFollow(emptyFollows(), A, { type: "follow", wallet: B }, yes));
  const before = structuredClone(s);
  refused(applyFollow(s, A, { type: "follow", wallet: "minjun.up.id" }, yes), 400);
  refused(applyFollow(s, "0x123", { type: "follow", wallet: B }, yes), 400);
  ok(applyFollow(s, A, { type: "follow", wallet: C }, yes));
  ok(applyFollow(s, A, { type: "unfollow", wallet: B }, yes));
  assert.deepEqual(s, before);
});

test("the signed message names the action, both wallets and the time", () => {
  const time = Date.UTC(2026, 10, 10, 12, 0, 0);
  assert.equal(
    followMessage({ type: "follow", wallet: `0x${B.slice(2).toUpperCase()}` }, A, time),
    `Chimi follows: follow ${B}\n\nWallet: ${A}\nTime: 2026-11-10T12:00:00.000Z`,
  );
  assert.match(followMessage({ type: "unfollow", wallet: B }, A, time), /^Chimi follows: stop following 0x0+b2\n/);
  // Following and unfollowing the same wallet at the same moment sign different text.
  assert.notEqual(followMessage({ type: "follow", wallet: B }, A, time), followMessage({ type: "unfollow", wallet: B }, A, time));
});
