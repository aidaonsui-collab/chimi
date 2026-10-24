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
  membersOf,
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
