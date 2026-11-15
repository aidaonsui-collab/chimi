import assert from "node:assert/strict";
import { test } from "node:test";
import { blocksOf, nameSellers, routerKept, sellersFromRawTransfers, sellersFromTransfers, type Sale } from "../src/lib/chimi/sale-rules.ts";

// Shapes taken from GIWA Sepolia: Chimi's router, the GIWAMI pool, and a real transfer of GIWAMI into it.
const ROUTER = "0x84F486d7254aEDc89986bce392771D88bf5828EA";
const POOL = "0xC60A5D1E2a7ea88Dc22918c33de0bdb34380eaF5";
const SELLER = "0x856DC4a12f08AFA49f42B52F81769A96505f312C";
const TX = "0x4b704f5722000000000000000000000000000000000000000000000000000001";
const AMOUNT = 914159579999999999974986n;
const topic = (address: string) => `0x000000000000000000000000${address.slice(2).toLowerCase()}`;

const sale = (over: Partial<Sale> = {}): Sale => ({ tx: TX, block: 41203053n, buy: false, recipient: ROUTER, tokenAmount: AMOUNT, ...over });

test("a sale the router paid out has the router on both sides of the pool's log", () => {
  assert.equal(routerKept(sale(), ROUTER), true);
  assert.equal(routerKept(sale(), ROUTER.toLowerCase()), true, "addresses compare without case");
  assert.equal(routerKept(sale({ recipient: SELLER }), ROUTER), false, "a sale paid straight to the seller already names them");
  assert.equal(routerKept(sale({ buy: true }), ROUTER), false, "a buy's recipient is the buyer");
  assert.equal(routerKept(sale(), undefined), false);
});

test("the seller is the wallet whose coins went into the pool in that transaction", () => {
  const swap = sale();
  const sellers = sellersFromTransfers([{ transactionHash: TX, args: { from: SELLER, to: POOL, value: AMOUNT } }]);
  nameSellers([{ swap, pool: POOL.toLowerCase() }], sellers);
  assert.equal(swap.recipient, SELLER);
});

test("the explorer's raw logs name the seller the same way", () => {
  const swap = sale();
  const raw = { transactionHash: TX, data: `0x${AMOUNT.toString(16).padStart(64, "0")}`, topics: ["0xddf2", topic(SELLER), topic(POOL)] };
  nameSellers([{ swap, pool: POOL }], sellersFromRawTransfers([raw], POOL));
  assert.equal(swap.recipient.toLowerCase(), SELLER.toLowerCase());
});

test("a transfer from another transaction, pool or amount names nobody", () => {
  const other = "0x1111111111111111111111111111111111111111";
  for (const log of [
    { transactionHash: TX.replace(/1$/, "2"), args: { from: SELLER, to: POOL, value: AMOUNT } },
    { transactionHash: TX, args: { from: SELLER, to: other, value: AMOUNT } },
    { transactionHash: TX, args: { from: SELLER, to: POOL, value: AMOUNT + 1n } },
  ] as const) {
    const swap = sale();
    nameSellers([{ swap, pool: POOL }], sellersFromTransfers([log]));
    assert.equal(swap.recipient, ROUTER, "the router's address stays until a matching transfer is found");
  }
});

test("two sales in one block by different wallets each get their own seller", () => {
  const second = "0x2222222222222222222222222222222222222222";
  const a = sale();
  const b = sale({ tx: TX.replace(/1$/, "9"), tokenAmount: 5n });
  const sellers = sellersFromTransfers([
    { transactionHash: a.tx, args: { from: SELLER, to: POOL, value: a.tokenAmount } },
    { transactionHash: b.tx, args: { from: second, to: POOL, value: b.tokenAmount } },
  ]);
  nameSellers(
    [
      { swap: a, pool: POOL },
      { swap: b, pool: POOL },
    ],
    sellers,
  );
  assert.equal(a.recipient, SELLER);
  assert.equal(b.recipient, second);
});

test("only the blocks the sales cover are read", () => {
  const span = blocksOf([
    { swap: sale({ block: 30n }), pool: POOL },
    { swap: sale({ block: 10n }), pool: POOL },
    { swap: sale({ block: 20n }), pool: POOL },
  ]);
  assert.deepEqual(span, { from: 10n, to: 30n });
});

test("an explorer log with no amount or no sender is read safely", () => {
  const sellers = sellersFromRawTransfers(
    [
      { transactionHash: TX, data: "0x", topics: ["0xddf2", topic(SELLER), topic(POOL)] },
      { transactionHash: TX, data: "0x01", topics: ["0xddf2", null, topic(POOL)] },
    ],
    POOL,
  );
  assert.equal(sellers.size, 1);
  const swap = sale({ tokenAmount: 0n });
  nameSellers([{ swap, pool: POOL }], sellers);
  assert.equal(swap.recipient.toLowerCase(), SELLER.toLowerCase());
});
