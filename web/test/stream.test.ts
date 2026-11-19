import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyStream,
  describeLink,
  embedUrl,
  emptyStreams,
  isStreamLink,
  jsonAfter,
  parseStreamLink,
  readSoopStation,
  readYouTubePage,
  statusUrl,
  streamMessage,
  watchUrl,
  type StreamLink,
  type StreamStatus,
} from "../src/lib/chimi/stream-rules.ts";

const NOW = 1_800_000_000_000;
const yt = (ref: string, kind: "channel" | "video" = "channel"): StreamLink => ({ platform: "youtube", kind, ref });
const soop = (ref: string): StreamLink => ({ platform: "soop", kind: "channel", ref });

test("YouTube channel links in their usual shapes", () => {
  assert.deepEqual(parseStreamLink("https://www.youtube.com/@LofiGirl"), yt("@LofiGirl"));
  assert.deepEqual(parseStreamLink("youtube.com/@LofiGirl/live"), yt("@LofiGirl"));
  assert.deepEqual(parseStreamLink("@LofiGirl"), yt("@LofiGirl"));
  assert.deepEqual(parseStreamLink("https://m.youtube.com/channel/UCSJ4gkVC6NrvII8umztf0Ow"), yt("channel/UCSJ4gkVC6NrvII8umztf0Ow"));
  assert.deepEqual(parseStreamLink("https://www.youtube.com/c/SomeName/videos"), yt("c/SomeName"));
});

test("YouTube video links in their usual shapes", () => {
  assert.deepEqual(parseStreamLink("https://www.youtube.com/watch?v=4t4AQ15yj1M&t=10"), yt("4t4AQ15yj1M", "video"));
  assert.deepEqual(parseStreamLink("https://youtu.be/4t4AQ15yj1M?si=abc"), yt("4t4AQ15yj1M", "video"));
  assert.deepEqual(parseStreamLink("https://www.youtube.com/live/4t4AQ15yj1M?feature=share"), yt("4t4AQ15yj1M", "video"));
  assert.ok("error" in parseStreamLink("https://www.youtube.com/watch?v=short"));
  assert.ok("error" in parseStreamLink("https://www.youtube.com/feed/subscriptions"));
});

test("SOOP links in their usual shapes, read as the streamer's id", () => {
  for (const link of [
    "https://play.sooplive.co.kr/muse0116",
    "https://play.sooplive.co.kr/muse0116/298689375",
    "play.sooplive.com/Muse0116/embed",
    "https://www.sooplive.co.kr/station/muse0116",
    "https://ch.sooplive.co.kr/muse0116",
    "https://bj.afreecatv.com/muse0116",
    "http://play.afreecatv.com/muse0116",
  ]) {
    assert.deepEqual(parseStreamLink(link), soop("muse0116"), link);
  }
  assert.ok("error" in parseStreamLink("https://www.sooplive.co.kr/station/"));
});

test("anything else is refused with a reason", () => {
  for (const bad of ["", "   ", "hello there", "https://chzzk.naver.com/live/7ce8032370ac5121dcabce7bad375ced", "https://twitch.tv/someone"]) {
    const out = parseStreamLink(bad);
    assert.ok("error" in out && out.error.length > 0, bad);
  }
});

test("a stored link is only trusted when it's well formed", () => {
  assert.ok(isStreamLink(yt("@LofiGirl")));
  assert.ok(isStreamLink(yt("channel/UCSJ4gkVC6NrvII8umztf0Ow")));
  assert.ok(isStreamLink(yt("4t4AQ15yj1M", "video")));
  assert.ok(isStreamLink(soop("muse0116")));
  assert.ok(!isStreamLink(yt("../../evil")));
  assert.ok(!isStreamLink(yt("channel/../../x")));
  assert.ok(!isStreamLink(soop("Muse0116")));
  assert.ok(!isStreamLink({ platform: "twitch", kind: "channel", ref: "x" }));
});

test("where the server looks and where people watch", () => {
  assert.equal(statusUrl(yt("@LofiGirl")), "https://www.youtube.com/@LofiGirl/live");
  assert.equal(statusUrl(yt("4t4AQ15yj1M", "video")), "https://www.youtube.com/watch?v=4t4AQ15yj1M");
  assert.equal(statusUrl(soop("muse0116")), "https://chapi.sooplive.co.kr/api/muse0116/station");
  const live: StreamStatus = { live: true, video: "4t4AQ15yj1M", embeddable: true, checkedAt: NOW };
  assert.equal(watchUrl(yt("@LofiGirl"), live), "https://www.youtube.com/watch?v=4t4AQ15yj1M");
  assert.equal(watchUrl(soop("muse0116"), { ...live, video: undefined }), "https://play.sooplive.co.kr/muse0116");
  assert.equal(watchUrl(soop("muse0116"), { live: false, embeddable: false, checkedAt: NOW }), "https://www.sooplive.co.kr/station/muse0116");
});

test("the player only goes on the page when it can play there", () => {
  const live: StreamStatus = { live: true, video: "4t4AQ15yj1M", embeddable: true, checkedAt: NOW };
  assert.match(embedUrl(yt("@LofiGirl"), live)!, /^https:\/\/www\.youtube-nocookie\.com\/embed\/4t4AQ15yj1M\?autoplay=1&mute=1/);
  assert.equal(embedUrl(soop("muse0116"), { ...live, video: undefined }), "https://play.sooplive.com/muse0116/embed");
  assert.equal(embedUrl(yt("@LofiGirl"), { ...live, embeddable: false }), null);
  assert.equal(embedUrl(soop("muse0116"), { ...live, adult: true }), null);
  assert.equal(embedUrl(soop("muse0116"), { ...live, locked: true }), null);
  assert.equal(embedUrl(yt("@LofiGirl"), { ...live, live: false }), null);
});

const page = (player: unknown, extra = "") =>
  `<html><head><meta property="og:title" content="Lofi Girl &amp; Friends"></head><body><script>var ytInitialPlayerResponse = ${JSON.stringify(player)};var meta = {"a":"}"};</script>${extra}</body></html>`;

test("a live YouTube page reads as live, with its video, title and viewers", () => {
  const html = page(
    {
      playabilityStatus: { status: "OK", playableInEmbed: true },
      videoDetails: { videoId: "4t4AQ15yj1M", title: 'lofi {radio} "live"', author: "Lofi Girl", isLive: true },
      microformat: { playerMicroformatRenderer: { liveBroadcastDetails: { isLiveNow: true }, isFamilySafe: true } },
    },
    '<script>{"viewCount":{"runs":[{"text":"4,944"},{"text":" watching now"}]}}</script>',
  );
  assert.deepEqual(readYouTubePage(html, NOW), {
    live: true,
    title: 'lofi {radio} "live"',
    name: "Lofi Girl",
    viewers: 4944,
    video: "4t4AQ15yj1M",
    embeddable: true,
    adult: undefined,
    checkedAt: NOW,
  });
});

test("an offline channel page and an old video read as not live", () => {
  assert.deepEqual(readYouTubePage("<html><head><meta property=\"og:title\" content=\"Lofi Girl &amp; Friends\"></head></html>", NOW), {
    live: false,
    name: "Lofi Girl & Friends",
    embeddable: false,
    checkedAt: NOW,
  });
  const old = readYouTubePage(page({ playabilityStatus: { status: "OK", playableInEmbed: true }, videoDetails: { videoId: "dQw4w9WgXcQ", title: "x", author: "Rick" } }), NOW);
  assert.equal(old.live, false);
});

test("a live YouTube video with embedding off can't play here", () => {
  const html = page({ playabilityStatus: { status: "OK", playableInEmbed: false }, videoDetails: { videoId: "4t4AQ15yj1M", isLive: true } });
  const status = readYouTubePage(html, NOW);
  assert.equal(status.live, true);
  assert.equal(status.embeddable, false);
});

test("a bot check on the server's request doesn't keep a live stream off the page", () => {
  const html = page({ playabilityStatus: { status: "LOGIN_REQUIRED", reason: "Sign in to confirm you're not a bot" }, videoDetails: { videoId: "4t4AQ15yj1M", isLive: true } });
  assert.equal(readYouTubePage(html, NOW).embeddable, true);
  const gone = page({ playabilityStatus: { status: "UNPLAYABLE" }, videoDetails: { videoId: "4t4AQ15yj1M", isLive: true } });
  assert.equal(readYouTubePage(gone, NOW).embeddable, false);
  const age = page({
    playabilityStatus: { status: "LOGIN_REQUIRED" },
    videoDetails: { videoId: "4t4AQ15yj1M", isLive: true },
    microformat: { playerMicroformatRenderer: { isFamilySafe: false } },
  });
  assert.equal(embedUrl(yt("@x"), readYouTubePage(age, NOW)), null);
});

test("braces and quotes inside strings don't end the JSON early", () => {
  assert.deepEqual(jsonAfter('x = {"a":"} {","b":{"c":"\\"}"}}; y', "x = "), { a: "} {", b: { c: '"}' } });
  assert.equal(jsonAfter("nothing here", "x = "), undefined);
  assert.equal(jsonAfter('x = {"a": 1', "x = "), undefined);
});

test("SOOP's station: live, offline, 19+, password, and no such streamer", () => {
  const station = { user_nick: "뮤즈_MUSE" };
  const broad = { broad_no: 298689375, broad_title: "배추", current_sum_viewer: 749, broad_grade: 0, is_password: false, subscription_only: 0 };
  assert.deepEqual(readSoopStation({ station, broad }, NOW), {
    live: true,
    title: "배추",
    name: "뮤즈_MUSE",
    viewers: 749,
    broadNo: 298689375,
    embeddable: true,
    adult: undefined,
    locked: undefined,
    checkedAt: NOW,
  });
  assert.deepEqual(readSoopStation({ station, broad: null }, NOW), { live: false, name: "뮤즈_MUSE", embeddable: false, checkedAt: NOW });
  assert.equal(readSoopStation({ station, broad: { ...broad, broad_grade: 19 } }, NOW)?.adult, true);
  assert.equal(readSoopStation({ station, broad: { ...broad, is_password: true } }, NOW)?.locked, true);
  assert.equal(readSoopStation({ code: 9000, message: "x" }, NOW), null);
});

test("the signed message names the coin, the link, the wallet and the time", () => {
  const msg = streamMessage({ type: "set", link: soop("muse0116") }, "0xABC0000000000000000000000000000000000001", "0xDEF0000000000000000000000000000000000002", NOW);
  assert.equal(
    msg,
    "Chimi stream: show SOOP muse0116 on 0xabc0000000000000000000000000000000000001\n\nWallet: 0xdef0000000000000000000000000000000000002\nTime: 2027-01-15T08:00:00.000Z",
  );
  assert.match(streamMessage({ type: "remove" }, "0xABC0000000000000000000000000000000000001", "0xd", NOW), /^Chimi stream: remove the stream from 0xabc0/);
  assert.equal(describeLink(yt("channel/UCSJ4gkVC6NrvII8umztf0Ow")), "YouTube UCSJ4gkVC6NrvII8umztf0Ow");
});

test("linking replaces, removing deletes, removing nothing is refused", () => {
  const coin = "0xAbC0000000000000000000000000000000000001";
  const one = applyStream(emptyStreams(), coin, "0xD", { type: "set", link: soop("muse0116") }, NOW);
  assert.ok(!("error" in one));
  assert.deepEqual(one.links[coin.toLowerCase()], { link: soop("muse0116"), by: "0xd", at: NOW });
  const two = applyStream(one, coin, "0xd", { type: "set", link: yt("@LofiGirl") }, NOW + 1);
  assert.ok(!("error" in two));
  assert.equal(two.links[coin.toLowerCase()]!.link.platform, "youtube");
  const gone = applyStream(two, coin, "0xd", { type: "remove" }, NOW + 2);
  assert.ok(!("error" in gone));
  assert.deepEqual(gone.links, {});
  assert.deepEqual(applyStream(gone, coin, "0xd", { type: "remove" }, NOW + 3), { error: "This coin has no stream linked.", status: 404 });
});
