/**
 * Live streams on a coin's page. The rules the API enforces (routes/api/streams.ts) and the page explains. The server
 * and the browser share this one copy, and node can test it directly, so it imports nothing.
 *
 * - A coin's creator links one YouTube or SOOP channel (or one YouTube video) to the coin by signing a message: no
 *   transaction. Linking again replaces it; the creator can remove it the same way.
 * - Chimi doesn't carry the video. Whenever the linked channel is live, the coin's page plays it in that site's own
 *   player, and the coin shows LIVE on the board.
 * - A stream SOOP won't play inside another site (19+ or password) shows a card that opens it there instead. YouTube's
 *   own player explains when a streamer turned embedding off or the stream is age-restricted.
 * - The site's operator can take a link down.
 */
export const STREAMS_VERSION = 1;
export const STREAM_SIGNATURE_TTL_MS = 5 * 60_000;
/** How long a channel's live check is reused before asking YouTube or SOOP again. */
export const STATUS_TTL_MS = 30_000;

export type StreamPlatform = "youtube" | "soop";

/**
 * What a creator linked. `ref` is, for YouTube, the channel's path (`@handle`, `channel/UC…`, `c/name`, `user/name`)
 * or a video's id; for SOOP, the streamer's id.
 */
export type StreamLink = { platform: StreamPlatform; kind: "channel" | "video"; ref: string };

/** What the channel is doing now, as the server last saw it. */
export type StreamStatus = {
  live: boolean;
  /** The stream's title, while live. */
  title?: string;
  /** The channel's name. */
  name?: string;
  viewers?: number;
  /** YouTube: the live video playing now. */
  video?: string;
  /** SOOP: the broadcast's number, for its thumbnail. */
  broadNo?: number;
  /** False when the site won't play it inside another site: it opens there instead. */
  embeddable: boolean;
  /** SOOP marks it 19+. */
  adult?: boolean;
  /** SOOP: a password or subscribers-only broadcast. */
  locked?: boolean;
  /** Unix ms. */
  checkedAt: number;
};

/** One coin's stream as the API hands it out. */
export type StreamView = { token: string; link: StreamLink; url: string; status: StreamStatus };

export type StreamsDoc = {
  version: 1;
  /** coin (lowercase) → its link, who linked it and when. */
  links: Record<string, { link: StreamLink; by: string; at: number }>;
  /** wallet → time of its last signed action, so a signature can't be used twice. */
  lastAction: Record<string, number>;
};

export const emptyStreams = (): StreamsDoc => ({ version: 1, links: {}, lastAction: {} });

export type StreamAction = { type: "set"; link: StreamLink } | { type: "remove" };

const YT_VIDEO = /^[A-Za-z0-9_-]{11}$/;
const YT_HANDLE = /^@[A-Za-z0-9._-]{3,30}$/;
const YT_CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const YT_NAME = /^[A-Za-z0-9._-]{1,100}$/;
const SOOP_ID = /^[a-z0-9_]{3,24}$/;

const YT_HOSTS = new Set(["youtube.com", "m.youtube.com", "youtu.be", "youtube-nocookie.com", "music.youtube.com"]);
const SOOP_PLAY_HOSTS = new Set(["play.sooplive.co.kr", "play.sooplive.com", "play.afreecatv.com", "vod.sooplive.co.kr"]);
const SOOP_STATION_HOSTS = new Set(["sooplive.co.kr", "sooplive.com", "afreecatv.com"]);
const SOOP_CH_HOSTS = new Set(["ch.sooplive.co.kr", "ch.sooplive.com", "bj.afreecatv.com"]);

const NOT_A_LINK = "Paste a link to your YouTube or SOOP channel.";

/** Reads a pasted link (or a YouTube @handle) into what it points at, or says why it can't. */
export function parseStreamLink(input: string): StreamLink | { error: string } {
  const text = input.trim();
  if (!text) return { error: NOT_A_LINK };
  if (YT_HANDLE.test(text)) return { platform: "youtube", kind: "channel", ref: text };
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return { error: NOT_A_LINK };
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const parts = url.pathname.split("/").filter(Boolean).map((p) => decodeURIComponent(p));

  if (YT_HOSTS.has(host)) {
    if (host === "youtu.be") return youtubeVideo(parts[0]);
    const v = url.searchParams.get("v");
    if (parts[0] === "watch" && v) return youtubeVideo(v);
    if ((parts[0] === "live" || parts[0] === "embed" || parts[0] === "shorts") && parts[1]) return youtubeVideo(parts[1]);
    if (parts[0] && YT_HANDLE.test(parts[0])) return { platform: "youtube", kind: "channel", ref: parts[0] };
    if (parts[0] === "channel" && parts[1] && YT_CHANNEL_ID.test(parts[1])) return { platform: "youtube", kind: "channel", ref: `channel/${parts[1]}` };
    if ((parts[0] === "c" || parts[0] === "user") && parts[1] && YT_NAME.test(parts[1])) return { platform: "youtube", kind: "channel", ref: `${parts[0]}/${parts[1]}` };
    return { error: "That YouTube link isn't a channel or a video." };
  }

  let soop: string | undefined;
  if (SOOP_PLAY_HOSTS.has(host) || SOOP_CH_HOSTS.has(host)) soop = parts[0];
  else if (SOOP_STATION_HOSTS.has(host)) soop = parts[0] === "station" ? parts[1] : parts[0];
  if (soop !== undefined) {
    const id = soop.toLowerCase();
    return SOOP_ID.test(id) ? { platform: "soop", kind: "channel", ref: id } : { error: "That SOOP link doesn't name a streamer." };
  }
  return { error: "Only YouTube and SOOP streams can be shown for now." };
}

function youtubeVideo(id: string | undefined): StreamLink | { error: string } {
  return id && YT_VIDEO.test(id) ? { platform: "youtube", kind: "video", ref: id } : { error: "That YouTube link doesn't name a video." };
}

/** True when a stored link is well formed (the API checks this before trusting what a client sends back). */
export function isStreamLink(v: unknown): v is StreamLink {
  if (!v || typeof v !== "object") return false;
  const { platform, kind, ref } = v as Record<string, unknown>;
  if (typeof ref !== "string") return false;
  if (platform === "soop") return kind === "channel" && SOOP_ID.test(ref);
  if (platform !== "youtube") return false;
  if (kind === "video") return YT_VIDEO.test(ref);
  if (kind !== "channel") return false;
  if (YT_HANDLE.test(ref)) return true;
  const [head, tail] = ref.split("/");
  return (head === "channel" && YT_CHANNEL_ID.test(tail ?? "")) || ((head === "c" || head === "user") && YT_NAME.test(tail ?? ""));
}

export const platformName = (p: StreamPlatform) => (p === "youtube" ? "YouTube" : "SOOP");

/** How a link is named in words: "SOOP muse0116", "YouTube @lofigirl", "a YouTube video". */
export function describeLink(link: StreamLink) {
  if (link.platform === "soop") return `SOOP ${link.ref}`;
  if (link.kind === "video") return `YouTube video ${link.ref}`;
  return `YouTube ${link.ref.startsWith("@") ? link.ref : link.ref.split("/")[1]}`;
}

/** Where the channel or video lives on its own site. */
export function linkUrl(link: StreamLink) {
  if (link.platform === "soop") return `https://www.sooplive.co.kr/station/${link.ref}`;
  if (link.kind === "video") return `https://www.youtube.com/watch?v=${link.ref}`;
  return `https://www.youtube.com/${link.ref}`;
}

/** Where to watch it now: the live broadcast, falling back to the channel. */
export function watchUrl(link: StreamLink, status?: StreamStatus) {
  if (link.platform === "soop") return status?.live ? `https://play.sooplive.co.kr/${link.ref}` : linkUrl(link);
  if (status?.video) return `https://www.youtube.com/watch?v=${status.video}`;
  return link.kind === "video" ? linkUrl(link) : `https://www.youtube.com/${link.ref}/live`;
}

/**
 * What the server reads to see whether the channel is live: SOOP's station API, a YouTube channel's Live tab, or for a
 * YouTube video, YouTube's oEmbed answer (which names the video's channel, whose Live tab then says).
 */
export function statusUrl(link: StreamLink) {
  if (link.platform === "soop") return `https://chapi.sooplive.co.kr/api/${link.ref}/station`;
  if (link.kind === "video") return `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${link.ref}`)}`;
  return `https://www.youtube.com/${link.ref}/streams`;
}

/** The channel an oEmbed answer's `author_url` points at, or null. */
export function channelOf(authorUrl: unknown): StreamLink | null {
  if (typeof authorUrl !== "string") return null;
  const link = parseStreamLink(authorUrl);
  return "error" in link || link.platform !== "youtube" || link.kind !== "channel" ? null : link;
}

/** The player to put on the page, or null when it can't play here. Starts muted, as a page full of trades should. */
export function embedUrl(link: StreamLink, status: StreamStatus) {
  if (!status.live || !status.embeddable || status.adult || status.locked) return null;
  if (link.platform === "soop") return `https://play.sooplive.com/${link.ref}/embed`;
  if (!status.video) return null;
  return `https://www.youtube-nocookie.com/embed/${status.video}?autoplay=1&mute=1&playsinline=1&rel=0`;
}

/** A still of the stream, for the card shown when it can't play here. */
export function thumbnailUrl(link: StreamLink, status: StreamStatus) {
  if (link.platform === "soop") return status.broadNo && !status.adult ? `https://liveimg.sooplive.co.kr/m/${status.broadNo}` : undefined;
  return status.video ? `https://i.ytimg.com/vi/${status.video}/hqdefault.jpg` : undefined;
}

export function streamMessage(action: StreamAction, token: string, wallet: string, time: number) {
  const coin = token.toLowerCase();
  const what = action.type === "set" ? `show ${describeLink(action.link)} on ${coin}` : `remove the stream from ${coin}`;
  return `Chimi stream: ${what}\n\nWallet: ${wallet.toLowerCase()}\nTime: ${new Date(time).toISOString()}`;
}

/** Finds the JSON object that starts right after `marker` in a page, reading strings so braces in them don't count. */
export function jsonAfter(text: string, marker: string): unknown {
  const at = text.indexOf(marker);
  if (at < 0) return undefined;
  const start = text.indexOf("{", at + marker.length);
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[^0-9]/g, "")) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

/** "4.4K watching" → 4400; "1,234 watching" → 1234. */
export function watchingCount(text: string | undefined): number | undefined {
  const m = /([\d.,]+)\s*([KMB])?\s+watching/i.exec(text ?? "");
  if (!m) return undefined;
  const n = Number(m[1]!.replace(/,/g, ""));
  const scale = m[2] ? { K: 1e3, M: 1e6, B: 1e9 }[m[2].toUpperCase() as "K" | "M" | "B"] : 1;
  return Number.isFinite(n) ? Math.round(n * scale) : undefined;
}

type Lockup = {
  contentId?: string;
  metadata?: { lockupMetadataViewModel?: { title?: { content?: string } } };
};

/**
 * What a channel's Live tab (`/@handle/streams`) says: a stream that's live now carries a LIVE badge on its
 * thumbnail, newest first. YouTube sends this page to servers as it sends it to people, unlike a video's own page,
 * which a server in a data centre can get as a "confirm you're not a bot" page.
 */
export function readYouTubeLiveTab(html: string, now: number, video?: string): StreamStatus {
  const name = /<meta property="og:title" content="([^"]*)"/.exec(html)?.[1];
  const base = { name: name ? decodeEntities(name) : undefined, checkedAt: now };
  const data = jsonAfter(html, "ytInitialData = ");
  let found: { lockup: Lockup; text: string } | undefined;
  const walk = (o: unknown): void => {
    if (found || !o || typeof o !== "object") return;
    if (Array.isArray(o)) return o.forEach(walk);
    const rec = o as Record<string, unknown>;
    if (rec.lockupViewModel && typeof rec.lockupViewModel === "object") {
      const text = JSON.stringify(rec.lockupViewModel);
      const lockup = rec.lockupViewModel as Lockup;
      if (text.includes("THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE") && (!video || lockup.contentId === video)) found = { lockup, text };
      return;
    }
    Object.values(rec).forEach(walk);
  };
  walk(data);
  const id = found?.lockup.contentId;
  if (!found || !id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return { live: false, ...base, embeddable: false };
  return {
    live: true,
    title: found.lockup.metadata?.lockupMetadataViewModel?.title?.content,
    ...base,
    viewers: watchingCount(/"content":"([^"]*watching[^"]*)"/.exec(found.text)?.[1]),
    video: id,
    // The Live tab doesn't say; YouTube's own player explains if the streamer turned embedding off.
    embeddable: true,
  };
}

function decodeEntities(s: string) {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

/** What SOOP's station API says, or null when there's no such streamer. */
export function readSoopStation(body: unknown, now: number): StreamStatus | null {
  if (!body || typeof body !== "object") return null;
  const b = body as {
    station?: { user_nick?: string };
    broad?: { broad_no?: number; broad_title?: string; current_sum_viewer?: number; broad_grade?: number; is_password?: boolean; subscription_only?: number } | null;
  };
  if (!b.station) return null;
  const name = b.station.user_nick || undefined;
  const broad = b.broad;
  if (!broad || !broad.broad_no) return { live: false, name, embeddable: false, checkedAt: now };
  return {
    live: true,
    title: broad.broad_title || undefined,
    name,
    viewers: num(broad.current_sum_viewer),
    broadNo: broad.broad_no,
    embeddable: true,
    adult: Number(broad.broad_grade) >= 19 || undefined,
    locked: broad.is_password === true || Number(broad.subscription_only) > 0 || undefined,
    checkedAt: now,
  };
}

/** Applies a signed action to the document, or says why it can't. */
export function applyStream(doc: StreamsDoc, token: string, wallet: string, action: StreamAction, now: number): StreamsDoc | { error: string; status: number } {
  const coin = token.toLowerCase();
  const next: StreamsDoc = { ...doc, links: { ...doc.links }, lastAction: { ...doc.lastAction } };
  if (action.type === "set") next.links[coin] = { link: action.link, by: wallet.toLowerCase(), at: now };
  else if (next.links[coin]) delete next.links[coin];
  else return { error: "This coin has no stream linked.", status: 404 };
  return next;
}
