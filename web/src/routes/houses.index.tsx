import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { LOCK_DAYS, MAX_MEMBERS, currentStint, scoreHouses } from "@/lib/chimi/house-rules";
import { fmtPoints, useHouses, usePoints } from "@/lib/chimi/rewards";
import { useChimi } from "@/components/chimi/provider";
import { FoundHouseDialog } from "@/components/chimi/found-house";
import { HouseSeal } from "@/components/chimi/house-seal";
import { SectionLabel, Skeleton } from "@/components/chimi/rewards-bits";

export const Route = createFileRoute("/houses/")({
  head: () => ({ meta: [{ title: "Houses · Chimi" }] }),
  component: HousesPage,
});

function HousesPage() {
  const { account } = useChimi();
  const { data: houses, loading } = useHouses();
  const { data: points } = usePoints();
  const [founding, setFounding] = useState(false);
  const scores = useMemo(() => (houses ? scoreHouses(houses.state, points) : []), [houses, points]);
  const mine = account && houses ? currentStint(houses.state, account) : undefined;
  const myHouse = mine ? scores.find((s) => s.house.tag === mine.tag) : undefined;
  const writable = houses?.writable !== false;

  return (
    <main>
      <section className="mx-auto max-w-[1180px] px-4 pt-9 pb-20 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <SectionLabel>가문 · HOUSES</SectionLabel>
            <h1 className="mt-1.5 text-[44px] leading-none font-semibold tracking-[-0.035em]">Houses</h1>
            <p className="mt-3 max-w-[540px] text-[15px] text-muted">
              Up to {MAX_MEMBERS} Dojang holders under one seal. Every point a member earns also counts for the house.
            </p>
          </div>
          {writable ? (
            <button
              type="button"
              onClick={() => setFounding(true)}
              className="rounded-full bg-seal px-5 py-2.5 text-sm font-semibold text-onseal shadow-[inset_0_1px_0_rgba(255,255,255,.22),0_6px_20px_rgba(210,74,46,.35)]"
            >
              Found a house
            </button>
          ) : null}
        </div>

        {!writable ? <p className="mt-5 text-sm text-muted">Houses aren’t switched on yet. They need the site’s database.</p> : null}

        {myHouse ? (
          <Link
            to="/houses/$tag"
            params={{ tag: myHouse.house.tag }}
            className="mt-7 flex items-center gap-4 rounded-3xl border border-gold/35 bg-gradient-to-br from-[#2a1f17] to-[#1d1611] p-4 pr-5 sm:p-5"
          >
            <HouseSeal seal={myHouse.house.seal} ink={myHouse.house.ink} size={56} />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold tracking-[0.08em] text-gold">YOUR HOUSE</p>
              <p className="mt-0.5 truncate text-lg font-semibold">
                {myHouse.house.name} <span className="text-sm font-medium text-muted">[{myHouse.house.tag}]</span>
              </p>
            </div>
            <div className="hidden text-right sm:block">
              <p className="text-xs text-muted">Rank</p>
              <p className="text-lg font-semibold tabular-nums">#{myHouse.rank}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted">Season</p>
              <p className="text-lg font-semibold tabular-nums">{fmtPoints(myHouse.season)}</p>
            </div>
          </Link>
        ) : null}

        <div className="mt-7 overflow-hidden rounded-3xl border border-line bg-chip/85 shadow-[inset_0_1px_0_rgba(255,255,255,.04)]">
          {loading && !houses ? (
            <div className="space-y-5 p-5">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="size-12 rounded-xl" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-4 w-20" />
                </div>
              ))}
            </div>
          ) : scores.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-16 text-center">
              <div className="flex -space-x-3">
                <HouseSeal seal="龍" ink="seal" size={56} className="-rotate-6" />
                <HouseSeal seal="福" ink="ink" size={56} className="relative z-[1] rotate-3" />
                <HouseSeal seal="月" ink="indigo" size={56} className="rotate-[8deg]" />
              </div>
              <p className="mt-6 text-xl font-semibold">No houses yet</p>
              <p className="mt-2 max-w-[420px] text-[15px] text-muted">Found the first one: pick a seal, gather up to {MAX_MEMBERS} traders with a Dojang, and climb the board together.</p>
              {writable ? (
                <button type="button" onClick={() => setFounding(true)} className="mt-6 rounded-full bg-seal px-5 py-2.5 text-sm font-semibold text-onseal">
                  Found the first house
                </button>
              ) : null}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-[2.25rem_minmax(0,1fr)_6rem] gap-3 border-b border-line px-4 py-3 text-xs font-medium tracking-[0.06em] text-muted sm:grid-cols-[2.5rem_minmax(0,1fr)_7rem_6rem_7rem] sm:px-5">
                <span>#</span>
                <span>House</span>
                <span className="hidden sm:block">Members</span>
                <span className="hidden text-right sm:block">Today</span>
                <span className="text-right">Season</span>
              </div>
              <ol>
                {scores.map((s) => (
                  <li key={s.house.tag}>
                    <Link
                      to="/houses/$tag"
                      params={{ tag: s.house.tag }}
                      className={`grid grid-cols-[2.25rem_minmax(0,1fr)_6rem] items-center gap-3 border-b border-line/55 px-4 py-3.5 hover:bg-fg/4 sm:grid-cols-[2.5rem_minmax(0,1fr)_7rem_6rem_7rem] sm:px-5 ${mine?.tag === s.house.tag ? "bg-seal/8" : ""}`}
                    >
                      <span className={`text-sm tabular-nums ${s.rank <= 3 ? "font-semibold text-gold" : "text-muted"}`}>{String(s.rank).padStart(2, "0")}</span>
                      <span className="flex min-w-0 items-center gap-3.5">
                        <HouseSeal seal={s.house.seal} ink={s.house.ink} size={46} />
                        <span className="min-w-0">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-base font-medium">{s.house.name}</span>
                            <span className="shrink-0 rounded-md border border-line/90 px-1.5 py-px text-[11px] font-semibold tracking-[0.08em] text-muted">{s.house.tag}</span>
                          </span>
                          <span className="block truncate text-[13px] text-muted">
                            {s.house.motto || `${s.members.length} member${s.members.length === 1 ? "" : "s"}`}
                            <span className="sm:hidden"> · {s.members.length}/{MAX_MEMBERS}</span>
                          </span>
                        </span>
                      </span>
                      <span className="hidden items-center gap-2 sm:flex">
                        <span className="h-1.5 w-12 overflow-hidden rounded-full bg-line">
                          <span className="block h-full rounded-full bg-gold/80" style={{ width: `${(s.members.length / MAX_MEMBERS) * 100}%` }} />
                        </span>
                        <span className="text-sm text-muted tabular-nums">
                          {s.members.length}/{MAX_MEMBERS}
                        </span>
                      </span>
                      <span className="hidden text-right text-sm text-muted tabular-nums sm:block">{s.live > 0 ? `+${fmtPoints(s.live)}` : "—"}</span>
                      <span className="text-right text-[15px] font-semibold tabular-nums">{fmtPoints(s.season)}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>

        <div className="mt-14">
          <SectionLabel>THE RULES</SectionLabel>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                ["도장", "Dojang holders", "Founding and joining need a GIWA Dojang, so a house is people, not a pile of fresh wallets."],
                ["칠일", `${LOCK_DAYS} days in`, `Joining keeps you in for ${LOCK_DAYS} days. You can leave any time, but can’t join another house until then. Going back is fine.`],
                ["자정", "Midnight decides", "Each day’s points count for the house you’re in when the day ends in Seoul."],
                ["가주", "The head", "The founder heads the house, sets its seal and motto, and can remove members. If the head leaves, the longest-standing member takes over."],
              ] as const
            ).map(([ko, title, body]) => (
              <div key={title} className="rounded-3xl border border-line bg-chip/70 p-5">
                <p className="font-serif text-lg text-gold">{ko}</p>
                <p className="mt-2 text-[17px] font-semibold tracking-[-0.01em]">{title}</p>
                <p className="mt-1.5 text-sm text-muted">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      {founding ? <FoundHouseDialog onClose={() => setFounding(false)} current={mine ? houses?.state.houses[mine.tag] : undefined} /> : null}
    </main>
  );
}
