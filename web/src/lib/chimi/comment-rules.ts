/**
 * Comments on a coin's page. The rules the API enforces (routes/api/comments.ts) and the page explains. The server and
 * the browser share this one copy, and node can test it directly, so it imports nothing.
 *
 * - A comment is a message the wallet signs (no transaction), good for SIGNATURE_TTL_MS and only once.
 * - Only a wallet with a GIWA Dojang can comment, so a thread is people talking, not a hundred fresh wallets.
 * - Plain text, up to MAX_LENGTH characters, and no links: a link in a coin's comments is nearly always a scam.
 * - One wallet can comment on one coin every MIN_GAP_MS at most.
 * - A wallet can delete its own comments. Nobody else can, except the site's operator.
 * - Each coin keeps its latest MAX_KEPT comments; older ones fall away.
 * - A comment can answer another. Answers sit one level deep: an answer to an answer joins the same thread.
 * - A wallet with a Dojang can like a comment that isn't its own, once. Likes ride on a pass: one signature that
 *   lets this browser like and unlike as the wallet for PASS_TTL_MS, so a like is one press and not a wallet popup.
 *   The pass allows nothing else; writing and deleting still take a signature each.
 */
export const COMMENTS_VERSION = 1;
export const MAX_LENGTH = 280;
export const MAX_KEPT = 500;
export const MIN_GAP_MS = 15_000;
export const SIGNATURE_TTL_MS = 5 * 60_000;
export const MAX_LIKES = 500;
export const PASS_TTL_MS = 7 * 24 * 60 * 60_000;

export type Comment = {
  id: string;
  wallet: string;
  text: string;
  time: number;
  /** The top-level comment this one answers. Absent on a top-level comment. */
  replyTo?: string;
  /** Whose answer in that thread this one answers, when it isn't the top-level comment's author. */
  to?: string;
};

export type CommentsDoc = {
  version: 1;
  /** The coin, lowercase. */
  token: string;
  /** Oldest first, at most MAX_KEPT. */
  items: Comment[];
  /** wallet → time of its last signed action here, so a signature can't be used twice. */
  lastAction: Record<string, number>;
  /** comment id → the wallets that like it, oldest first. Documents from before likes lack it. */
  likes?: Record<string, string[]>;
};

export type CommentAction =
  | { type: "post"; text: string; replyTo?: string }
  | { type: "delete"; id: string }
  | { type: "like"; id: string }
  | { type: "unlike"; id: string };

/** The actions a wallet signs one by one. Likes ride on a pass instead. */
export type SignedAction = Extract<CommentAction, { type: "post" | "delete" }>;

/** What the API answers with: one page of a coin's comments. */
export type CommentsView = {
  token: string;
  /** Newest first: the latest threads, each top-level comment with every answer to it. */
  items: Comment[];
  /** How many the coin has in all, answers included; `items` may be only the latest of them. */
  total: number;
  /** How many threads (top-level comments) the coin has in all. */
  threads: number;
  /** comment id → how many wallets like it. Comments nobody likes are absent. */
  likes: Record<string, number>;
  /** The comments in `items` the asking wallet likes. Empty when nobody asked as a wallet. */
  liked: string[];
  /** The commenters in `items` who have ever bought this coin, by the trade record. */
  bought: string[];
  /** False when the site has nowhere to keep comments. */
  writable: boolean;
};

/** What the API knows that the rules can't: whether the acting wallet holds a Dojang right now. */
export type CommentContext = { verified: boolean };

export const emptyComments = (token: string): CommentsDoc => ({ version: COMMENTS_VERSION, token: token.toLowerCase(), items: [], lastAction: {} });

const LINK = /(?:https?:\/\/|www\.|t\.me\/)\S+|\b[a-z0-9-]+\.(?:com|io|xyz|fun|app|net|org|gg|me|co|finance|exchange|link)\b/i;

/** Tidies what was typed: no control characters, no runs of blank lines, no spaces at either end. */
export function cleanText(text: string): string {
  return (
    text
      .replace(/\r\n?/g, "\n")
      // Control characters and the invisible ones used to hide text or flip its direction.
      .replace(/[\u{0}-\u{9}\u{b}-\u{1f}\u{7f}\u{200b}\u{200c}\u{200e}\u{200f}\u{202a}-\u{202e}\u{2060}-\u{2069}\u{feff}]/gu, "")
      .replace(/[^\S\n]+/g, " ")
      .replace(/ ?\n ?/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/** Why this text can't be posted, or null when it can. Check the cleaned text. */
export function checkText(text: string): string | null {
  if (text.length === 0) return "Write something first.";
  if ([...text].length > MAX_LENGTH) return `Keep it to ${MAX_LENGTH} characters at most.`;
  if (LINK.test(text)) return "Links aren't allowed in comments.";
  return null;
}

/** What the wallet signs. The API rebuilds it from the request, so the two must stay in step. */
export function commentMessage(action: SignedAction, token: string, wallet: string, time: number) {
  const coin = token.toLowerCase();
  const what =
    action.type === "delete"
      ? `delete my comment ${action.id} on ${coin}`
      : action.replyTo
        ? `reply to ${action.replyTo} on ${coin}:\n${cleanText(action.text)}`
        : `say on ${coin}:\n${cleanText(action.text)}`;
  return `Chimi comments: ${what}\n\nWallet: ${wallet.toLowerCase()}\nTime: ${new Date(time).toISOString()}`;
}

/** What the wallet signs once to like from this browser until `until`. It names what it allows, and nothing else. */
export function likePassMessage(wallet: string, until: number) {
  return `Chimi likes: let this browser like and unlike comments as me until ${new Date(until).toISOString()}\n\nIt can't post, follow, trade or move anything.\n\nWallet: ${wallet.toLowerCase()}`;
}

/** Why a pass can't be used at `now`, or null when it can. A pass for longer than PASS_TTL_MS is never honoured. */
export function checkPass(until: number, now: number): string | null {
  if (!Number.isFinite(until) || until <= now) return "Your like pass has run out. Like again to renew it.";
  if (until - now > PASS_TTL_MS + SIGNATURE_TTL_MS) return "That pass is for too long.";
  return null;
}

/** What an action did that someone should hear about. The API turns these into inbox items. */
export type CommentEffect =
  | { type: "comment"; comment: Comment }
  /** `parent` is the comment answered; `root` the top-level comment of its thread (the same one, or above it). */
  | { type: "reply"; comment: Comment; parent: Comment; root: Comment }
  | { type: "like"; comment: Comment; by: string };

type Result = { doc: CommentsDoc; effect?: CommentEffect } | { error: string; status: number };

export const NEED_DOJANG = "Get a Dojang on GIWA first: only verified wallets can comment.";
export const NEED_DOJANG_TO_LIKE = "Get a Dojang on GIWA first: only verified wallets can like.";

/**
 * Applies one signed action. `time` is when it arrived, by the server's clock rather than the wallet's, so the wait
 * between comments and their order can't be bent by signing with another time.
 * Returns a new document, or why the action is refused.
 */
export function applyComment(doc: CommentsDoc, walletIn: string, action: CommentAction, time: number, ctx: CommentContext): Result {
  const wallet = walletIn.toLowerCase();
  const next = structuredClone(doc);
  if (action.type === "delete") {
    const found = next.items.find((c) => c.id === action.id);
    if (!found) return { error: "That comment is already gone.", status: 404 };
    if (found.wallet !== wallet) return { error: "You can only delete your own comments.", status: 403 };
    next.items = next.items.filter((c) => c.id !== action.id);
    dropLikes(next);
    return { doc: next };
  }
  if (action.type === "unlike") {
    // Taking back a like you never gave changes nothing, and isn't an error.
    const rest = (next.likes?.[action.id] ?? []).filter((w) => w !== wallet);
    if (next.likes) {
      if (rest.length > 0) next.likes[action.id] = rest;
      else delete next.likes[action.id];
    }
    return { doc: next };
  }
  if (action.type === "like") {
    const found = next.items.find((c) => c.id === action.id);
    if (!found) return { error: "That comment is gone.", status: 404 };
    if (found.wallet === wallet) return { error: "You can't like your own comment.", status: 400 };
    const by = next.likes?.[action.id] ?? [];
    if (by.includes(wallet)) return { doc: next };
    if (!ctx.verified) return { error: NEED_DOJANG_TO_LIKE, status: 403 };
    if (by.length >= MAX_LIKES) return { error: "That comment has all the likes it can hold.", status: 409 };
    (next.likes ??= {})[action.id] = [...by, wallet];
    return { doc: next, effect: { type: "like", comment: found, by: wallet } };
  }
  if (!ctx.verified) return { error: NEED_DOJANG, status: 403 };
  const text = cleanText(action.text);
  const problem = checkText(text);
  if (problem) return { error: problem, status: 400 };
  const parent = action.replyTo === undefined ? undefined : next.items.find((c) => c.id === action.replyTo);
  if (action.replyTo !== undefined && !parent) return { error: "The comment you're answering is gone.", status: 404 };
  const mine = next.items.filter((c) => c.wallet === wallet);
  const last = mine[mine.length - 1];
  if (last && time - last.time < MIN_GAP_MS) return { error: "Give it a few seconds before commenting again.", status: 429 };
  if (last && last.text === text) return { error: "You just said that.", status: 409 };
  // Time and wallet together are unique: a wallet's actions must come in time order.
  const comment: Comment = { id: `${time.toString(36)}-${wallet.slice(2, 10)}`, wallet, text, time };
  if (parent) {
    // Threads are one level deep: an answer to an answer joins the thread, and remembers whom it answers.
    comment.replyTo = parent.replyTo ?? parent.id;
    if (parent.replyTo && parent.wallet !== wallet) comment.to = parent.wallet;
  }
  next.items.push(comment);
  if (next.items.length > MAX_KEPT) {
    next.items.splice(0, next.items.length - MAX_KEPT);
    dropLikes(next);
  }
  if (!parent) return { doc: next, effect: { type: "comment", comment } };
  return { doc: next, effect: { type: "reply", comment, parent, root: next.items.find((c) => c.id === comment.replyTo) ?? parent } };
}

/** Forgets the likes of comments that are no longer kept. Mutates `doc`. */
function dropLikes(doc: CommentsDoc) {
  if (!doc.likes) return;
  const kept = new Set(doc.items.map((c) => c.id));
  for (const id of Object.keys(doc.likes)) if (!kept.has(id)) delete doc.likes[id];
}

/** A top-level comment and the answers to it, oldest answer first. */
export type Thread = { root: Comment; replies: Comment[] };

/**
 * Comments as threads, newest thread first. An answer whose top-level comment isn't among `items` (it was deleted,
 * or fell off the page) leads a thread of its own, so nothing that was said disappears.
 */
export function threadsOf(items: readonly Comment[]): Thread[] {
  const oldestFirst = [...items].sort((a, b) => a.time - b.time || (a.id < b.id ? -1 : 1));
  const ids = new Set(oldestFirst.map((c) => c.id));
  const threads = new Map<string, Thread>();
  for (const c of oldestFirst) {
    const home = c.replyTo !== undefined && ids.has(c.replyTo) ? threads.get(c.replyTo) : undefined;
    if (home) home.replies.push(c);
    else threads.set(c.id, { root: c, replies: [] });
  }
  return [...threads.values()].reverse();
}

/** One page: the comments of the newest `limit` threads, newest first, and how many threads there are in all. */
export function pageOf(doc: CommentsDoc | null, limit: number): { items: Comment[]; threads: number } {
  const threads = threadsOf(doc?.items ?? []);
  const items = threads
    .slice(0, limit)
    .flatMap((t) => [t.root, ...t.replies])
    .sort((a, b) => b.time - a.time || (a.id < b.id ? 1 : -1));
  return { items, threads: threads.length };
}

/** How many wallets like each of these comments, and which of them `wallet` likes. */
export function likesOf(doc: CommentsDoc | null, ids: readonly string[], wallet?: string): { likes: Record<string, number>; liked: string[] } {
  const who = wallet?.toLowerCase();
  const likes: Record<string, number> = {};
  const liked: string[] = [];
  for (const id of ids) {
    const by = doc?.likes?.[id];
    if (!by || by.length === 0) continue;
    likes[id] = by.length;
    if (who && by.includes(who)) liked.push(id);
  }
  return { likes, liked };
}

/** Takes a comment out, whoever wrote it. For the site's operator. */
export function removeComment(doc: CommentsDoc, id: string): CommentsDoc | null {
  if (!doc.items.some((c) => c.id === id)) return null;
  const next = structuredClone(doc);
  next.items = next.items.filter((c) => c.id !== id);
  dropLikes(next);
  return next;
}

/** What a commenter holds, said in a few words: "holds 1.2%", "sold", or nothing when they never held any. */
export function stance(heldShare: number, everBought: boolean): string | null {
  if (heldShare > 0) {
    const pct = heldShare * 100;
    return `holds ${pct >= 10 ? pct.toFixed(0) : pct >= 0.1 ? pct.toFixed(1) : pct >= 0.01 ? pct.toFixed(2) : "<0.01"}%`;
  }
  return everBought ? "sold" : null;
}
