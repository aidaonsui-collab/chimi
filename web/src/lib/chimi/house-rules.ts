/**
 * Houses (가문): teams of traders. The rules the API enforces (routes/api/houses.ts) and the pages explain. The server
 * and the browser share this one copy, and node can test it directly (so it imports only other plain modules).
 *
 * - Only wallets with a GIWA Dojang (a Verified Address attestation) can found or join a house, so a house is people,
 *   not a pile of fresh wallets. The API checks Dojang at the moment of each action.
 * - A wallet is in at most one house. Founding or joining one keeps it there for LOCK_DAYS: it can leave any time but
 *   can't join another house until the lock ends (going back to the one it left is fine). A wallet the head removes is
 *   free to join elsewhere at once.
 * - A house holds up to MAX_MEMBERS wallets. When the head leaves, the longest-standing member takes over; a house with
 *   nobody left closes.
 * - A day's points go to the house a wallet is in when that KST day ends (scoreHouses adds them up).
 * - Every change is a message the wallet signs (no transaction), good for SIGNATURE_TTL_MS and only once.
 */
import { dayEndMs, type Points } from "./points-rules.ts";

export const MAX_MEMBERS = 25;
export const LOCK_DAYS = 7;
export const SIGNATURE_TTL_MS = 5 * 60_000;
const DAY_MS = 86_400_000;

/** The character stamped on a house's seal, with its Korean reading and meaning. */
export const SEALS = {
  龍: "용 · dragon",
  虎: "호 · tiger",
  鳳: "봉 · phoenix",
  月: "월 · moon",
  日: "일 · sun",
  山: "산 · mountain",
  火: "화 · fire",
  水: "수 · water",
  金: "금 · gold",
  雲: "운 · cloud",
  風: "풍 · wind",
  福: "복 · fortune",
} as const;
export type Seal = keyof typeof SEALS;

/** Seal inks: stamp colors that read on rice paper, starting with Chimi's own vermilion. */
export const INKS = {
  seal: "#c4402b",
  ink: "#2a221d",
  indigo: "#2e4b7c",
  jade: "#2c6e66",
  pine: "#41683c",
  plum: "#7b3a63",
  gold: "#a5761c",
  rust: "#9a4a1c",
} as const;
export type Ink = keyof typeof INKS;

export type House = {
  tag: string;
  name: string;
  seal: Seal;
  ink: Ink;
  motto: string;
  head: string; // lowercase
  createdAt: number;
  closedAt: number | null;
};

/** One wallet's time in one house. `to` is null while it's still there. */
export type Stint = { wallet: string; tag: string; from: number; to: number | null };

export type HousesState = {
  version: 1;
  houses: Record<string, House>; // by tag
  stints: Stint[];
  locks: Record<string, number>; // wallet → can't join another house before this time
  lastAction: Record<string, number>; // wallet → time of its last signed action
};

export type HouseAction =
  | { type: "found"; tag: string; name: string; seal: Seal; ink: Ink; motto: string }
  | { type: "join"; tag: string }
  | { type: "leave" }
  | { type: "remove"; wallet: string }
  | { type: "motto"; motto: string }
  | { type: "seal"; seal: Seal; ink: Ink };

/** What the API knows that the rules can't: whether the acting wallet holds a Dojang right now. */
export type HouseContext = { verified: boolean };

export const emptyHouses = (): HousesState => ({ version: 1, houses: {}, stints: [], locks: {}, lastAction: {} });

const LINK = /(https?:|www\.|\.(com|io|xyz|fun|net|org|gg|app|me|co|so|to|ly|kr|link)\b|@)/i;

export function checkName(name: string): string | null {
  const n = name.trim();
  if (n.length < 2 || n.length > 20) return "Use 2 to 20 characters.";
  if (!/^[\p{L}\p{N}][\p{L}\p{N} '._-]*$/u.test(n)) return "Letters, numbers, spaces and ' . _ - only.";
  if (LINK.test(n)) return "No links.";
  return null;
}

export function checkTag(tag: string): string | null {
  return /^[A-Z0-9]{2,5}$/.test(tag) ? null : "2 to 5 capital letters or digits.";
}

export function checkMotto(motto: string): string | null {
  if (motto.length > 80) return "Keep it under 80 characters.";
  if (LINK.test(motto)) return "No links or handles.";
  return null;
}

/** A tag to start from: the initials of the name, or its first letters. */
export function suggestTag(name: string) {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, "").split(/\s+/).filter(Boolean);
  const initials = words.map((w) => w[0]).join("");
  return (initials.length >= 2 ? initials : (words[0] ?? "")).slice(0, 5);
}

/** What the wallet signs. The API rebuilds it from the request, so the two must stay in step. */
export function houseMessage(action: HouseAction, wallet: string, time: number) {
  const what =
    action.type === "found"
      ? `found [${action.tag}] ${action.name}\nSeal: ${action.seal} in ${action.ink}\nMotto: ${action.motto}`
      : action.type === "join"
        ? `join [${action.tag}]`
        : action.type === "remove"
          ? `remove ${action.wallet.toLowerCase()} from my house`
          : action.type === "motto"
            ? `set my house's motto to: ${action.motto}`
            : action.type === "seal"
              ? `change my house's seal to ${action.seal} in ${action.ink}`
              : "leave my house";
  return `Chimi houses: ${what}\n\nWallet: ${wallet.toLowerCase()}\nTime: ${new Date(time).toISOString()}`;
}

export const currentStint = (state: HousesState, wallet: string) =>
  state.stints.find((s) => s.wallet === wallet.toLowerCase() && s.to === null);

export const membersOf = (state: HousesState, tag: string) => state.stints.filter((s) => s.tag === tag && s.to === null);

/** When the wallet may join a house, or 0 when it can now. */
export function lockedUntil(state: HousesState, wallet: string, now: number) {
  const until = state.locks[wallet.toLowerCase()] ?? 0;
  return until > now ? until : 0;
}

type Result = { state: HousesState } | { error: string; status: number };

const fail = (error: string, status = 400): Result => ({ error, status });

/** Closes the wallet's stint; hands the house on, or closes an empty one. Mutates `s`. */
function depart(s: HousesState, stint: Stint, now: number) {
  stint.to = now;
  const house = s.houses[stint.tag]!;
  if (house.head !== stint.wallet) return;
  const next = membersOf(s, stint.tag).sort((a, b) => a.from - b.from)[0];
  if (next) house.head = next.wallet;
  else house.closedAt = now;
}

const NEED_DOJANG = "Get a Dojang on GIWA first: houses are for verified wallets.";

/** Applies one signed action. Returns a new state, or why the action is refused. */
export function applyAction(state: HousesState, walletIn: string, action: HouseAction, now: number, ctx: HouseContext): Result {
  const wallet = walletIn.toLowerCase();
  const s: HousesState = structuredClone(state);
  const mine = currentStint(s, wallet);
  const lock = lockedUntil(s, wallet, now);
  const lockError = () => fail(`You can switch houses from ${new Date(lock).toUTCString().slice(5, 22)} UTC.`, 409);
  const head = mine ? s.houses[mine.tag]!.head === wallet : false;

  switch (action.type) {
    case "found": {
      const tag = action.tag.toUpperCase();
      const problem = checkName(action.name) ?? checkTag(tag) ?? checkMotto(action.motto.trim());
      if (problem) return fail(problem);
      if (!(action.seal in SEALS) || !(action.ink in INKS)) return fail("Pick a seal and an ink.");
      if (!ctx.verified) return fail(NEED_DOJANG, 403);
      if (s.houses[tag]) return fail(`[${tag}] is taken.`, 409);
      const name = action.name.trim().replace(/\s+/g, " ");
      if (Object.values(s.houses).some((h) => !h.closedAt && h.name.toLowerCase() === name.toLowerCase())) {
        return fail(`A house called ${name} already exists.`, 409);
      }
      if (lock) return lockError();
      if (mine) depart(s, mine, now);
      s.houses[tag] = { tag, name, seal: action.seal, ink: action.ink, motto: action.motto.trim(), head: wallet, createdAt: now, closedAt: null };
      s.stints.push({ wallet, tag, from: now, to: null });
      s.locks[wallet] = now + LOCK_DAYS * DAY_MS;
      return { state: s };
    }
    case "join": {
      const house = s.houses[action.tag];
      if (!house || house.closedAt) return fail("That house doesn't exist.", 404);
      if (mine?.tag === house.tag) return fail(`You're already in [${house.tag}].`, 409);
      if (!ctx.verified) return fail(NEED_DOJANG, 403);
      // The lock keeps a wallet from hopping between houses; going back to the one it just left is fine.
      const lastHouse = s.stints.filter((x) => x.wallet === wallet).sort((a, b) => b.from - a.from)[0]?.tag;
      if (lock && lastHouse !== house.tag) return lockError();
      if (membersOf(s, house.tag).length >= MAX_MEMBERS) return fail(`[${house.tag}] is full (${MAX_MEMBERS} members).`, 409);
      if (mine) depart(s, mine, now);
      s.stints.push({ wallet, tag: house.tag, from: now, to: null });
      s.locks[wallet] = now + LOCK_DAYS * DAY_MS;
      return { state: s };
    }
    case "leave": {
      if (!mine) return fail("You're not in a house.", 409);
      depart(s, mine, now);
      return { state: s };
    }
    case "remove": {
      const target = action.wallet.toLowerCase();
      if (!head) return fail("Only the head of the house can remove members.", 403);
      if (target === wallet) return fail("Leave the house instead.");
      const theirs = currentStint(s, target);
      if (!theirs || theirs.tag !== mine!.tag) return fail("That wallet isn't in your house.", 404);
      theirs.to = now;
      delete s.locks[target];
      return { state: s };
    }
    case "motto": {
      if (!head) return fail("Only the head of the house can change the motto.", 403);
      const problem = checkMotto(action.motto.trim());
      if (problem) return fail(problem);
      s.houses[mine!.tag]!.motto = action.motto.trim();
      return { state: s };
    }
    case "seal": {
      if (!head) return fail("Only the head of the house can change the seal.", 403);
      if (!(action.seal in SEALS) || !(action.ink in INKS)) return fail("Pick a seal and an ink.");
      Object.assign(s.houses[mine!.tag]!, { seal: action.seal, ink: action.ink });
      return { state: s };
    }
  }
}

export type HouseMember = { wallet: string; since: number; season: number; live: number };

export type HouseScore = {
  house: House;
  members: HouseMember[]; // best season first
  season: number;
  live: number;
  daily: { day: string; points: number }[]; // closed days, oldest first
  rank: number; // by season points
};

/**
 * Adds up each open house's points: a closed day's points go to the house each wallet was in when that KST day ended,
 * and today's estimate to the house it's in now.
 */
export function scoreHouses(state: HousesState, points: Points | null | undefined): HouseScore[] {
  const byWallet = new Map<string, Stint[]>();
  for (const s of state.stints) {
    const list = byWallet.get(s.wallet);
    if (list) list.push(s);
    else byWallet.set(s.wallet, [s]);
  }
  const houseAt = (wallet: string, t: number) => byWallet.get(wallet)?.find((s) => s.from <= t && (s.to === null || s.to > t))?.tag;

  const open = Object.values(state.houses).filter((h) => !h.closedAt);
  const tally = new Map(open.map((h) => [h.tag, { season: 0, live: 0, daily: new Map<string, number>(), members: new Map<string, { season: number; live: number }>() }]));
  const member = (tag: string, wallet: string) => {
    const t = tally.get(tag)!;
    let m = t.members.get(wallet);
    if (!m) t.members.set(wallet, (m = { season: 0, live: 0 }));
    return m;
  };

  for (const d of points?.file.days ?? []) {
    const end = dayEndMs(d.day);
    for (const [wallet, p] of Object.entries(d.points)) {
      const tag = houseAt(wallet, end);
      const t = tag ? tally.get(tag) : undefined;
      if (!t) continue;
      t.season += p;
      t.daily.set(d.day, (t.daily.get(d.day) ?? 0) + p);
      member(tag!, wallet).season += p;
    }
  }
  for (const s of points?.live?.standings ?? []) {
    const tag = currentStint(state, s.wallet)?.tag;
    const t = tag ? tally.get(tag) : undefined;
    if (!t) continue;
    t.live += s.points;
    member(tag!, s.wallet).live += s.points;
  }

  const days = (points?.file.days ?? []).map((d) => d.day);
  return open
    .map((house) => {
      const t = tally.get(house.tag)!;
      const members = membersOf(state, house.tag)
        .map((s) => ({ wallet: s.wallet, since: s.from, ...(t.members.get(s.wallet) ?? { season: 0, live: 0 }) }))
        .sort((a, b) => b.season - a.season || b.live - a.live || a.since - b.since);
      return { house, members, season: t.season, live: t.live, daily: days.map((day) => ({ day, points: t.daily.get(day) ?? 0 })), rank: 0 };
    })
    .sort((a, b) => b.season - a.season || b.live - a.live || a.house.createdAt - b.house.createdAt)
    .map((h, i) => ({ ...h, rank: i + 1 }));
}

/** Each wallet's current house, for seals next to names. */
export function houseOfWallet(state: HousesState | undefined) {
  const map = new Map<string, House>();
  if (!state) return map;
  for (const s of state.stints) if (s.to === null && state.houses[s.tag]) map.set(s.wallet, state.houses[s.tag]!);
  return map;
}
