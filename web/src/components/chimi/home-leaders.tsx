import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import type { FeedTrade } from "@/lib/chimi/feed-rules";
import { useFollows } from "@/lib/chimi/follows";
import { compactUsd, ethText } from "@/lib/chimi/format";
import { membersOf, scoreHouses } from "@/lib/chimi/house-rules";
import type { Points } from "@/lib/chimi/points-rules";
import { fmtPoints, shortWallet, useHouses, useProfiles } from "@/lib/chimi/rewards";
import { defaultTraderSort, orderTraders, traderRows } from "@/lib/chimi/trader-rules";
import { FollowButton } from "@/components/chimi/follow";
import { HouseSeal } from "@/components/chimi/house-seal";
import { IconChevronRight } from "@/components/chimi/icons";
import { DojangMark } from "@/components/chimi/rewards-bits";
import { Blockie, Seg } from "@/components/chimi/ui";

/*
 * Beside the feed on the home page: who is worth following. The traders, by the season's points (or by the day's
 * trading until a season has any), each one press from a follow; and the houses they trade for. The whole lists are
 * at /traders and /houses.
 */

type Tab = "traders" | "houses";

const DAY = 24 * 60 * 60;
const ROWS = 10;

export function Leaders({ points, trades, now, me, ethUsd, waiting }: { points: Points | null | undefined; trades: FeedTrade[]; now: number; me?: string; ethUsd?: number; waiting: boolean }) {
  const [tab, setTab] = useState<Tab>("traders");
  const { data: follows } = useFollows();
  const { data: houses } = useHouses();

  const all = useMemo(() => traderRows(points, follows?.state, trades, now - DAY), [points, follows, trades, now]);
  const by = defaultTraderSort(all);
  const top = useMemo(() => orderTraders(all, by).slice(0, ROWS), [all, by]);
  const profiles = useProfiles(
    useMemo(() => top.map((r) => r.wallet), [top]),
    points?.file.profiles,
  );
  const scores = useMemo(() => (houses ? scoreHouses(houses.state, points).slice(0, ROWS) : []), [houses, points]);
  const cash = (eth: number) => (ethUsd ? compactUsd(eth * ethUsd) : `${ethText(eth)} ETH`);

  return (
    <section className="card leaders" aria-label="Who to follow">
      <div className="flex items-center justify-between gap-3 px-3 pt-3 pb-2.5 sm:px-4">
        <Seg
          label="Leaders"
          value={tab}
          onChange={setTab}
          options={[
            ["traders", "Top traders"],
            ["houses", "Houses"],
          ]}
        />
        <span className="text-[12px] text-faint">{tab === "houses" ? "season points" : by === "points" ? "season points" : "traded today"}</span>
      </div>

      <div className="leaders-body border-t border-line/70">
        {tab === "traders" ? (
          waiting && top.length === 0 ? (
            <LeadSkeleton />
          ) : top.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">Wallets show up here once they buy or sell a Chimi coin.</p>
          ) : (
            <ol>
              {top.map((r, i) => {
                const profile = profiles[r.wallet];
                const name = profile?.name?.replace(/\.up\.id$/, "") ?? shortWallet(r.wallet);
                const you = r.wallet === me;
                // What it is ranked by comes first, so it is what survives when the line runs out of room.
                const bits = [
                  by === "points" && r.points > 0 ? `${fmtPoints(r.points)} pts` : null,
                  by === "today" && r.todayEth > 0 ? `${cash(r.todayEth)} today` : null,
                  r.followers > 0 ? `${r.followers} ${r.followers === 1 ? "follower" : "followers"}` : null,
                  r.trades > 0 ? `${r.trades} ${r.trades === 1 ? "trade" : "trades"} today` : null,
                  r.led > 0 ? `${r.led} led` : null,
                ].filter(Boolean);
                return (
                  <li key={r.wallet} className="lead-row">
                    <span className="num w-4 shrink-0 text-center text-[12px] text-faint">{i + 1}</span>
                    <Link to="/u/$address" params={{ address: r.wallet }} title={r.wallet} className="lead-who">
                      <Blockie address={r.wallet} size={28} />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1">
                          <span className="num truncate text-[14px] font-semibold">{you ? "You" : name}</span>
                          <DojangMark verified={profile?.verified} />
                        </span>
                        <span className="num block truncate text-[12px] text-muted">{bits.length > 0 ? bits.join(" · ") : profile?.verified === false ? "No Dojang yet" : "No trades today"}</span>
                      </span>
                    </Link>
                    {you ? null : <FollowButton wallet={r.wallet} name={profile?.name} size="sm" quiet className="lead-follow" />}
                  </li>
                );
              })}
            </ol>
          )
        ) : !houses ? (
          <LeadSkeleton />
        ) : scores.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-muted">No house has been founded yet. A house is up to 25 traders whose points add up together.</p>
            <Link to="/houses" className="btn btn-sm btn-secondary mt-3">
              Found the first
            </Link>
          </div>
        ) : (
          <ol>
            {scores.map((s) => {
              const members = membersOf(houses.state, s.house.tag).length;
              return (
                <li key={s.house.tag}>
                  <Link to="/houses/$tag" params={{ tag: s.house.tag }} className="lead-row lead-row-link">
                    <span className="num w-4 shrink-0 text-center text-[12px] text-faint">{s.rank}</span>
                    <HouseSeal seal={s.house.seal} ink={s.house.ink} size={28} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[14px] font-semibold">{s.house.name}</span>
                        <span className="num shrink-0 text-[11.5px] text-faint">{s.house.tag}</span>
                      </span>
                      <span className="num block truncate text-[12px] text-muted">
                        {members} {members === 1 ? "member" : "members"}
                        {s.live > 0 ? ` · +${fmtPoints(s.live)} today` : ""}
                      </span>
                    </span>
                    <span className="num shrink-0 text-right text-[13px] font-medium">{s.season > 0 ? fmtPoints(s.season) : "—"}</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line/70 px-3 py-2.5 sm:px-4">
        <p className="min-w-0 truncate text-[12.5px] text-muted" title={tab === "traders" ? "Follow a wallet and its buys, launches and comments land in your feed. Buy a coin after it and it earns points for leading you." : undefined}>
          {tab === "traders" ? "Follow to see their trades" : "A house shares one score"}
        </p>
        <Link to={tab === "traders" ? "/traders" : "/houses"} className="inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold text-gold hover:underline">
          {tab === "traders" ? "All traders" : "All houses"}
          <IconChevronRight size={14} />
        </Link>
      </div>
    </section>
  );
}

function LeadSkeleton() {
  return (
    <ul aria-hidden>
      {Array.from({ length: 5 }, (_, i) => (
        <li key={i} className="lead-row">
          <span className="skeleton h-3 w-3" />
          <span className="skeleton size-7 shrink-0 rounded-full" />
          <span className="flex-1 space-y-1.5">
            <span className="skeleton block h-3.5 w-2/5" />
            <span className="skeleton block h-3 w-3/5" />
          </span>
          <span className="skeleton h-7 w-16 rounded-lg" />
        </li>
      ))}
    </ul>
  );
}
