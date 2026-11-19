import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { compactUsd, ethText } from "@/lib/chimi/format";
import { useHomeFeed, type HomeFeed } from "@/lib/chimi/feed";
import { freshnessKey, type FeedItem, type Suggestion } from "@/lib/chimi/feed-rules";
import { followingOf } from "@/lib/chimi/follow-rules";
import { useFollows } from "@/lib/chimi/follows";
import { heldKey, useHeldShares } from "@/lib/chimi/holdings";
import { short } from "@/lib/chimi/market";
import type { Profile } from "@/lib/chimi/points-rules";
import { fmtPoints, useProfiles } from "@/lib/chimi/rewards";
import { useTokenImages } from "@/lib/chimi/token-image";
import { defaultTraderSort, orderTraders, traderRows, type TraderRow, type TraderSort } from "@/lib/chimi/trader-rules";
import { FeedRow, QuickAmount, RowSkeleton, holdersIn, walletsIn, type RowContext } from "@/components/chimi/feed-rows";
import { FollowButton } from "@/components/chimi/follow";
import { IconArrowUp, IconPlus } from "@/components/chimi/icons";
import { PostBox } from "@/components/chimi/post-box";
import { useChimi } from "@/components/chimi/provider";
import { DojangMark, useNow } from "@/components/chimi/rewards-bits";
import { Highlights, TopTraders } from "@/components/chimi/social";
import { toast } from "@/components/chimi/toast";
import { Blockie, Empty, Seg, TraderLink } from "@/components/chimi/ui";

/**
 * The social side of Chimi. Three tiles say what the last day was about; under them the feed (who bought, sold,
 * launched and said what, newest first) runs beside the top traders. The leaderboard is the whole list of traders,
 * by season points, followers or the day's trading. A phone switches between the feed and the leaderboard.
 */
type View = "feed" | "leaderboard";

export const Route = createFileRoute("/traders")({
  validateSearch: (search: Record<string, unknown>): { view?: "leaderboard" } => ({ view: search.view === "leaderboard" ? "leaderboard" : undefined }),
  component: Traders,
});

type Tab = "foryou" | "following";

const TAB_KEY = "chimi.feed.tab";
/** Rows are small, so a page of the feed is a few screens of them. */
const PAGE = 30;

function Traders() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const view: View = search.view === "leaderboard" ? "leaderboard" : "feed";
  const nowMs = useNow(30_000);
  const feed = useHomeFeed(nowMs);
  const { account } = useChimi();
  const images = useTokenImages(useMemo(() => feed.live.map((coin) => coin.token), [feed.live]));

  useEffect(() => {
    const before = document.title;
    document.title = view === "leaderboard" ? "Leaderboard · Chimi" : "Traders · Chimi";
    return () => {
      document.title = before;
    };
  }, [view]);

  const money = (eth: number | undefined) => (eth === undefined ? "—" : feed.ethUsd ? compactUsd(eth * feed.ethUsd) : `${ethText(eth)} ETH`);
  const tileWallets = useMemo(() => [...new Set(feed.trades.map((t) => t.wallet))].slice(0, 80), [feed.trades]);
  const tileProfiles = useProfiles(tileWallets, feed.points?.file.profiles);

  const pick = (next: View) => void navigate({ to: "/traders", search: next === "leaderboard" ? { view: "leaderboard" } : {}, replace: true });

  return (
    <main className="page pt-3 pb-16 sm:pt-5">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <h1 className="flex items-baseline gap-3 px-1 text-[28px] leading-none font-semibold tracking-[-0.03em]">
          Traders
          <span className="font-serif text-[15px] font-normal tracking-normal text-gold">상인</span>
        </h1>
        <Seg
          label="Feed or leaderboard"
          value={view}
          onChange={pick}
          className="seg-full"
          options={[
            ["feed", "Feed"],
            ["leaderboard", "Leaderboard"],
          ]}
        />
      </div>

      {view === "feed" ? (
        <>
          <div className="mt-5">
            <Highlights items={feed.items} trades={feed.trades} byToken={feed.byToken} images={images} profiles={tileProfiles} now={feed.now} money={money} waiting={feed.waiting} />
          </div>
          <div className="social-grid mt-5">
            <Feed feed={feed} images={images} />
            <aside className="social-side">
              <TopTraders points={feed.points} trades={feed.trades} now={feed.now} me={feed.me} ethUsd={feed.ethUsd} waiting={feed.waiting || !feed.tradesReady} />
            </aside>
          </div>
        </>
      ) : (
        <Leaderboard feed={feed} me={account?.toLowerCase()} />
      )}
    </main>
  );
}

/** The feed: everything happening on Chimi (or only what the wallets you follow do), newest first, as it happens. */
function Feed({ feed, images }: { feed: HomeFeed; images: Record<string, string | undefined> }) {
  const { account, connect, coins, preview, note, refresh, loading } = useChimi();
  const [tab, setTab] = useState<Tab>("foryou");
  const [shown, setShown] = useState(PAGE);

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
  const page = list.slice(0, shown);

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

  const profiles = useProfiles(
    useMemo(() => [...new Set([...walletsIn(page), ...feed.suggestions.map((s) => s.wallet)])], [page, feed.suggestions]),
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

  const failed = !loading && !feed.hasCoins && !preview && !!note && coins.length === 0;
  const joinIn = () =>
    void connect().catch((err: unknown) => {
      const text = short(err);
      if (!/reject|denied|cancel/i.test(text)) toast({ kind: "bad", title: "Couldn’t connect", body: text });
    });

  return (
    <section id="feed" className="card social-feed scroll-mt-24" aria-labelledby="feed-title">
      {unseen > 0 ? (
        <button
          type="button"
          onClick={() => {
            document.getElementById("feed")?.scrollIntoView({ behavior: "smooth", block: "start" });
            setUnseen(0);
          }}
          className="new-pill"
        >
          <IconArrowUp size={14} />
          {unseen} new
        </button>
      ) : null}
      <div className="flex items-center gap-2.5 px-3 py-3 sm:gap-3 sm:px-4">
        <h2 id="feed-title" className="sr-only">
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

      <div className="border-t border-line/70">
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
            {tab === "foryou" && !preview ? <PostBox coins={feed.live} images={images} stats={feed.stats} ethUsd={feed.ethUsd} /> : null}
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
            {tab === "following" && feed.following.length > 0 && feed.following.length < 3 && feed.suggestions.length > 0 ? (
              <div className="border-t border-line/70 p-4 sm:p-5">
                <p className="th uppercase">More to follow</p>
                <Suggestions items={feed.suggestions.slice(0, 3)} profiles={profiles} usd={usd} />
              </div>
            ) : null}
          </>
        )}
      </div>

      {list.length > shown ? (
        <button type="button" onClick={() => setShown((n) => n + PAGE)} className="w-full border-t border-line/70 py-3 text-sm font-medium text-muted hover:text-fg">
          Show more ({list.length - shown} left)
        </button>
      ) : list.length > 0 ? (
        <p className="border-t border-line/70 py-3 text-center text-[12.5px] text-faint">That’s everything so far</p>
      ) : null}
    </section>
  );
}

/** Wallets worth following, each with the reason and a Follow button. */
function Suggestions({ items, profiles, usd }: { items: Suggestion[]; profiles: Record<string, Profile>; usd: (eth: number | undefined) => string }) {
  return (
    <ul className="mt-3 grid gap-1">
      {items.map((s) => (
        <li key={s.wallet} className="-mx-2 flex items-center justify-between gap-3 rounded-2xl px-2 py-2 hover:bg-raise">
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
            ? "No trades in the last day. Buy from the board, or launch a coin, and the feed starts here."
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

const BOARD_PAGE = 25;

/**
 * Everyone who trades on Chimi, in one list: the season's points, who follows them, the buys they have led and what
 * they traded today. It is put together in the browser from the points book, the follow list and the day's trades.
 */
function Leaderboard({ feed, me }: { feed: HomeFeed; me?: string }) {
  const { loading } = useChimi();
  const { data: follows } = useFollows();
  const [sort, setSort] = useState<TraderSort>("points");
  const [picked, setPicked] = useState(false);
  const [shown, setShown] = useState(BOARD_PAGE);

  const rows = useMemo(() => traderRows(feed.points, follows?.state, feed.trades, feed.now - 24 * 60 * 60), [feed.points, follows, feed.trades, feed.now]);
  const order: TraderSort = picked ? sort : defaultTraderSort(rows);
  const sorted = useMemo(() => orderTraders(rows, order), [rows, order]);
  const page = sorted.slice(0, shown);
  const profiles = useProfiles(
    useMemo(() => page.map((r) => r.wallet), [page]),
    feed.points?.file.profiles,
  );
  const mine = useMemo(() => new Set(followingOf(follows?.state, me)), [follows, me]);
  const cash = (eth: number) => (eth === 0 ? "—" : feed.ethUsd ? compactUsd(eth * feed.ethUsd) : `${ethText(eth)} ETH`);
  // The list is mostly the points book, so it isn't called empty until that has answered.
  const waiting = loading || (feed.points === undefined && rows.length === 0) || (feed.live.length > 0 && !feed.tradesReady && rows.length === 0);

  return (
    <section className="mt-5" aria-label="Leaderboard">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <p className="max-w-[60ch] px-1 text-sm text-muted">Follow a wallet and its buys, launches and comments show up in your feed; when you buy a coin after it, it earns points for leading you.</p>
        <Seg
          label="Order traders by"
          value={order}
          onChange={(next) => {
            setSort(next);
            setPicked(true);
            setShown(BOARD_PAGE);
          }}
          options={[
            ["points", "Season points"],
            ["followers", "Followers"],
            ["today", "Traded today"],
          ]}
        />
      </div>
      <div className="card overflow-hidden">
        <div className="lb-grid th border-b border-line py-3">
          <span>#</span>
          <span>Trader</span>
          <span className="lb-narrow text-right">{order === "followers" ? "Followers" : order === "today" ? "Today" : "Points"}</span>
          <span className="lb-wide text-right">Season points</span>
          <span className="lb-wide text-right">Followers</span>
          <span className="lb-wide text-right">Buys led</span>
          <span className="lb-wide text-right">Traded today</span>
          <span className="lb-wide" />
        </div>
        {waiting ? (
          Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-4 border-b border-line/70 px-5 py-3.5 last:border-0">
              <span className="skeleton h-4 w-4" />
              <span className="skeleton size-9 rounded-full" />
              <span className="skeleton h-4 flex-1" />
              <span className="skeleton h-4 w-16" />
            </div>
          ))
        ) : sorted.length === 0 ? (
          <Empty
            mark="첫 거래"
            title="No traders to show yet"
            action={
              <Link to="/" className="btn btn-primary">
                Find a coin
              </Link>
            }
          >
            Wallets show up here once they buy or sell a Chimi coin.
          </Empty>
        ) : (
          page.map((r, i) => <LeaderRow key={r.wallet} row={r} rank={i + 1} profile={profiles[r.wallet]} you={r.wallet === me} following={mine.has(r.wallet)} order={order} cash={cash} />)
        )}
        {sorted.length > shown ? (
          <button type="button" onClick={() => setShown((n) => n + BOARD_PAGE)} className="w-full border-t border-line py-3 text-sm font-medium text-muted hover:text-fg">
            Show more ({sorted.length - shown} left)
          </button>
        ) : null}
      </div>
    </section>
  );
}

function LeaderRow({ row: r, rank, profile, you, following, order, cash }: { row: TraderRow; rank: number; profile?: Profile; you: boolean; following: boolean; order: TraderSort; cash: (eth: number) => string }) {
  const name = profile?.name?.replace(/\.up\.id$/, "");
  return (
    <div className="lb-grid row-hover border-b border-line/70 py-3 last:border-0">
      <span className={`num text-sm ${rank <= 3 ? "font-semibold text-gold" : "text-faint"}`}>{rank}</span>
      <Link to="/u/$address" params={{ address: r.wallet }} title={r.wallet} className="flex min-w-0 items-center gap-3">
        <Blockie address={r.wallet} size={38} />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <span className="num truncate text-[15px] font-semibold hover:text-gold">{name ?? `${r.wallet.slice(0, 6)}…${r.wallet.slice(-4)}`}</span>
            <DojangMark verified={profile?.verified} />
            {you ? <span className="chip h-5 px-1.5 text-[11px] text-gold">You</span> : null}
            {following ? <span className="chip h-5 px-1.5 text-[11px]">Following</span> : null}
          </span>
          <span className="num block truncate text-[13px] text-muted">
            {r.trades > 0 ? `${r.trades} ${r.trades === 1 ? "trade" : "trades"} today` : r.rank ? `Rank #${r.rank} this season` : profile?.verified === false ? "No Dojang, so no points yet" : "No trades today"}
          </span>
        </span>
      </Link>
      <span className="lb-narrow num text-right text-[15px] font-semibold">{order === "followers" ? r.followers : order === "today" ? cash(r.todayEth) : fmtPoints(r.points)}</span>
      <span className="lb-wide num text-right text-[15px] font-semibold">{r.points > 0 ? fmtPoints(r.points) : "—"}</span>
      <span className="lb-wide num text-right text-[15px]">{r.followers || "—"}</span>
      <span className="lb-wide num text-right text-[15px]" title={r.led ? `${ethText(r.ledEth)} ETH of buys followed theirs` : undefined}>
        {r.led || "—"}
      </span>
      <span className="lb-wide num text-right text-[15px]">{cash(r.todayEth)}</span>
      <span className="lb-wide lb-follow">{you ? null : <FollowButton wallet={r.wallet} name={profile?.name} size="sm" />}</span>
    </div>
  );
}
