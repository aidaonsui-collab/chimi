import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { LOCK_DAYS, MAX_MEMBERS, currentStint, scoreHouses } from "@/lib/chimi/house-rules";
import { fmtPoints, useHouses, usePoints } from "@/lib/chimi/rewards";
import { useChimi } from "@/components/chimi/provider";
import { FoundHouseDialog } from "@/components/chimi/found-house";
import { HouseSeal } from "@/components/chimi/house-seal";
import { IconChevronRight, IconPlus } from "@/components/chimi/icons";
import { SectionLabel, Skeleton } from "@/components/chimi/rewards-bits";
import { Empty } from "@/components/chimi/ui";

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
      <section className="page pt-4 pb-16">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
          <div>
            <SectionLabel>가문 · HOUSES</SectionLabel>
            <h1 className="mt-2 text-[34px] leading-[1.05] font-semibold tracking-[-0.03em] sm:text-[42px]">Houses</h1>
            <p className="mt-3 max-w-[540px] text-[15px] leading-relaxed text-muted">
              Up to {MAX_MEMBERS} Dojang holders under one seal. Every point a member earns also counts for the house.
            </p>
          </div>
          {writable ? (
            <button
              type="button"
              onClick={() => setFounding(true)}
              className="btn btn-lg btn-primary"
            >
              <IconPlus size={18} />
              Found a house
            </button>
          ) : null}
        </div>

        {!writable ? <p className="mt-5 rounded-xl border border-gold/25 bg-gold/8 px-4 py-3 text-sm">Houses aren’t switched on yet. They need the site’s database.</p> : null}

        {myHouse ? (
          <Link
            to="/houses/$tag"
            params={{ tag: myHouse.house.tag }}
            className="card card-lift group mt-7 flex items-center gap-4 border-gold/30 p-4 pr-5 sm:p-5"
          >
            <HouseSeal seal={myHouse.house.seal} ink={myHouse.house.ink} size={56} />
            <div className="min-w-0 flex-1">
              <p className="eyebrow">Your house</p>
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
            <IconChevronRight size={18} className="hidden shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-fg sm:block" />
          </Link>
        ) : null}

        <div className="card mt-7 overflow-hidden">
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
            <div className="py-4">
              <div className="mt-8 flex justify-center -space-x-3">
                <HouseSeal seal="龍" ink="seal" size={60} className="-rotate-6 drop-shadow-[0_10px_20px_rgba(0,0,0,.5)]" />
                <HouseSeal seal="福" ink="ink" size={60} className="relative z-[1] rotate-3 drop-shadow-[0_10px_20px_rgba(0,0,0,.5)]" />
                <HouseSeal seal="月" ink="indigo" size={60} className="rotate-[8deg] drop-shadow-[0_10px_20px_rgba(0,0,0,.5)]" />
              </div>
              <Empty
                title="No houses yet"
                action={
                  writable ? (
                    <button type="button" onClick={() => setFounding(true)} className="btn btn-primary">
                      Found the first house
                    </button>
                  ) : null
                }
              >
                Found the first one: pick a seal, gather up to {MAX_MEMBERS} traders with a Dojang, and climb the board together.
              </Empty>
            </div>
          ) : (
            <>
              <div className="th grid grid-cols-[2.25rem_minmax(0,1fr)_6rem] gap-3 border-b border-line px-4 py-3 sm:grid-cols-[2.5rem_minmax(0,1fr)_7rem_6rem_7rem] sm:px-5">
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
                      className={`row-hover grid grid-cols-[2.25rem_minmax(0,1fr)_6rem] items-center gap-3 border-b border-line/70 px-4 py-3.5 sm:grid-cols-[2.5rem_minmax(0,1fr)_7rem_6rem_7rem] sm:px-5 ${mine?.tag === s.house.tag ? "bg-gold/6 shadow-[inset_3px_0_0_var(--color-gold)]" : ""}`}
                    >
                      <span className={`num text-sm ${s.rank <= 3 ? "font-semibold text-gold" : "text-faint"}`}>{s.rank}</span>
                      <span className="flex min-w-0 items-center gap-3.5">
                        <HouseSeal seal={s.house.seal} ink={s.house.ink} size={46} />
                        <span className="min-w-0">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-base font-medium">{s.house.name}</span>
                            <span className="shrink-0 rounded-md border border-edge bg-raise px-1.5 py-px text-[11px] font-semibold tracking-[0.08em] text-muted">{s.house.tag}</span>
                          </span>
                          <span className="block truncate text-[13px] text-muted">
                            {s.house.motto || `${s.members.length} member${s.members.length === 1 ? "" : "s"}`}
                            <span className="sm:hidden"> · {s.members.length}/{MAX_MEMBERS}</span>
                          </span>
                        </span>
                      </span>
                      <span className="hidden items-center gap-2 sm:flex">
                        <span className="h-1.5 w-12 overflow-hidden rounded-full bg-raise2">
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

        <div className="mt-12">
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
              <div key={title} className="card p-5">
                <p className="font-serif text-lg text-gold">{ko}</p>
                <p className="mt-2 text-[17px] font-semibold tracking-[-0.01em]">{title}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      {founding ? <FoundHouseDialog onClose={() => setFounding(false)} current={mine ? houses?.state.houses[mine.tag] : undefined} /> : null}
    </main>
  );
}
