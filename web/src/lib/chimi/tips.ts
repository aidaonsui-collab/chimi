import { useCallback, useEffect, useRef, useState } from "react";
import { parseAbiItem, type Address } from "viem";
import type { Deployment } from "@/lib/chimi/chain";
import { publicClient } from "@/lib/chimi/client";

/*
 * Tips read straight from the chain: the tips contract's `Tipped` events for one coin. The page and the stream alerts
 * read them in the browser, so they cost the site nothing however many people watch.
 */

export type Tip = {
  key: string;
  token: string;
  from: string;
  creator: string;
  amount: bigint;
  message: string;
  block: bigint;
  tx: `0x${string}`;
  /** Unix seconds; read only where it's shown (the feed). */
  time?: number;
};

const tipped = parseAbiItem("event Tipped(address indexed token, address indexed from, address indexed creator, uint256 amount, uint256 fee, string message)");
/** The public RPC answers at most 10,000 blocks of logs at a time. */
const SPAN = 9_000n;
/** How far back the coin's page looks: about 15 hours at one block a second. */
const BACK_SPANS = 6;
const KEEP = 30;

/** One span of tips: to `token`, or to every coin when it's undefined. */
async function readSpan(contract: Address, token: Address | undefined, from: bigint, to: bigint): Promise<Tip[]> {
  const logs = await publicClient.getLogs({ address: contract, event: tipped, args: token ? { token } : undefined, fromBlock: from, toBlock: to });
  return logs.map((log) => ({
    key: `${log.transactionHash}:${log.logIndex}`,
    token: log.args.token!.toLowerCase(),
    from: log.args.from!.toLowerCase(),
    creator: log.args.creator!.toLowerCase(),
    amount: log.args.amount!,
    message: log.args.message ?? "",
    block: log.blockNumber,
    tx: log.transactionHash,
  }));
}

/** Tips to `token` from block `from` through `to`, oldest first, read in spans the RPC accepts. */
export async function readTips(contract: Address, token: Address, from: bigint, to: bigint): Promise<Tip[]> {
  const spans: { from: bigint; to: bigint }[] = [];
  for (let start = from; start <= to; start += SPAN) spans.push({ from: start, to: start + SPAN - 1n < to ? start + SPAN - 1n : to });
  const pages = await Promise.all(spans.map((s) => readSpan(contract, token, s.from, s.to)));
  return pages.flat();
}

const visible = () => typeof document === "undefined" || document.visibilityState === "visible";

/**
 * The latest tips to a coin, newest first: about the last 15 hours, then new ones every `everyMs` while the page is
 * in view. undefined until the first read; empty when tips aren't deployed. `refresh` reads at once (after a tip).
 */
export function useTips(deployment: Deployment | null, token: string | undefined, everyMs = 10_000) {
  const contract = deployment?.tips?.address;
  const start = deployment?.tips ? BigInt(deployment.tips.block) : 0n;
  const [tips, setTips] = useState<Tip[] | undefined>();
  const cursor = useRef<bigint | null>(null);
  const busy = useRef(false);

  const pull = useCallback(async () => {
    if (!contract || !token || busy.current) return;
    busy.current = true;
    try {
      const latest = await publicClient.getBlockNumber();
      const back = latest - SPAN * BigInt(BACK_SPANS);
      const from = cursor.current !== null ? cursor.current + 1n : back > start ? back : start;
      if (from > latest) return;
      const fresh = await readTips(contract, token as Address, from, latest);
      cursor.current = latest;
      setTips((had) => {
        const seen = new Set((had ?? []).map((t) => t.key));
        return [...fresh.filter((t) => !seen.has(t.key)).reverse(), ...(had ?? [])].slice(0, KEEP);
      });
    } catch {
      // A failed read is tried again on the next round; the list keeps what it had.
      setTips((had) => had ?? []);
    } finally {
      busy.current = false;
    }
  }, [contract, token, start]);

  useEffect(() => {
    cursor.current = null;
    setTips(contract ? undefined : []);
    if (!contract || !token) return;
    void pull();
    const timer = setInterval(() => visible() && void pull(), everyMs);
    return () => clearInterval(timer);
  }, [contract, token, everyMs, pull]);

  return { tips, refresh: pull };
}

/**
 * Calls `onTips` with each new tip to `token` from now on, checking every `everyMs`, for the stream alerts. Older
 * tips are never replayed. Answers with a function that stops it.
 */
export function watchTips(contract: Address, token: Address, onTips: (tips: Tip[]) => void, everyMs = 2_500) {
  let cursor: bigint | null = null;
  let stopped = false;
  let busy = false;
  const round = async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      const latest = await publicClient.getBlockNumber();
      if (cursor === null) cursor = latest;
      else if (latest > cursor) {
        // After a long gap (a sleeping laptop), only the last span is read: alerts are for now, not for catching up.
        const from = latest - cursor > SPAN ? latest - SPAN + 1n : cursor + 1n;
        const fresh = await readSpan(contract, token, from, latest);
        cursor = latest;
        if (fresh.length && !stopped) onTips(fresh);
      }
    } catch {
      // Tried again on the next round.
    } finally {
      busy = false;
    }
  };
  void round();
  const timer = setInterval(() => void round(), everyMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

/** How far back the feed looks: about a day at one block a second. */
const FEED_SPANS = 10;

/** When each of these blocks was made, in unix seconds. */
async function blockTimes(blocks: bigint[]) {
  const unique = [...new Set(blocks)];
  const read = await Promise.all(unique.map((b) => publicClient.getBlock({ blockNumber: b }).then((x) => [b, Number(x.timestamp)] as const)));
  return new Map(read);
}

/**
 * The latest tips to every coin, newest first, with their times, for the Clubhouse feed: about the last day, then new
 * ones every `everyMs` while the page is in view. Empty until tips are deployed.
 */
export function useRecentTips(deployment: Deployment | null, everyMs = 30_000) {
  const contract = deployment?.tips?.address;
  const start = deployment?.tips ? BigInt(deployment.tips.block) : 0n;
  const [tips, setTips] = useState<Tip[]>([]);
  const cursor = useRef<bigint | null>(null);
  const busy = useRef(false);

  const pull = useCallback(async () => {
    if (!contract || busy.current) return;
    busy.current = true;
    try {
      const latest = await publicClient.getBlockNumber();
      const back = latest - SPAN * BigInt(FEED_SPANS);
      const from = cursor.current !== null ? cursor.current + 1n : back > start ? back : start;
      if (from > latest) return;
      const spans: { from: bigint; to: bigint }[] = [];
      for (let a = from; a <= latest; a += SPAN) spans.push({ from: a, to: a + SPAN - 1n < latest ? a + SPAN - 1n : latest });
      const fresh = (await Promise.all(spans.map((sp) => readSpan(contract, undefined, sp.from, sp.to)))).flat();
      const times = fresh.length ? await blockTimes(fresh.map((t) => t.block)) : new Map<bigint, number>();
      cursor.current = latest;
      if (fresh.length === 0) return;
      setTips((had) => {
        const seen = new Set(had.map((t) => t.key));
        const timed = fresh.filter((t) => !seen.has(t.key)).map((t) => ({ ...t, time: times.get(t.block) }));
        return [...timed.reverse(), ...had].slice(0, 100);
      });
    } catch {
      // Tried again on the next round.
    } finally {
      busy.current = false;
    }
  }, [contract, start]);

  useEffect(() => {
    cursor.current = null;
    setTips([]);
    if (!contract) return;
    void pull();
    const timer = setInterval(() => visible() && void pull(), everyMs);
    return () => clearInterval(timer);
  }, [contract, everyMs, pull]);

  return tips;
}

/** Tells the server about a confirmed tip, so it lands in the creator's inbox. Best effort. */
export function announceTip(tx: string) {
  void fetch("/api/tips", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tx }) }).catch(() => undefined);
}
