/**
 * GET /api/houses: every house, membership, lock and waiting request (public; the pages add up points themselves).
 * POST /api/houses: one signed change, { wallet, action, time, signature } (rules in lib/chimi/house-rules.ts). A request
 * to join tells the head in their inbox; accepting or turning it down tells the wallet that asked.
 *
 * Needs the project's Upstash Redis (KV_REST_API_URL / KV_REST_API_TOKEN) to change anything. CHIMI_ADMIN_TOKEN lets
 * the operator close a house with that bearer token: POST { admin: "close", tag }.
 */
import { createFileRoute } from "@tanstack/react-router";
import { isAddress, isHex, recoverMessageAddress } from "viem";
import { readProfiles } from "@/lib/chimi/identity";
import {
  applyAction,
  currentStint,
  emptyHouses,
  houseMessage,
  INKS,
  requestOf,
  SEALS,
  SIGNATURE_TTL_MS,
  type HouseAction,
  type HousesState,
} from "@/lib/chimi/house-rules";
import { tell } from "@/server/inbox";
import { giwa } from "@/server/points";
import { docStore, json, rateLimited } from "@/server/store";

const store = () => docStore<HousesState>("chimi:houses:v1");

export const Route = createFileRoute("/api/houses")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const s = store();
          const { doc } = await s.load();
          return json({ state: doc ?? emptyHouses(), writable: s.writable }, 200, { "cache-control": "public, max-age=5" });
        } catch (e) {
          console.error("[houses]", e instanceof Error ? e.message : e);
          return json({ error: "houses unavailable" }, 503);
        }
      },
      POST: async ({ request }) => post(request),
    },
  },
});

type Body = { wallet?: unknown; action?: unknown; time?: unknown; signature?: unknown; admin?: unknown; tag?: unknown };

function asAction(a: unknown): HouseAction | null {
  if (!a || typeof a !== "object") return null;
  const o = a as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : null);
  const seal = str("seal");
  const ink = str("ink");
  const look = seal !== null && seal in SEALS && ink !== null && ink in INKS ? { seal: seal as keyof typeof SEALS, ink: ink as keyof typeof INKS } : null;
  // A picture is a URL or null for none; anything else is refused rather than read as none.
  if (o.image !== undefined && o.image !== null && typeof o.image !== "string") return null;
  const image = (o.image ?? null) as string | null;
  const target = str("wallet") && isAddress(str("wallet")!) ? str("wallet")! : null;
  switch (o.type) {
    case "found": {
      const [tag, name, motto] = [str("tag"), str("name"), str("motto") ?? ""];
      if (o.approve !== undefined && typeof o.approve !== "boolean") return null;
      return tag === null || name === null || !look ? null : { type: "found", tag, name, motto, ...look, approve: o.approve === true, image };
    }
    case "seal":
      return look ? { type: "seal", ...look, image } : null;
    case "join":
      return str("tag") === null ? null : { type: "join", tag: str("tag")! };
    case "withdraw":
      return { type: "withdraw" };
    case "accept":
    case "reject":
      return target ? { type: o.type, wallet: target } : null;
    case "approve":
      return typeof o.approve === "boolean" ? { type: "approve", approve: o.approve } : null;
    case "leave":
      return { type: "leave" };
    case "remove":
      return target ? { type: "remove", wallet: target } : null;
    case "motto":
      return str("motto") === null ? null : { type: "motto", motto: str("motto")! };
    default:
      return null;
  }
}

async function post(request: Request) {
  if (await rateLimited(request, "houses", 30, 60)) return json({ error: "Too many changes. Try again in a minute." }, 429, { "retry-after": "60" });
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body) return json({ error: "invalid request" }, 400);
  const s = store();
  if (!s.writable) return json({ error: "Houses aren't switched on yet." }, 503);

  // Operator: close a house (abuse, impersonation).
  if (body.admin !== undefined) {
    const token = process.env.CHIMI_ADMIN_TOKEN;
    if (!token || request.headers.get("authorization") !== `Bearer ${token}`) return json({ error: "forbidden" }, 403);
    if (body.admin !== "close" || typeof body.tag !== "string") return json({ error: "invalid request" }, 400);
    const tag = body.tag;
    const closed = await commit(s, (state) => {
      if (!state.houses[tag] || state.houses[tag]!.closedAt) return { error: "no such house", status: 404 };
      const next = structuredClone(state);
      const now = Date.now();
      next.houses[tag]!.closedAt = now;
      for (const st of next.stints) if (st.tag === tag && st.to === null) st.to = now;
      return { state: next };
    });
    return closed.response;
  }

  const action = asAction(body.action);
  if (typeof body.wallet !== "string" || !isAddress(body.wallet) || !action || typeof body.time !== "number") {
    return json({ error: "invalid request" }, 400);
  }
  if (typeof body.signature !== "string" || !isHex(body.signature)) return json({ error: "invalid signature" }, 400);
  const wallet = body.wallet.toLowerCase();
  const time = body.time;
  if (Math.abs(Date.now() - time) > SIGNATURE_TTL_MS) return json({ error: "That signature has expired. Try again." }, 401);
  const signer = await recoverMessageAddress({ message: houseMessage(action, wallet, time), signature: body.signature }).catch(() => null);
  if (signer?.toLowerCase() !== wallet) return json({ error: "The signature doesn't match the wallet." }, 401);

  // Only founding and joining need a Dojang, checked on the chain at the moment of the change.
  let verified = false;
  if (action.type === "found" || action.type === "join") {
    try {
      verified = (await readProfiles(giwa(), [wallet]))[wallet]?.verified ?? false;
    } catch {
      return json({ error: "Couldn't reach GIWA to check your Dojang. Try again." }, 503);
    }
  }
  let before: HousesState | null = null;
  const res = await commit(s, (state) => {
    // A wallet's changes must come in time order, so a signature can't be replayed.
    if ((state.lastAction[wallet] ?? 0) >= time) return { error: "That signature was already used.", status: 409 };
    const out = applyAction(state, wallet, action, Date.now(), { verified });
    if ("state" in out) {
      out.state.lastAction[wallet] = time;
      before = state;
    }
    return out;
  });
  if (res.ok && before) await tellAbout(action, wallet, before, res.state).catch((e) => console.error("[houses] inbox", e instanceof Error ? e.message : e));
  return res.response;
}

/** Inbox notes for requests: the head hears of a new one; the wallet that asked hears the answer. */
async function tellAbout(action: HouseAction, wallet: string, before: HousesState, after: HousesState) {
  const now = Date.now();
  if (action.type === "join") {
    const asked = requestOf(after, wallet, now);
    const house = asked ? after.houses[asked.tag] : undefined;
    if (asked && house) await tell([{ wallet: house.head, item: { kind: "house", key: `house:ask:${asked.tag}:${wallet}:${asked.at}`, time: now, from: wallet, tag: asked.tag, what: "asked" } }]);
    return;
  }
  if (action.type === "accept" || action.type === "reject") {
    const tag = currentStint(before, wallet)?.tag;
    const target = action.wallet.toLowerCase();
    if (!tag) return;
    const what = action.type === "accept" ? "accepted" : "declined";
    await tell([{ wallet: target, item: { kind: "house", key: `house:${what}:${tag}:${target}:${now}`, time: now, from: wallet, tag, what } }]);
  }
}

type Committed = { ok: true; state: HousesState; response: Response } | { ok: false; response: Response };

/** Reads, applies and writes back, again if another change landed in between. */
async function commit(s: ReturnType<typeof store>, change: (state: HousesState) => { state: HousesState } | { error: string; status: number }): Promise<Committed> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { doc, rev } = await s.load();
    const out = change(doc ?? emptyHouses());
    if ("error" in out) return { ok: false, response: json({ error: out.error }, out.status) };
    if (await s.save(out.state, rev)) return { ok: true, state: out.state, response: json({ state: out.state, writable: true }) };
  }
  return { ok: false, response: json({ error: "Busy. Try again." }, 503) };
}
