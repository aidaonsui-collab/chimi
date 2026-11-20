/*
 * Posts on X about Chimi coins: what to search X for, which coin each post found is about, and how it reads in the
 * feed. The server asks twitterapi.io (server/x-posts.ts); this file only builds the searches and reads the answers,
 * so it imports nothing and can be tested on its own.
 *
 * A post belongs to a coin when it comes from the X account the coin's creator linked on the coin page, or when it
 * links to the coin's page on Chimi or names its contract address. Posts that only say a ticker ("$DAL") are left
 * out: tickers are shared with other coins and stocks, and anyone can post one.
 */

export type XMedia = { kind: "photo" | "video" | "gif"; url: string; width?: number; height?: number };

/** A link in a post: `text` is how it reads in the post, `href` where it goes. */
export type XLink = { text: string; href: string };

/** One post on X, as it shows under one coin. A post about two coins is two of these. */
export type XPost = {
  /** The post's id on X. */
  id: string;
  /** The coin, lowercase. */
  token: string;
  /** Why it belongs to the coin: from the coin's own account, a link to its page, or its contract address. */
  via: "account" | "link" | "address";
  url: string;
  /** Unix seconds. */
  time: number;
  handle: string;
  name: string;
  avatar?: string;
  verified: boolean;
  followers: number;
  /** The words, with X's short links written out as `links` say and the trailing media link left off. */
  text: string;
  links: XLink[];
  media: XMedia[];
  likes: number;
  reposts: number;
  replies: number;
  views: number;
};

/** What the server keeps: the posts, the time it has looked up to, and what the operator took down. */
export type XDoc = {
  v: 1;
  /** Unix seconds: every search up to here has been asked. */
  through: number;
  /** Milliseconds: when the server last asked X. */
  ranAt: number;
  posts: XPost[];
  /** Post ids, and accounts as "@handle", the operator took down. */
  hidden: string[];
};

/** A post as twitterapi.io sends it. Only the fields read here; any of them may be missing. */
export type RawMedia = { type?: unknown; url?: unknown; media_url_https?: unknown; original_info?: { width?: unknown; height?: unknown } };
export type RawTweet = {
  id?: unknown;
  text?: unknown;
  createdAt?: unknown;
  likeCount?: unknown;
  retweetCount?: unknown;
  replyCount?: unknown;
  viewCount?: unknown;
  isReply?: unknown;
  isRetweet?: unknown;
  retweeted_tweet?: unknown;
  possiblySensitive?: unknown;
  author?: { userName?: unknown; name?: unknown; profilePicture?: unknown; isBlueVerified?: unknown; followers?: unknown; protected?: unknown; unavailable?: unknown };
  entities?: { urls?: { url?: unknown; display_url?: unknown; expanded_url?: unknown }[]; media?: RawMedia[] };
  extendedEntities?: { media?: RawMedia[] };
  extended_entities?: { media?: RawMedia[] };
};

/** twitterapi.io refuses a search longer than this. */
export const X_QUERY_MAX = 512;
/** What an X handle can be. */
export const X_HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
/** Where Chimi's coin pages live, so a link to one can be told apart. */
export const CHIMI_HOSTS = ["chimi.club", "www.chimi.club", "chimi-sage.vercel.app"];
/** What the searches ask for links to. `url:chimi.club` also finds www.chimi.club. */
export const SEARCH_HOSTS = ["chimi.club", "chimi-sage.vercel.app"];
/** A post by someone other than the coin's own account needs this many followers, which keeps most bots out. */
export const X_MIN_FOLLOWERS = 10;
/** How long a post stays. */
export const X_KEEP_S = 7 * 24 * 60 * 60;
/** How many posts the server keeps at most. */
export const X_MAX_POSTS = 400;
/** How many of one coin's posts the feed shows at once, so one busy account can't fill it. */
export const X_PER_COIN_IN_FEED = 3;
/** How much of a post's words are kept. */
export const X_TEXT_MAX = 600;

const lower = (s: string) => s.toLowerCase();
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

// Paths on x.com that look like a handle but aren't one.
const NOT_HANDLES = new Set(["home", "i", "search", "intent", "share", "explore", "hashtag", "settings", "messages", "notifications", "compose"]);

/**
 * The X handle in what a creator typed for their coin's X: "chimi", "@chimi", "x.com/chimi" or a full link to the
 * profile or one of its posts. undefined when it isn't one.
 */
export function xHandleOf(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  let v = value.trim();
  const link = /^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/(@?[^/?#\s]+)/i.exec(v);
  if (link) v = link[1]!;
  v = v.replace(/^@/, "");
  return X_HANDLE_RE.test(v) && !NOT_HANDLES.has(lower(v)) ? v : undefined;
}

/**
 * Searches of the form "(a OR b OR …) tail", each as long as X allows, between them asking for every term. A term
 * too long to fit even alone is left out.
 */
export function orQueries(terms: readonly string[], tail: string, max = X_QUERY_MAX): string[] {
  const build = (group: string[]) => `(${group.join(" OR ")}) ${tail}`;
  const out: string[] = [];
  let group: string[] = [];
  for (const term of terms) {
    if (build([term]).length > max) continue;
    if (group.length > 0 && build([...group, term]).length > max) {
      out.push(build(group));
      group = [];
    }
    group.push(term);
  }
  if (group.length > 0) out.push(build(group));
  return out;
}

/**
 * Every search one look at X takes, for posts since `since` (unix seconds): one set for the coins' own accounts, one
 * for links to Chimi and the coins' contract addresses. Replies and reposts are left out of both.
 */
export function xSearches(input: { handles: readonly string[]; tokens: readonly string[]; since: number; hosts?: readonly string[] }): string[] {
  const tail = `-filter:replies -filter:retweets since_time:${Math.floor(input.since)}`;
  const handles = [...new Map(input.handles.filter((h) => X_HANDLE_RE.test(h)).map((h) => [lower(h), h])).values()];
  const tokens = [...new Set(input.tokens.map(lower).filter((t) => /^0x[0-9a-f]{40}$/.test(t)))];
  return [
    ...orQueries(
      handles.map((h) => `from:${h}`),
      tail,
    ),
    ...orQueries([...(input.hosts ?? SEARCH_HOSTS).map((h) => `url:${h}`), ...tokens.map((t) => `"${t}"`)], tail),
  ];
}

/** Which coin each handle speaks for (lowercase handle → lowercase tokens), and every coin there is. */
export type CoinIndex = { handles: Map<string, string[]>; tokens: Set<string>; hosts: readonly string[] };

export function coinIndex(coins: readonly { token: string; handle?: string }[], hosts: readonly string[] = CHIMI_HOSTS): CoinIndex {
  const handles = new Map<string, string[]>();
  const tokens = new Set<string>();
  for (const c of coins) {
    const token = lower(c.token);
    tokens.add(token);
    if (!c.handle) continue;
    const h = lower(c.handle);
    handles.set(h, [...(handles.get(h) ?? []), token]);
  }
  return { handles, tokens, hosts };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Unix seconds from X's "Tue Dec 10 07:00:30 +0000 2024" (or any date the platform can read). */
export function xTime(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const m = /^\w{3} (\w{3}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2}) (\d{4})$/.exec(value.trim());
  if (m) {
    const month = MONTHS.indexOf(m[1]!);
    if (month < 0) return undefined;
    const utc = Date.UTC(Number(m[9]), month, Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])) / 1000;
    const offset = (m[6] === "-" ? -1 : 1) * (Number(m[7]) * 60 + Number(m[8])) * 60;
    return utc - offset;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
}

/** Pictures come only from X's own image hosts. */
const X_IMAGE_RE = /^https:\/\/(?:pbs|abs)\.twimg\.com\//;

function mediaOf(raw: RawTweet): RawMedia[] {
  const list = raw.extendedEntities?.media ?? raw.extended_entities?.media ?? raw.entities?.media;
  return Array.isArray(list) ? list : [];
}

/** A post's pictures and videos (a video as its still), four at most. */
export function xMedia(raw: RawTweet): XMedia[] {
  const out: XMedia[] = [];
  for (const m of mediaOf(raw)) {
    const url = str(m.media_url_https);
    if (!X_IMAGE_RE.test(url)) continue;
    const kind = m.type === "video" ? "video" : m.type === "animated_gif" ? "gif" : "photo";
    const width = count(m.original_info?.width) || undefined;
    const height = count(m.original_info?.height) || undefined;
    out.push({ kind, url, width, height });
    if (out.length === 4) break;
  }
  return out;
}

const HTML_ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

/**
 * A post's words as they read on X: its short links written out, the link X adds at the end for the post's media
 * left off, and the few characters X escapes put back.
 */
export function xText(raw: RawTweet, max = X_TEXT_MAX): { text: string; links: XLink[] } {
  let text = str(raw.text);
  for (const m of mediaOf(raw)) {
    const short = str(m.url);
    if (short) text = text.split(short).join("");
  }
  const links: XLink[] = [];
  for (const u of Array.isArray(raw.entities?.urls) ? raw.entities!.urls! : []) {
    const short = str(u.url);
    const href = str(u.expanded_url);
    if (!short || !/^https?:\/\//i.test(href)) continue;
    const shown = str(u.display_url) || href.replace(/^https?:\/\//i, "");
    if (!text.includes(short)) continue;
    text = text.split(short).join(shown);
    if (!links.some((l) => l.text === shown)) links.push({ text: shown, href });
  }
  text = text
    .replace(/&(?:amp|lt|gt|quot|#39);/g, (e) => HTML_ENTITIES[e] ?? e)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length > max) text = `${text.slice(0, max - 1).trimEnd()}…`;
  return { text, links };
}

/** The coin a link points at, when it is a coin page on Chimi. */
export function coinInLink(href: string, hosts: readonly string[] = CHIMI_HOSTS): string | undefined {
  try {
    const url = new URL(href);
    if (!hosts.includes(lower(url.hostname))) return undefined;
    const m = /^\/coin\/(0x[0-9a-fA-F]{40})(?:[/?#]|$)/.exec(url.pathname);
    return m ? lower(m[1]!) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A post as found, as the posts it makes: one for each coin it is about, none when it is about no coin here or isn't
 * fit to show (a repost, a protected or gone account, a stranger's reply, a stranger with almost no followers, or a
 * post X marks as sensitive).
 */
export function readTweet(raw: RawTweet, index: CoinIndex, minFollowers = X_MIN_FOLLOWERS): XPost[] {
  const id = str(raw.id);
  if (!/^\d{1,25}$/.test(id)) return [];
  if (raw.isRetweet === true || (raw.retweeted_tweet !== undefined && raw.retweeted_tweet !== null)) return [];
  const author = raw.author ?? {};
  const handle = str(author.userName);
  if (!X_HANDLE_RE.test(handle) || author.protected === true || author.unavailable === true) return [];
  const time = xTime(raw.createdAt);
  if (time === undefined) return [];
  const followers = count(author.followers);

  const about = new Map<string, XPost["via"]>();
  for (const token of index.handles.get(lower(handle)) ?? []) about.set(token, "account");
  const own = about.size > 0;
  if (!own && (raw.isReply === true || raw.possiblySensitive === true || followers < minFollowers)) return [];

  const { text, links } = xText(raw);
  for (const u of Array.isArray(raw.entities?.urls) ? raw.entities!.urls! : []) {
    const token = coinInLink(str(u.expanded_url), index.hosts);
    if (token && index.tokens.has(token) && !about.has(token)) about.set(token, "link");
  }
  for (const m of str(raw.text).matchAll(/0x[0-9a-fA-F]{40}/g)) {
    const token = lower(m[0]);
    if (index.tokens.has(token) && !about.has(token)) about.set(token, "address");
  }
  if (about.size === 0) return [];

  const avatar = str(author.profilePicture);
  const base = {
    id,
    url: `https://x.com/${handle}/status/${id}`,
    time,
    handle,
    name: str(author.name).trim().slice(0, 50) || handle,
    // X's "_normal" picture is 48px; "_bigger" is 73px, sharp at the size the feed draws it.
    avatar: X_IMAGE_RE.test(avatar) ? avatar.replace(/_normal(\.\w+)$/, "_bigger$1") : undefined,
    verified: author.isBlueVerified === true,
    followers,
    text,
    links,
    media: xMedia(raw),
    likes: count(raw.likeCount),
    reposts: count(raw.retweetCount),
    replies: count(raw.replyCount),
    views: count(raw.viewCount),
  };
  return [...about].map(([token, via]) => ({ ...base, token, via }));
}

export const postKey = (p: { id: string; token: string }) => `${p.id}:${p.token}`;

/** True when the operator took the post, or its account, down. `hidden` holds lowercase ids and "@handles". */
export function isHidden(p: XPost, hidden: ReadonlySet<string>): boolean {
  return hidden.has(p.id) || hidden.has(`@${lower(p.handle)}`);
}

/**
 * What the server keeps after a look: the posts it had and the ones just found (a post found again brings its newer
 * counts), less the ones older than `keepS`, dated ahead of `now`, or taken down; newest first, `max` at most.
 */
export function mergePosts(prev: readonly XPost[], found: readonly XPost[], now: number, hidden: readonly string[] = [], keepS = X_KEEP_S, max = X_MAX_POSTS): XPost[] {
  const byKey = new Map<string, XPost>();
  for (const p of prev) byKey.set(postKey(p), p);
  for (const p of found) byKey.set(postKey(p), p);
  const down = new Set(hidden.map(lower));
  return [...byKey.values()]
    .filter((p) => now - p.time <= keepS && p.time <= now + 300 && !isHidden(p, down))
    .sort((a, b) => b.time - a.time || (a.id < b.id ? 1 : a.id > b.id ? -1 : a.token < b.token ? -1 : 1))
    .slice(0, max);
}

/** The posts the feed shows: newest first, `perCoin` of each coin at most. */
export function xForFeed(posts: readonly XPost[], perCoin = X_PER_COIN_IN_FEED): XPost[] {
  const shown = new Map<string, number>();
  const out: XPost[] = [];
  for (const p of [...posts].sort((a, b) => b.time - a.time)) {
    const n = shown.get(p.token) ?? 0;
    if (n >= perCoin) continue;
    shown.set(p.token, n + 1);
    out.push(p);
  }
  return out;
}

/** "@chimi" or a post id the operator wants down, in the form `hidden` keeps it. undefined when it is neither. */
export function hiddenEntry(input: { id?: unknown; handle?: unknown }): string | undefined {
  if (typeof input.id === "string" && /^\d{1,25}$/.test(input.id)) return input.id;
  const handle = xHandleOf(input.handle);
  return handle ? `@${lower(handle)}` : undefined;
}

/** A post's words cut into plain text, links, and @mentions, for drawing. */
export type XPiece = { text: string; href?: string };

export function xPieces(text: string, links: readonly XLink[]): XPiece[] {
  const escaped = links.map((l) => l.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).filter(Boolean);
  const re = new RegExp([...escaped, "@[A-Za-z0-9_]{1,15}\\b"].join("|"), "g");
  const out: XPiece[] = [];
  let at = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    if (start > at) out.push({ text: text.slice(at, start) });
    const link = links.find((l) => l.text === m[0]);
    // An "@" in the middle of a word (an email address) isn't a mention.
    const mention = !link && (start === 0 || !/[A-Za-z0-9_]/.test(text[start - 1]!));
    out.push(link ? { text: m[0], href: link.href } : mention ? { text: m[0], href: `https://x.com/${m[0].slice(1)}` } : { text: m[0] });
    at = start + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}
