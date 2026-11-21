/**
 * Where the mainnet waitlist lives. In the project's Upstash Redis it is one sorted set, wallet → the time it joined,
 * so a join is one small write however long the list grows, and the count and a wallet's place are single reads
 * (ZADD NX keeps the first time a wallet joined). In `vite dev` without Redis a file in the system temp folder stands
 * in; in production without Redis the waitlist reads as empty and closed.
 */
import { docStore } from "@/server/store";
import { kv, kvReady } from "@/server/kv";
import type { WaitlistEntry } from "@/lib/chimi/waitlist-rules";

const KEY = "chimi:waitlist:v1";

export interface Waitlist {
  readonly open: boolean;
  count(): Promise<number>;
  entry(wallet: string): Promise<WaitlistEntry | null>;
  /** Adds the wallet if it isn't on the list yet; either way answers with its place. */
  join(wallet: string, at: number): Promise<{ entry: WaitlistEntry; added: boolean }>;
  /** Everyone in order, for the read-out at mainnet. */
  all(): Promise<{ wallet: string; at: number }[]>;
}

class RedisWaitlist implements Waitlist {
  readonly open = true;

  count() {
    return kv<number>("ZCARD", KEY);
  }

  async entry(wallet: string) {
    const [rank, score] = await Promise.all([kv<number | null>("ZRANK", KEY, wallet), kv<string | null>("ZSCORE", KEY, wallet)]);
    return rank === null || score === null ? null : { position: rank + 1, at: Number(score) };
  }

  async join(wallet: string, at: number) {
    const added = (await kv<number>("ZADD", KEY, "NX", at, wallet)) === 1;
    const entry = await this.entry(wallet);
    if (!entry) throw new Error("waitlist write didn't stick");
    return { entry, added };
  }

  async all() {
    // WITHSCORES answers member, score, member, score…
    const flat = await kv<string[]>("ZRANGE", KEY, 0, -1, "WITHSCORES");
    const out: { wallet: string; at: number }[] = [];
    for (let i = 0; i + 1 < flat.length; i += 2) out.push({ wallet: flat[i]!, at: Number(flat[i + 1]) });
    return out;
  }
}

type FileList = { entries: [wallet: string, at: number][] };

/** `vite dev` without Redis: the list as one small JSON file. */
class FileWaitlist implements Waitlist {
  readonly open = true;
  private readonly store = docStore<FileList>(KEY);

  private async list() {
    return (await this.store.load()).doc?.entries ?? [];
  }

  async count() {
    return (await this.list()).length;
  }

  async entry(wallet: string) {
    const list = await this.list();
    const i = list.findIndex(([w]) => w === wallet);
    return i < 0 ? null : { position: i + 1, at: list[i]![1] };
  }

  async join(wallet: string, at: number) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { doc, rev } = await this.store.load();
      const entries = doc?.entries ?? [];
      const i = entries.findIndex(([w]) => w === wallet);
      if (i >= 0) return { entry: { position: i + 1, at: entries[i]![1] }, added: false };
      if (await this.store.save({ entries: [...entries, [wallet, at]] }, rev)) return { entry: { position: entries.length + 1, at }, added: true };
    }
    throw new Error("waitlist busy");
  }

  async all() {
    return (await this.list()).map(([wallet, at]) => ({ wallet, at }));
  }
}

class ClosedWaitlist implements Waitlist {
  readonly open = false;
  async count() {
    return 0;
  }
  async entry() {
    return null;
  }
  async join(): Promise<never> {
    throw new Error("The waitlist isn't open on this deployment.");
  }
  async all() {
    return [];
  }
}

export function waitlist(): Waitlist {
  if (kvReady()) return new RedisWaitlist();
  if (import.meta.env.DEV) return new FileWaitlist();
  return new ClosedWaitlist();
}
