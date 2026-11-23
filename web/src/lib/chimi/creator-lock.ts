import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { creatorLockAbi } from "@/lib/chimi/chain";
import { publicClient } from "@/lib/chimi/client";
import type { CreatorLock } from "@/lib/chimi/creator-lock-rules";
import { useChimi } from "@/components/chimi/provider";

/*
 * Reading creator first-buy locks from the chain (rules and wording in creator-lock-rules.ts). The lock's address is
 * in deployments.json (`creatorLock`); before it's deployed these read nothing.
 */

const EVERY_MS = 30_000;
const PAGE = 200n;

type RawLock = { token: Address; creator: Address; amount: bigint; claimed: bigint; start: bigint; cliffEnd: bigint; vestEnd: bigint };

const toLock = (id: bigint, l: RawLock): CreatorLock => ({
  id,
  token: l.token.toLowerCase(),
  creator: l.creator.toLowerCase(),
  amount: l.amount,
  claimed: l.claimed,
  start: Number(l.start),
  cliffEnd: Number(l.cliffEnd),
  vestEnd: Number(l.vestEnd),
});

/** Re-reads every EVERY_MS while the page is visible, and on demand. */
function usePolled<T>(key: string | null, read: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!key) {
      setData(null);
      return;
    }
    let off = false;
    const run = () => {
      if (document.visibilityState !== "visible") return;
      read()
        .then((d) => !off && setData(d))
        .catch(() => undefined);
    };
    run();
    const timer = setInterval(run, EVERY_MS);
    return () => {
      off = true;
      clearInterval(timer);
    };
    // `read` is keyed by `key`.
  }, [key, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  return { data, refresh };
}

/** The creator lock's address on this deployment, if it has one. */
export function useCreatorLockAddress(): Address | undefined {
  return useChimi().deployment?.creatorLock?.address;
}

/** Every lock, oldest first. Null until read; [] on a deployment without the lock. */
export function useAllLocks() {
  const address = useCreatorLockAddress();
  const out = usePolled(address ?? null, async () => {
    const c = { address: address!, abi: creatorLockAbi } as const;
    const n = await publicClient.readContract({ ...c, functionName: "lockCount" });
    const all: CreatorLock[] = [];
    for (let i = 0n; i < n; i += PAGE) {
      const page = await publicClient.readContract({ ...c, functionName: "locksPage", args: [i, PAGE] });
      page.forEach((l, k) => all.push(toLock(i + BigInt(k), l as RawLock)));
    }
    return all;
  });
  return { locks: address ? out.data : [], refresh: out.refresh, available: !!address };
}

/** The locks on one coin (normally one: its creator's first buy). */
export function useTokenLocks(token: string | undefined) {
  const address = useCreatorLockAddress();
  const out = usePolled(address && token ? `${address}:${token.toLowerCase()}` : null, async () => {
    const c = { address: address!, abi: creatorLockAbi } as const;
    const ids = await publicClient.readContract({ ...c, functionName: "locksOfToken", args: [token as Address] });
    const locks = await Promise.all(ids.map((id) => publicClient.readContract({ ...c, functionName: "getLock", args: [id] })));
    return locks.map((l, k) => toLock(ids[k]!, l as RawLock));
  });
  return { locks: out.data, refresh: out.refresh, available: !!address };
}
