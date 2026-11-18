import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { followingOf } from "@/lib/chimi/follow-rules";
import { useFollows } from "@/lib/chimi/follows";
import { compactUsd, ethText } from "@/lib/chimi/format";
import { useEthUsd, useSwaps } from "@/lib/chimi/live";
import { poolKey } from "@/lib/chimi/market";
import { fmtPoints, usePoints, useProfiles } from "@/lib/chimi/rewards";
import { defaultTraderSort, orderTraders, traderRows, type TraderSort } from "@/lib/chimi/trader-rules";
import { FollowButton } from "@/components/chimi/follow";
import { useChimi } from "@/components/chimi/provider";
import { DojangMark } from "@/components/chimi/rewards-bits";
import { Blockie, Empty, PageHead, Seg } from "@/components/chimi/ui";

/**
 * Everyone who trades on Chimi, in one list: the season's points, who follows them, the buys they have led and what
 * they traded today. It is put together in the browser from the points book, the follow list and the day's trades.
 */
export const Route = createFileRoute("/traders")({ component: Traders });

const DAY = 24 * 60 * 60;
const PAGE = 25;

const GRID =
  "grid items-center gap-x-4 px-4 sm:px-5 grid-cols-[1.5rem_minmax(0,1fr)_auto] md:grid-cols-[2rem_minmax(0,1.6fr)_repeat(4,minmax(0,1fr))_6.5rem]";

function Traders() {
  const { coins, account, loading } = useChimi();
  const live = useMemo(() => coins.filter((c) => !c.preview), [coins]);
  const { byPool, ready } = useSwaps(live);
  const { data: points, loading: pointsLoading } = usePoints();
  const { data: follows } = useFollows();
  const ethUsd = useEthUsd();
  const [sort, setSort] = useState<TraderSort>("points");
  const [picked, setPicked] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const me = account?.toLowerCase();

  useEffect(() => {
    const before = document.title;
    document.title = "Traders · Chimi";
    return () => {
      document.title = before;
    };
  }, []);

  const rows = useMemo(() => {
    const since = Math.floor(Date.now() / 1000) - DAY;
    const trades = live.flatMap((coin) => (byPool[poolKey(coin)] ?? []).map((swap) => ({ wallet: swap.recipient, eth: Number(swap.ethAmount) / 1e18, time: swap.time })));
    return traderRows(points, follows?.state, trades, since);
  }, [points, follows, live, byPool]);

  const order: TraderSort = picked ? sort : defaultTraderSort(rows);
  const sorted = useMemo(() => orderTraders(rows, order), [rows, order]);
  const page = sorted.slice(0, shown);
  const profiles = useProfiles(
    useMemo(() => page.map((r) => r.wallet), [page]),
    points?.file.profiles,
  );
  const mine = useMemo(() => new Set(followingOf(follows?.state, me)), [follows, me]);
  const cash = (eth: number) => (eth === 0 ? "—" : ethUsd ? compactUsd(eth * ethUsd) : `${ethText(eth)} ETH`);
  // The list is mostly the points book, so it isn't called empty until that has answered.
  const waiting = loading || (pointsLoading && rows.length === 0) || (live.length > 0 && !ready && rows.length === 0);

  return (
    <main className="page pt-2 pb-16">
      <PageHead
        eyebrow="Who to follow"
        title="Traders"
        actions={
          <Seg
            label="Order traders by"
            value={order}
            onChange={(next) => {
              setSort(next);
              setPicked(true);
              setShown(PAGE);
            }}
            options={[
              ["points", "Season points"],
              ["followers", "Followers"],
              ["today", "Traded today"],
            ]}
          />
        }
      >
        Everyone trading on Chimi. Follow a wallet and its buys, launches and comments show up in your feed; when you buy a coin after it, it earns points for leading you.
      </PageHead>

      <div className="card mt-8 overflow-hidden">
        <div className={`${GRID} th border-b border-line py-3`}>
          <span>#</span>
          <span>Trader</span>
          <span className="text-right md:hidden">{order === "followers" ? "Followers" : order === "today" ? "Today" : "Points"}</span>
          <span className="hidden text-right md:block">Season points</span>
          <span className="hidden text-right md:block">Followers</span>
          <span className="hidden text-right md:block">Buys led</span>
          <span className="hidden text-right md:block">Traded today</span>
          <span className="hidden md:block" />
        </div>
        {waiting ? (
          Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-4 border-b border-line/70 px-5 py-3.5 last:border-0">
              <span className="skeleton h-4 w-4" />
              <span className="skeleton size-8 rounded-full" />
              <span className="skeleton h-4 flex-1" />
              <span className="skeleton h-4 w-16" />
            </div>
          ))
        ) : sorted.length === 0 ? (
          <Empty
            mark="첫 거래"
            title="No traders to show yet"
            action={
              <Link to="/board" className="btn btn-primary">
                Find a coin
              </Link>
            }
          >
            Wallets show up here once they buy or sell a Chimi coin.
          </Empty>
        ) : (
          page.map((r, i) => {
            const profile = profiles[r.wallet];
            const name = profile?.name?.replace(/\.up\.id$/, "");
            const you = r.wallet === me;
            return (
              <div key={r.wallet} className={`${GRID} row-hover border-b border-line/70 py-3 last:border-0`}>
                <span className="num text-sm text-faint">{i + 1}</span>
                <Link to="/u/$address" params={{ address: r.wallet }} title={r.wallet} className="flex min-w-0 items-center gap-3">
                  <Blockie address={r.wallet} size={36} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="num truncate text-[15px] font-semibold hover:text-gold">{name ?? `${r.wallet.slice(0, 6)}…${r.wallet.slice(-4)}`}</span>
                      <DojangMark verified={profile?.verified} />
                      {you ? <span className="chip h-5 px-1.5 text-[11px] text-gold">You</span> : null}
                      {mine.has(r.wallet) ? <span className="chip h-5 px-1.5 text-[11px]">Following</span> : null}
                    </span>
                    <span className="num block truncate text-[13px] text-muted">
                      {r.trades > 0 ? `${r.trades} ${r.trades === 1 ? "trade" : "trades"} today` : r.rank ? `Rank #${r.rank} this season` : profile?.verified === false ? "No Dojang, so no points yet" : "No trades today"}
                    </span>
                  </span>
                </Link>
                <span className="num text-right text-[15px] font-medium md:hidden">{order === "followers" ? r.followers : order === "today" ? cash(r.todayEth) : fmtPoints(r.points)}</span>
                <span className="num hidden text-right text-[15px] font-medium md:block">{r.points > 0 ? fmtPoints(r.points) : "—"}</span>
                <span className="num hidden text-right text-[15px] md:block">{r.followers || "—"}</span>
                <span className="num hidden text-right text-[15px] md:block" title={r.led ? `${ethText(r.ledEth)} ETH of buys followed theirs` : undefined}>
                  {r.led || "—"}
                </span>
                <span className="num hidden text-right text-[15px] md:block">{cash(r.todayEth)}</span>
                <span className="hidden justify-end md:flex">{you ? null : <FollowButton wallet={r.wallet} name={profile?.name} size="sm" />}</span>
              </div>
            );
          })
        )}
        {sorted.length > shown ? (
          <button type="button" onClick={() => setShown((n) => n + PAGE)} className="w-full border-t border-line py-3 text-sm font-medium text-muted hover:text-fg">
            Show more ({sorted.length - shown} left)
          </button>
        ) : null}
      </div>
    </main>
  );
}
