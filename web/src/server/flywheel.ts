/**
 * The daily keeper for the fee burns (contracts/src/ChimiBurner.sol) and the flywheel before them
 * (contracts/src/ChimiFlywheel.sol), run by Vercel Cron at 00:10 KST through /api/keeper/flywheel. In order, each step
 * on its own so one failing doesn't stop the next:
 *
 * 1. Sweep the fees of every coin. Each lock pays the wallets written on it: on the 2% DEX the creator (WETH), the
 *    platform, the CHIMI burn (ETH) and, for a coin that burns itself, its own burner (WETH); on the first DEX, the
 *    creator's 70% and the platform's 30%.
 * 2. Buy back and burn CHIMI with the flywheel's burn half, then with what the burner holds for CHIMI, each up to
 *    MAX_BURN a day, at no less than 98% of a dry run's price taken just before.
 * 2b. For every coin that burns itself, buy the coin with what its burner holds and burn it, on the same terms, the
 *    fullest burners first, at most MAX_COIN_BURNS coins a run.
 * 3. Pay the KST day that just ended: the flywheel's holder half, shared by average CHIMI balance over the day among
 *    wallets that averaged at least 10,000 (lib/chimi/flywheel-rules.ts). The plan is saved before anything is sent,
 *    so a run that stops halfway finishes the same plan next time; the contract pays each (day, batch) once.
 *
 * KEEPER_PRIVATE_KEY is the flywheel's keeper wallet (it only needs gas). A dry run reads and plans but sends nothing.
 */
import { createPublicClient, createWalletClient, http, parseAbiItem, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import deploymentJson from "../../public/deployments.json";
import { burnerAbi, coinBurnerAbi, dexesOf, erc20Abi, factoryAbi, flywheelAbi, giwaSepolia, lockerAbi, poolAbi, type Deployment } from "@/lib/chimi/chain";
import { BATCH, MIN_HOLD, averageBalances, batches, eligible, isContractCode, periodBounds, periodDate, periodOf, shareOut, type ChimiTransfer } from "@/lib/chimi/flywheel-rules";
import { env } from "@/server/env";
import { docStore, takeLock } from "@/server/store";

const deployment = deploymentJson as Deployment;
const DEAD = "0x000000000000000000000000000000000000dead";
const ZERO = "0x0000000000000000000000000000000000000000";
/** Below this the burn half waits for another day. */
const MIN_BURN = 10n ** 14n;
/** The most the burn spends in one day, so one buy never moves CHIMI's small pool too far. */
const MAX_BURN = 25n * 10n ** 16n;
/** Coins bought back and burned per run, so the run stays inside the function's time limit. */
const MAX_COIN_BURNS = 15;
/** The public RPC answers getLogs for at most ~10k blocks at a time. */
const LOG_SPAN = 9_000n;
const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const ownerAbi = [{ type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const;

type Plan = { period: number; total: string; payouts: [string, string][]; at: number };
type Book = { plans: Record<string, Plan>; lastRun?: FlywheelReport };

export type FlywheelReport = {
  at: number;
  dry: boolean;
  /** Why the run did nothing at all, when it didn't. */
  skipped?: string;
  keeper?: string;
  keeperEth?: string;
  sweep?: { positions: number; tx: string[] };
  burn?: { ethIn: string; chimiOut: string; tx?: string } | { skipped: string };
  /** The CHIMI burn every coin launched since the fee choice pays (the burner). */
  chimiBurn?: { ethIn: string; chimiOut: string; tx?: string } | { skipped: string };
  /** Coins that burn themselves, bought back with their own burners. */
  coinBurns?: { coin: string; ethIn: string; out: string; tx?: string }[];
  payout?: { period: number; date: string; total: string; wallets: number; tx: string[] } | { skipped: string };
  errors: string[];
};

const book = () => docStore<Book>("chimi-flywheel-v1");

function client(): PublicClient {
  return createPublicClient({ chain: giwaSepolia, transport: http(env("GIWA_RPC") || undefined, { batch: true }) }) as PublicClient;
}

/** The run's last report, for the app's rewards panel. */
export async function lastFlywheelRun(): Promise<FlywheelReport | null> {
  return (await book().load()).doc?.lastRun ?? null;
}

export async function runFlywheel(opts: { dry?: boolean; nowMs?: number } = {}): Promise<FlywheelReport> {
  const dry = !!opts.dry;
  const report: FlywheelReport = { at: opts.nowMs ?? Date.now(), dry, errors: [] };
  const fw = deployment.flywheel;
  if (!fw) {
    report.skipped = "no flywheel in deployments.json yet";
    return report;
  }
  const release = await takeLock("chimi:flywheel:run", 5 * 60_000);
  if (!release) {
    report.errors.push("another run is going");
    return report;
  }
  try {
    const pub = client();
    const key = env("KEEPER_PRIVATE_KEY") as Hex | undefined;
    const account = key ? privateKeyToAccount(key) : undefined;
    if (!dry && !account) throw new Error("KEEPER_PRIVATE_KEY is not set");
    const keeper = account?.address ?? ((await pub.readContract({ address: fw.address, abi: flywheelAbi, functionName: "keeper" })) as Address);
    report.keeper = keeper;
    report.keeperEth = (await pub.getBalance({ address: keeper })).toString();
    const wallet = account ? createWalletClient({ account, chain: giwaSepolia, transport: http(env("GIWA_RPC") || undefined) }) : undefined;
    const send = async (req: Parameters<PublicClient["simulateContract"]>[0]) => {
      const { request } = await pub.simulateContract({ ...req, account: account ?? keeper } as Parameters<PublicClient["simulateContract"]>[0]);
      if (dry || !wallet) return undefined;
      const hash = await wallet.writeContract(request as Parameters<typeof wallet.writeContract>[0]);
      const receipt = await pub.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`transaction ${hash} reverted`);
      return hash;
    };

    // 1. Sweep the new coins' fees.
    try {
      const swept = await sweep(pub, send);
      report.sweep = swept;
    } catch (e) {
      report.errors.push(`sweep: ${message(e)}`);
    }

    // 2. Buy back and burn CHIMI.
    try {
      const [toBurn] = (await pub.readContract({ address: fw.address, abi: flywheelAbi, functionName: "pending" })) as readonly [bigint, bigint];
      if (toBurn < MIN_BURN) report.burn = { skipped: `burn half ${toBurn} wei is under the minimum` };
      else {
        const amountIn = toBurn < MAX_BURN ? toBurn : MAX_BURN;
        const { result } = await pub.simulateContract({ address: fw.address, abi: flywheelAbi, functionName: "buybackAndBurn", args: [amountIn, 0n], account: account ?? keeper });
        const minOut = ((result as bigint) * 98n) / 100n;
        const tx = await send({ address: fw.address, abi: flywheelAbi, functionName: "buybackAndBurn", args: [amountIn, minOut] });
        report.burn = { ethIn: amountIn.toString(), chimiOut: (result as bigint).toString(), tx };
      }
    } catch (e) {
      report.errors.push(`burn: ${message(e)}`);
    }

    // 2. (continued) The burner: CHIMI, then each coin that burns itself.
    const burner = deployment.burner;
    if (burner) {
      try {
        const waiting = (await pub.readContract({ address: burner.address, abi: burnerAbi, functionName: "pendingChimi" })) as bigint;
        if (waiting < MIN_BURN) report.chimiBurn = { skipped: `${waiting} wei waiting is under the minimum` };
        else {
          const amountIn = waiting < MAX_BURN ? waiting : MAX_BURN;
          const { result } = await pub.simulateContract({ address: burner.address, abi: burnerAbi, functionName: "burnChimi", args: [amountIn, 0n], account: account ?? keeper });
          const minOut = ((result as bigint) * 98n) / 100n;
          const tx = await send({ address: burner.address, abi: burnerAbi, functionName: "burnChimi", args: [amountIn, minOut] });
          report.chimiBurn = { ethIn: amountIn.toString(), chimiOut: (result as bigint).toString(), tx };
        }
      } catch (e) {
        report.errors.push(`CHIMI burn: ${message(e)}`);
      }
      try {
        report.coinBurns = await coinBurns(pub, send, burner.address, account?.address ?? keeper, report.errors);
      } catch (e) {
        report.errors.push(`coin burns: ${message(e)}`);
      }
    }

    // 3. Pay the day that just ended, by the chain's clock.
    try {
      const head = await pub.getBlock();
      report.payout = await payout(pub, send, Number(head.timestamp), dry);
    } catch (e) {
      report.errors.push(`payout: ${message(e)}`);
    }
  } catch (e) {
    report.errors.push(message(e));
  } finally {
    if (!dry) await saveReport(report).catch(() => undefined);
    await release();
  }
  return report;
}

type Send = (req: Parameters<PublicClient["simulateContract"]>[0]) => Promise<string | undefined>;

/** Buys back and burns each coin whose burner holds enough, fullest first. A coin that fails is noted and skipped. */
async function coinBurns(pub: PublicClient, send: Send, burner: Address, from: Address, errors: string[]): Promise<NonNullable<FlywheelReport["coinBurns"]>> {
  const count = (await pub.readContract({ address: burner, abi: burnerAbi, functionName: "burningCoinsLength" })) as bigint;
  if (count === 0n) return [];
  const coins = (await pub.multicall({
    allowFailure: false,
    contracts: Array.from({ length: Number(count) }, (_, i) => ({ address: burner, abi: burnerAbi, functionName: "burningCoins", args: [BigInt(i)] }) as const),
  })) as Address[];
  const burners = (await pub.multicall({
    allowFailure: false,
    contracts: coins.map((c) => ({ address: burner, abi: burnerAbi, functionName: "burnerOf", args: [c] }) as const),
  })) as Address[];
  const pending = (await pub.multicall({
    allowFailure: false,
    contracts: burners.map((b) => ({ address: b, abi: coinBurnerAbi, functionName: "pending" }) as const),
  })) as bigint[];
  const due = coins
    .map((coin, i) => ({ coin, pending: pending[i]! }))
    .filter((c) => c.pending >= MIN_BURN)
    .sort((a, b) => (a.pending === b.pending ? 0 : a.pending > b.pending ? -1 : 1))
    .slice(0, MAX_COIN_BURNS);

  const done: NonNullable<FlywheelReport["coinBurns"]> = [];
  for (const { coin, pending: waiting } of due) {
    try {
      const amountIn = waiting < MAX_BURN ? waiting : MAX_BURN;
      const { result } = await pub.simulateContract({ address: burner, abi: burnerAbi, functionName: "burnCoin", args: [coin, amountIn, 0n], account: from });
      const [spent, out] = result as readonly [bigint, bigint];
      const minOut = (out * 98n) / 100n;
      const tx = await send({ address: burner, abi: burnerAbi, functionName: "burnCoin", args: [coin, amountIn, minOut] });
      done.push({ coin, ethIn: spent.toString(), out: out.toString(), tx });
    } catch (e) {
      errors.push(`burn ${coin}: ${message(e)}`);
    }
  }
  return done;
}

async function sweep(pub: PublicClient, send: Send) {
  // Every coin on every DEX: the first DEX's coins pay only their creator and the platform, but sweeping them too means
  // every creator's fees arrive daily without a claim.
  const all = dexesOf(deployment);
  const count = (await pub.readContract({ address: deployment.factory, abi: factoryAbi, functionName: "allTokensLength" })) as bigint;
  const tokens = (await pub.multicall({
    allowFailure: false,
    contracts: Array.from({ length: Number(count) }, (_, i) => ({ address: deployment.factory, abi: factoryAbi, functionName: "allTokens", args: [BigInt(i)] }) as const),
  })) as Address[];
  const pools = (await pub.multicall({
    allowFailure: false,
    contracts: tokens.map((t) => ({ address: deployment.factory, abi: factoryAbi, functionName: "getPool", args: [t] }) as const),
  })) as { uniPool: Address; positionId: bigint }[];
  const factories = (await pub.multicall({
    allowFailure: true,
    contracts: pools.map((p) => ({ address: p.uniPool, abi: poolAbi, functionName: "factory" }) as const),
  })) as { result?: Address }[];

  const tx: string[] = [];
  let positions = 0;
  for (const dex of all) {
    const ids = pools.filter((_, i) => factories[i]?.result?.toLowerCase() === dex.uniFactory.toLowerCase()).map((p) => p.positionId);
    positions += ids.length;
    for (const chunk of batches(ids, 40)) {
      const hash = await send({ address: dex.locker, abi: lockerAbi, functionName: "collectFeesBatch", args: [chunk] });
      if (hash) tx.push(hash);
    }
  }
  return { positions, tx };
}

async function payout(pub: PublicClient, send: Send, nowSec: number, dry: boolean): Promise<FlywheelReport["payout"]> {
  const fw = deployment.flywheel!;
  const period = periodOf(nowSec) - 1;
  const store = book();
  const loaded = await store.load();
  let plan = loaded.doc?.plans?.[String(period)];

  if (!plan) {
    if (await batchDone(pub, period, 0)) return { skipped: `day ${periodDate(period)} was already paid` };
    const [, toHolders] = (await pub.readContract({ address: fw.address, abi: flywheelAbi, functionName: "pending" })) as readonly [bigint, bigint];
    if (toHolders === 0n) return { skipped: "the holder half is empty" };
    const weights = await holderWeights(pub, period);
    const payouts = shareOut(toHolders, weights);
    if (payouts.length === 0) return { skipped: `no wallet averaged ${MIN_HOLD / 10n ** 18n} CHIMI on ${periodDate(period)}` };
    plan = { period, total: toHolders.toString(), payouts: payouts.map((p) => [p.wallet, p.amount.toString()]), at: Date.now() };
    if (!dry) {
      const doc: Book = { ...(loaded.doc ?? { plans: {} }), plans: keepRecent({ ...(loaded.doc?.plans ?? {}), [String(period)]: plan }) };
      if (!(await store.save(doc, loaded.rev))) throw new Error("the plan changed under this run; try again");
    }
  }

  const tx: string[] = [];
  const groups = batches(plan.payouts, BATCH);
  for (let b = 0; b < groups.length; b++) {
    if (!dry && (await batchDone(pub, period, b))) continue;
    const group = groups[b]!;
    const hash = await send({
      address: fw.address,
      abi: flywheelAbi,
      functionName: "distribute",
      args: [BigInt(period), BigInt(b), group.map(([w]) => w as Address), group.map(([, a]) => BigInt(a))],
    });
    if (hash) tx.push(hash);
  }
  return { period, date: periodDate(period), total: plan.total, wallets: plan.payouts.length, tx };
}

const batchDone = async (pub: PublicClient, period: number, batch: number) =>
  (await pub.readContract({ address: deployment.flywheel!.address, abi: flywheelAbi, functionName: "batchDone", args: [BigInt(period), BigInt(batch)] })) as boolean;

/**
 * Each eligible wallet's average CHIMI over the day. Balances are read at the latest block and walked back through
 * CHIMI's transfers since the day began. The wallets are everyone the explorer lists as a holder plus everyone in
 * those transfers; if the explorer can't be read, the day isn't paid rather than paid to a partial list.
 */
async function holderWeights(pub: PublicClient, period: number): Promise<Map<string, bigint>> {
  const fw = deployment.flywheel!;
  const { start, end } = periodBounds(period);
  const latest = await pub.getBlock();
  const fromBlock = await firstBlockAtOrAfter(pub, start, latest);

  const raw: { from: string; to: string; value: bigint; block: bigint; index: number }[] = [];
  for (let from = fromBlock; from <= latest.number; from += LOG_SPAN) {
    const to = from + LOG_SPAN - 1n < latest.number ? from + LOG_SPAN - 1n : latest.number;
    const logs = await pub.getLogs({ address: fw.chimi, event: transferEvent, fromBlock: from, toBlock: to });
    for (const l of logs) raw.push({ from: l.args.from!.toLowerCase(), to: l.args.to!.toLowerCase(), value: l.args.value!, block: l.blockNumber!, index: l.logIndex! });
  }
  // Each transfer at its block's own time.
  const blocks = [...new Set(raw.map((t) => t.block))];
  const stamps = new Map<bigint, number>();
  for (const chunk of batches(blocks, 200)) {
    const got = await Promise.all(chunk.map((b) => pub.getBlock({ blockNumber: b })));
    got.forEach((blk) => stamps.set(blk.number, Number(blk.timestamp)));
  }
  const transfers: ChimiTransfer[] = raw.map((t) => ({ ...t, time: stamps.get(t.block)! }));

  const wallets = new Set<string>([...(await explorerHolders(fw.chimi)), ...transfers.flatMap((t) => [t.from, t.to])]);
  wallets.delete(ZERO);
  const list = [...wallets] as Address[];
  const balances = (await pub.multicall({
    allowFailure: false,
    blockNumber: latest.number,
    contracts: list.map((w) => ({ address: fw.chimi, abi: erc20Abi, functionName: "balanceOf", args: [w] }) as const),
  })) as bigint[];
  const now = new Map(list.map((w, i) => [w.toLowerCase(), balances[i]!]));
  const averages = averageBalances(now, transfers, start, end);

  const excluded = await excludedWallets(pub);
  const candidates = eligible(averages, excluded);
  // Pools, lockers and other contracts aren't holders. A wallet with an EIP-7702 delegation still is.
  const codes = await Promise.all([...candidates.keys()].map((w) => pub.getCode({ address: w as Address }).catch(() => undefined)));
  const out = new Map<string, bigint>();
  [...candidates.entries()].forEach(([w, avg], i) => {
    if (!isContractCode(codes[i])) out.set(w, avg);
  });
  return out;
}

/** The first block whose time is at or after `ts`, by binary search on block times. */
async function firstBlockAtOrAfter(pub: PublicClient, ts: number, latest: { number: bigint; timestamp: bigint }): Promise<bigint> {
  if (Number(latest.timestamp) < ts) return latest.number + 1n;
  // About five days of one-second blocks back is plenty for yesterday; widen to the start if the chain is slower.
  let lo = latest.number > 400_000n ? latest.number - 400_000n : 0n;
  if (lo > 0n && Number((await pub.getBlock({ blockNumber: lo })).timestamp) >= ts) lo = 0n;
  let hi = latest.number;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    if (Number((await pub.getBlock({ blockNumber: mid })).timestamp) < ts) lo = mid + 1n;
    else hi = mid;
  }
  return lo;
}

/** The addresses that never earn: burn and zero, the flywheel, every DEX contract, the pad and the platform. */
async function excludedWallets(pub: PublicClient): Promise<Set<string>> {
  const out = new Set<string>([DEAD, ZERO, deployment.flywheel!.address, deployment.factory, deployment.bpsSource]);
  for (const d of dexesOf(deployment)) for (const a of [d.uniFactory, d.positionManager, d.swapRouter, d.locker]) out.add(a);
  const owner = await pub.readContract({ address: deployment.factory, abi: ownerAbi, functionName: "owner" }).catch(() => undefined);
  if (owner) out.add(owner);
  return new Set([...out].map((a) => a.toLowerCase()));
}

/** Every CHIMI holder the explorer knows, all pages. Throws when the explorer can't be read. */
async function explorerHolders(token: Address): Promise<string[]> {
  const base = `${giwaSepolia.blockExplorers.default.url}/api/v2/tokens/${token}/holders`;
  const out: string[] = [];
  let next = "";
  for (let page = 0; page < 50; page++) {
    const res = await fetch(base + next, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`explorer holders ${res.status}`);
    const body = (await res.json()) as { items?: { address?: { hash?: string } }[]; next_page_params?: Record<string, string | number> | null };
    for (const item of body.items ?? []) if (item.address?.hash) out.push(item.address.hash.toLowerCase());
    if (!body.next_page_params) return out;
    next = "?" + new URLSearchParams(Object.entries(body.next_page_params).map(([k, v]) => [k, String(v)])).toString();
  }
  throw new Error("explorer holders: too many pages");
}

/** The last two weeks of plans are kept; older days are settled for good. */
function keepRecent(plans: Record<string, Plan>): Record<string, Plan> {
  const keys = Object.keys(plans).map(Number).sort((a, b) => b - a).slice(0, 14);
  return Object.fromEntries(keys.map((k) => [String(k), plans[String(k)]!]));
}

async function saveReport(report: FlywheelReport) {
  const store = book();
  for (let attempt = 0; attempt < 3; attempt++) {
    const loaded = await store.load();
    const doc: Book = { plans: loaded.doc?.plans ?? {}, lastRun: report };
    if (await store.save(doc, loaded.rev)) return;
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0]!.slice(0, 300) : String(e));
