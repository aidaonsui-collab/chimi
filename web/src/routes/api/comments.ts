/**
 * GET /api/comments?token=0x…[&limit=50][&wallet=0x…]: a coin's comments, newest thread first (public). With
 *   `wallet`, the answer also says which of them that wallet likes.
 * GET /api/comments?recent=20&tokens=0x…,0x…[&wallet=0x…]: the newest comments across those coins, for the home
 *   feed (public).
 * POST /api/comments: one action (rules in lib/chimi/comment-rules.ts). Writing, answering and deleting are signed
 *   one by one: { token, wallet, action, time, signature }. Liking rides on a pass signed once per browser:
 *   { token, wallet, action, pass: { until, signature } }.
 *
 * Needs the project's Upstash Redis (KV_REST_API_URL / KV_REST_API_TOKEN) to keep anything. CHIMI_ADMIN_TOKEN lets the
 * operator take a comment out with that bearer token: POST { admin: "delete", token, id }.
 */
import { createFileRoute } from "@tanstack/react-router";
import { isAddress, isHex, recoverMessageAddress, type Address } from "viem";
import deployment from "../../../public/deployments.json";
import { factoryAbi } from "@/lib/chimi/chain";
import {
  MAX_KEPT,
  SIGNATURE_TTL_MS,
  applyComment,
  checkPass,
  checkText,
  cleanText,
  commentMessage,
  emptyComments,
  likePassMessage,
  likesOf,
  pageOf,
  removeComment,
  type CommentAction,
  type CommentsDoc,
  type CommentsView,
} from "@/lib/chimi/comment-rules";
import { readProfiles } from "@/lib/chimi/identity";
import { inboxFor } from "@/lib/chimi/inbox-rules";
import { tell } from "@/server/inbox";
import { everBought } from "@/server/ledger";
import { giwa } from "@/server/points";
import { docStore, json, rateLimited } from "@/server/store";

const PAGE = 50;
/** The home feed asks about the coins on the board; past this many it asks for the busiest ones only. */
const MAX_RECENT_TOKENS = 60;

const store = (token: string) => docStore<CommentsDoc>(`chimi:comments:v1:${token.toLowerCase()}`);

const pageSize = (asked: unknown) => Math.min(MAX_KEPT, Math.max(1, Math.floor(Number(asked)) || PAGE));

/** One page of a coin's comments, as the page shows them. `wallet` is who is asking, when they said. */
async function view(doc: CommentsDoc | null, token: string, limit: number, writable: boolean, wallet?: string): Promise<CommentsView> {
  const { items, threads } = pageOf(doc, limit);
  // The trade record is a nicety here ("sold" beside a name); the comments still show without it.
  const bought = await everBought(token, [...new Set(items.map((c) => c.wallet))]).catch(() => []);
  return { token: token.toLowerCase(), items, total: doc?.items.length ?? 0, threads, ...likesOf(doc, items.map((c) => c.id), wallet), bought, writable };
}

/** Who is asking, from the address: a wallet, or nobody. */
const asker = (url: URL) => {
  const wallet = url.searchParams.get("wallet") ?? "";
  return isAddress(wallet, { strict: false }) ? wallet.toLowerCase() : undefined;
};

export const Route = createFileRoute("/api/comments")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const recent = url.searchParams.get("recent");
        if (recent !== null) {
          const tokens = [...new Set((url.searchParams.get("tokens") ?? "").split(",").map((t) => t.trim().toLowerCase()))]
            .filter((t) => isAddress(t, { strict: false }))
            .slice(0, MAX_RECENT_TOKENS);
          const limit = Math.min(PAGE, Math.max(1, Math.floor(Number(recent)) || 20));
          try {
            // One coin's comments failing to load shouldn't blank the others.
            const docs = await Promise.all(tokens.map((t) => store(t).load().then((loaded) => loaded.doc, () => null)));
            const who = asker(url);
            const items = docs
              .flatMap((doc, i) =>
                (doc?.items ?? []).slice(-limit).map((comment) => {
                  const by = doc?.likes?.[comment.id] ?? [];
                  const replies = doc!.items.filter((c) => c.replyTo === comment.id).length;
                  return { ...comment, token: tokens[i]!, likes: by.length, liked: !!who && by.includes(who), replies };
                }),
              )
              .sort((a, b) => b.time - a.time)
              .slice(0, limit);
            return json({ items }, 200, { "cache-control": "public, max-age=10, s-maxage=10, stale-while-revalidate=30" });
          } catch (e) {
            console.error("[comments]", e instanceof Error ? e.message : e);
            return json({ error: "comments unavailable" }, 503);
          }
        }
        const token = url.searchParams.get("token") ?? "";
        if (!isAddress(token, { strict: false })) return json({ error: "invalid token" }, 400);
        try {
          const s = store(token);
          const { doc } = await s.load();
          return json(await view(doc, token, pageSize(url.searchParams.get("limit")), s.writable, asker(url)), 200, {
            "cache-control": "public, max-age=5, s-maxage=5, stale-while-revalidate=25",
          });
        } catch (e) {
          console.error("[comments]", e instanceof Error ? e.message : e);
          return json({ error: "comments unavailable" }, 503);
        }
      },
      POST: async ({ request }) => post(request),
    },
  },
});

type Body = { token?: unknown; wallet?: unknown; action?: unknown; time?: unknown; signature?: unknown; pass?: unknown; limit?: unknown; admin?: unknown; id?: unknown };

const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 40;

function asAction(a: unknown): CommentAction | null {
  if (!a || typeof a !== "object") return null;
  const o = a as Record<string, unknown>;
  // The text is cut to its real limit by the rules; this only stops a huge body from being signed for and stored.
  if (o.type === "post" && typeof o.text === "string" && o.text.length <= 4_000 && (o.replyTo === undefined || isId(o.replyTo))) {
    return o.replyTo === undefined ? { type: "post", text: o.text } : { type: "post", text: o.text, replyTo: o.replyTo };
  }
  if ((o.type === "delete" || o.type === "like" || o.type === "unlike") && isId(o.id)) return { type: o.type, id: o.id };
  return null;
}

/** The wallet that launched this coin on Chimi, or null when the factory didn't make it: comments are only kept for coins on Chimi. */
async function creatorOf(token: string): Promise<string | null> {
  try {
    const pool = await giwa().readContract({ address: deployment.factory as Address, abi: factoryAbi, functionName: "getPool", args: [token as Address] });
    return pool.creator && !/^0x0{40}$/i.test(pool.creator) ? pool.creator.toLowerCase() : null;
  } catch {
    return null;
  }
}

async function post(request: Request) {
  const body = (await request.json().catch(() => null)) as Body | null;
  // Likes are counted on their own, looser limit below, so a few of them never use up the room for writing.
  const liking = ["like", "unlike"].includes((body?.action as { type?: unknown } | undefined)?.type as string);
  if (!liking && (await rateLimited(request, "comments", 20, 60))) return json({ error: "Too many comments. Try again in a minute." }, 429, { "retry-after": "60" });
  if (!body || typeof body.token !== "string" || !isAddress(body.token, { strict: false })) return json({ error: "invalid request" }, 400);
  const token = body.token.toLowerCase();
  const s = store(token);
  if (!s.writable) return json({ error: "Comments aren't switched on yet." }, 503);
  const limit = pageSize(body.limit);

  // Operator: take a comment out (a scam, abuse).
  if (body.admin !== undefined) {
    const secret = process.env.CHIMI_ADMIN_TOKEN;
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return json({ error: "forbidden" }, 403);
    if (body.admin !== "delete" || typeof body.id !== "string") return json({ error: "invalid request" }, 400);
    for (let attempt = 0; attempt < 4; attempt++) {
      const { doc, rev } = await s.load();
      const next = doc ? removeComment(doc, body.id) : null;
      if (!next) return json({ error: "no such comment" }, 404);
      if (await s.save(next, rev)) return json(await view(next, token, limit, true));
    }
    return json({ error: "Busy. Try again." }, 503);
  }

  const action = asAction(body.action);
  if (typeof body.wallet !== "string" || !isAddress(body.wallet, { strict: false }) || !action) return json({ error: "invalid request" }, 400);
  const wallet = body.wallet.toLowerCase();

  // A like rides on the browser's pass; everything else is signed for on its own.
  let time = 0;
  if (action.type === "like" || action.type === "unlike") {
    if (await rateLimited(request, "likes", 90, 60)) return json({ error: "Too many likes. Try again in a minute." }, 429, { "retry-after": "60" });
    const pass = body.pass as { until?: unknown; signature?: unknown } | undefined;
    if (!pass || typeof pass.until !== "number" || typeof pass.signature !== "string" || !isHex(pass.signature)) return json({ error: "invalid pass" }, 400);
    const expired = checkPass(pass.until, Date.now());
    if (expired) return json({ error: expired }, 401);
    const signer = await recoverMessageAddress({ message: likePassMessage(wallet, pass.until), signature: pass.signature }).catch(() => null);
    if (signer?.toLowerCase() !== wallet) return json({ error: "The pass doesn't match the wallet." }, 401);
  } else {
    if (typeof body.time !== "number") return json({ error: "invalid request" }, 400);
    if (typeof body.signature !== "string" || !isHex(body.signature)) return json({ error: "invalid signature" }, 400);
    time = body.time;
    if (Math.abs(Date.now() - time) > SIGNATURE_TTL_MS) return json({ error: "That signature has expired. Try again." }, 401);
    const signer = await recoverMessageAddress({ message: commentMessage(action, token, wallet, time), signature: body.signature }).catch(() => null);
    if (signer?.toLowerCase() !== wallet) return json({ error: "The signature doesn't match the wallet." }, 401);
  }

  // Writing and liking need a Dojang, and writing a real coin: both checked on the chain at that moment.
  let verified = false;
  let creator: string | undefined;
  if (action.type === "post" || action.type === "like") {
    if (action.type === "post") {
      const problem = checkText(cleanText(action.text));
      if (problem) return json({ error: problem }, 400);
    }
    try {
      const [profiles, launchedBy] = await Promise.all([readProfiles(giwa(), [wallet]), action.type === "post" ? creatorOf(token) : null]);
      if (action.type === "post" && !launchedBy) return json({ error: "That coin isn't on Chimi." }, 404);
      creator = launchedBy ?? undefined;
      verified = profiles[wallet]?.verified ?? false;
    } catch {
      return json({ error: "Couldn't reach GIWA to check your Dojang. Try again." }, 503);
    }
  }

  // Reads, applies and writes back, again if another comment landed in between.
  for (let attempt = 0; attempt < 4; attempt++) {
    const { doc, rev } = await s.load();
    const current = doc ?? emptyComments(token);
    // A wallet's signed actions must come in time order, so a signature can't be replayed.
    if (time && (current.lastAction[wallet] ?? 0) >= time) return json({ error: "That signature was already used." }, 409);
    const now = Date.now();
    const out = applyComment(current, wallet, action, now, { verified });
    if ("error" in out) return json({ error: out.error }, out.status);
    if (time) out.doc.lastAction[wallet] = time;
    if (await s.save(out.doc, rev)) {
      // Whoever it concerns hears of it in their inbox. A reply to the coin's creator is one note, not two.
      if (out.effect) await tell(inboxFor(out.effect, token, creator, now));
      return json(await view(out.doc, token, limit, true, wallet));
    }
  }
  return json({ error: "Busy. Try again." }, 503);
}
