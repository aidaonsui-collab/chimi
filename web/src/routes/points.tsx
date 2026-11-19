import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { DOJANG_URL } from "@/lib/chimi/identity";
import { houseOfWallet } from "@/lib/chimi/house-rules";
import { DAILY_POOL, LEAD_SHARE, LEAGUES, dayEndMs, dayLabel, leagueOf, today, type Points, type Standing } from "@/lib/chimi/points-rules";
import { fmtPoints, useHouses, useMyProfile, usePoints } from "@/lib/chimi/rewards";
import { IconChevronRight, IconSearch } from "@/components/chimi/icons";
import { useChimi } from "@/components/chimi/provider";
import { LeaguesRoof } from "@/components/chimi/leagues-roof";
import { Empty } from "@/components/chimi/ui";
import {
  DayBars,
  DojangMark,
  HouseTag,
  LeagueChip,
  Movement,
  SectionLabel,
  Segmented,
  Skeleton,
  Stat,
  WalletMark,
  WalletName,
  duration,
  useNow,
} from "@/components/chimi/rewards-bits";

export const Route = createFileRoute("/points")({
  head: () => ({ meta: [{ title: "Points · Chimi" }] }),
  component: PointsPage,
});

type Board = "season" | "today" | "last";

function PointsPage() {
  const { data: points, loading, error } = usePoints();
  const { data: houses } = useHouses();
  const [board, setBoard] = useState<Board>("season");
  const [query, setQuery] = useState("");
  const now = useNow();

  const houseOf = useMemo(() => houseOfWallet(houses?.state), [houses]);
  const profiles = points?.file.profiles ?? {};
  const rows: Standing[] = (board === "season" ? points?.season : board === "today" ? points?.live?.standings : points?.lastDay?.standings) ?? [];
  const q = query.trim().toLowerCase();
  const shown = q ? rows.filter((r) => r.wallet.includes(q) || profiles[r.wallet]?.name?.includes(q) || houseOf.get(r.wallet)?.tag.toLowerCase() === q) : rows;
  const live = points?.live;
  const endsIn = now === null ? null : dayEndMs(live?.day ?? today(now)) - now;
  const behind = points && now !== null ? now - points.file.throughTs * 1000 > 15 * 60_000 : false;

  return (
    <main>
      <section className="page pt-4 pb-16">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
          <div>
            <SectionLabel>SEASON 1{points ? ` · SINCE ${dayLabel(points.file.seasonStart).toUpperCase()}` : ""}</SectionLabel>
            <h1 className="mt-2 text-[34px] leading-[1.05] font-semibold tracking-[-0.03em] sm:text-[42px]">Points</h1>
            <p className="mt-3 max-w-[520px] text-[15px] leading-relaxed text-muted">
              {fmtPoints(DAILY_POOL)} points a day, shared by everyone with a Dojang who trades Chimi coins. Days end at midnight in
              Seoul.
            </p>
          </div>
          <div className="card flex items-center gap-5 px-5 py-3.5">
            <div>
              <div className="text-xs text-muted">Today’s pool</div>
              <div className="num text-xl font-semibold tracking-[-0.02em]">{fmtPoints(DAILY_POOL)}</div>
            </div>
            <div className="h-9 w-px bg-line" />
            <div>
              <div className="flex items-center gap-1.5 text-xs text-muted">
                <span className="live-dot size-1.5 text-ok" />
                {endsIn === null || endsIn > 0 ? "Shared out in" : "Sharing out"}
              </div>
              <div className="num text-xl font-semibold tracking-[-0.02em]">{endsIn === null ? "—" : endsIn > 0 ? duration(endsIn) : "now…"}</div>
            </div>
          </div>
        </div>

        {error && !points ? <p className="mt-5 rounded-xl border border-gold/25 bg-gold/8 px-4 py-3 text-sm">{error}</p> : null}
        {behind ? (
          <p className="mt-4 text-sm text-muted">
            Catching up with GIWA: trades are counted through {new Date(points!.file.throughTs * 1000).toLocaleString("en-US", { timeZone: "Asia/Seoul", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} KST so far.
          </p>
        ) : null}

        <div className="mt-8 grid grid-cols-1 items-start gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
          <YourCard points={points ?? null} loading={loading} houseOf={houseOf} />

          <div className="card min-w-0 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
              <Segmented
                value={board}
                onChange={setBoard}
                options={[
                  ["season", "Season"],
                  ["today", "Today"],
                  ["last", points?.lastDay ? dayLabel(points.lastDay.day) : "Last day"],
                ]}
              />
              <label className="field flex min-h-0 w-full items-center gap-2.5 py-0 sm:w-[240px]">
                <IconSearch size={15} className="shrink-0 text-faint" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, 0x… or house tag" aria-label="Find a trader" className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none" />
              </label>
            </div>
            {board === "today" && live ? (
              <p className="border-b border-line/70 bg-raise/40 px-5 py-2.5 text-xs text-muted">
                An estimate if the day ended now. {live.volume.toFixed(3)} ETH has counted so far today.
              </p>
            ) : null}
            <BoardRows rows={shown} total={rows.length} board={board} points={points ?? null} loading={loading} houseOf={houseOf} query={q} />
          </div>
        </div>

        <HowItWorks />
        <Leagues points={points ?? null} />
      </section>
    </main>
  );
}

function BoardRows({
  rows,
  total,
  board,
  points,
  loading,
  houseOf,
  query,
}: {
  rows: Standing[];
  total: number;
  board: Board;
  points: Points | null;
  loading: boolean;
  houseOf: ReturnType<typeof houseOfWallet>;
  query: string;
}) {
  const { account } = useChimi();
  const me = account?.toLowerCase();
  const seasonCount = points?.season.length ?? 0;
  const seasonRank = new Map(points?.season.map((s) => [s.wallet, s.rank]) ?? []);
  const [limit, setLimit] = useState(50);

  if (loading && !points) {
    return (
      <div className="space-y-4 px-5 py-5">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-4 w-6" />
            <Skeleton className="size-9 rounded-[9px]" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <Empty
        mark={query ? "없음" : "첫 거래"}
        title={query ? "Nobody on this board matches" : board === "today" ? "No trades today yet" : board === "last" ? "No day has closed yet" : "No points yet this season"}
        action={
          query ? null : (
            <Link to="/" className="btn btn-primary">
              Find a coin
            </Link>
          )
        }
      >
        {query
          ? "Try a name, a 0x address or a house tag."
          : board === "today"
            ? "No Dojang wallet has traded today. The first trade takes the whole pool, for now."
            : board === "last"
              ? "The first day closes at midnight in Seoul."
              : total === 0 && points?.live?.standings.length
                ? "The season’s first day is still open. Its points land at midnight in Seoul."
                : "Trade any Chimi coin to start."}
      </Empty>
    );
  }
  return (
    <div>
      <div className="th grid grid-cols-[1.75rem_minmax(0,1fr)_4.75rem] gap-3 border-b border-line px-4 py-2.5 sm:grid-cols-[2.5rem_minmax(0,1fr)_7rem_6rem] sm:px-5">
        <span>#</span>
        <span>Trader</span>
        <span className="text-right">{board === "today" ? "So far" : "Points"}</span>
        <span className="hidden text-right sm:block">{board === "season" ? "Move" : "Season"}</span>
      </div>
      <ol>
        {rows.slice(0, limit).map((r) => {
          const house = houseOf.get(r.wallet);
          const profile = points?.file.profiles[r.wallet];
          const sRank = seasonRank.get(r.wallet);
          const mine = r.wallet === me;
          return (
            <li
              key={r.wallet}
              className={`row-hover grid grid-cols-[1.75rem_minmax(0,1fr)_4.75rem] items-center gap-3 border-b border-line/70 px-4 py-3 last:border-0 sm:grid-cols-[2.5rem_minmax(0,1fr)_7rem_6rem] sm:px-5 ${mine ? "bg-gold/6 shadow-[inset_3px_0_0_var(--color-gold)]" : ""}`}
            >
              <span className={`num text-sm ${r.rank <= 3 ? "font-semibold text-gold" : "text-faint"}`}>{r.rank}</span>
              <span className="flex min-w-0 items-center gap-2.5 sm:gap-3">
                <WalletMark house={house} />
                <span className="min-w-0">
                  <span className="flex min-w-0 items-center gap-1.5 text-[14px] sm:text-[15px]">
                    <WalletName wallet={r.wallet} profile={profile} you={mine} />
                    <DojangMark verified={profile?.verified} />
                  </span>
                  <span className="mt-0.5 flex min-w-0 items-center gap-1.5">
                    {sRank ? <LeagueChip league={leagueOf(sRank, seasonCount)} /> : null}
                    {house ? <HouseTag house={house} /> : null}
                  </span>
                </span>
              </span>
              <span className="text-right text-[15px] font-semibold tabular-nums">{fmtPoints(r.points)}</span>
              <span className="hidden text-right text-sm tabular-nums sm:block">
                {board === "season" ? <Movement rank={r.rank} prev={r.prevRank} /> : <span className="text-muted">{sRank ? `#${sRank}` : "—"}</span>}
              </span>
            </li>
          );
        })}
      </ol>
      {rows.length > limit ? (
        <button type="button" onClick={() => setLimit((l) => l + 100)} className="w-full border-t border-line py-3 text-sm font-medium text-muted hover:text-fg">
          Show more ({rows.length - limit} left)
        </button>
      ) : null}
    </div>
  );
}

function YourCard({ points, loading, houseOf }: { points: Points | null; loading: boolean; houseOf: ReturnType<typeof houseOfWallet> }) {
  const { account, connect } = useChimi();
  const { profile, checking, check } = useMyProfile();
  const [connectError, setConnectError] = useState<string | null>(null);
  const shell = "card relative w-full overflow-hidden p-5 sm:p-6";
  const glow = <div className="pointer-events-none absolute -top-24 -right-20 size-64 rounded-full bg-[radial-gradient(closest-side,rgba(212,67,43,.2),transparent)]" />;

  if (!account) {
    return (
      <div className={shell}>
        {glow}
        <div className="relative">
          <span className="eyebrow">Your standing</span>
          <p className="mt-4 text-[24px] leading-[1.12] font-semibold tracking-[-0.03em]">Trade, and take a share of every day’s pool.</p>
          <p className="mt-3 text-sm text-muted">Connect to see your rank, your league and what today is worth to you so far.</p>
          <button
            type="button"
            onClick={() => void connect().catch((e: unknown) => setConnectError(e instanceof Error ? e.message : "Couldn't connect."))}
            className="btn btn-lg btn-light mt-6 w-full"
          >
            Connect wallet
          </button>
          {connectError ? <p className="mt-2 text-sm text-down">{connectError}</p> : null}
        </div>
      </div>
    );
  }

  const me = account.toLowerCase();
  const season = points?.season.find((s) => s.wallet === me);
  const todayRow = points?.live?.standings.find((s) => s.wallet === me);
  const tradedToday = !!points?.file.open.find((d) => d.day === points.live?.day)?.weights[me];
  const missed = points?.file.days.filter((d) => d.unverified.includes(me)).length ?? 0;
  const league = season ? leagueOf(season.rank, points!.season.length) : null;
  const house = houseOf.get(me);
  const verified = profile?.verified ?? points?.file.profiles[me]?.verified;
  const name = profile?.name ?? points?.file.profiles[me]?.name;

  return (
    <div className={shell}>
      {glow}
      <div className="relative">
        <div className="flex items-center justify-between gap-3">
          <span className="eyebrow">Your standing</span>
          {season ? <span className="num chip text-fg">Rank #{season.rank}</span> : null}
        </div>
        <div className="mt-5 flex items-center gap-3.5">
          <WalletMark house={house} size={52} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xl">
              <WalletName wallet={me} profile={name !== undefined ? { name: name ?? null, verified: !!verified, at: 0 } : null} />
              <DojangMark verified={verified} />
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              {league ? <LeagueChip league={league} /> : <span className="text-xs text-muted">No league yet</span>}
              {house ? <HouseTag house={house} /> : null}
            </div>
          </div>
        </div>

        {verified === false ? (
          <div className="mt-5 rounded-xl border border-gold/30 bg-gold/8 p-4">
            <p className="text-sm font-semibold text-fg">No Dojang on this wallet</p>
            <p className="mt-1 text-sm text-muted">
              Only wallets with a GIWA Dojang earn points.
              {tradedToday
                ? " You’ve traded today: get one before midnight in Seoul and today counts."
                : missed > 0
                  ? ` You traded on ${missed} day${missed === 1 ? "" : "s"} without one.`
                  : " It’s free, and checked when each day closes."}
            </p>
            <div className="mt-3 flex items-center gap-2">
              <a href={DOJANG_URL} target="_blank" rel="noreferrer" className="btn btn-sm btn-primary">
                Get a Dojang ↗
              </a>
              <button type="button" disabled={checking} onClick={() => void check().catch(() => undefined)} className="btn btn-sm btn-secondary">
                {checking ? "Checking…" : "Check again"}
              </button>
            </div>
          </div>
        ) : null}

        <div className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-5">
          <Stat label="Season" value={loading && !points ? <Skeleton className="mt-1 h-6 w-20" /> : fmtPoints(season?.points ?? 0)} sub="points" />
          <Stat label="Today so far" value={loading && !points ? <Skeleton className="mt-1 h-6 w-16" /> : fmtPoints(todayRow?.points ?? 0)} sub={todayRow ? `#${todayRow.rank} today` : "estimate"} />
        </div>
        {points && (season || todayRow) ? (
          <div className="mt-6">
            <DayBars days={points.history(me)} live={points.live ? { day: points.live.day, points: todayRow?.points ?? 0 } : null} color="#e4563d" />
          </div>
        ) : null}
        {!house ? (
          <Link to="/houses" className="group mt-5 flex items-center justify-between rounded-xl bg-raise px-4 py-3 text-sm font-medium transition-colors hover:bg-raise2">
            <span>Join a house</span>
            <IconChevronRight size={15} className="text-muted transition-transform group-hover:translate-x-0.5" />
          </Link>
        ) : (
          <Link to="/houses/$tag" params={{ tag: house.tag }} className="group mt-5 flex items-center justify-between rounded-xl bg-raise px-4 py-3 text-sm font-medium transition-colors hover:bg-raise2">
            <span>{house.name}</span>
            <IconChevronRight size={15} className="text-muted transition-transform group-hover:translate-x-0.5" />
          </Link>
        )}
      </div>
    </div>
  );
}

function HowItWorks() {
  const items = [
    ["매일", "A pool every day", `${fmtPoints(DAILY_POOL)} points are shared out at midnight in Seoul, by how much ETH each wallet bought and sold on Chimi coins that day.`],
    ["창작", "Creators earn too", "Launch a coin and earn 10% of what other wallets trade on it. Your own trades on your own coin don’t count."],
    ["선도", "Lead the way", `When someone who follows you buys a coin within a day of your own buy, you earn ${LEAD_SHARE * 100}% of theirs, up to the size of yours. It costs them nothing.`],
    ["도장", "Dojang only", "Only wallets with a GIWA Dojang share the pool, so one person can’t farm it with a hundred wallets. It’s checked when each day closes."],
    ["가문", "Houses add up", "Join a house and your points also count toward it. A day counts for the house you’re in when it ends."],
  ] as const;
  return (
    <div className="mt-12">
      <SectionLabel>HOW IT WORKS</SectionLabel>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        {items.map(([ko, title, body]) => (
          <div key={title} className="reveal reveal-step card p-5">
            <p className="font-serif text-lg text-gold">{ko}</p>
            <p className="mt-2 text-[17px] font-semibold tracking-[-0.01em]">{title}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Leagues({ points }: { points: Points | null }) {
  const [active, setActive] = useState<string | undefined>();
  const total = points?.season.length ?? 0;
  const counts = new Map<string, number>();
  for (const s of points?.season ?? []) {
    const l = leagueOf(s.rank, total).name;
    counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  return (
    <div className="mt-12">
      <SectionLabel>LEAGUES</SectionLabel>
      <p className="mt-2 max-w-[560px] text-[15px] text-muted">Your season rank puts you on the roof. The higher you trade, the higher you sit.</p>
      <div className="card mt-5 grid grid-cols-1 items-center gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <LeaguesRoof active={active} />
        <ul className="space-y-1">
          {LEAGUES.map((l, i) => (
            <li key={l.name}>
              <button
                type="button"
                onMouseEnter={() => setActive(l.name)}
                onMouseLeave={() => setActive(undefined)}
                onFocus={() => setActive(l.name)}
                onBlur={() => setActive(undefined)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-raise"
              >
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: l.color }} />
                <span className="w-16 shrink-0 font-serif text-lg" style={{ color: l.color }}>
                  {l.korean}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium">{l.name}</span>
                  <span className="block text-xs text-muted">
                    {i === LEAGUES.length - 1 ? "Everyone else" : `Top ${l.top * 100}%`} · {["the ornament on the ridge", "the ridge", "the roof tiles", "the rafters", "the foundation stones"][i]}
                  </span>
                </span>
                <span className="text-sm text-muted tabular-nums">{counts.get(l.name) ?? 0}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
