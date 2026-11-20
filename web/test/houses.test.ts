// npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { recoverMessageAddress } from "viem";
import {
  applyAction,
  checkMotto,
  checkName,
  currentStint,
  emptyHouses,
  houseMessage,
  LOCK_DAYS,
  MAX_MEMBERS,
  REQUEST_DAYS,
  checkImage,
  lockedUntil,
  membersOf,
  requestOf,
  requestsFor,
  scoreHouses,
  suggestTag,
  type HouseAction,
  type HousesState,
} from "../src/lib/chimi/house-rules.ts";
import { emptyBook, summarize } from "../src/lib/chimi/points-rules.ts";

const DAY = 86_400_000;
const T0 = Date.parse("2026-11-10T12:00:00Z");
const W = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const found = (tag: string, name = `House ${tag}`): HouseAction => ({ type: "found", tag, name, seal: "龍", ink: "seal", motto: "" });

function run(state: HousesState, wallet: string, action: HouseAction, now = T0, verified = true) {
  const out = applyAction(state, wallet, action, now, { verified });
  if ("error" in out) throw new Error(out.error);
  return out.state;
}
const refused = (state: HousesState, wallet: string, action: HouseAction, now = T0, verified = true) => {
  const out = applyAction(state, wallet, action, now, { verified });
  assert.ok("error" in out, `expected ${action.type} to be refused`);
  return out.error;
};

test("found, join and the house's roster", () => {
  let s = run(emptyHouses(), W(1), found("RIDGE", "Ridge Line"));
  s = run(s, W(2), { type: "join", tag: "RIDGE" });
  assert.equal(s.houses.RIDGE!.head, W(1));
  assert.deepEqual(membersOf(s, "RIDGE").map((m) => m.wallet), [W(1), W(2)]);
  assert.match(refused(s, W(3), found("RIDGE")), /taken/);
  assert.match(refused(s, W(3), found("RL", "ridge line")), /already exists/);
});

test("only Dojang wallets found or join", () => {
  let s = run(emptyHouses(), W(1), found("DOJ"));
  assert.match(refused(s, W(2), found("NEW"), T0, false), /Dojang/);
  assert.match(refused(s, W(2), { type: "join", tag: "DOJ" }, T0, false), /Dojang/);
  // Leaving never needs one: a wallet that lost its Dojang can still walk out.
  s = run(s, W(1), { type: "leave" }, T0 + 1, false);
  assert.equal(currentStint(s, W(1)), undefined);
});

test("the lock: leave any time, join elsewhere only after it", () => {
  let s = run(emptyHouses(), W(1), found("AAA"));
  s = run(s, W(2), found("BBB"));
  s = run(s, W(3), { type: "join", tag: "AAA" });
  assert.match(refused(s, W(3), { type: "join", tag: "BBB" }, T0 + DAY), /switch houses from/);
  s = run(s, W(3), { type: "leave" }, T0 + DAY);
  refused(s, W(3), { type: "join", tag: "BBB" }, T0 + 2 * DAY);
  // Going back to the house it left is fine during the lock.
  assert.equal(currentStint(run(s, W(3), { type: "join", tag: "AAA" }, T0 + 2 * DAY), W(3))!.tag, "AAA");
  s = run(s, W(3), { type: "join", tag: "BBB" }, T0 + LOCK_DAYS * DAY + 1);
  assert.equal(currentStint(s, W(3))!.tag, "BBB");
  s = run(s, W(3), { type: "join", tag: "AAA" }, T0 + 2 * LOCK_DAYS * DAY + 2);
  assert.equal(s.stints.filter((x) => x.wallet === W(3) && x.to === null).length, 1);
});

test("headship passes on, and an empty house closes", () => {
  let s = run(emptyHouses(), W(1), found("CAP"));
  s = run(s, W(2), { type: "join", tag: "CAP" }, T0 + 1);
  s = run(s, W(3), { type: "join", tag: "CAP" }, T0 + 2);
  s = run(s, W(1), { type: "leave" }, T0 + 3);
  assert.equal(s.houses.CAP!.head, W(2), "the longest-standing member takes over");
  s = run(s, W(2), { type: "leave" }, T0 + 4);
  s = run(s, W(3), { type: "leave" }, T0 + 5);
  assert.ok(s.houses.CAP!.closedAt);
  assert.match(refused(s, W(4), { type: "join", tag: "CAP" }), /doesn't exist/);
});

test("only the head removes members, and removal lifts the lock", () => {
  let s = run(emptyHouses(), W(1), found("RMV"));
  s = run(s, W(2), { type: "join", tag: "RMV" });
  s = run(s, W(9), found("ELSE"));
  assert.match(refused(s, W(2), { type: "remove", wallet: W(1) }), /Only the head/);
  s = run(s, W(1), { type: "remove", wallet: W(2) }, T0 + 1);
  assert.equal(currentStint(s, W(2)), undefined);
  s = run(s, W(2), { type: "join", tag: "ELSE" }, T0 + 2);
  assert.equal(currentStint(s, W(2))!.tag, "ELSE");
});

test("houses fill up", () => {
  let s = run(emptyHouses(), W(1), found("FULL"));
  for (let i = 2; i <= MAX_MEMBERS; i++) s = run(s, W(i), { type: "join", tag: "FULL" });
  assert.equal(membersOf(s, "FULL").length, MAX_MEMBERS);
  assert.match(refused(s, W(999), { type: "join", tag: "FULL" }), /is full/);
});

test("only the head changes the seal and motto", () => {
  let s = run(emptyHouses(), W(1), found("SEAL"));
  s = run(s, W(2), { type: "join", tag: "SEAL" });
  assert.match(refused(s, W(2), { type: "seal", seal: "虎", ink: "jade" }), /Only the head/);
  s = run(s, W(1), { type: "seal", seal: "虎", ink: "jade" });
  assert.deepEqual([s.houses.SEAL!.seal, s.houses.SEAL!.ink], ["虎", "jade"]);
  assert.match(refused(s, W(1), { type: "seal", seal: "X" as "虎", ink: "jade" }), /Pick a seal/);
  s = run(s, W(1), { type: "motto", motto: "  Tiles before towers.  " });
  assert.equal(s.houses.SEAL!.motto, "Tiles before towers.");
});

test("names, mottos and tags", () => {
  assert.equal(checkName("Ridge Line"), null);
  assert.equal(checkName("기와집"), null, "Korean names are fine");
  assert.ok(checkName("a"));
  assert.ok(checkName("visit scam.com now"));
  assert.ok(checkMotto("follow @someone"));
  assert.equal(checkMotto("Tiles before towers."), null);
  assert.equal(suggestTag("Ridge Line"), "RL");
  assert.equal(suggestTag("Moonshot"), "MOONS");
});

test("a day's points go to the house the wallet is in when the KST day ends", () => {
  // 2026-11-10 KST ends at 15:00 UTC on 11-10.
  const end = Date.parse("2026-11-10T15:00:00Z");
  let s = run(emptyHouses(), W(1), found("EAST"), end - DAY);
  s = run(s, W(2), found("WEST"), end - DAY);
  s = run(s, W(3), { type: "join", tag: "EAST" }, end - DAY);
  // W(3) leaves an hour after the day ends: the day still counts for EAST.
  s = run(s, W(3), { type: "leave" }, end + 3_600_000);
  s = run(s, W(4), { type: "join", tag: "WEST" }, end - 60_000); // joined a minute before the day ended
  const book = emptyBook({ chainId: 1, factory: W(0), dailyPool: 100, creatorShare: 0.1, seasonStart: "2026-11-01" }, 0, 0);
  book.days.push({ day: "2026-11-10", points: { [W(1)]: 10, [W(3)]: 30, [W(4)]: 60 }, volume: 1, unverified: [] });
  const [first, second] = scoreHouses(s, summarize(book));
  assert.deepEqual([first!.house.tag, first!.season], ["WEST", 60]);
  assert.deepEqual([second!.house.tag, second!.season], ["EAST", 40]);
});

test("the signed message names the action, wallet and time", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const action: HouseAction = { type: "found", tag: "SIG", name: "Signed House", seal: "鳳", ink: "gold", motto: "Hi" };
  const message = houseMessage(action, account.address, T0);
  assert.match(message, /^Chimi houses: found \[SIG\] Signed House\nSeal: 鳳 in gold/);
  assert.match(message, new RegExp(account.address.toLowerCase()));
  const signature = await account.signMessage({ message });
  assert.equal(await recoverMessageAddress({ message: houseMessage(action, account.address.toLowerCase(), T0), signature }), account.address);
});

// ─── requests, the join choice and seal pictures ─────────────────────────────────────────────────────────────

const PIC = "https://3l7nlcmj1elkwe2g.public.blob.vercel-storage.com/chimi/house-ridge-AbC123.jpg";
const approving = (tag: string): HouseAction => ({ type: "found", tag, name: `House ${tag}`, seal: "龍", ink: "seal", motto: "", approve: true });

test("a house holds a hundred", () => {
  assert.equal(MAX_MEMBERS, 100);
});

test("in a house that approves, joining is a request the head answers", () => {
  let s = run(emptyHouses(), W(1), approving("APP"));
  assert.equal(s.houses.APP!.approve, true);
  s = run(s, W(2), { type: "join", tag: "APP" }, T0 + 1);
  assert.equal(currentStint(s, W(2)), undefined, "not in yet");
  assert.deepEqual(requestsFor(s, "APP", T0 + 2).map((r) => r.wallet), [W(2)]);
  assert.match(refused(s, W(2), { type: "join", tag: "APP" }, T0 + 2), /already asked/);
  // Only the head answers.
  s = run(s, W(3), { type: "join", tag: "APP" }, T0 + 3);
  assert.match(refused(s, W(3), { type: "accept", wallet: W(2) }, T0 + 4), /head/);
  s = run(s, W(1), { type: "accept", wallet: W(2) }, T0 + 5);
  assert.equal(currentStint(s, W(2))!.tag, "APP");
  assert.ok(lockedUntil(s, W(2), T0 + 6) > 0, "the lock starts when they're let in");
  s = run(s, W(1), { type: "reject", wallet: W(3) }, T0 + 7);
  assert.equal(currentStint(s, W(3)), undefined);
  assert.equal(requestsFor(s, "APP", T0 + 8).length, 0);
  assert.match(refused(s, W(1), { type: "accept", wallet: W(3) }, T0 + 9), /no request/);
});

test("a request still needs a Dojang, a free lock and a seat", () => {
  let s = run(emptyHouses(), W(1), approving("APP"));
  s = run(s, W(2), found("OTH"));
  assert.match(refused(s, W(3), { type: "join", tag: "APP" }, T0, false), /Dojang/);
  s = run(s, W(3), { type: "join", tag: "OTH" }, T0 + 1);
  assert.match(refused(s, W(3), { type: "join", tag: "APP" }, T0 + DAY), /switch houses from/);
});

test("one request at a time: asking another house replaces it, joining or founding drops it", () => {
  let s = run(emptyHouses(), W(1), approving("AAA"));
  s = run(s, W(2), approving("BBB"));
  s = run(s, W(3), found("OPEN"));
  s = run(s, W(9), { type: "join", tag: "AAA" }, T0 + 1);
  s = run(s, W(9), { type: "join", tag: "BBB" }, T0 + 2);
  assert.equal(requestOf(s, W(9), T0 + 3)!.tag, "BBB");
  assert.equal(requestsFor(s, "AAA", T0 + 3).length, 0);
  s = run(s, W(9), { type: "join", tag: "OPEN" }, T0 + 4);
  assert.equal(requestOf(s, W(9), T0 + 5), undefined, "joining an open house drops the request");
  s = run(s, W(8), { type: "join", tag: "AAA" }, T0 + 6);
  s = run(s, W(8), found("MINE"), T0 + 7);
  assert.equal(requestOf(s, W(8), T0 + 8), undefined, "founding drops it too");
});

test("a request can be withdrawn, and lapses on its own", () => {
  let s = run(emptyHouses(), W(1), approving("APP"));
  s = run(s, W(2), { type: "join", tag: "APP" }, T0 + 1);
  s = run(s, W(2), { type: "withdraw" }, T0 + 2);
  assert.equal(requestOf(s, W(2), T0 + 3), undefined);
  assert.match(refused(s, W(2), { type: "withdraw" }, T0 + 3), /no request/);
  s = run(s, W(2), { type: "join", tag: "APP" }, T0 + 4);
  const later = T0 + 4 + REQUEST_DAYS * DAY;
  assert.equal(requestOf(s, W(2), later), undefined, "lapsed");
  assert.match(refused(s, W(1), { type: "accept", wallet: W(2) }, later), /no request/);
});

test("accepting moves a wallet out of its house, handing that house on", () => {
  let s = run(emptyHouses(), W(1), approving("APP"));
  s = run(s, W(2), found("OLD"));
  s = run(s, W(3), { type: "join", tag: "OLD" }, T0 + 1);
  // W(2) heads OLD and its lock has run out by the time it asks.
  const t = T0 + LOCK_DAYS * DAY + 1;
  s = run(s, W(2), { type: "join", tag: "APP" }, t);
  s = run(s, W(1), { type: "accept", wallet: W(2) }, t + 1);
  assert.equal(currentStint(s, W(2))!.tag, "APP");
  assert.equal(s.houses.OLD!.head, W(3));
});

test("the head switches between anyone and approving; an open house lets wallets straight in", () => {
  let s = run(emptyHouses(), W(1), found("SW"));
  assert.equal(s.houses.SW!.approve, false);
  s = run(s, W(1), { type: "approve", approve: true }, T0 + 1);
  s = run(s, W(2), { type: "join", tag: "SW" }, T0 + 2);
  assert.equal(currentStint(s, W(2)), undefined);
  s = run(s, W(1), { type: "approve", approve: false }, T0 + 3);
  s = run(s, W(3), { type: "join", tag: "SW" }, T0 + 4);
  assert.equal(currentStint(s, W(3))!.tag, "SW");
  assert.match(refused(s, W(3), { type: "approve", approve: true }, T0 + 5), /head/);
  // A house from before the choice has no `approve`: anyone can join.
  const old: HousesState = structuredClone(s);
  delete old.houses.SW!.approve;
  delete old.requests;
  assert.equal(currentStint(run(old, W(4), { type: "join", tag: "SW" }, T0 + 6), W(4))!.tag, "SW");
});

test("a seal can be a picture from Chimi's image store, and back to a stamp", () => {
  let s = run(emptyHouses(), W(1), { ...found("PIC"), image: PIC });
  assert.equal(s.houses.PIC!.image, PIC);
  s = run(s, W(1), { type: "seal", seal: "月", ink: "indigo", image: null }, T0 + 1);
  assert.equal(s.houses.PIC!.image, undefined);
  assert.equal(s.houses.PIC!.seal, "月");
  s = run(s, W(1), { type: "seal", seal: "月", ink: "indigo", image: PIC }, T0 + 2);
  assert.equal(s.houses.PIC!.image, PIC);
  for (const bad of ["https://evil.example/x.jpg", "http://3l7nlcmj1elkwe2g.public.blob.vercel-storage.com/chimi/a.jpg", "https://x.public.blob.vercel-storage.com/other/a.jpg", "javascript:alert(1)"]) {
    assert.match(refused(s, W(1), { type: "seal", seal: "月", ink: "indigo", image: bad }, T0 + 3), /Upload the picture/);
    assert.equal(checkImage(bad) !== null, true);
  }
});

test("the new actions sign what they do", async () => {
  const key = generatePrivateKey();
  const acct = privateKeyToAccount(key);
  const actions: HouseAction[] = [
    approving("SIGN"),
    { type: "withdraw" },
    { type: "accept", wallet: W(5) },
    { type: "reject", wallet: W(5) },
    { type: "approve", approve: true },
    { type: "seal", seal: "龍", ink: "seal", image: PIC },
  ];
  const texts = actions.map((a) => houseMessage(a, acct.address, T0));
  assert.match(texts[0]!, /New members: I approve each one/);
  assert.match(texts[0]!, /Picture: none/);
  assert.match(texts[2]!, new RegExp(`accept ${W(5)} into my house`));
  assert.match(texts[3]!, /turn down .* request to join my house/);
  assert.match(texts[4]!, /new members to: I approve each one/);
  assert.match(texts[5]!, new RegExp(`Picture: ${PIC.replace(/[.]/g, "\\.")}`));
  for (const message of texts) {
    const signature = await acct.signMessage({ message });
    assert.equal((await recoverMessageAddress({ message, signature })).toLowerCase(), acct.address.toLowerCase());
  }
});
