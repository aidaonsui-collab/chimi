import { useCallback, useEffect, useState } from "react";
import { waitlistMessage, type WaitlistStatus } from "@/lib/chimi/waitlist-rules";
import { useChimi } from "@/components/chimi/provider";

/** How often an open page reads the count again. */
const EVERY_MS = 30_000;

async function read(wallet?: string): Promise<WaitlistStatus> {
  const res = await fetch(`/api/waitlist${wallet ? `?wallet=${wallet.toLowerCase()}` : ""}`);
  if (!res.ok) throw new Error(`waitlist ${res.status}`);
  return (await res.json()) as WaitlistStatus;
}

/**
 * The mainnet waitlist as a page sees it: the count, the connected wallet's place, and joining (one signature, no
 * gas). `status` is null until the first read.
 */
export function useWaitlist() {
  const { account, connect, signMessage } = useChimi();
  const [status, setStatus] = useState<WaitlistStatus | null>(null);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    const load = () => {
      if (document.visibilityState !== "visible") return;
      read(account)
        .then((s) => !off && setStatus(s))
        .catch(() => undefined);
    };
    load();
    const timer = setInterval(load, EVERY_MS);
    return () => {
      off = true;
      clearInterval(timer);
    };
  }, [account]);

  const join = useCallback(async () => {
    setJoining(true);
    setError(null);
    try {
      const time = Date.now();
      let who: string | undefined;
      let signature: string;
      try {
        who = account ?? (await connect())?.who;
        if (!who) throw new Error("Connect a wallet first.");
        // Already on it: show the place, no signature needed.
        const now = await read(who);
        if (now.entry) {
          setStatus(now);
          return true;
        }
        signature = await signMessage(waitlistMessage(who, time));
      } catch (e) {
        const text = e instanceof Error ? `${e.name} ${e.message}` : String(e);
        if (/reject|denied|cancel/i.test(text)) throw new Error("You cancelled the signature.");
        throw e instanceof Error && /No wallet|Connect/.test(e.message) ? e : new Error("Your wallet couldn't sign the message.");
      }
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: who, time, signature }),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<WaitlistStatus> & { error?: string };
      if (!res.ok || !body.entry) throw new Error(body.error ?? "Something went wrong. Try again.");
      setStatus(body as WaitlistStatus);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setJoining(false);
    }
  }, [account, connect, signMessage]);

  return { status, joining, error, join, account };
}

/** A wallet's place on the waitlist, for its profile; null when it hasn't joined or while unknown. */
export function useWaitlistPlace(wallet: string | undefined) {
  const [position, setPosition] = useState<number | null>(null);
  useEffect(() => {
    setPosition(null);
    if (!wallet) return;
    let off = false;
    read(wallet)
      .then((s) => !off && setPosition(s.entry?.position ?? null))
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [wallet]);
  return position;
}

/** How many wallets are on the waitlist, for the home banner; null until read. */
export function useWaitlistCount() {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let off = false;
    read()
      .then((s) => !off && setCount(s.open ? s.count : null))
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, []);
  return count;
}
