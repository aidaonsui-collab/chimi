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
 */
export const COMMENTS_VERSION = 1;
export const MAX_LENGTH = 280;
export const MAX_KEPT = 500;
export const MIN_GAP_MS = 15_000;
export const SIGNATURE_TTL_MS = 5 * 60_000;

export type Comment = { id: string; wallet: string; text: string; time: number };

export type CommentsDoc = {
  version: 1;
  /** The coin, lowercase. */
  token: string;
  /** Oldest first, at most MAX_KEPT. */
  items: Comment[];
  /** wallet → time of its last signed action here, so a signature can't be used twice. */
  lastAction: Record<string, number>;
};

export type CommentAction = { type: "post"; text: string } | { type: "delete"; id: string };

/** What the API answers with: one page of a coin's comments. */
export type CommentsView = {
  token: string;
  /** Newest first. */
  items: Comment[];
  /** How many the coin has in all; `items` may be only the latest of them. */
  total: number;
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
export function commentMessage(action: CommentAction, token: string, wallet: string, time: number) {
  const what = action.type === "post" ? `say on ${token.toLowerCase()}:\n${cleanText(action.text)}` : `delete my comment ${action.id} on ${token.toLowerCase()}`;
  return `Chimi comments: ${what}\n\nWallet: ${wallet.toLowerCase()}\nTime: ${new Date(time).toISOString()}`;
}

type Result = { doc: CommentsDoc } | { error: string; status: number };

export const NEED_DOJANG = "Get a Dojang on GIWA first: only verified wallets can comment.";

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
    return { doc: next };
  }
  if (!ctx.verified) return { error: NEED_DOJANG, status: 403 };
  const text = cleanText(action.text);
  const problem = checkText(text);
  if (problem) return { error: problem, status: 400 };
  const mine = next.items.filter((c) => c.wallet === wallet);
  const last = mine[mine.length - 1];
  if (last && time - last.time < MIN_GAP_MS) return { error: "Give it a few seconds before commenting again.", status: 429 };
  if (last && last.text === text) return { error: "You just said that.", status: 409 };
  // Time and wallet together are unique: a wallet's actions must come in time order.
  next.items.push({ id: `${time.toString(36)}-${wallet.slice(2, 10)}`, wallet, text, time });
  if (next.items.length > MAX_KEPT) next.items.splice(0, next.items.length - MAX_KEPT);
  return { doc: next };
}

/** Takes a comment out, whoever wrote it. For the site's operator. */
export function removeComment(doc: CommentsDoc, id: string): CommentsDoc | null {
  if (!doc.items.some((c) => c.id === id)) return null;
  return { ...doc, items: doc.items.filter((c) => c.id !== id) };
}

/** What a commenter holds, said in a few words: "holds 1.2%", "sold", or nothing when they never held any. */
export function stance(heldShare: number, everBought: boolean): string | null {
  if (heldShare > 0) {
    const pct = heldShare * 100;
    return `holds ${pct >= 10 ? pct.toFixed(0) : pct >= 0.1 ? pct.toFixed(1) : pct >= 0.01 ? pct.toFixed(2) : "<0.01"}%`;
  }
  return everBought ? "sold" : null;
}
