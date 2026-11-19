/**
 * Live streams linked to coins (rules in lib/chimi/stream-rules.ts).
 *
 * GET /api/streams: every linked coin with its channel and whether it's live now (public, cached a few seconds).
 * GET /api/streams?check=<link>: what a pasted link points at and whether it's live, for the creator's form.
 * POST /api/streams: { token, wallet, action, time, signature }, signed by the wallet that launched the coin.
 *   `action` is { type: "set", link } or { type: "remove" }.
 *
 * The links live in one document in the project's Upstash Redis. Whether a channel is live is asked of YouTube or
 * SOOP and kept for STATUS_TTL_MS per server. CHIMI_ADMIN_TOKEN lets the operator take a link down with that bearer
 * token: POST { admin: "remove", token }.
 */
import { isAddress, isHex, type Address } from "viem";
import deployment from "../../public/deployments.json";
import { factoryAbi } from "@/lib/chimi/chain";
import {
  STATUS_TTL_MS,
  STREAM_SIGNATURE_TTL_MS,
  applyStream,
  emptyStreams,
  isStreamLink,
  linkUrl,
  parseStreamLink,
  platformName,
  readSoopStation,
  readYouTubePage,
  statusUrl,
  streamMessage,
  type StreamAction,
  type StreamLink,
  type StreamStatus,
  type StreamView,
  type StreamsDoc,
} from "@/lib/chimi/stream-rules";
import { giwa } from "@/server/points";
import { docStore, json, rateLimited } from "@/server/store";

const store = () => docStore<StreamsDoc>("chimi:streams:v1");

const HEADERS = {
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
  "accept-language": "en-US,en;q=0.8,ko;q=0.6",
  // Skips YouTube's cookie-consent page where a region would show one.
  cookie: "SOCS=CAI",
};
/** How many channels are asked about at once. */
const AT_ONCE = 8;

const keyOf = (link: StreamLink) => `${link.platform}:${link.kind}:${link.ref}`;

/** null: no such channel or video. Throws when the site couldn't be asked. */
async function askSite(link: StreamLink): Promise<StreamStatus | null> {
  const res = await fetch(statusUrl(link), { headers: HEADERS, signal: AbortSignal.timeout(6_000) });
  if (link.platform === "soop") {
    // SOOP answers an unknown streamer with an error code in the body, not a 404.
    const body = await res.json().catch(() => null);
    const status = readSoopStation(body, Date.now());
    if (status || (body && typeof body === "object" && "code" in body)) return status;
    throw new Error(`SOOP answered ${res.status}`);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`YouTube answered ${res.status}`);
  return readYouTubePage(await res.text(), Date.now());
}

type Seen = { status: StreamStatus | null; at: number; job?: Promise<StreamStatus | null> };
const seen = new Map<string, Seen>();

/**
 * Whether the channel is live, asking the site at most once per STATUS_TTL_MS. When the site can't be reached the
 * last answer stands, or "not live" when there was none.
 */
async function statusOf(link: StreamLink, fresh = false): Promise<StreamStatus | null> {
  const key = keyOf(link);
  const had = seen.get(key);
  if (had?.job) return had.job;
  if (had && !fresh && Date.now() - had.at < STATUS_TTL_MS) return had.status;
  const job = askSite(link).then(
    (status) => {
      seen.set(key, { status, at: Date.now() });
      return status;
    },
    (e) => {
      console.error("[streams]", key, e instanceof Error ? e.message : e);
      const fallback = had?.status ?? { live: false, embeddable: false, checkedAt: Date.now() };
      seen.set(key, { status: fallback, at: Date.now() });
      return fallback;
    },
  );
  seen.set(key, { status: had?.status ?? null, at: had?.at ?? 0, job });
  return job;
}

const offline = (): StreamStatus => ({ live: false, embeddable: false, checkedAt: Date.now() });

const viewOf = (token: string, link: StreamLink, status: StreamStatus | null): StreamView => ({ token, link, url: linkUrl(link), status: status ?? offline() });

async function allStreams(doc: StreamsDoc | null): Promise<Record<string, StreamView>> {
  const entries = Object.entries(doc?.links ?? {}).filter(([, v]) => isStreamLink(v.link));
  const out: Record<string, StreamView> = {};
  for (let i = 0; i < entries.length; i += AT_ONCE) {
    await Promise.all(
      entries.slice(i, i + AT_ONCE).map(async ([token, { link }]) => {
        out[token] = viewOf(token, link, await statusOf(link));
      }),
    );
  }
  return out;
}

export async function getStreams(request: Request) {
  const url = new URL(request.url);
  const check = url.searchParams.get("check");
  if (check !== null) {
    if (await rateLimited(request, "stream-check", 30, 60)) return json({ error: "Too many checks. Try again in a minute." }, 429, { "retry-after": "60" });
    const link = parseStreamLink(check);
    if ("error" in link) return json({ error: link.error }, 400);
    const status = await statusOf(link, true);
    if (!status) return json({ error: `Couldn't find that ${link.kind} on ${platformName(link.platform)}.` }, 404);
    return json({ link, url: linkUrl(link), status }, 200, { "cache-control": "no-store" });
  }
  try {
    const { doc } = await store().load();
    // Browsers always ask the CDN (max-age=0), so a creator who just linked a stream sees it after a reload.
    return json({ streams: await allStreams(doc) }, 200, { "cache-control": "public, max-age=0, s-maxage=15, stale-while-revalidate=30" });
  } catch (e) {
    console.error("[streams]", e instanceof Error ? e.message : e);
    return json({ error: "streams unavailable" }, 503);
  }
}

type Body = { token?: unknown; wallet?: unknown; action?: unknown; time?: unknown; signature?: unknown; admin?: unknown };

function asAction(a: unknown): StreamAction | null {
  if (!a || typeof a !== "object") return null;
  const o = a as Record<string, unknown>;
  if (o.type === "set" && isStreamLink(o.link)) return { type: "set", link: { platform: o.link.platform, kind: o.link.kind, ref: o.link.ref } };
  if (o.type === "remove") return { type: "remove" };
  return null;
}

/** The wallet that launched this coin on Chimi, or null when the factory didn't make it. */
async function creatorOf(token: string): Promise<string | null> {
  const pool = await giwa().readContract({ address: deployment.factory as Address, abi: factoryAbi, functionName: "getPool", args: [token as Address] });
  return pool.creator && !/^0x0{40}$/i.test(pool.creator) ? pool.creator.toLowerCase() : null;
}

/** Writes the change, again if another one landed in between. */
async function write(change: (doc: StreamsDoc) => StreamsDoc | { error: string; status: number }) {
  const s = store();
  for (let attempt = 0; attempt < 4; attempt++) {
    const { doc, rev } = await s.load();
    const next = change(doc ?? emptyStreams());
    if ("error" in next) return next;
    if (await s.save(next, rev)) return next;
  }
  return { error: "Busy. Try again.", status: 503 };
}

export async function postStreams(request: Request) {
  if (await rateLimited(request, "streams", 10, 60)) return json({ error: "Too many changes. Try again in a minute." }, 429, { "retry-after": "60" });
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body || typeof body.token !== "string" || !isAddress(body.token, { strict: false })) return json({ error: "invalid request" }, 400);
  const token = body.token.toLowerCase();
  if (!store().writable) return json({ error: "Streams aren't switched on yet." }, 503);

  // Operator: take a link down.
  if (body.admin !== undefined) {
    const secret = process.env.CHIMI_ADMIN_TOKEN;
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return json({ error: "forbidden" }, 403);
    if (body.admin !== "remove") return json({ error: "invalid request" }, 400);
    const out = await write((doc) => applyStream(doc, token, "operator", { type: "remove" }, Date.now()));
    return "error" in out ? json({ error: out.error }, out.status) : json({ stream: null });
  }

  const action = asAction(body.action);
  if (typeof body.wallet !== "string" || !isAddress(body.wallet, { strict: false }) || !action) return json({ error: "invalid request" }, 400);
  if (typeof body.time !== "number" || typeof body.signature !== "string" || !isHex(body.signature)) return json({ error: "invalid signature" }, 400);
  const wallet = body.wallet.toLowerCase();
  const time = body.time;
  if (Math.abs(Date.now() - time) > STREAM_SIGNATURE_TTL_MS) return json({ error: "That signature has expired. Try again." }, 401);

  let creator: string | null;
  try {
    creator = await creatorOf(token);
  } catch {
    return json({ error: "Couldn't reach GIWA to check the coin. Try again." }, 503);
  }
  if (!creator) return json({ error: "That coin isn't on Chimi." }, 404);
  if (creator !== wallet) return json({ error: "Only the wallet that launched this coin can link its stream." }, 403);
  // verifyMessage also accepts smart-account wallets, which sign differently from a plain key.
  const valid = await giwa()
    .verifyMessage({ address: wallet as Address, message: streamMessage(action, token, wallet, time), signature: body.signature })
    .catch(() => false);
  if (!valid) return json({ error: "The signature doesn't match the wallet." }, 401);

  // A link that leads nowhere is refused now, not discovered by viewers later.
  let status: StreamStatus | null = null;
  if (action.type === "set") {
    status = await statusOf(action.link, true);
    if (!status) return json({ error: `Couldn't find that ${action.link.kind} on ${platformName(action.link.platform)}.` }, 404);
  }

  const out = await write((doc) => {
    // A wallet's signed actions must come in time order, so a signature can't be replayed.
    if ((doc.lastAction[wallet] ?? 0) >= time) return { error: "That signature was already used.", status: 409 };
    const next = applyStream(doc, token, wallet, action, Date.now());
    if (!("error" in next)) next.lastAction[wallet] = time;
    return next;
  });
  if ("error" in out) return json({ error: out.error }, out.status);
  return json({ stream: action.type === "set" ? viewOf(token, action.link, status) : null });
}
