/**
 * The inbox: what other wallets did that concerns yours. Someone answered or liked your comment, commented on a coin
 * you launched, followed you, bought a coin after you did, or tipped you. The server adds an item when the thing happens
 * (routes/api/comments.ts, follows.ts and server/points.ts); the page only reads the list. The server and the
 * browser share this one copy, and node can test it directly, so it imports nothing.
 *
 * - Everything in an inbox is already public: comments, likes, follows and trades are. So an inbox can be read by
 *   anyone who knows the wallet, like the wallet's trades can.
 * - Nothing you do yourself lands in your own inbox.
 * - An inbox keeps its latest MAX_INBOX items; older ones fall away.
 * - What you have seen is remembered in the browser, not on the server: reading takes no signature.
 */
export const INBOX_VERSION = 1;
export const MAX_INBOX = 100;
/** A quoted comment is cut to this many characters. */
export const SNIPPET = 120;

type Base = { key: string; /** Milliseconds, by the server's clock. */ time: number; /** Who did it, lowercase. */ from: string };

export type InboxItem =
  /**
   * `from` answered your comment on `token`. `comment` is their answer, `text` what it says. With `thread`, they
   * answered someone else under a comment of yours.
   */
  | (Base & { kind: "reply"; token: string; comment: string; text: string; thread?: true })
  /** `from` likes your comment `comment` on `token`. `text` is what you said. */
  | (Base & { kind: "like"; token: string; comment: string; text: string })
  /** `from` commented on `token`, a coin you launched. */
  | (Base & { kind: "comment"; token: string; comment: string; text: string })
  /** `from` follows you now. */
  | (Base & { kind: "follow" })
  /** `from` follows you and bought `token` after you did. `eth` is what counts toward your lead. */
  | (Base & { kind: "led"; token: string; eth: number })
  /** `from` tipped you `eth` on `token`, a coin you launched; `text` is their message (may be empty). */
  | (Base & { kind: "tip"; token: string; eth: number; text: string });

export type InboxDoc = {
  version: 1;
  /** Whose inbox, lowercase. */
  wallet: string;
  /** Oldest first, at most MAX_INBOX. */
  items: InboxItem[];
};

export const emptyInbox = (wallet: string): InboxDoc => ({ version: INBOX_VERSION, wallet: wallet.toLowerCase(), items: [] });

/** The start of a comment, for quoting in a line of the inbox. */
export function snippet(text: string, max = SNIPPET): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const chars = [...flat];
  return chars.length <= max ? flat : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

/**
 * The inbox with these items added, or null when there is nothing to write: an item about your own doing, or one
 * already there (a like given, taken back and given again is one like).
 */
export function addToInbox(doc: InboxDoc, add: readonly InboxItem[]): InboxDoc | null {
  const have = new Set(doc.items.map((i) => i.key));
  const fresh: InboxItem[] = [];
  for (const item of add) {
    const from = item.from.toLowerCase();
    if (from === doc.wallet || have.has(item.key)) continue;
    have.add(item.key);
    fresh.push({ ...item, from });
  }
  if (fresh.length === 0) return null;
  const items = [...doc.items, ...fresh].sort((a, b) => a.time - b.time);
  return { ...doc, items: items.slice(-MAX_INBOX) };
}

/** How many items arrived after `seen` (milliseconds). */
export const unreadCount = (items: readonly InboxItem[], seen: number) => items.filter((i) => i.time > seen).length;

/** One line of the inbox as it is shown. Likes of one comment are one line, however many wallets gave them. */
export type InboxRow = {
  key: string;
  kind: InboxItem["kind"];
  /** The newest of what the line stands for. */
  time: number;
  /** Who did it, newest first. More than one only for likes. */
  from: string[];
  token?: string;
  comment?: string;
  text?: string;
  eth?: number;
  /** A reply to someone else, in a thread you started. */
  thread?: boolean;
};

/** The inbox as lines, newest first. */
export function rowsOf(items: readonly InboxItem[]): InboxRow[] {
  const rows: InboxRow[] = [];
  const likes = new Map<string, InboxRow>();
  for (const item of [...items].sort((a, b) => b.time - a.time || (a.key < b.key ? -1 : 1))) {
    if (item.kind === "like") {
      const id = `${item.token}:${item.comment}`;
      const row = likes.get(id);
      if (row) {
        if (!row.from.includes(item.from)) row.from.push(item.from);
        continue;
      }
      const made: InboxRow = { key: `likes:${id}`, kind: "like", time: item.time, from: [item.from], token: item.token, comment: item.comment, text: item.text };
      likes.set(id, made);
      rows.push(made);
      continue;
    }
    rows.push({
      key: item.key,
      kind: item.kind,
      time: item.time,
      from: [item.from],
      token: "token" in item ? item.token : undefined,
      comment: "comment" in item ? item.comment : undefined,
      text: "text" in item ? item.text : undefined,
      eth: item.kind === "led" || item.kind === "tip" ? item.eth : undefined,
      thread: item.kind === "reply" ? item.thread : undefined,
    });
  }
  return rows;
}

/** Who gets told about a comment action, and what. `creator` is the wallet that launched the coin. */
export function inboxFor(
  effect:
    | { type: "comment"; comment: { id: string; wallet: string; text: string } }
    | { type: "reply"; comment: { id: string; wallet: string; text: string }; parent: { wallet: string }; root: { wallet: string } }
    | { type: "like"; comment: { id: string; wallet: string; text: string }; by: string },
  token: string,
  creator: string | undefined,
  time: number,
): { wallet: string; item: InboxItem }[] {
  const coin = token.toLowerCase();
  if (effect.type === "like") {
    return [{ wallet: effect.comment.wallet, item: { kind: "like", key: `like:${coin}:${effect.comment.id}:${effect.by.toLowerCase()}`, time, from: effect.by, token: coin, comment: effect.comment.id, text: snippet(effect.comment.text) } }];
  }
  const { comment } = effect;
  if (effect.type === "reply") {
    // The wallet answered hears of it, and so does whoever started the thread.
    const item = { kind: "reply" as const, key: `reply:${coin}:${comment.id}`, time, from: comment.wallet, token: coin, comment: comment.id, text: snippet(comment.text) };
    const answered = effect.parent.wallet.toLowerCase();
    const starter = effect.root.wallet.toLowerCase();
    return starter === answered ? [{ wallet: answered, item }] : [{ wallet: answered, item }, { wallet: starter, item: { ...item, thread: true as const } }];
  }
  if (!creator) return [];
  return [{ wallet: creator.toLowerCase(), item: { kind: "comment", key: `comment:${coin}:${comment.id}`, time, from: comment.wallet, token: coin, comment: comment.id, text: snippet(comment.text) } }];
}
