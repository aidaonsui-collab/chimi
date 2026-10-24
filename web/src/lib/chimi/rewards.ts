import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { publicClient } from "@/lib/chimi/client";
import { readProfiles } from "@/lib/chimi/identity";
import { emptyHouses, houseMessage, type HouseAction, type HousesState } from "@/lib/chimi/house-rules";
import { summarize, type Points, type PointsFile, type Profile } from "@/lib/chimi/points-rules";
import { useChimi } from "@/components/chimi/provider";

/** A value fetched from the server and shared by every component that reads it, refreshed while any of them is open. */
function shared<T>(load: () => Promise<T>, everyMs: number) {
  let value: { data?: T; error?: string; loading: boolean } = { loading: true };
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let inflight: Promise<void> | undefined;
  const set = (next: typeof value) => {
    value = next;
    for (const l of listeners) l();
  };
  const refresh = () =>
    (inflight ??= load()
      .then((data) => set({ data, loading: false }))
      .catch((e) => set({ ...value, error: e instanceof Error ? e.message : String(e), loading: false }))
      .finally(() => (inflight = undefined)));
  const subscribe = (l: () => void) => {
    listeners.add(l);
    if (listeners.size === 1) {
      void refresh();
      timer = setInterval(() => void refresh(), everyMs);
    }
    return () => {
      listeners.delete(l);
      if (listeners.size === 0) clearInterval(timer);
    };
  };
  const SERVER = { loading: true };
  return {
    use: () => useSyncExternalStore(subscribe, () => value, () => SERVER as typeof value),
    put: (data: T) => set({ data, loading: false }),
    refresh,
  };
}

const points = shared(async (): Promise<Points | null> => {
  const res = await fetch("/api/points");
  const body = (await res.json().catch(() => null)) as { file?: PointsFile | null; writable?: boolean } | null;
  if (!res.ok) throw new Error("Points are unavailable right now.");
  if (!body?.file && body?.writable === false) throw new Error("Points aren’t switched on yet. They need the site’s database.");
  return body?.file ? summarize(body.file) : null;
}, 60_000);

type HousesResponse = { state: HousesState; writable: boolean };

const houses = shared(async (): Promise<HousesResponse> => {
  const res = await fetch("/api/houses");
  const body = (await res.json().catch(() => null)) as HousesResponse | null;
  if (!res.ok || !body?.state) return { state: emptyHouses(), writable: false };
  return body;
}, 30_000);

/** The season's points; `data` is null until the server has read the chain once. */
export const usePoints = points.use;

export const useHouses = houses.use;

/**
 * Up.id names and Dojangs for these wallets. The points book already carries them for traders; anyone else (a house
 * member who hasn't traded, the connected wallet) is read from GIWA here.
 */
export function useProfiles(wallets: string[], known?: Record<string, Profile>) {
  const key = [...new Set(wallets.map((w) => w.toLowerCase()))].sort().join(",");
  const [read, setRead] = useState<Record<string, Profile>>({});
  useEffect(() => {
    const missing = key ? key.split(",").filter((w) => !known?.[w] && !read[w]) : [];
    if (missing.length === 0) return;
    let cancel = false;
    void readProfiles(publicClient, missing)
      .then((got) => !cancel && setRead((r) => ({ ...r, ...got })))
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
    // `read` is left out on purpose: it only grows, and including it would read again after every answer.
  }, [key, known]);
  return { ...read, ...known };
}

/** The connected wallet's own profile, read fresh (it may have just got a Dojang). */
export function useMyProfile() {
  const { account } = useChimi();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [checking, setChecking] = useState(false);
  const check = useCallback(async () => {
    if (!account) return;
    setChecking(true);
    try {
      const got = await readProfiles(publicClient, [account]);
      setProfile(got[account.toLowerCase()] ?? null);
    } finally {
      setChecking(false);
    }
  }, [account]);
  useEffect(() => {
    setProfile(null);
    void check().catch(() => undefined);
  }, [check]);
  return { profile, checking, check };
}

/** Signs one house action with the connected wallet (connecting first if needed) and sends it. */
export function useHouseAction() {
  const { account, connect, signMessage } = useChimi();
  const [pending, setPending] = useState<HouseAction["type"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (action: HouseAction) => {
      setPending(action.type);
      setError(null);
      try {
        const time = Date.now();
        let who: string | undefined;
        let signature: string;
        try {
          who = account ?? (await connect())?.who;
          if (!who) throw new Error("Connect a wallet first.");
          signature = await signMessage(houseMessage(action, who, time));
        } catch (e) {
          const text = e instanceof Error ? `${e.name} ${e.message}` : String(e);
          if (/reject|denied|cancel/i.test(text)) throw new Error("You cancelled the signature.");
          throw e instanceof Error && /No wallet|Connect/.test(e.message) ? e : new Error("Your wallet couldn't sign the message.");
        }
        const res = await fetch("/api/houses", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ wallet: who, action, time, signature }),
        });
        const body = (await res.json().catch(() => ({}))) as Partial<HousesResponse> & { error?: string };
        if (!res.ok || !body.state) throw new Error(body.error ?? "Something went wrong. Try again.");
        houses.put(body as HousesResponse);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        setPending(null);
      }
    },
    [account, connect, signMessage],
  );
  return { run, pending, error, clearError: () => setError(null) };
}

export const fmtPoints = (p: number) => (p > 0 && p < 1 ? "<1" : Math.round(p).toLocaleString("en-US"));

export const shortWallet = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`;
