/**
 * Where the points book and the houses live: JSON documents in the project's Upstash Redis (KV_REST_API_URL /
 * KV_REST_API_TOKEN), each written with a compare-and-set on a revision counter so two writes at once can't overwrite
 * each other. In `vite dev` without Redis, files in the system temp folder stand in. In production without Redis, the
 * documents read as empty and can't change.
 */
import { clientIp } from "@/server/env";
import { kv, kvReady, rateLimited as kvRateLimited } from "@/server/kv";

// Writes the document only if the revision is still the one it was read at.
const CAS = `if (redis.call('GET', KEYS[2]) or '0') ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
redis.call('INCR', KEYS[2])
return 1`;

export type Loaded<T> = { doc: T | null; rev: string };

export interface DocStore<T> {
  readonly writable: boolean;
  load(): Promise<Loaded<T>>;
  /** False when someone else wrote first. */
  save(doc: T, rev: string): Promise<boolean>;
}

class RedisStore<T> implements DocStore<T> {
  readonly writable = true;
  private readonly key: string;
  private readonly rev: string;

  constructor(key: string) {
    this.key = key;
    this.rev = `${key}:rev`;
  }

  async load(): Promise<Loaded<T>> {
    const [doc, rev] = await kv<(string | null)[]>("MGET", this.key, this.rev);
    return { doc: doc ? (JSON.parse(doc) as T) : null, rev: rev ?? "0" };
  }

  async save(doc: T, rev: string) {
    return (await kv<number>("EVAL", CAS, 2, this.key, this.rev, rev, JSON.stringify(doc))) === 1;
  }
}

class FileStore<T> implements DocStore<T> {
  readonly writable = true;
  private readonly key: string;

  constructor(key: string) {
    this.key = key;
  }

  private async path() {
    const [{ tmpdir }, { join }] = await Promise.all([import("node:os"), import("node:path")]);
    return join(process.env.CHIMI_DEV_DIR || tmpdir(), `${this.key.replace(/[^a-z0-9]+/gi, "-")}.json`);
  }

  async load(): Promise<Loaded<T>> {
    const { readFile } = await import("node:fs/promises");
    const text = await readFile(await this.path(), "utf8").catch(() => null);
    return text ? (JSON.parse(text) as Loaded<T>) : { doc: null, rev: "0" };
  }

  async save(doc: T, rev: string) {
    if ((await this.load()).rev !== rev) return false;
    const { writeFile } = await import("node:fs/promises");
    await writeFile(await this.path(), JSON.stringify({ doc, rev: String(Number(rev) + 1) }));
    return true;
  }
}

class NoStore<T> implements DocStore<T> {
  readonly writable = false;
  async load(): Promise<Loaded<T>> {
    return { doc: null, rev: "0" };
  }
  async save() {
    return false;
  }
}

export function docStore<T>(key: string): DocStore<T> {
  if (kvReady()) return new RedisStore<T>(key);
  if (import.meta.env.DEV) return new FileStore<T>(key);
  return new NoStore<T>();
}

const UNLOCK = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0`;

/**
 * Takes a lock that lapses after `ms`, so one request at a time does slow work. Returns its release, or null when
 * another request holds it. Without Redis there's nothing to share, so it's always granted.
 */
export async function takeLock(key: string, ms: number): Promise<(() => Promise<void>) | null> {
  if (!kvReady()) return async () => undefined;
  const id = crypto.randomUUID();
  if ((await kv<string | null>("SET", key, id, "NX", "PX", ms)) !== "OK") return null;
  return async () => {
    await kv("EVAL", UNLOCK, 1, key, id).catch(() => undefined);
  };
}

/** Counts a request from this client toward `limit` per `windowSec`; true once it's over. Never limits without Redis. */
export async function rateLimited(request: Request, name: string, limit: number, windowSec: number) {
  return kvReady() ? kvRateLimited(name, clientIp(request), limit, windowSec) : false;
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}
