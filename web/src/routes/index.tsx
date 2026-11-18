import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { compactUsd, ethText } from "@/lib/chimi/format";
import { useHomeFeed, type HomeFeed } from "@/lib/chimi/feed";
import { freshnessKey, type FeedItem, type Suggestion } from "@/lib/chimi/feed-rules";
import { heldKey, useHeldShares } from "@/lib/chimi/holdings";
import { usePoolEth } from "@/lib/chimi/live";
import { poolKey, short } from "@/lib/chimi/market";
import { DAILY_POOL, dayEndMs, today, type Profile } from "@/lib/chimi/points-rules";
import { fmtPoints, useProfiles } from "@/lib/chimi/rewards";
import { useTokenImages } from "@/lib/chimi/token-image";
import { CreatorFeesMini } from "@/components/chimi/creator-fees";
import { FeedRow, QuickAmount, RowSkeleton, Ticker, holdersIn, walletsIn, type RowContext } from "@/components/chimi/feed-rows";
import { HomeTop, type HeroStat } from "@/components/chimi/feed-hero";
import { FollowButton } from "@/components/chimi/follow";
import { HomeBoard } from "@/components/chimi/home-board";
import { Leaders } from "@/components/chimi/home-leaders";
import { IconArrowUp, IconChevronDown, IconChevronRight, IconPlus, IconPoints } from "@/components/chimi/icons";
import { useChimi } from "@/components/chimi/provider";
import { DojangMark, duration, useNow } from "@/components/chimi/rewards-bits";
import { toast } from "@/components/chimi/toast";
import { Empty, Seg, TraderLink } from "@/components/chimi/ui";

/**
 * The home page is the feed and the board together. The feed leads: who is buying, selling, launching and saying
 * what, newest first, with the traders and houses worth following beside it. Right under it is the board: every
 * trading pair, ranked, next to the pairs that have just launched. Nothing here needs another page to be read; the
 * full tables are at /board and /traders.
 */
export const Route = createFileRoute("/")({ component: Home });

type Tab = "foryou" | "following";

const TAB_KEY = "chimi.feed.tab";
/** Rows are small, so a page of the opened feed is a few screens of them. */
const PAGE = 30;
/** Rows drawn while the feed is folded to its panel: more than the tallest panel holds. */
const FOLDED = 14;

function Home() {
  const { account, connect, coins, deployment, preview, note, refresh, loading } = useChimi();
  const nowMs = useNow(30_000);
  const feed = useHomeFeed(nowMs);
  const listed = preview ? coins : feed.live;
  const images = useTokenImages(useMemo(() => listed.map((coin) => coin.token), [listed]));
  const reserves = usePoolEth(feed.live, deployment);
  const [tab, setTab] = useState<Tab>("foryou");
  const [shown, setShown] = useState(PAGE);
  // Folded, the feed is a panel beside the leaders with the board under it. Opened, it runs as long as it likes.
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(TAB_KEY) === "following") setTab("following");
    } catch {
      /* private mode */
    }
  }, []);
  const pick = (next: Tab) => {
    setTab(next);
    setShown(PAGE);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      /* private mode */
    }
  };

  const list: FeedItem[] = feed.tabs[tab];
  const page = list.slice(0, open ? shown : FOLDED);

  // Rows that arrive while the page is open rise into place; the ones it opened with stay still. If the reader
  // has scrolled down, a pill says how many came in above.
  const seen = useRef<{ tab: Tab; keys: Set<string> } | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const [unseen, setUnseen] = useState(0);
  const settled = !feed.waiting && feed.tradesReady && !feed.refreshing;
  useEffect(() => {
    if (!settled) return;
    const keys = list.map(freshnessKey);
    if (!seen.current || seen.current.tab !== tab) {
      seen.current = { tab, keys: new Set(keys) };
      setFresh(new Set());
      setUnseen(0);
      return;
    }
    const added = keys.filter((key) => !seen.current!.keys.has(key));
    if (added.length === 0) return;
    for (const key of added) seen.current.keys.add(key);
    // A flood (the page woke after a long sleep) is a reload, not news.
    if (added.length > 8) return;
    setFresh(new Set(added));
    if (window.scrollY > 480) setUnseen((n) => n + added.length);
  }, [list, tab, settled]);
  useEffect(() => {
    if (unseen === 0) return;
    const onScroll = () => {
      if (window.scrollY < 240) setUnseen(0);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [unseen]);

  // Folded, the panel cuts the list where its height ends. Whether anything is cut decides if "Show more" is there.
  const body = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [cut, setCut] = useState(false);
  useEffect(() => {
    const el = body.current;
    if (!el || open || typeof ResizeObserver === "undefined") {
      setCut(false);
      return;
    }
    const measure = () => setCut(el.scrollHeight - el.clientHeight > 12);
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    if (inner.current) watch.observe(inner.current);
    return () => watch.disconnect();
  }, [open]);
  const more = !open && (cut || list.length > page.length);
  const fold = () => {
    setOpen(false);
    setShown(PAGE);
  };
  // Folding from far down the opened feed would leave the reader in the middle of the board, so once the panel has
  // shrunk the page goes back to its top.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) document.getElementById("feed")?.scrollIntoView({ block: "start" });
    wasOpen.current = open;
  }, [open]);

  const profiles = useProfiles(
    useMemo(() => [...new Set([...walletsIn(feed.items.slice(0, 60)), ...walletsIn(page), ...feed.suggestions.map((s) => s.wallet)])], [feed.items, page, feed.suggestions]),
    feed.points?.file.profiles,
  );
  // The proof beside a name: what the wallet holds of the coin right now, and its place in the season.
  const held = useHeldShares(
    useMemo(() => holdersIn(page), [page]),
    feed.trades.length,
  );
  const bought = useMemo(() => new Set(feed.trades.filter((t) => t.buy).map((t) => heldKey(t.token, t.wallet))), [feed.trades]);
  const ranks = useMemo(() => new Map((feed.points?.season ?? []).filter((s) => s.rank <= 10 && s.points > 0).map((s) => [s.wallet.toLowerCase(), s.rank])), [feed.points]);
  const ctx: RowContext = { byToken: feed.byToken, images, stats: feed.stats, profiles, ethUsd: feed.ethUsd, now: feed.now, me: feed.me, held, bought, ranks };

  const usd = (eth: number | undefined) => (eth === undefined ? "—" : feed.ethUsd ? compactUsd(eth * feed.ethUsd) : `${ethText(eth)} ETH`);
  const totals = useMemo(() => {
    const all = Object.values(feed.stats);
    const pools = feed.live.map((c) => reserves[poolKey(c)]);
    return {
      capEth: all.reduce((sum, s) => sum + s.capEth, 0),
      volEth: all.every((s) => s.volEth !== undefined) ? all.reduce((sum, s) => sum + (s.volEth ?? 0), 0) : undefined,
      liqEth: pools.length > 0 && pools.every((wei) => wei !== undefined) ? pools.reduce((sum, wei) => sum + Number(wei) / 1e18, 0) : undefined,
    };
  }, [feed.stats, feed.live, reserves]);
  const heroStats: HeroStat[] = [
    ["Pairs", loading ? null : feed.live.length.toLocaleString("en-US")],
    ["24h volume", loading ? null : usd(totals.volEth)],
    ["Market cap", loading ? null : usd(feed.hasCoins ? totals.capEth : undefined)],
    ["Liquidity", loading ? null : usd(totals.liqEth)],
  ];

  const failed = !loading && !feed.hasCoins && !preview && !!note;
  const joinIn = () =>
    void connect().catch((err: unknown) => {
      const text = short(err);
      if (!/reject|denied|cancel/i.test(text)) toast({ kind: "bad", title: "Couldn’t connect", body: text });
    });

  return (
    <main className="pb-16">
      <div className="border-b border-line/70 bg-bg/45 backdrop-blur-sm">
        <div className="page">
          <Ticker items={feed.items} ctx={ctx} />
        </div>
      </div>

      <HomeTop stats={heroStats} live={!preview} />

      {unseen > 0 ? (
        <button
          type="button"
          onClick={() => {
            window.scrollTo({ top: 0, behavior: "smooth" });
            setUnseen(0);
          }}
          className="new-pill"
        >
          <IconArrowUp size={14} />
          {unseen} new
        </button>
      ) : null}

      <div className="page home-grid">
        <section id="feed" className="card home-feed scroll-mt-20" data-folded={open ? undefined : ""} aria-labelledby="feed-title">
          <div className="flex items-center gap-2.5 px-3 pt-3 pb-2.5 sm:gap-3 sm:px-4">
            <h2 id="feed-title" className="sr-only text-[17px] font-semibold tracking-[-0.02em] whitespace-nowrap sm:not-sr-only">
              {account ? "Your feed" : "The feed"}
            </h2>
            <Seg
              label="Which feed"
              value={tab}
              onChange={pick}
              options={[
                ["foryou", "For you"],
                ["following", `Following${feed.me && feed.following.length ? ` · ${feed.following.length}` : ""}`],
              ]}
            />
            <span className="ml-auto hidden shrink-0 items-center gap-2 text-[12.5px] text-muted sm:flex" role="status">
              {feed.waiting || feed.refreshing ? (
                <>
                  <span className="spinner" aria-hidden />
                  Updating
                </>
              ) : (
                <>
                  <span className="live-dot text-ok" />
                  Live
                </>
              )}
            </span>
            <QuickAmount className="ml-auto sm:ml-0" />
          </div>

          <div ref={body} className="home-feed-body border-t border-line/70">
            <div ref={inner}>
              {feed.waiting ? (
                <ul aria-hidden>
                  {Array.from({ length: 8 }, (_, i) => (
                    <RowSkeleton key={i} />
                  ))}
                </ul>
              ) : failed ? (
                <Empty
                  mark="끊김"
                  title="Couldn’t reach GIWA"
                  action={
                    <button type="button" onClick={() => void refresh().catch(() => undefined)} className="btn btn-secondary">
                      Try again
                    </button>
                  }
                >
                  The feed reads straight from the chain and the node didn’t answer. {note}
                </Empty>
              ) : !feed.hasCoins ? (
                <Empty
                  mark="첫 코인"
                  title="Nothing has launched yet"
                  action={
                    <Link to="/launch" className="btn btn-primary">
                      <IconPlus size={17} />
                      Launch the first coin
                    </Link>
                  }
                >
                  The feed fills with buys, launches and comments as soon as there is a coin to trade.
                </Empty>
              ) : tab === "following" && !feed.me ? (
                <Empty
                  mark="팔로우"
                  title="See what the traders you follow are doing"
                  action={
                    <button type="button" onClick={joinIn} className="btn btn-light">
                      Connect wallet
                    </button>
                  }
                >
                  Follow a wallet and every buy, sale, launch and comment it makes on Chimi shows up here.
                </Empty>
              ) : tab === "following" && feed.following.length === 0 ? (
                <div className="p-4 sm:p-5">
                  <p className="text-[15px] font-semibold">You aren’t following anyone yet</p>
                  <p className="mt-1 text-sm text-muted">Start with a few of the busiest traders. Following is a signature, not a transaction, and needs a Dojang.</p>
                  <Suggestions items={feed.suggestions} profiles={profiles} usd={usd} />
                </div>
              ) : (
                <>
                  {!feed.tradesReady ? <TradesOnTheWay /> : tab === "foryou" && feed.quiet ? <QuietLead feed={feed} usd={usd} /> : null}
                  {page.length === 0 ? (
                    <Empty mark="조용함" title={tab === "following" ? "Nothing from the wallets you follow yet" : "Nothing here yet"}>
                      {tab === "following" ? `When any of the ${feed.following.length} you follow buys, sells, launches or comments, it shows up here.` : "When someone trades, launches or comments, it shows up here within a minute."}
                    </Empty>
                  ) : (
                    <ul>
                      {page.map((item) => (
                        <FeedRow key={item.key} item={item} ctx={ctx} fresh={fresh.has(freshnessKey(item))} />
                      ))}
                    </ul>
                  )}
                  {open && tab === "following" && feed.following.length > 0 && feed.following.length < 3 && feed.suggestions.length > 0 ? (
                    <div className="border-t border-line/70 p-4 sm:p-5">
                      <p className="th uppercase">More to follow</p>
                      <Suggestions items={feed.suggestions.slice(0, 3)} profiles={profiles} usd={usd} />
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>

          {more ? (
            <div className="home-feed-more">
              <button type="button" onClick={() => setOpen(true)} className="btn btn-sm btn-secondary">
                Show more
                <IconChevronDown size={14} />
              </button>
            </div>
          ) : null}
          {open ? (
            <div className="flex items-center justify-between gap-3 border-t border-line/70 px-3 py-2 sm:px-4">
              {list.length > shown ? (
                <button type="button" onClick={() => setShown((n) => n + PAGE)} className="text-[13px] font-medium text-muted hover:text-fg">
                  Show more ({list.length - shown} left)
                </button>
              ) : (
                <span className="text-[12.5px] text-faint">That’s everything so far</span>
              )}
              <button type="button" onClick={fold} className="btn btn-sm btn-secondary">
                Fold the feed
                <IconChevronDown size={14} className="rotate-180" />
              </button>
            </div>
          ) : null}
        </section>

        <div className="home-leaders">
          <Leaders points={feed.points} trades={feed.trades} now={feed.now} me={feed.me} ethUsd={feed.ethUsd} waiting={feed.waiting || !feed.tradesReady} />
        </div>

        <div className="home-board">
          <HomeBoard coins={listed} stats={feed.stats} images={images} ethUsd={feed.ethUsd} launched={feed.launched} known={feed.points?.file.profiles} now={feed.now} waiting={feed.waiting} tradesReady={feed.tradesReady} />
        </div>

        <div className="home-foot">
          <PointsBand />
          <CreatorFeesMini coins={feed.live} />
        </div>
      </div>
    </main>
  );
}

/** Wallets worth following, each with the reason and a Follow button. */
function Suggestions({ items, profiles, usd }: { items: Suggestion[]; profiles: Record<string, Profile>; usd: (eth: number | undefined) => string }) {
  return (
    <ul className="mt-3 grid gap-1">
      {items.map((s) => (
        <li key={s.wallet} className="-mx-2 flex items-center justify-between gap-3 rounded-xl px-2 py-2 hover:bg-raise">
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-[15px] font-medium">
              <TraderLink address={s.wallet} name={profiles[s.wallet]?.name} size={28} className="gap-3" />
              <DojangMark verified={profiles[s.wallet]?.verified} />
            </span>
            <span className="num mt-0.5 block pl-10 text-xs text-muted">{s.points !== undefined ? `${fmtPoints(s.points)} points this season` : `${usd(s.eth)} traded today`}</span>
          </span>
          <FollowButton wallet={s.wallet} name={profiles[s.wallet]?.name} size="sm" />
        </li>
      ))}
    </ul>
  );
}

/** What leads the feed when nobody has traded for an hour: the last day in a line, and a way to start something. */
function QuietLead({ feed, usd }: { feed: HomeFeed; usd: (eth: number | undefined) => string }) {
  const { trades, eth, wallets } = feed.digest;
  return (
    <div className="feed-note" role="status">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-raise font-serif text-[13px] text-gold" aria-hidden>
        靜
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium text-fg">Quiet on GIWA right now</span>
        <span className="num block text-[12.5px] text-muted">
          {trades === 0
            ? "No trades in the last day. Buy from the board below, or launch a coin, and the feed starts here."
            : `No trades in the last hour. The last day: ${trades.toLocaleString("en-US")} ${trades === 1 ? "trade" : "trades"} · ${usd(eth)} · ${wallets.toLocaleString("en-US")} ${wallets === 1 ? "wallet" : "wallets"}.`}
        </span>
      </span>
      <Link to="/launch" className="btn btn-sm btn-primary hidden shrink-0 sm:inline-flex">
        <IconPlus size={15} />
        Launch
      </Link>
    </div>
  );
}

/** Shown above the feed while the pools' trades are still being read, so launches and comments don't wait on them. */
function TradesOnTheWay() {
  return (
    <div className="feed-note" role="status">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-raise">
        <span className="spinner" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium text-fg">Reading the latest trades from GIWA…</span>
        <span className="block text-[12.5px] text-muted">Launches and comments are below. Trades join them as soon as the chain answers.</span>
      </span>
    </div>
  );
}

/** The season in one band under the board: what is shared out each day, and how long until today's pool closes. */
function PointsBand() {
  const now = useNow();
  const left = now === null ? null : dayEndMs(today(now)) - now;
  return (
    <Link to="/points" className="card card-lift group relative flex min-w-0 flex-1 flex-wrap items-center gap-x-8 gap-y-3 overflow-hidden p-4 sm:p-5">
      <div className="pointer-events-none absolute -top-28 -left-16 size-64 rounded-full bg-[radial-gradient(closest-side,rgba(212,67,43,.2),transparent)]" />
      <div className="relative min-w-0 flex-1 basis-[18rem]">
        <p className="eyebrow flex items-center gap-2">
          <IconPoints size={14} />
          Season 1
        </p>
        <p className="mt-2 text-[19px] leading-[1.15] font-semibold tracking-[-0.02em]">{fmtPoints(DAILY_POOL)} points, every day</p>
        <p className="mt-1 text-sm text-muted">Shared by everyone with a Dojang who trades Chimi coins. Leading a buy and launching a coin earn too.</p>
      </div>
      <div className="relative flex items-end gap-6">
        <div>
          <p className="text-xs text-faint">Today’s pool is shared out in</p>
          <p className="num mt-0.5 text-lg font-semibold tracking-[-0.02em]">{left === null ? "—" : left > 0 ? duration(left) : "now…"}</p>
        </div>
        <span className="flex items-center gap-1 pb-0.5 text-sm font-medium text-fg">
          Points
          <IconChevronRight size={15} className="transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}
