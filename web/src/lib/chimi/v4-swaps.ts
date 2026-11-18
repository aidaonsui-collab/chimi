import { decodeEventLog, parseAbiItem, toEventSelector, type Address, type Hex } from "viem";
import { v4SwapEvent, type Deployment } from "@/lib/chimi/chain";
import { publicClient } from "@/lib/chimi/client";
import { v4PoolDelta } from "@/lib/chimi/v4-rules";
import type { PoolRef, PoolSwap } from "@/lib/chimi/market";

/**
 * Trades on taxed v4 pools. They are not contracts of their own: every swap is a log on the PoolManager,
 * named by the pool id. The amounts on that log are what the trader is owed, so they are flipped to the
 * pool-delta sign the rest of the app already uses for v3. A buyback the hook runs inside a trade is a
 * second swap whose sender is the hook; those are left out of the tape.
 */

const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const V4_SWAP_TOPIC = toEventSelector(v4SwapEvent);

type Raw = {
  tx: Hex;
  block: bigint;
  index: number;
  time: number;
  poolId: string;
  sender: Address;
  tokenAmt: bigint;
  ethAmt: bigint;
  buy: boolean;
  sqrtPriceX96: bigint;
};

export async function loadV4Swaps(
  refs: PoolRef[],
  head: { number: bigint; time: number },
  spans: { from: bigint; to: bigint }[],
): Promise<Map<string, PoolSwap[]>> {
  const out = new Map<string, PoolSwap[]>(refs.map((r) => [r.poolId!.toLowerCase(), []]));
  const manager = refs.find((r) => r.manager)?.manager;
  if (!manager || spans.length === 0) return out;
  const wanted = new Map(refs.filter((r) => r.poolId).map((r) => [r.poolId!.toLowerCase(), r]));
  const hooks = new Set(refs.map((r) => r.hook?.toLowerCase()).filter((h): h is string => !!h));
  const pages = await Promise.all(
    spans.map((span) =>
      publicClient
        .getLogs({ address: manager, event: v4SwapEvent, fromBlock: span.from, toBlock: span.to })
        .then((logs) => ({ span, logs }))
        .catch(() => ({ span, logs: [] })),
    ),
  );
  const raw: Raw[] = [];
  const seen = new Set<string>();
  for (const { span, logs } of pages) {
    for (const log of logs) {
      const id = (log.args.id ?? "0x").toLowerCase();
      const ref = wanted.get(id);
      if (!ref) continue;
      const key = `${log.transactionHash}:${log.logIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const sender = (log.args.sender ?? manager).toLowerCase() as Address;
      if (hooks.has(sender)) continue;
      const flipped = v4PoolDelta(log.args.amount0 ?? 0n, log.args.amount1 ?? 0n);
      const tokenAmt = ref.tokenIs0 ? flipped.amount0 : flipped.amount1;
      const ethAmt = ref.tokenIs0 ? flipped.amount1 : flipped.amount0;
      const block = log.blockNumber ?? span.to;
      raw.push({
        tx: log.transactionHash ?? "0x",
        block,
        index: Number(log.logIndex ?? 0),
        time: head.time - Number(head.number - block),
        poolId: id,
        sender,
        tokenAmt,
        ethAmt,
        buy: tokenAmt < 0n,
        sqrtPriceX96: log.args.sqrtPriceX96 ?? 0n,
      });
    }
  }
  const who = await tradersFor(raw, refs, manager);
  for (const row of raw) {
    const list = out.get(row.poolId);
    if (!list) continue;
    list.push({
      tx: row.tx,
      block: row.block,
      index: row.index,
      time: row.time,
      recipient: who.get(`${row.tx}:${row.index}`) ?? row.sender,
      buy: row.buy,
      tokenAmount: row.tokenAmt < 0n ? -row.tokenAmt : row.tokenAmt,
      ethAmount: row.ethAmt < 0n ? -row.ethAmt : row.ethAmt,
      sqrtPriceX96: row.sqrtPriceX96,
    });
  }
  for (const rows of out.values()) rows.sort((a, b) => (a.block === b.block ? (a.index ?? 0) - (b.index ?? 0) : a.block < b.block ? -1 : 1));
  return out;
}

/** The wallet a v4 swap was for, from the token transfer between the PoolManager and that wallet. */
async function tradersFor(raw: Raw[], refs: PoolRef[], manager: Address): Promise<Map<string, Address>> {
  const out = new Map<string, Address>();
  if (raw.length === 0) return out;
  const byToken = new Map<string, { token: Address; rows: Raw[] }>();
  const tokenOf = new Map(refs.filter((r) => r.poolId && r.token).map((r) => [r.poolId!.toLowerCase(), r.token!]));
  let from = raw[0]!.block;
  let to = from;
  for (const row of raw) {
    if (row.block < from) from = row.block;
    if (row.block > to) to = row.block;
    const token = tokenOf.get(row.poolId);
    if (!token) continue;
    const bucket = byToken.get(token.toLowerCase()) ?? { token, rows: [] };
    bucket.rows.push(row);
    byToken.set(token.toLowerCase(), bucket);
  }
  await Promise.all(
    [...byToken.values()].map(async ({ token, rows }) => {
      const logs = await publicClient.getLogs({ address: token, event: transferEvent, fromBlock: from, toBlock: to }).catch(() => []);
      const paid = new Map<string, Address>();
      const received = new Map<string, Address>();
      for (const log of logs) {
        const value = log.args.value ?? 0n;
        const tx = log.transactionHash ?? "0x";
        if ((log.args.from ?? "").toLowerCase() === manager.toLowerCase()) received.set(`${tx}:${value}`, log.args.to ?? manager);
        if ((log.args.to ?? "").toLowerCase() === manager.toLowerCase()) paid.set(`${tx}:${value}`, log.args.from ?? manager);
      }
      for (const row of rows) {
        const size = row.tokenAmt < 0n ? -row.tokenAmt : row.tokenAmt;
        const wallet = row.buy ? received.get(`${row.tx}:${size}`) : paid.get(`${row.tx}:${size}`);
        if (wallet) out.set(`${row.tx}:${row.index}`, wallet);
      }
    }),
  );
  return out;
}

export type ExplorerLog = {
  blockNumber: string;
  timeStamp: string;
  data: Hex;
  topics: (Hex | null)[];
  transactionHash: Hex;
  logIndex: string;
};

/** One pool's v4 swaps from explorer rows already filtered to that pool id. */
export function v4SwapsFromExplorer(logs: ExplorerLog[], ref: PoolRef, hook?: Address): PoolSwap[] {
  const rows: PoolSwap[] = [];
  const seen = new Set<string>();
  for (const log of logs) {
    const key = `${log.transactionHash}:${log.logIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const topics = log.topics.filter((t): t is Hex => Boolean(t));
    const decoded = decodeEventLog({ abi: [v4SwapEvent], data: log.data, topics: topics as [Hex, ...Hex[]] });
    const sender = (decoded.args.sender ?? "0x").toLowerCase();
    if (hook && sender === hook.toLowerCase()) continue;
    const flipped = v4PoolDelta(decoded.args.amount0, decoded.args.amount1);
    const tokenAmt = ref.tokenIs0 ? flipped.amount0 : flipped.amount1;
    const ethAmt = ref.tokenIs0 ? flipped.amount1 : flipped.amount0;
    rows.push({
      tx: log.transactionHash,
      block: BigInt(log.blockNumber),
      index: Number(log.logIndex),
      time: Number(BigInt(log.timeStamp)),
      recipient: (decoded.args.sender ?? ref.manager ?? ref.pool) as Address,
      buy: tokenAmt < 0n,
      tokenAmount: tokenAmt < 0n ? -tokenAmt : tokenAmt,
      ethAmount: ethAmt < 0n ? -ethAmt : ethAmt,
      sqrtPriceX96: decoded.args.sqrtPriceX96,
    });
  }
  return rows;
}

export function v4Manager(dep: Deployment | null | undefined): Address | undefined {
  return dep?.v4?.poolManager;
}

export { V4_SWAP_TOPIC };
