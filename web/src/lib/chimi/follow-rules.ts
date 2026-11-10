/**
 * Following: who watches whose trades. The rules the API enforces (routes/api/follows.ts) and the pages explain. The
 * server and the browser share this one copy, and node can test it directly, so it imports nothing.
 *
 * - Following is a message the wallet signs (no transaction), good for SIGNATURE_TTL_MS and only once.
 * - Only a wallet with a GIWA Dojang can follow, so a follower count is a count of people, not of fresh wallets.
 *   Anyone can be followed, and anyone can unfollow.
 * - A wallet follows at most MAX_FOLLOWING others, newest first.
 * - Who follows whom is public, like every trade on the chain.
 */
export const FOLLOWS_VERSION = 1;
export const MAX_FOLLOWING = 100;
export const SIGNATURE_TTL_MS = 5 * 60_000;

export type FollowsState = {
  version: 1;
  /** Each wallet's list of the wallets it follows, newest first. All lowercase. */
  following: Record<string, string[]>;
  /** wallet → time of its last signed action, so a signature can't be used twice. */
  lastAction: Record<string, number>;
};

export type FollowAction = { type: "follow"; wallet: string } | { type: "unfollow"; wallet: string };

/** What the API knows that the rules can't: whether the acting wallet holds a Dojang right now. */
export type FollowContext = { verified: boolean };

export const emptyFollows = (): FollowsState => ({ version: FOLLOWS_VERSION, following: {}, lastAction: {} });

const ADDRESS = /^0x[0-9a-f]{40}$/;

/** What the wallet signs. The API rebuilds it from the request, so the two must stay in step. */
export function followMessage(action: FollowAction, wallet: string, time: number) {
  const what = `${action.type === "follow" ? "follow" : "stop following"} ${action.wallet.toLowerCase()}`;
  return `Chimi follows: ${what}\n\nWallet: ${wallet.toLowerCase()}\nTime: ${new Date(time).toISOString()}`;
}

/** The wallets this one follows, newest first. */
export const followingOf = (state: FollowsState | undefined, wallet: string | undefined): string[] =>
  (wallet && state?.following[wallet.toLowerCase()]) || [];

/** The wallets that follow this one. */
export function followersOf(state: FollowsState | undefined, wallet: string | undefined): string[] {
  if (!state || !wallet) return [];
  const target = wallet.toLowerCase();
  return Object.entries(state.following).flatMap(([who, list]) => (list.includes(target) ? [who] : []));
}

export const isFollowing = (state: FollowsState | undefined, wallet: string | undefined, target: string) =>
  followingOf(state, wallet).includes(target.toLowerCase());

/** How many followers every followed wallet has. */
export function followerCounts(state: FollowsState | undefined): Map<string, number> {
  const counts = new Map<string, number>();
  for (const list of Object.values(state?.following ?? {})) for (const target of list) counts.set(target, (counts.get(target) ?? 0) + 1);
  return counts;
}

type Result = { state: FollowsState } | { error: string; status: number };

export const NEED_DOJANG = "Get a Dojang on GIWA first: only verified wallets can follow.";

/** Applies one signed action. Returns a new state, or why the action is refused. */
export function applyFollow(state: FollowsState, walletIn: string, action: FollowAction, ctx: FollowContext): Result {
  const wallet = walletIn.toLowerCase();
  const target = action.wallet.toLowerCase();
  if (!ADDRESS.test(wallet) || !ADDRESS.test(target)) return { error: "That isn't a wallet address.", status: 400 };
  const mine = state.following[wallet] ?? [];
  const next = structuredClone(state);
  if (action.type === "unfollow") {
    // Asking to stop following someone you don't follow changes nothing, and isn't an error.
    const rest = mine.filter((w) => w !== target);
    if (rest.length > 0) next.following[wallet] = rest;
    else delete next.following[wallet];
    return { state: next };
  }
  if (target === wallet) return { error: "You can't follow yourself.", status: 400 };
  if (mine.includes(target)) return { state: next };
  if (!ctx.verified) return { error: NEED_DOJANG, status: 403 };
  if (mine.length >= MAX_FOLLOWING) return { error: `You can follow up to ${MAX_FOLLOWING} wallets. Stop following one first.`, status: 409 };
  next.following[wallet] = [target, ...mine];
  return { state: next };
}
