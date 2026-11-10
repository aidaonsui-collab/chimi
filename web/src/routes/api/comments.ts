/**
 * GET /api/comments?token=0x…[&limit=50]: a coin's comments, newest first (public).
 * POST /api/comments: one signed action, { token, wallet, action, time, signature } (rules in lib/chimi/comment-rules.ts).
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
  checkText,
  cleanText,
  commentMessage,
  emptyComments,
  removeComment,
  type CommentAction,
  type CommentsDoc,
  type CommentsView,
} from "@/lib/chimi/comment-rules";
import { readProfiles } from "@/lib/chimi/identity";
import { everBought } from "@/server/ledger";
import { giwa } from "@/server/points";
import { docStore, json, rateLimited } from "@/server/store";

const PAGE = 50;

const store = (token: string) => docStore<CommentsDoc>(`chimi:comments:v1:${token.toLowerCase()}`);

const pageSize = (asked: unknown) => Math.min(MAX_KEPT, Math.max(1, Math.floor(Number(asked)) || PAGE));

/** One page of a coin's comments, as the page shows them. */
async function view(doc: CommentsDoc | null, token: string, limit: number, writable: boolean): Promise<CommentsView> {
  const all = doc?.items ?? [];
  const items = all.slice(-limit).reverse();
  // The trade record is a nicety here ("sold" beside a name); the comments still show without it.
  const bought = await everBought(
    token,
    items.map((c) => c.wallet),
  ).catch(() => []);
  return { token: token.toLowerCase(), items, total: all.length, bought, writable };
}

export const Route = createFileRoute("/api/comments")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("token") ?? "";
        if (!isAddress(token, { strict: false })) return json({ error: "invalid token" }, 400);
        try {
          const s = store(token);
          const { doc } = await s.load();
          return json(await view(doc, token, pageSize(url.searchParams.get("limit")), s.writable), 200, {
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

type Body = { token?: unknown; wallet?: unknown; action?: unknown; time?: unknown; signature?: unknown; limit?: unknown; admin?: unknown; id?: unknown };

function asAction(a: unknown): CommentAction | null {
  if (!a || typeof a !== "object") return null;
  const o = a as Record<string, unknown>;
  // The text is cut to its real limit by the rules; this only stops a huge body from being signed for and stored.
  if (o.type === "post" && typeof o.text === "string" && o.text.length <= 4_000) return { type: "post", text: o.text };
  if (o.type === "delete" && typeof o.id === "string" && o.id.length <= 40) return { type: "delete", id: o.id };
  return null;
}

/** True when the factory made this coin: comments are only kept for coins on Chimi. */
async function onChimi(token: string): Promise<boolean> {
  try {
    const pool = await giwa().readContract({ address: deployment.factory as Address, abi: factoryAbi, functionName: "getPool", args: [token as Address] });
    return !!pool.creator && !/^0x0{40}$/i.test(pool.creator);
  } catch {
    return false;
  }
}

async function post(request: Request) {
  if (await rateLimited(request, "comments", 20, 60)) return json({ error: "Too many comments. Try again in a minute." }, 429, { "retry-after": "60" });
  const body = (await request.json().catch(() => null)) as Body | null;
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
  if (typeof body.wallet !== "string" || !isAddress(body.wallet, { strict: false }) || !action || typeof body.time !== "number") {
    return json({ error: "invalid request" }, 400);
  }
  if (typeof body.signature !== "string" || !isHex(body.signature)) return json({ error: "invalid signature" }, 400);
  const wallet = body.wallet.toLowerCase();
  const time = body.time;
  if (Math.abs(Date.now() - time) > SIGNATURE_TTL_MS) return json({ error: "That signature has expired. Try again." }, 401);
  const signer = await recoverMessageAddress({ message: commentMessage(action, token, wallet, time), signature: body.signature }).catch(() => null);
  if (signer?.toLowerCase() !== wallet) return json({ error: "The signature doesn't match the wallet." }, 401);

  // Only posting needs a Dojang and a real coin, both checked on the chain at the moment of the comment.
  let verified = false;
  if (action.type === "post") {
    const problem = checkText(cleanText(action.text));
    if (problem) return json({ error: problem }, 400);
    try {
      const [profiles, listed] = await Promise.all([readProfiles(giwa(), [wallet]), onChimi(token)]);
      if (!listed) return json({ error: "That coin isn't on Chimi." }, 404);
      verified = profiles[wallet]?.verified ?? false;
    } catch {
      return json({ error: "Couldn't reach GIWA to check your Dojang. Try again." }, 503);
    }
  }

  // Reads, applies and writes back, again if another comment landed in between.
  for (let attempt = 0; attempt < 4; attempt++) {
    const { doc, rev } = await s.load();
    const current = doc ?? emptyComments(token);
    // A wallet's actions must come in time order, so a signature can't be replayed.
    if ((current.lastAction[wallet] ?? 0) >= time) return json({ error: "That signature was already used." }, 409);
    const out = applyComment(current, wallet, action, Date.now(), { verified });
    if ("error" in out) return json({ error: out.error }, out.status);
    out.doc.lastAction[wallet] = time;
    if (await s.save(out.doc, rev)) return json(await view(out.doc, token, limit, true));
  }
  return json({ error: "Busy. Try again." }, 503);
}
