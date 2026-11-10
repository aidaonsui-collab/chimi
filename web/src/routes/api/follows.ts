/**
 * GET /api/follows: who follows whom (public; the pages count followers themselves).
 * POST /api/follows: one signed change, { wallet, action, time, signature } (rules in lib/chimi/follow-rules.ts).
 *
 * Needs the project's Upstash Redis (KV_REST_API_URL / KV_REST_API_TOKEN) to change anything.
 */
import { createFileRoute } from "@tanstack/react-router";
import { isAddress, isHex, recoverMessageAddress } from "viem";
import { SIGNATURE_TTL_MS, applyFollow, emptyFollows, followMessage, type FollowAction, type FollowsState } from "@/lib/chimi/follow-rules";
import { readProfiles } from "@/lib/chimi/identity";
import { giwa } from "@/server/points";
import { docStore, json, rateLimited } from "@/server/store";

const store = () => docStore<FollowsState>("chimi:follows:v1");

export const Route = createFileRoute("/api/follows")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const s = store();
          const { doc } = await s.load();
          return json({ state: doc ?? emptyFollows(), writable: s.writable }, 200, { "cache-control": "public, max-age=5" });
        } catch (e) {
          console.error("[follows]", e instanceof Error ? e.message : e);
          return json({ error: "follows unavailable" }, 503);
        }
      },
      POST: async ({ request }) => post(request),
    },
  },
});

type Body = { wallet?: unknown; action?: unknown; time?: unknown; signature?: unknown };

function asAction(a: unknown): FollowAction | null {
  if (!a || typeof a !== "object") return null;
  const o = a as Record<string, unknown>;
  if ((o.type !== "follow" && o.type !== "unfollow") || typeof o.wallet !== "string" || !isAddress(o.wallet, { strict: false })) return null;
  return { type: o.type, wallet: o.wallet.toLowerCase() };
}

async function post(request: Request) {
  if (await rateLimited(request, "follows", 40, 60)) return json({ error: "Too many changes. Try again in a minute." }, 429, { "retry-after": "60" });
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body) return json({ error: "invalid request" }, 400);
  const s = store();
  if (!s.writable) return json({ error: "Following isn't switched on yet." }, 503);

  const action = asAction(body.action);
  if (typeof body.wallet !== "string" || !isAddress(body.wallet, { strict: false }) || !action || typeof body.time !== "number") {
    return json({ error: "invalid request" }, 400);
  }
  if (typeof body.signature !== "string" || !isHex(body.signature)) return json({ error: "invalid signature" }, 400);
  const wallet = body.wallet.toLowerCase();
  const time = body.time;
  if (Math.abs(Date.now() - time) > SIGNATURE_TTL_MS) return json({ error: "That signature has expired. Try again." }, 401);
  const signer = await recoverMessageAddress({ message: followMessage(action, wallet, time), signature: body.signature }).catch(() => null);
  if (signer?.toLowerCase() !== wallet) return json({ error: "The signature doesn't match the wallet." }, 401);

  // Only following needs a Dojang, checked on the chain at the moment of the change.
  let verified = false;
  if (action.type === "follow") {
    try {
      verified = (await readProfiles(giwa(), [wallet]))[wallet]?.verified ?? false;
    } catch {
      return json({ error: "Couldn't reach GIWA to check your Dojang. Try again." }, 503);
    }
  }

  // Reads, applies and writes back, again if another change landed in between.
  for (let attempt = 0; attempt < 4; attempt++) {
    const { doc, rev } = await s.load();
    const state = doc ?? emptyFollows();
    // A wallet's changes must come in time order, so a signature can't be replayed.
    if ((state.lastAction[wallet] ?? 0) >= time) return json({ error: "That signature was already used." }, 409);
    const out = applyFollow(state, wallet, action, { verified });
    if ("error" in out) return json({ error: out.error }, out.status);
    out.state.lastAction[wallet] = time;
    if (await s.save(out.state, rev)) return json({ state: out.state, writable: true });
  }
  return json({ error: "Busy. Try again." }, 503);
}
