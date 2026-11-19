import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import type { FeedItem, FeedTrade } from "@/lib/chimi/feed-rules";
import { useFollows } from "@/lib/chimi/follows";
import { compactUsd, ethText } from "@/lib/chimi/format";
import type { Coin } from "@/lib/chimi/market";
import type { Points, Profile } from "@/lib/chimi/points-rules";
import { fmtPoints, shortWallet, useProfiles } from "@/lib/chimi/rewards";
import { mostActiveTrader, mostBought, mostTalkedAbout } from "@/lib/chimi/social-rules";
import { defaultTraderSort, orderTraders, traderRows } from "@/lib/chimi/trader-rules";
import { FollowButton } from "@/components/chimi/follow";
import { IconChevronRight } from "@/components/chimi/icons";
import { DojangMark } from "@/components/chimi/rewards-bits";
import { TokenLogo } from "@/components/chimi/token-logo";
import { Blockie } from "@/components/chimi/ui";

/*
 * The pieces of the Traders page around the feed: three tiles on what the last day was about, and the top traders
 * beside the feed.
 */

const DAY = 24 * 60 * 60;

type Money = (eth: number | undefined) => string;

/** One tile: a small label, the coin or wallet it names, and a line of why. */
function Tile({ label, to, main, sub, empty }: { label: string; to?: { kind: "coin"; token: string; comments?: boolean } | { kind: "wallet"; wallet: string }; main: React.ReactNode; sub: string; empty?: boolean }) {
  const body = (
    <>
      <span className="tile-label">{label}</span>
      <span className={`tile-main ${empty ? "text-faint" : ""}`}>{main}</span>
      <span className="tile-sub num">{sub}</span>
    </>
  );
  if (!to || empty) return <div className="tile">{body}</div>;
  if (to.kind === "wallet") {
    return (
      <Link to="/u/$address" params={{ address: to.wallet }} className="tile tile-link">
        {body}
      </Link>
    );
  }
  return (
    <Link to="/coin/$address" params={{ address: to.token }} search={to.comments ? { tab: "comments" } : undefined} className="tile tile-link">
      {body}
    </Link>
  );
}

/** What the last day was about: the coin people talked about, the coin they bought, and who traded the most. */
export function Highlights({
  items,
  trades,
  byToken,
  images,
  profiles,
  now,
  money,
  waiting,
}: {
  items: FeedItem[];
  trades: FeedTrade[];
  byToken: Map<string, Coin>;
  images: Record<string, string | undefined>;
  profiles: Record<string, Profile>;
  now: number;
  money: Money;
  waiting: boolean;
}) {
  const comments = useMemo(() => items.flatMap((i) => (i.kind === "comment" ? [{ wallet: i.wallet, token: i.token, time: i.time }] : [])), [items]);
  const known = (token: string) => byToken.has(token.toLowerCase());
  const talked = useMemo(() => mostTalkedAbout(comments.filter((c) => known(c.token)), now), [comments, now, byToken]); // eslint-disable-line react-hooks/exhaustive-deps
  const bought = useMemo(() => mostBought(trades.filter((t) => known(t.token)), now), [trades, now, byToken]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = useMemo(() => mostActiveTrader(trades, now), [trades, now]);

  const coin = (token: string) => {
    const c = byToken.get(token)!;
    return (
      <>
        <TokenLogo symbol={c.symbol} image={images[token]} size={34} />
        <strong className="truncate">${c.symbol}</strong>
      </>
    );
  };
  const name = (wallet: string) => profiles[wallet]?.name?.replace(/\.up\.id$/, "") ?? shortWallet(wallet);
  const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

  if (waiting) {
    return (
      <div className="tiles" aria-hidden>
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="tile">
            <span className="skeleton h-3.5 w-36" />
            <span className="skeleton mt-1 h-8 w-28" />
            <span className="skeleton h-3.5 w-24" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="tiles">
      <Tile
        label="Most talked about · 24h"
        to={talked ? { kind: "coin", token: talked.token, comments: true } : undefined}
        empty={!talked}
        main={talked ? coin(talked.token) : "Nobody yet"}
        sub={talked ? `${plural(talked.comments, "comment", "comments")} · ${plural(talked.people, "person", "people")}` : "No comments in the last day"}
      />
      <Tile
        label="Most bought · 24h"
        to={bought ? { kind: "coin", token: bought.token } : undefined}
        empty={!bought}
        main={bought ? coin(bought.token) : "Nothing yet"}
        sub={bought ? `${money(bought.eth)} bought · ${plural(bought.buyers, "buyer", "buyers")}` : "No buys in the last day"}
      />
      <Tile
        label="Most active trader · 24h"
        to={active ? { kind: "wallet", wallet: active.wallet } : undefined}
        empty={!active}
        main={
          active ? (
            <>
              <Blockie address={active.wallet} size={34} />
              <strong className="num truncate">{name(active.wallet)}</strong>
            </>
          ) : (
            "Nobody yet"
          )
        }
        sub={active ? `${money(active.eth)} traded · ${plural(active.trades, "trade", "trades")}` : "No trades in the last day"}
      />
    </div>
  );
}

/**
 * Beside the feed: the season's top traders (or the day's, until a season has points), each with a Follow button,
 * and the way to the whole list.
 */
export function TopTraders({
  points,
  trades,
  now,
  me,
  ethUsd,
  waiting,
  rows = 12,
}: {
  points: Points | null | undefined;
  trades: FeedTrade[];
  now: number;
  me?: string;
  ethUsd?: number;
  waiting: boolean;
  rows?: number;
}) {
  const { data: follows } = useFollows();
  const all = useMemo(() => traderRows(points, follows?.state, trades, now - DAY), [points, follows, trades, now]);
  const by = defaultTraderSort(all);
  const top = useMemo(() => orderTraders(all, by).slice(0, rows), [all, by, rows]);
  const profiles = useProfiles(
    useMemo(() => top.map((r) => r.wallet), [top]),
    points?.file.profiles,
  );
  const cash = (eth: number) => (ethUsd ? compactUsd(eth * ethUsd) : `${ethText(eth)} ETH`);

  return (
    <section className="card top-traders" aria-labelledby="top-traders-title">
      <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
        <h2 id="top-traders-title" className="text-[16px] font-semibold tracking-[-0.01em]">
          Top traders
        </h2>
        <Link to="/traders" search={{ view: "leaderboard" }} className="inline-flex items-center gap-0.5 text-[13px] font-medium text-muted hover:text-fg">
          See all
          <IconChevronRight size={14} />
        </Link>
      </div>
      {waiting && top.length === 0 ? (
        <ul aria-hidden className="px-2 pb-2">
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="lead-row">
              <span className="skeleton h-3 w-3" />
              <span className="skeleton size-8 shrink-0 rounded-full" />
              <span className="flex-1 space-y-1.5">
                <span className="skeleton block h-3.5 w-2/5" />
                <span className="skeleton block h-3 w-3/5" />
              </span>
            </li>
          ))}
        </ul>
      ) : top.length === 0 ? (
        <p className="px-5 pt-2 pb-6 text-sm text-muted">Wallets show up here once they buy or sell a Chimi coin.</p>
      ) : (
        <ol className="px-2 pb-2">
          {top.map((r, i) => {
            const profile = profiles[r.wallet];
            const name = profile?.name?.replace(/\.up\.id$/, "") ?? shortWallet(r.wallet);
            const you = r.wallet === me;
            const metric = by === "points" ? (r.points > 0 ? `${fmtPoints(r.points)} pts` : "—") : r.todayEth > 0 ? cash(r.todayEth) : "—";
            const sub = by === "points" ? (r.todayEth > 0 ? `${cash(r.todayEth)} today` : r.followers > 0 ? `${r.followers} ${r.followers === 1 ? "follower" : "followers"}` : "") : `${r.trades} ${r.trades === 1 ? "trade" : "trades"}`;
            return (
              <li key={r.wallet} className="lead-row">
                <span className={`num w-5 shrink-0 text-center text-[13px] ${i < 3 ? "font-semibold text-gold" : "text-faint"}`}>{i + 1}</span>
                <Link to="/u/$address" params={{ address: r.wallet }} title={r.wallet} className="lead-who">
                  <Blockie address={r.wallet} size={32} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1">
                      <span className="num truncate text-[14.5px] font-semibold">{you ? "You" : name}</span>
                      <DojangMark verified={profile?.verified} />
                    </span>
                    {r.followers > 0 && by !== "points" ? <span className="num block truncate text-[12px] text-faint">{`${r.followers} ${r.followers === 1 ? "follower" : "followers"}`}</span> : null}
                  </span>
                </Link>
                <span className="lead-metric">
                  <span className="num block text-[14px] font-semibold text-ok">{metric}</span>
                  {sub ? <span className="num block text-[12px] text-faint">{sub}</span> : null}
                </span>
                {you ? null : <FollowButton wallet={r.wallet} name={profile?.name} size="sm" quiet className="lead-follow" />}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
