import assert from "node:assert/strict";
import { test } from "node:test";
import { GIWA_SEPOLIA, LOCAL, NETWORKS, networkOf } from "../src/lib/chimi/network-rules.ts";
import deployment from "../public/deployments.json" with { type: "json" };

test("a deployment's chain id picks its network", () => {
  assert.equal(networkOf(91342), GIWA_SEPOLIA);
  assert.equal(networkOf(31337), LOCAL);
  assert.equal(networkOf(deployment.chainId).id, deployment.chainId);
});

test("a chain the app doesn't describe stops the build instead of guessing", () => {
  assert.throws(() => networkOf(12345), /chain 12345.*network\.ts/);
});

test("every network says enough to add it to a wallet and read through Multicall3", () => {
  const ids = new Set<number>();
  for (const n of NETWORKS) {
    assert.ok(!ids.has(n.id), `${n.name}: one entry per chain`);
    ids.add(n.id);
    assert.match(n.rpc, /^https?:\/\//, n.name);
    assert.match(n.multicall3, /^0x[0-9a-fA-F]{40}$/, n.name);
    assert.ok(n.name.length > 0);
    if (n.dojang) {
      assert.match(n.dojang.scroll, /^0x[0-9a-fA-F]{40}$/);
      assert.ok(n.dojang.attesters.length > 0, `${n.name}: Dojang without attesters verifies nobody`);
      for (const a of n.dojang.attesters) assert.match(a.id, /^0x[0-9a-f]{64}$/);
    }
  }
});

test("only a real GIWA chain is public: the test networks say they are tests", () => {
  for (const n of NETWORKS) if (n.id === 91342 || n.id === 31337) assert.equal(n.testnet, true, n.name);
});
