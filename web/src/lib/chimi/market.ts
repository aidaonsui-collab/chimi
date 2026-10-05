import { formatEther, parseAbiItem, zeroAddress, type Address } from "viem";
import { erc20Abi, factoryAbi, isDeployed, poolAbi, type Deployment } from "@/lib/chimi/chain";
import { publicClient } from "@/lib/chimi/client";

export type Coin = {
  token: Address;
  name: string;
  symbol: string;
  pool: Address;
  creator: Address;
  sqrtPriceX96: bigint;
  tokenIs0: boolean;
  liquidity: bigint;
  preview?: boolean;
};

const Q96 = 2n ** 96n;

export function wethPerToken(sqrtPriceX96: bigint, tokenIs0: boolean): bigint {
  if (sqrtPriceX96 === 0n) return 0n;
  const ratioX192 = sqrtPriceX96 * sqrtPriceX96;
  const one = 10n ** 18n;
  if (tokenIs0) return (ratioX192 * one) / (Q96 * Q96);
  return (Q96 * Q96 * one) / ratioX192;
}

export function fmt(wei: bigint, digits = 6): string {
  const s = formatEther(wei);
  const [w, f = ""] = s.split(".");
  return f.length > 0 ? `${w}.${f.slice(0, digits)}` : w;
}

export function short(err: unknown): string {
  if (err && typeof err === "object" && "shortMessage" in err) {
    return String((err as { shortMessage: string }).shortMessage);
  }
  if (err instanceof Error) return err.message;
  return "Transaction failed";
}

export function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Spot estimate after the 1% pool fee. Buying a token spends ETH. */
export function estimatedOut(amountIn: bigint, priceWethPerToken: bigint, buyingToken: boolean): bigint {
  if (amountIn <= 0n || priceWethPerToken <= 0n) return 0n;
  const afterFee = (amountIn * 99n) / 100n;
  if (buyingToken) return (afterFee * 10n ** 18n) / priceWethPerToken;
  return (afterFee * priceWethPerToken) / 10n ** 18n;
}

export async function loadCoins(dep: Deployment): Promise<Coin[]> {
  if (!isDeployed(dep)) return [];
  const length = await publicClient.readContract({
    address: dep.factory,
    abi: factoryAbi,
    functionName: "allTokensLength",
  });
  const next: Coin[] = [];
  for (let i = 0; i < Number(length); i++) {
    const token = await publicClient.readContract({
      address: dep.factory,
      abi: factoryAbi,
      functionName: "allTokens",
      args: [BigInt(i)],
    });
    const [name, symbol, pool] = await Promise.all([
      publicClient.readContract({ address: token, abi: erc20Abi, functionName: "name" }),
      publicClient.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
      publicClient.readContract({
        address: dep.factory,
        abi: factoryAbi,
        functionName: "getPool",
        args: [token],
      }),
    ]);
    const [token0, slot0] = await Promise.all([
      publicClient.readContract({ address: pool.uniPool, abi: poolAbi, functionName: "token0" }),
      publicClient.readContract({ address: pool.uniPool, abi: poolAbi, functionName: "slot0" }),
    ]);
    next.push({
      token,
      name,
      symbol,
      pool: pool.uniPool,
      creator: pool.creator,
      sqrtPriceX96: slot0[0],
      tokenIs0: token0.toLowerCase() === token.toLowerCase(),
      liquidity: pool.liquidity,
    });
  }
  return next.reverse();
}

export async function loadCoin(dep: Deployment, token: Address): Promise<Coin | null> {
  if (!isDeployed(dep)) return null;
  const pool = await publicClient.readContract({
    address: dep.factory,
    abi: factoryAbi,
    functionName: "getPool",
    args: [token],
  });
  if (pool.uniPool === zeroAddress) return null;
  const [name, symbol, token0, slot0] = await Promise.all([
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: "name" }),
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
    publicClient.readContract({ address: pool.uniPool, abi: poolAbi, functionName: "token0" }),
    publicClient.readContract({ address: pool.uniPool, abi: poolAbi, functionName: "slot0" }),
  ]);
  return {
    token,
    name,
    symbol,
    pool: pool.uniPool,
    creator: pool.creator,
    sqrtPriceX96: slot0[0],
    tokenIs0: token0.toLowerCase() === token.toLowerCase(),
    liquidity: pool.liquidity,
  };
}

export type PoolSwap = {
  tx: `0x${string}`;
  block: bigint;
  time: number;
  recipient: Address;
  buy: boolean;
  tokenAmount: bigint;
  ethAmount: bigint;
  sqrtPriceX96: bigint;
};

export type Holder = {
  address: Address;
  balance: bigint;
};

const swapEvent = parseAbiItem(
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
);

const createdEvent = parseAbiItem(
  "event InstantQuoteTokenCreated(address indexed token, address indexed creator, address pool, uint256 positionId)",
);

export type Launch = {
  token: Address;
  pool: Address;
  time: number;
};

export async function loadLaunches(factory: Address): Promise<Launch[]> {
  const latest = await publicClient.getBlock();
  const latestNum = latest.number;
  const latestTime = Number(latest.timestamp);
  const span = 9_000n;
  const seen = new Set<string>();
  const rows: Launch[] = [];
  for (let i = 0; i < 16; i++) {
    const to = latestNum - span * BigInt(i);
    if (to <= 0n) break;
    const from = to > span ? to - span + 1n : 0n;
    const logs = await publicClient.getLogs({ address: factory, event: createdEvent, fromBlock: from, toBlock: to });
    for (const log of logs) {
      const token = log.args.token;
      const pool = log.args.pool;
      if (!token || !pool || seen.has(token.toLowerCase())) continue;
      seen.add(token.toLowerCase());
      const block = log.blockNumber ?? to;
      rows.push({ token, pool, time: latestTime - Number(latestNum - block) });
    }
    if (from === 0n) break;
  }
  rows.sort((a, b) => a.time - b.time);
  return rows;
}

export async function loadSwaps(pool: Address, tokenIs0: boolean): Promise<PoolSwap[]> {
  const latest = await publicClient.getBlock();
  const latestNum = latest.number;
  const latestTime = Number(latest.timestamp);
  const span = 9_000n;
  const seen = new Set<string>();
  const rows: PoolSwap[] = [];
  for (let i = 0; i < 10; i++) {
    const to = latestNum - span * BigInt(i);
    if (to <= 0n) break;
    const from = to > span ? to - span + 1n : 0n;
    const logs = await publicClient.getLogs({
      address: pool,
      event: swapEvent,
      fromBlock: from,
      toBlock: to,
    });
    for (const log of logs) {
      const key = `${log.transactionHash}:${log.logIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const amount0 = log.args.amount0 ?? 0n;
      const amount1 = log.args.amount1 ?? 0n;
      const tokenAmt = tokenIs0 ? amount0 : amount1;
      const ethAmt = tokenIs0 ? amount1 : amount0;
      const block = log.blockNumber ?? to;
      rows.push({
        tx: log.transactionHash ?? "0x",
        block,
        time: latestTime - Number(latestNum - block),
        recipient: log.args.recipient ?? pool,
        buy: tokenAmt < 0n,
        tokenAmount: tokenAmt < 0n ? -tokenAmt : tokenAmt,
        ethAmount: ethAmt < 0n ? -ethAmt : ethAmt,
        sqrtPriceX96: log.args.sqrtPriceX96 ?? 0n,
      });
    }
    if (from === 0n) break;
  }
  rows.sort((a, b) => (a.block < b.block ? -1 : 1));
  return rows;
}

export async function loadHolders(token: Address, pool: Address, traders: Address[]): Promise<Holder[]> {
  const unique = [...new Set([pool, ...traders].map((a) => a.toLowerCase() as Address))];
  const balances = await Promise.all(
    unique.map((holder) =>
      publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [holder] }),
    ),
  );
  return unique
    .map((address, i) => ({ address, balance: balances[i] }))
    .filter((row) => row.balance > 0n)
    .sort((a, b) => (a.balance < b.balance ? 1 : -1));
}
