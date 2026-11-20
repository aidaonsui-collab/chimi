/**
 * Posts on X about Chimi coins (rules in lib/chimi/x-rules.ts), found through twitterapi.io.
 *
 * GET /api/x: the newest posts about any coin, for the feed. GET /api/x?token=<address>: one coin's, for its page.
 * Both answer from one document in Redis. When it is older than REFRESH_MS, the request that finds it so (one at a
 * time, behind a lock) first asks twitterapi.io for the posts since the last look. Vercel's CDN keeps an answer a
 * minute and hands it out stale while it asks again (CACHE), so a visitor rarely waits on X, and nobody visiting means
 * no searches.
 *
 * Each look runs a few searches: posts from the coins' own X accounts (what the creator typed on the coin page), and
 * posts linking to a coin's page on Chimi or naming its contract address. twitterapi.io charges 15 credits ($0.00015)
 * a search even when it finds nothing, and 15 a post found.
 *
 * Env: TWITTERAPI_IO_KEY (without it the feed simply has no X posts), TWITTERAPI_IO_BASE (a stand-in server for
 * tests), CHIMI_ADMIN_TOKEN (the operator can take a post or an account down: POST { admin: "hide", id } or
 * { admin: "hide", handle }, and put it back with "show"). In `vite dev` without Redis, CHIMI_X_DEV_HANDLES
 * ("0xtoken=handle,…") stands in for the handles creators typed.
 */
import { isAddress, type Address } from "viem";
import deployment from "../../public/deployments.json";
import { factoryAbi } from "@/lib/chimi/chain";
import { coinIndex, hiddenEntry, mergePosts, newHandles, readTweet, xHandleOf, xSearches, xTime, type RawTweet, type XDoc, type XPost } from "@/lib/chimi/x-rules";
import { env } from "@/server/env";
import { kvMGetJson, kvReady } from "@/server/kv";
import { giwa } from "@/server/points";
import { docStore, json, takeLock } from "@/server/store";

const store = () => docStore<XDoc>("chimi:x:v1");

/** How often X is asked, at most. */
const REFRESH_MS = 3 * 60_000;
/**
 * The first look reaches back this far, as does the first search of an account just linked to a coin. A look after a
 * long quiet spell reaches back this far at most.
 */
const FIRST_LOOK_S = 2 * 24 * 60 * 60;
/** Each look starts a little before the last one ended, so a post X indexes late isn't missed. */
const OVERLAP_S = 120;
/** Pages of 20 posts read per search, at most. */
const MAX_PAGES = 3;
/** The newest coins whose contract address is searched for. Links to Chimi are searched for every coin in one go. */
const ADDRESS_COINS = 50;
/** A look stops starting searches after this long. */
const LOOK_BUDGET_MS = 40_000;
/** How many posts an answer carries: for the feed, and for one coin. */
const FEED_POSTS = 80;
const COIN_POSTS = 30;

/**
 * Vercel's CDN keeps an answer a minute and may hand it out up to ten minutes stale while it asks again. Browsers
 * never reuse one without asking: a browser honours stale-while-revalidate too, and would show an old list first.
 */
const CACHE = { "cache-control": "public, max-age=0, must-revalidate", "vercel-cdn-cache-control": "max-age=60, stale-while-revalidate=600" };

class OutOfCredits extends Error {}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Every coin on the factory, oldest first, with the X handle its creator typed. */
async function chimiCoins(): Promise<{ token: string; handle?: string }[]> {
  const client = giwa();
  const factory = deployment.factory as Address;
  const length = Number(await client.readContract({ address: factory, abi: factoryAbi, functionName: "allTokensLength" }));
  if (length === 0) return [];
  const tokens = (
    await client.multicall({
      allowFailure: false,
      contracts: Array.from({ length }, (_, i) => ({ address: factory, abi: factoryAbi, functionName: "allTokens", args: [BigInt(i)] }) as const),
    })
  ).map((t) => t.toLowerCase());
  const handles = await coinHandles(tokens);
  return tokens.map((token, i) => ({ token, handle: handles[i] }));
}

/** The X handle on each coin's profile (server/token-meta.ts keeps them), in the order given. */
async function coinHandles(tokens: string[]): Promise<(string | undefined)[]> {
  if (!kvReady()) {
    const dev = new Map(
      (env("CHIMI_X_DEV_HANDLES") ?? "")
        .split(",")
        .map((pair) => pair.split("=").map((s) => s.trim()))
        .filter((pair): pair is [string, string] => pair.length === 2 && isAddress(pair[0]!, { strict: false }))
        .map(([token, handle]) => [token.toLowerCase(), handle]),
    );
    return tokens.map((t) => xHandleOf(dev.get(t)));
  }
  const out: (string | undefined)[] = [];
  for (let i = 0; i < tokens.length; i += 100) {
    const records = await kvMGetJson<{ twitter?: string }>(tokens.slice(i, i + 100).map((t) => `chimi:token:meta:${t}`));
    out.push(...records.map((r) => xHandleOf(r?.twitter)));
  }
  return out;
}

type Page = { tweets?: unknown; has_next_page?: unknown; next_cursor?: unknown };

/** One search, newest first, reading pages until they reach back to `since`. */
async function search(query: string, since: number, key: string): Promise<RawTweet[]> {
  const base = (env("TWITTERAPI_IO_BASE") ?? "https://api.twitterapi.io").replace(/\/+$/, "");
  const out: RawTweet[] = [];
  let cursor = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${base}/twitter/tweet/advanced_search?${new URLSearchParams({ query, queryType: "Latest", cursor })}`;
    const ask = () => fetch(url, { headers: { "x-api-key": key }, signal: AbortSignal.timeout(12_000) });
    let res = await ask();
    // A key that has never been topped up may ask once every five seconds.
    if (res.status === 429) {
      await sleep(5_500);
      res = await ask();
    }
    if (res.status === 402) throw new OutOfCredits("twitterapi.io is out of credits");
    if (!res.ok) throw new Error(`twitterapi.io answered ${res.status}`);
    const body = (await res.json().catch(() => ({}))) as Page;
    const tweets = Array.isArray(body.tweets) ? (body.tweets as RawTweet[]) : [];
    out.push(...tweets);
    const oldest = Math.min(...tweets.map((t) => xTime(t.createdAt) ?? Number.POSITIVE_INFINITY));
    if (body.has_next_page !== true || typeof body.next_cursor !== "string" || !body.next_cursor || tweets.length === 0 || oldest <= since) break;
    cursor = body.next_cursor;
  }
  return out;
}

/** One look at X: every search since the last look, merged into what was kept. */
async function look(prev: XDoc | null, key: string): Promise<XDoc> {
  const started = Date.now();
  const now = Math.floor(started / 1000);
  const coins = await chimiCoins();
  const index = coinIndex(coins);
  const since = Math.max(prev?.through ? prev.through - OVERLAP_S : 0, now - FIRST_LOOK_S);
  const handles = [...new Set(coins.flatMap((c) => (c.handle ? [c.handle.toLowerCase()] : [])))];
  const queries = xSearches({
    handles,
    newHandles: newHandles(handles, prev?.handles),
    newSince: now - FIRST_LOOK_S,
    tokens: coins.slice(-ADDRESS_COINS).map((c) => c.token),
    since,
  });
  const found: XPost[] = [];
  let complete = true;
  for (const query of queries) {
    if (Date.now() - started > LOOK_BUDGET_MS) {
      complete = false;
      break;
    }
    try {
      for (const raw of await search(query, since, key)) found.push(...readTweet(raw, index));
    } catch (err) {
      complete = false;
      console.warn("[x] search failed:", err instanceof Error ? err.message : err, JSON.stringify(query.slice(0, 80)));
      if (err instanceof OutOfCredits) break;
    }
  }
  const hidden = prev?.hidden ?? [];
  return {
    v: 1,
    // A look that didn't finish leaves its window to be asked again next time.
    through: complete ? now : (prev?.through ?? since),
    ranAt: Date.now(),
    posts: mergePosts(prev?.posts ?? [], found, now, hidden),
    hidden,
    // An account counts as searched once a look that included it finished; until then it's new again next time.
    handles: complete ? handles : (prev?.handles ?? []),
  };
}

/** The kept posts, after a fresh look when they are due one and no other request is already looking. */
async function current(key: string | undefined): Promise<XDoc | null> {
  const first = await store().load();
  if (!key || (first.doc && Date.now() - first.doc.ranAt < REFRESH_MS)) return first.doc;
  const release = await takeLock("chimi:x:lock", 60_000).catch(() => null);
  if (!release) return first.doc;
  try {
    // Someone may have looked between the read above and taking the lock.
    const loaded = await store().load();
    if (loaded.doc && Date.now() - loaded.doc.ranAt < REFRESH_MS) return loaded.doc;
    const next = await look(loaded.doc, key);
    // If the operator took something down meanwhile, this look is dropped; the next request looks again.
    return (await store().save(next, loaded.rev)) ? next : loaded.doc;
  } catch (err) {
    console.warn("[x] look failed:", err instanceof Error ? err.message : err);
    return first.doc;
  } finally {
    await release();
  }
}

export async function getX(request: Request) {
  const param = new URL(request.url).searchParams.get("token");
  const token = param && isAddress(param, { strict: false }) ? param.toLowerCase() : undefined;
  const key = env("TWITTERAPI_IO_KEY");
  let doc: XDoc | null = null;
  try {
    doc = await current(key);
  } catch (err) {
    console.warn("[x] read failed:", err instanceof Error ? err.message : err);
  }
  const posts = (doc?.posts ?? []).filter((p) => !token || p.token === token).slice(0, token ? COIN_POSTS : FEED_POSTS);
  return json({ enabled: Boolean(key), posts }, 200, CACHE);
}

/** Operator only: take a post or an account down, or put it back. */
export async function postX(request: Request) {
  const secret = env("CHIMI_ADMIN_TOKEN");
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return json({ error: "forbidden" }, 403);
  const body = (await request.json().catch(() => null)) as { admin?: unknown; id?: unknown; handle?: unknown } | null;
  const entry = body ? hiddenEntry(body) : undefined;
  if (!entry || (body?.admin !== "hide" && body?.admin !== "show")) return json({ error: "invalid request" }, 400);
  if (!store().writable) return json({ error: "X posts aren't switched on yet." }, 503);
  for (let attempt = 0; attempt < 5; attempt++) {
    const { doc, rev } = await store().load();
    const base: XDoc = doc ?? { v: 1, through: 0, ranAt: 0, posts: [], hidden: [] };
    const hidden = body.admin === "hide" ? [...new Set([...base.hidden, entry])] : base.hidden.filter((h) => h !== entry);
    const next: XDoc = { ...base, hidden, posts: mergePosts(base.posts, [], Math.floor(Date.now() / 1000), hidden) };
    if (await store().save(next, rev)) return json({ hidden });
  }
  return json({ error: "Busy. Try again." }, 503);
}
