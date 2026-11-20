import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFeed, forYou, fromFollowed } from "../src/lib/chimi/feed-rules.ts";
import {
  X_QUERY_MAX,
  coinInLink,
  coinIndex,
  hiddenEntry,
  mergePosts,
  orQueries,
  readTweet,
  xForFeed,
  xHandleOf,
  xPieces,
  xSearches,
  xText,
  xTime,
  type RawTweet,
  type XPost,
} from "../src/lib/chimi/x-rules.ts";

const COIN = "0xc01c01c01c01c01c01c01c01c01c01c01c01c01c";
const OTHER = "0xd0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0";
const UNKNOWN = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const NOW = 1_800_000_000;
const index = coinIndex([{ token: COIN, handle: "DalnimCoin" }, { token: OTHER }]);

/** "Tue Dec 10 07:00:30 +0000 2024", the way X writes a time, for unix seconds. */
const xDate = (s: number) => {
  const d = new Date(s * 1000);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const p = (n: number) => String(n).padStart(2, "0");
  return `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000 ${d.getUTCFullYear()}`;
};

const tweet = (over: Partial<RawTweet> = {}, author: Partial<NonNullable<RawTweet["author"]>> = {}): RawTweet => ({
  id: "1900000000000000001",
  text: "gm",
  createdAt: xDate(NOW - 600),
  likeCount: 12,
  retweetCount: 3,
  replyCount: 2,
  viewCount: 900,
  isReply: false,
  author: { userName: "someone", name: "Some One", profilePicture: "https://pbs.twimg.com/profile_images/1/a_normal.jpg", isBlueVerified: false, followers: 500, ...author },
  entities: { urls: [] },
  ...over,
});

test("a handle is read from what a creator might type, and only a real handle", () => {
  assert.equal(xHandleOf("chimi"), "chimi");
  assert.equal(xHandleOf(" @Chimi_Club "), "Chimi_Club");
  assert.equal(xHandleOf("https://x.com/chimi?s=21"), "chimi");
  assert.equal(xHandleOf("twitter.com/@chimi/status/123"), "chimi");
  assert.equal(xHandleOf("https://mobile.twitter.com/chimi"), "chimi");
  assert.equal(xHandleOf("https://x.com/home"), undefined);
  assert.equal(xHandleOf("has space"), undefined);
  assert.equal(xHandleOf("abcdefghijklmnop"), undefined); // 16 characters
  assert.equal(xHandleOf("from:evil OR x"), undefined);
  assert.equal(xHandleOf(undefined), undefined);
});

test("X's time format is read exactly, offsets included", () => {
  assert.equal(xTime("Tue Dec 10 07:00:30 +0000 2024"), Date.UTC(2024, 11, 10, 7, 0, 30) / 1000);
  assert.equal(xTime("Tue Dec 10 09:00:30 +0200 2024"), Date.UTC(2024, 11, 10, 7, 0, 30) / 1000);
  assert.equal(xTime("2024-12-10T07:00:30Z"), Date.UTC(2024, 11, 10, 7, 0, 30) / 1000);
  assert.equal(xTime("not a date"), undefined);
  assert.equal(xTime(42), undefined);
});

test("searches are split to fit X's length limit and every term is asked once", () => {
  const terms = Array.from({ length: 60 }, (_, i) => `from:handle_${String(i).padStart(3, "0")}`);
  const queries = orQueries(terms, "-filter:replies since_time:1");
  assert.ok(queries.length > 1);
  for (const q of queries) assert.ok(q.length <= X_QUERY_MAX, `${q.length}`);
  const asked = queries.flatMap((q) => q.slice(1, q.indexOf(")")).split(" OR "));
  assert.deepEqual(asked, terms);
  assert.deepEqual(orQueries([], "tail"), []);
  assert.deepEqual(orQueries(["x".repeat(600)], "tail"), []);
});

test("one look asks for the coins' accounts, and for links to Chimi and contract addresses", () => {
  const queries = xSearches({ handles: ["DalnimCoin", "dalnimcoin", "bad handle"], tokens: [COIN, COIN.toUpperCase().replace("0X", "0x"), "nope"], since: NOW - 3600.7 });
  assert.equal(queries.length, 2);
  assert.equal(queries[0], `(from:dalnimcoin) -filter:replies -filter:retweets since_time:${NOW - 3601}`);
  assert.equal(queries[1], `(url:chimi.club OR url:chimi-sage.vercel.app OR "${COIN}") -filter:replies -filter:retweets since_time:${NOW - 3601}`);
  // No coin has an account: only the second search.
  assert.equal(xSearches({ handles: [], tokens: [], since: NOW }).length, 1);
});

test("a coin is read out of a link to its page on Chimi", () => {
  assert.equal(coinInLink(`https://www.chimi.club/coin/${COIN.toUpperCase().replace("0X", "0x")}`), COIN);
  assert.equal(coinInLink(`https://chimi.club/coin/${COIN}?tab=x`), COIN);
  assert.equal(coinInLink(`https://chimi-sage.vercel.app/coin/${COIN}/`), COIN);
  assert.equal(coinInLink(`https://evil.example/coin/${COIN}`), undefined);
  assert.equal(coinInLink(`https://www.chimi.club/u/${COIN}`), undefined);
  assert.equal(coinInLink("not a link"), undefined);
});

test("a post from the coin's own account belongs to the coin, whatever it says", () => {
  const posts = readTweet(tweet({ text: "Stream at 9" }, { userName: "dalnimcoin", followers: 3 }), index);
  assert.equal(posts.length, 1);
  const p = posts[0]!;
  assert.equal(p.token, COIN);
  assert.equal(p.via, "account");
  assert.equal(p.url, "https://x.com/dalnimcoin/status/1900000000000000001");
  assert.equal(p.time, NOW - 600);
  assert.equal(p.avatar, "https://pbs.twimg.com/profile_images/1/a_bigger.jpg");
  assert.deepEqual([p.likes, p.reposts, p.replies, p.views], [12, 3, 2, 900]);
});

test("a stranger's post belongs to every coin it links to or names", () => {
  const raw = tweet({
    text: `aping https://t.co/abc and ${OTHER.toUpperCase().replace("0X", "0x")} and ${UNKNOWN}`,
    entities: { urls: [{ url: "https://t.co/abc", display_url: "chimi.club/coin/0xc01c…", expanded_url: `https://www.chimi.club/coin/${COIN}` }] },
  });
  const posts = readTweet(raw, index);
  assert.deepEqual(
    posts.map((p) => [p.token, p.via]),
    [
      [COIN, "link"],
      [OTHER, "address"],
    ],
  );
  assert.equal(posts[0]!.text, `aping chimi.club/coin/0xc01c… and ${OTHER.toUpperCase().replace("0X", "0x")} and ${UNKNOWN}`);
  assert.deepEqual(posts[0]!.links, [{ text: "chimi.club/coin/0xc01c…", href: `https://www.chimi.club/coin/${COIN}` }]);
});

test("posts not fit to show are left out", () => {
  const about = { text: `buy ${COIN}` };
  assert.equal(readTweet(tweet(about), index).length, 1);
  assert.equal(readTweet(tweet({ ...about, isRetweet: true }), index).length, 0);
  assert.equal(readTweet(tweet({ ...about, retweeted_tweet: { id: "1" } }), index).length, 0);
  assert.equal(readTweet(tweet({ ...about, isReply: true }), index).length, 0);
  assert.equal(readTweet(tweet({ ...about, possiblySensitive: true }), index).length, 0);
  assert.equal(readTweet(tweet(about, { followers: 9 }), index).length, 0);
  assert.equal(readTweet(tweet(about, { protected: true }), index).length, 0);
  assert.equal(readTweet(tweet(about, { userName: "bad name" }), index).length, 0);
  assert.equal(readTweet(tweet({ ...about, id: "12abc" }), index).length, 0);
  assert.equal(readTweet(tweet({ ...about, createdAt: "whenever" }), index).length, 0);
  assert.equal(readTweet(tweet({ text: "about nothing here" }), index).length, 0);
  // The coin's own account may reply: its replies aren't searched for, but a stray one isn't dropped either.
  assert.equal(readTweet(tweet({ isReply: true }, { userName: "DalnimCoin" }), index).length, 1);
});

test("the words drop the media link, write out short links, and undo X's escapes", () => {
  const raw = tweet({
    text: "Tom &amp; Jerry &lt;3 https://t.co/site\n\n\n\nmore https://t.co/pic",
    entities: { urls: [{ url: "https://t.co/site", display_url: "example.com/a", expanded_url: "https://example.com/a" }] },
    extendedEntities: { media: [{ type: "photo", url: "https://t.co/pic", media_url_https: "https://pbs.twimg.com/media/A.jpg", original_info: { width: 1200, height: 800 } }] },
  });
  const { text, links } = xText(raw);
  assert.equal(text, "Tom & Jerry <3 example.com/a\n\nmore");
  assert.deepEqual(links, [{ text: "example.com/a", href: "https://example.com/a" }]);
  assert.equal(xText(tweet({ text: "a".repeat(700) }), 600).text.length, 600);
});

test("media comes only from X's image host, four at most, with videos as their stills", () => {
  const media = Array.from({ length: 5 }, (_, i) => ({ type: i === 1 ? "video" : i === 2 ? "animated_gif" : "photo", media_url_https: `https://pbs.twimg.com/media/${i}.jpg` }));
  const p = readTweet(tweet({ text: `${COIN}`, extendedEntities: { media: [{ type: "photo", media_url_https: "https://evil.example/x.jpg" }, ...media] } }), index)[0]!;
  assert.deepEqual(
    p.media.map((m) => [m.kind, m.url]),
    [
      ["photo", "https://pbs.twimg.com/media/0.jpg"],
      ["video", "https://pbs.twimg.com/media/1.jpg"],
      ["gif", "https://pbs.twimg.com/media/2.jpg"],
      ["photo", "https://pbs.twimg.com/media/3.jpg"],
    ],
  );
  assert.equal(readTweet(tweet({ text: COIN }, { profilePicture: "https://evil.example/a.jpg" }), index)[0]!.avatar, undefined);
});

const post = (over: Partial<XPost> = {}): XPost => ({
  id: "1",
  token: COIN,
  via: "link",
  url: "https://x.com/a/status/1",
  time: NOW - 60,
  handle: "a",
  name: "A",
  verified: false,
  followers: 100,
  text: "hi",
  links: [],
  media: [],
  likes: 0,
  reposts: 0,
  replies: 0,
  views: 0,
  ...over,
});

test("a look keeps what it had, takes new counts, and lets old and taken-down posts go", () => {
  const kept = [post({ id: "1", likes: 1 }), post({ id: "2", time: NOW - 8 * 86_400 }), post({ id: "3", handle: "Spammer" }), post({ id: "4" })];
  const found = [post({ id: "1", likes: 9 }), post({ id: "5", time: NOW - 10 }), post({ id: "6", time: NOW + 3600 })];
  const merged = mergePosts(kept, found, NOW, ["@spammer", "4"]);
  assert.deepEqual(
    merged.map((p) => [p.id, p.likes]),
    [
      ["5", 0],
      ["1", 9],
    ],
  );
  assert.equal(mergePosts(Array.from({ length: 10 }, (_, i) => post({ id: String(i), time: NOW - i })), [], NOW, [], 86_400, 3).length, 3);
});

test("the feed shows a few posts per coin at most", () => {
  const posts = [...Array.from({ length: 5 }, (_, i) => post({ id: `c${i}`, time: NOW - i })), post({ id: "o1", token: OTHER })];
  const shown = xForFeed(posts, 3);
  assert.deepEqual(
    shown.map((p) => p.id),
    ["c0", "c1", "c2", "o1"],
  );
});

test("posts on X are For you items, newest first among the rest, and never in Following", () => {
  const items = buildFeed({
    trades: [],
    launches: [],
    comments: [{ id: "c", token: COIN, wallet: "0x1111111111111111111111111111111111111111", text: "gm", time: NOW - 30 }],
    x: [post({ id: "9", token: COIN.toUpperCase().replace("0X", "0x"), time: NOW - 10 })],
    following: ["0x1111111111111111111111111111111111111111"],
    now: NOW,
  });
  assert.deepEqual(
    items.map((i) => [i.kind, i.key]),
    [
      ["x", `x:9:${COIN}`],
      ["comment", `comment:${COIN}:c`],
    ],
  );
  assert.equal(forYou(items)[0]!.kind, "x");
  assert.deepEqual(
    fromFollowed(items).map((i) => i.kind),
    ["comment"],
  );
});

test("the operator takes a post down by id or an account by handle", () => {
  assert.equal(hiddenEntry({ id: "1900000000000000001" }), "1900000000000000001");
  assert.equal(hiddenEntry({ handle: "@SpamBot" }), "@spambot");
  assert.equal(hiddenEntry({ handle: "https://x.com/SpamBot" }), "@spambot");
  assert.equal(hiddenEntry({ id: "x1" }), undefined);
  assert.equal(hiddenEntry({}), undefined);
});

test("a post's words are cut into text, its links and its mentions", () => {
  assert.deepEqual(xPieces("hi @chimi see example.com/a, mail a@b.co", [{ text: "example.com/a", href: "https://example.com/a" }]), [
    { text: "hi " },
    { text: "@chimi", href: "https://x.com/chimi" },
    { text: " see " },
    { text: "example.com/a", href: "https://example.com/a" },
    { text: ", mail a" },
    { text: "@b" },
    { text: ".co" },
  ]);
  assert.deepEqual(xPieces("", []), []);
});
