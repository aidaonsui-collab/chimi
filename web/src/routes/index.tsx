import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { compactUsd, ethText } from "@/lib/chimi/format";
import { useHomeFeed, type HomeFeed } from "@/lib/chimi/feed";
import type { FeedItem, Suggestion } from "@/lib/chimi/feed-rules";
import { usePoolEth } from "@/lib/chimi/live";
import { short } from "@/lib/chimi/market";
import { DAILY_POOL, dayEndMs, today, type Profile } from "@/lib/chimi/points-rules";
import { fmtPoints, useProfiles } from "@/lib/chimi/rewards";
import { useTokenImages } from "@/lib/chimi/token-image";
import { CreatorFeesMini } from "@/components/chimi/creator-fees";
import { FeedCard, QuickBuy, Ticker, walletsIn, type CardContext } from "@/components/chimi/feed-cards";
import { HomeTop, type HeroStat } from "@/components/chimi/feed-hero";
import { FollowButton } from "@/components/chimi/follow";
import { IconChevronRight, IconPlus, IconPoints } from "@/components/chimi/icons";
import { useChimi } from "@/components/chimi/provider";
import { DojangMark, duration, useNow } from "@/components/chimi/rewards-bits";
import { toast } from "@/components/chimi/toast";
import { TokenLogo } from "@/components/chimi/token-logo";
import { Change, Empty, Seg, TraderLink } from "@/components/chimi/ui";

/**
 * The home page is the feed: who is buying, selling, launching and saying what, newest first, with the coins that
 * are moving and the traders worth following beside it. The board of every coin lives at /board.
 */
export const Route = createFileRoute("/")({ component: Home });

type Tab = "foryou" | "following" | "new" | "top";

const TAB_KEY = "chimi.feed.tab";
const PAGE = 12;

function Home() {
  const { account, connect, deployment, preview, note, refresh, loading } = useChimi();
  const nowMs = useNow(30_000);
  const feed = useHomeFeed(nowMs);
  const images = useTokenImages(useMemo(() => feed.live.map((coin) => coin.token), [feed.live]));
  const reserves = usePoolEth(feed.live, deployment?.weth);
  const [tab, setTab] = useState<Tab>("foryou");
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(TAB_KEY);
      if (saved === "following" || saved === "new" || saved === "top") setTab(saved);
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

  const list: FeedItem[] = tab === "top" ? [] : feed.tabs[tab];
  const page = list.slice(0, shown);
  const profiles = useProfiles(
    useMemo(() => [...new Set([...walletsIn(feed.items.slice(0, 40)), ...feed.suggestions.map((s) => s.wallet)])], [feed.items, feed.suggestions]),
    feed.points?.file.profiles,
  );
  const ctx: CardContext = { byToken: feed.byToken, images, stats: feed.stats, profiles, ethUsd: feed.ethUsd, now: feed.now, me: feed.me };

  const usd = (eth: number | undefined) => (eth === undefined ? "—" : feed.ethUsd ? compactUsd(eth * feed.ethUsd) : `${ethText(eth)} ETH`);
  const totals = useMemo(() => {
    const all = Object.values(feed.stats);
    const pools = feed.live.map((c) => reserves[c.pool.toLowerCase()]);
    return {
      capEth: all.reduce((sum, s) => sum + s.capEth, 0),
      volEth: all.every((s) => s.volEth !== undefined) ? all.reduce((sum, s) => sum + (s.volEth ?? 0), 0) : undefined,
      liqEth: pools.length > 0 && pools.every((wei) => wei !== undefined) ? pools.reduce((sum, wei) => sum + Number(wei) / 1e18, 0) : undefined,
    };
  }, [feed.stats, feed.live, reserves]);
  const heroStats: HeroStat[] = [
    ["Coins", loading ? null : feed.live.length.toLocaleString("en-US")],
    ["24h volume", loading ? null : usd(totals.volEth)],
    ["Market cap", loading ? null : usd(feed.hasCoins ? totals.capEth : undefined)],
    ["Liquidity", loading ? null : usd(totals.liqEth)],
  ];

  const byVolume = useMemo(
    () => [...feed.live].sort((a, b) => (feed.stats[b.token.toLowerCase()]?.volEth ?? 0) - (feed.stats[a.token.toLowerCase()]?.volEth ?? 0) || (feed.stats[b.token.toLowerCase()]?.capEth ?? 0) - (feed.stats[a.token.toLowerCase()]?.capEth ?? 0)),
    [feed.live, feed.stats],
  );
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

      <section className="page pt-8 sm:pt-10">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
          <div className="min-w-0 max-w-xl">
            <p className="eyebrow">Who is trading what</p>
            <h2 className="mt-2 text-[34px] leading-[1.05] font-semibold tracking-[-0.03em] sm:text-[42px]">{account ? "Your feed" : "The feed"}</h2>
            <p className="mt-3 text-[15px] leading-relaxed text-fg/75">Buys, launches and comments from the wallets you follow, and what is moving on GIWA.</p>
          </div>
          <Seg
            label="Which feed"
            value={tab}
            onChange={pick}
            options={[
              ["foryou", "For you"],
              ["following", `Following${feed.me && feed.following.length ? ` · ${feed.following.length}` : ""}`],
              ["new", "New"],
              ["top", "Top"],
            ]}
          />
        </div>

        <div className="mt-7 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="grid min-w-0 grid-cols-1 gap-4">
            {feed.waiting ? (
              <FeedSkeleton />
            ) : failed ? (
              <div className="card">
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
              </div>
            ) : !feed.hasCoins ? (
              <div className="card">
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
              </div>
            ) : tab === "top" ? (
              <TopCoins coins={byVolume} ctx={ctx} usd={usd} />
            ) : tab === "following" && !feed.me ? (
              <div className="card">
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
              </div>
            ) : tab === "following" && feed.following.length === 0 ? (
              <div className="card p-5">
                <p className="text-[15px] font-semibold">You aren’t following anyone yet</p>
                <p className="mt-1 text-sm text-muted">Start with a few of the busiest traders. Following is a signature, not a transaction, and needs a Dojang.</p>
                <Suggestions items={feed.suggestions} profiles={profiles} usd={usd} />
              </div>
            ) : (
              <>
                {tab === "foryou" && feed.quiet ? <QuietLead feed={feed} usd={usd} /> : null}
                {page.length === 0 ? (
                  <div className="card">
                    <Empty mark="조용함" title={tab === "following" ? "Nothing from the wallets you follow yet" : "Nothing here yet"}>
                      {tab === "following" ? `When any of the ${feed.following.length} you follow buys, sells, launches or comments, it shows up here.` : "When someone trades, launches or comments, it shows up here within a minute."}
                    </Empty>
                  </div>
                ) : (
                  page.map((item) => <FeedCard key={item.key} item={item} ctx={ctx} />)
                )}
                {list.length > shown ? (
                  <button type="button" onClick={() => setShown((n) => n + PAGE)} className="btn btn-secondary w-full">
                    Show more ({list.length - shown} left)
                  </button>
                ) : null}
                {tab === "following" && feed.following.length > 0 && feed.following.length < 3 && feed.suggestions.length > 0 ? (
                  <div className="card p-5">
                    <p className="th uppercase">More to follow</p>
                    <Suggestions items={feed.suggestions.slice(0, 3)} profiles={profiles} usd={usd} />
                  </div>
                ) : null}
              </>
            )}
          </div>

          <aside className="grid min-w-0 grid-cols-1 gap-5">
            {feed.hasCoins ? (
              <section className="card p-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-[15px] font-semibold">Moving now</h3>
                  <Link to="/board" className="text-[13px] font-semibold text-gold hover:underline">
                    The board
                  </Link>
                </div>
                <ul className="mt-3 grid gap-1">
                  {byVolume.slice(0, 5).map((coin) => {
                    const stats = feed.stats[coin.token.toLowerCase()];
                    return (
                      <li key={coin.token}>
                        <Link to="/coin/$address" params={{ address: coin.token }} className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-raise">
                          <TokenLogo symbol={coin.symbol} image={images[coin.token.toLowerCase()]} size={34} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-semibold">{coin.name}</span>
                            <span className="num block text-xs text-muted">{usd(stats?.capEth)}</span>
                          </span>
                          <Change value={stats?.change} className="shrink-0 text-sm" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}

            {feed.suggestions.length > 0 ? (
              <section className="card p-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-[15px] font-semibold">Who to follow</h3>
                  <Link to="/traders" className="text-[13px] font-semibold text-gold hover:underline">
                    All traders
                  </Link>
                </div>
                <Suggestions items={feed.suggestions.slice(0, 3)} profiles={profiles} usd={usd} />
              </section>
            ) : null}

            <CreatorFeesMini coins={feed.live} />
            <PointsCard />
          </aside>
        </div>
      </section>
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

/** What leads the feed when nobody has traded for an hour: the last day in numbers, and a way to start something. */
function QuietLead({ feed, usd }: { feed: HomeFeed; usd: (eth: number | undefined) => string }) {
  const { trades, eth, wallets } = feed.digest;
  return (
    <section className="card p-5">
      <h3 className="text-[19px] font-semibold tracking-[-0.01em]">Quiet on GIWA right now</h3>
      <p className="mt-1 text-sm text-muted">{trades === 0 ? "No trades in the last day. Buy a coin or launch one and the feed starts here." : "No trades in the last hour. Here is the last day."}</p>
      <dl className="mt-4 grid grid-cols-3 gap-2.5">
        {(
          [
            ["Trades", trades.toLocaleString("en-US")],
            ["Volume", usd(eth)],
            ["Wallets trading", wallets.toLocaleString("en-US")],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="rounded-xl bg-raise px-3.5 py-3">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="num mt-0.5 truncate text-[19px] font-semibold tracking-[-0.02em]">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 flex flex-wrap gap-2.5">
        <Link to="/launch" className="btn btn-primary">
          <IconPlus size={17} />
          Launch a coin
        </Link>
        <Link to="/board" className="btn btn-secondary">
          Open the board
        </Link>
      </div>
    </section>
  );
}

/** The Top tab: the coins by what traded today, each one press from a buy. */
function TopCoins({ coins, ctx, usd }: { coins: HomeFeed["live"]; ctx: CardContext; usd: (eth: number | undefined) => string }) {
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3.5 sm:px-5">
        <h3 className="text-[15px] font-semibold">Most traded today</h3>
        <Link to="/board" className="text-[13px] font-semibold text-gold hover:underline">
          Open the board
        </Link>
      </div>
      <ul>
        {coins.slice(0, 20).map((coin, i) => {
          const stats = ctx.stats[coin.token.toLowerCase()];
          return (
            <li key={coin.token} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line/70 px-4 py-3 last:border-0 sm:px-5">
              <span className="num w-5 text-sm text-faint">{i + 1}</span>
              <Link to="/coin/$address" params={{ address: coin.token }} className="flex min-w-0 flex-1 items-center gap-3">
                <TokenLogo symbol={coin.symbol} image={ctx.images[coin.token.toLowerCase()]} size={38} />
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-semibold hover:text-gold">{coin.name}</span>
                  <span className="num block truncate text-[13px] text-muted">
                    {usd(stats?.capEth)} cap · {usd(stats?.volEth)} today
                  </span>
                </span>
              </Link>
              <Change value={stats?.change} className="shrink-0 text-sm" />
              <QuickBuy coin={coin} amounts={["0.01"]} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function FeedSkeleton() {
  return (
    <>
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="card space-y-3.5 p-5" aria-hidden>
          <div className="flex items-center gap-3">
            <span className="skeleton size-[38px] rounded-full" />
            <span className="flex-1 space-y-2">
              <span className="skeleton block h-4 w-2/3" />
              <span className="skeleton block h-3 w-1/3" />
            </span>
          </div>
          <span className="skeleton block h-16 w-full rounded-xl" />
        </div>
      ))}
    </>
  );
}

function PointsCard() {
  const now = useNow();
  const left = now === null ? null : dayEndMs(today(now)) - now;
  return (
    <Link to="/points" className="card card-lift group relative overflow-hidden p-5">
      <div className="pointer-events-none absolute -top-24 -right-16 size-64 rounded-full bg-[radial-gradient(closest-side,rgba(212,67,43,.22),transparent)]" />
      <div className="relative">
        <p className="eyebrow flex items-center gap-2">
          <IconPoints size={14} />
          Season 1
        </p>
        <p className="mt-3 text-[22px] leading-[1.15] font-semibold tracking-[-0.03em]">{fmtPoints(DAILY_POOL)} points, every day</p>
        <p className="mt-2 text-sm text-muted">Shared by everyone with a Dojang who trades Chimi coins. Leading a buy and launching a coin earn too.</p>
        <div className="mt-4 flex items-end justify-between gap-3 border-t border-line pt-4">
          <div>
            <p className="text-xs text-faint">Today’s pool is shared out in</p>
            <p className="num mt-0.5 text-lg font-semibold tracking-[-0.02em]">{left === null ? "—" : left > 0 ? duration(left) : "now…"}</p>
          </div>
          <span className="flex items-center gap-1 text-sm font-medium text-fg">
            Points
            <IconChevronRight size={15} className="transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </div>
    </Link>
  );
}
