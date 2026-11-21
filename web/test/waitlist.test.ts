// npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { recoverMessageAddress } from "viem";
import { csvRow, ordinal, PERKS, shareText, waitlistMessage } from "../src/lib/chimi/waitlist-rules.ts";

test("the join message names the wallet (lowercase) and the time", () => {
  const msg = waitlistMessage("0xABCDEF0123456789abcdef0123456789ABCDEF01", Date.UTC(2026, 10, 20, 12, 0, 0));
  assert.equal(msg, "Chimi mainnet waitlist: add my wallet\n\nWallet: 0xabcdef0123456789abcdef0123456789abcdef01\nTime: 2026-11-20T12:00:00.000Z");
});

test("a signature over the join message recovers to the wallet, and only for that wallet and time", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const time = Date.now();
  const signature = await account.signMessage({ message: waitlistMessage(account.address, time) });
  const signer = await recoverMessageAddress({ message: waitlistMessage(account.address, time), signature });
  assert.equal(signer.toLowerCase(), account.address.toLowerCase());
  const other = await recoverMessageAddress({ message: waitlistMessage(account.address, time + 1), signature });
  assert.notEqual(other.toLowerCase(), account.address.toLowerCase());
});

test("places read as ordinals", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 112, 1000].map(ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th", "112th", "1000th"]);
});

test("the share text carries the place and stays within a post", () => {
  const text = shareText(1234);
  assert.match(text, /1234th through the gate/);
  assert.ok(text.length < 250);
});

test("the read-out row is wallet, place, ISO time", () => {
  assert.equal(csvRow("0xAbC0000000000000000000000000000000000001", 7, Date.UTC(2026, 10, 21)), "0xabc0000000000000000000000000000000000001,7,2026-11-21T00:00:00.000Z");
});

test("perks are listed", () => {
  assert.ok(PERKS.length > 0);
  for (const p of PERKS) assert.ok(p.title && p.body);
});
