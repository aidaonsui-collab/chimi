import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { DOJANG_URL } from "@/lib/chimi/identity";
import { MAX_MEMBERS, SEALS, checkMotto, currentStint, lockedUntil, scoreHouses } from "@/lib/chimi/house-rules";
import { dayLabel } from "@/lib/chimi/points-rules";
import { fmtPoints, useHouseAction, useHouses, useMyProfile, usePoints, useProfiles } from "@/lib/chimi/rewards";
import { useChimi } from "@/components/chimi/provider";
import { EditSealDialog } from "@/components/chimi/found-house";
import { HouseSeal } from "@/components/chimi/house-seal";
import { DayBars, DojangMark, SectionLabel, Skeleton, Stat, WalletName } from "@/components/chimi/rewards-bits";

export const Route = createFileRoute("/houses/$tag")({
  head: ({ params }) => ({ meta: [{ title: `[${params.tag.toUpperCase()}] · Chimi houses` }] }),
  component: HousePage,
});

const when = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "Asia/Seoul" });

function HousePage() {
  const tag = Route.useParams().tag.toUpperCase();
  const { account } = useChimi();
  const { data: houses, loading } = useHouses();
  const { data: points } = usePoints();
  const { profile: myProfile } = useMyProfile();
  const action = useHouseAction();
  const [editing, setEditing] = useState<"seal" | "motto" | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null); // "leave" or a wallet to remove
  const [motto, setMotto] = useState("");

  const scores = useMemo(() => (houses ? scoreHouses(houses.state, points) : []), [houses, points]);
  const score = scores.find((s) => s.house.tag === tag);
  const profiles = useProfiles(score?.members.map((m) => m.wallet) ?? [], points?.file.profiles);

  if (loading && !houses) {
    return (
      <main className="mx-auto max-w-[1180px] px-4 pt-9 pb-20 sm:px-6">
        <Skeleton className="h-40 w-full rounded-[28px]" />
      </main>
    );
  }
  const house = houses?.state.houses[tag];
  if (!houses || !house || !score) {
    return (
      <main className="mx-auto max-w-[1180px] px-4 pt-16 pb-24 text-center sm:px-6">
        <p className="font-serif text-3xl text-gold">없음</p>
        <p className="mt-3 text-lg font-semibold">{house?.closedAt ? `[${tag}] has closed.` : `There’s no house called [${tag}].`}</p>
        <Link to="/houses" className="mt-6 inline-flex rounded-full border border-line px-4 py-2 text-sm text-muted hover:text-fg">
          All houses
        </Link>
      </main>
    );
  }

  const me = account?.toLowerCase();
  const myStint = me ? currentStint(houses.state, me) : undefined;
  const member = myStint?.tag === tag;
  const head = house.head === me;
  const full = score.members.length >= MAX_MEMBERS;
  const lock = me ? lockedUntil(houses.state, me, Date.now()) : 0;
  const lastHouse = me ? houses.state.stints.filter((s) => s.wallet === me).sort((a, b) => b.from - a.from)[0]?.tag : undefined;
  const lockedOut = !member && lock > 0 && lastHouse !== tag;
  const noDojang = myProfile?.verified === false;
  const headProfile = profiles[house.head];
  const today = points?.live?.day;

  async function act(a: Parameters<typeof action.run>[0]) {
    const done = await action.run(a);
    if (done) {
      setConfirm(null);
      setEditing(null);
    }
  }

  return (
    <main>
      <section className="mx-auto max-w-[1180px] px-4 pt-7 pb-20 sm:px-6">
        <Link to="/houses" className="text-sm text-muted hover:text-fg">
          ← Houses
        </Link>

        <div className="relative mt-4 overflow-hidden rounded-[28px] border border-gold/35 bg-gradient-to-br from-[#2a1f17] to-[#1d1611] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,.06),0_30px_60px_-30px_rgba(0,0,0,.8)] sm:p-8">
          <div className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-[radial-gradient(closest-side,rgba(210,74,46,.24),transparent)]" />
          <div className="relative flex flex-col gap-6 sm:flex-row sm:items-start">
            <HouseSeal seal={house.seal} ink={house.ink} size={128} className="-rotate-3 drop-shadow-[0_14px_30px_rgba(0,0,0,.45)]" title={`${SEALS[house.seal]} seal`} />
            <div className="min-w-0 flex-1">
              <SectionLabel>
                HOUSE #{score.rank} · {SEALS[house.seal].toUpperCase()}
              </SectionLabel>
              <h1 className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[36px] leading-none font-semibold tracking-[-0.03em] sm:text-[44px]">
                <span className="min-w-0 break-words">{house.name}</span>
                <span className="rounded-lg border border-line px-2 py-0.5 text-base font-semibold tracking-[0.1em] text-muted">{house.tag}</span>
              </h1>
              {editing === "motto" ? (
                <form
                  className="mt-3 flex max-w-[520px] gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act({ type: "motto", motto: motto.trim() });
                  }}
                >
                  <input autoFocus maxLength={80} value={motto} onChange={(e) => setMotto(e.target.value)} className="min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 py-2 font-serif" placeholder="A line for the house" />
                  <button type="submit" disabled={!!action.pending || !!checkMotto(motto.trim())} className="rounded-full bg-seal px-4 text-sm font-semibold text-onseal disabled:opacity-40">
                    {action.pending ? "Signing…" : "Save"}
                  </button>
                  <button type="button" onClick={() => setEditing(null)} className="px-2 text-sm text-muted">
                    Cancel
                  </button>
                </form>
              ) : (
                <p className="mt-3 font-serif text-lg text-fg/85">{house.motto || <span className="text-muted">No motto yet.</span>}</p>
              )}
              <p className="mt-3 flex flex-wrap items-center gap-x-1.5 text-sm text-muted">
                Headed by
                <span className="inline-flex items-center gap-1 text-fg">
                  <WalletName wallet={house.head} profile={headProfile} you={head} />
                </span>
                · founded {when(house.createdAt)}
              </p>
            </div>

            <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col sm:items-stretch">
              {member ? (
                confirm === "leave" ? (
                  <div className="rounded-2xl border border-line bg-bg/60 p-3 text-sm sm:w-56">
                    <p className="text-muted">
                      {head && score.members.length === 1
                        ? `Leave [${tag}]? It closes with nobody in it${lock ? `, and you can’t join or found another house until ${when(lock)}` : ""}.`
                        : `Leave [${tag}]? ${lock ? `You can come back, but can’t join or found another house until ${when(lock)}.` : "You can come back any time."}${head ? " The longest-standing member becomes head." : ""}`}
                    </p>
                    <div className="mt-2.5 flex gap-2">
                      <button type="button" disabled={!!action.pending} onClick={() => void act({ type: "leave" })} className="rounded-full bg-seal px-3.5 py-1.5 font-semibold text-onseal disabled:opacity-40">
                        {action.pending ? "Signing…" : "Leave"}
                      </button>
                      <button type="button" onClick={() => setConfirm(null)} className="px-2 text-muted">
                        Stay
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {head ? (
                      <>
                        <button type="button" onClick={() => setEditing("seal")} className="rounded-full border border-line bg-chip px-4 py-2 text-sm font-medium hover:border-muted/60">
                          Change seal
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setMotto(house.motto);
                            setEditing("motto");
                          }}
                          className="rounded-full border border-line bg-chip px-4 py-2 text-sm font-medium hover:border-muted/60"
                        >
                          Edit motto
                        </button>
                      </>
                    ) : null}
                    <button type="button" onClick={() => setConfirm("leave")} className="rounded-full px-4 py-2 text-sm text-muted hover:text-fg">
                      Leave house
                    </button>
                  </>
                )
              ) : (
                <div className="sm:w-56">
                  <button
                    type="button"
                    disabled={!!action.pending || full || lockedOut || noDojang}
                    onClick={() => void act({ type: "join", tag })}
                    className="w-full rounded-full bg-seal px-5 py-2.5 text-sm font-semibold text-onseal shadow-[inset_0_1px_0_rgba(255,255,255,.22),0_6px_20px_rgba(210,74,46,.35)] disabled:opacity-40 disabled:shadow-none"
                  >
                    {action.pending ? "Sign in your wallet…" : full ? "House is full" : myStint ? `Move to [${tag}]` : `Join [${tag}]`}
                  </button>
                  <p className="mt-2 text-xs text-muted">
                    {lockedOut ? (
                      `You can switch houses from ${when(lock)}.`
                    ) : noDojang ? (
                      <>
                        Houses are for wallets with a Dojang.{" "}
                        <a href={DOJANG_URL} target="_blank" rel="noreferrer" className="text-fg underline underline-offset-2">
                          Get one ↗
                        </a>
                      </>
                    ) : myStint ? (
                      `You’ll leave [${myStint.tag}]. A signature, not a transaction.`
                    ) : (
                      "A signature, not a transaction. You stay at least 7 days."
                    )}
                  </p>
                </div>
              )}
            </div>
          </div>
          {action.error ? <p className="relative mt-4 text-sm text-seal">{action.error}</p> : null}

          <div className="relative mt-7 grid grid-cols-2 gap-4 border-t border-line/90 pt-5 sm:grid-cols-4">
            <Stat label="Season" value={fmtPoints(score.season)} sub="points" />
            <Stat label="Today so far" value={fmtPoints(score.live)} sub={today ? dayLabel(today) : "estimate"} />
            <Stat label="Rank" value={`#${score.rank}`} sub={`of ${scores.length} house${scores.length === 1 ? "" : "s"}`} />
            <Stat label="Members" value={`${score.members.length}/${MAX_MEMBERS}`} sub={full ? "full" : `${MAX_MEMBERS - score.members.length} seats open`} />
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 overflow-hidden rounded-3xl border border-line bg-chip/85">
            <div className="grid grid-cols-[2.25rem_minmax(0,1fr)_6rem] gap-3 border-b border-line px-4 py-3 text-xs font-medium tracking-[0.06em] text-muted sm:grid-cols-[2.5rem_minmax(0,1fr)_6rem_7rem_5.5rem] sm:px-5">
              <span>#</span>
              <span>Member</span>
              <span className="hidden text-right sm:block">Today</span>
              <span className="text-right">Season</span>
              <span className="hidden sm:block" />
            </div>
            <ol>
              {score.members.map((m, i) => {
                const p = profiles[m.wallet];
                const isHead = m.wallet === house.head;
                return (
                  <li key={m.wallet} className={`grid grid-cols-[2.25rem_minmax(0,1fr)_6rem] items-center gap-3 border-b border-line/50 px-4 py-3 last:border-0 sm:grid-cols-[2.5rem_minmax(0,1fr)_6rem_7rem_5.5rem] sm:px-5 ${m.wallet === me ? "bg-seal/8" : ""}`}>
                    <span className="text-sm text-muted tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                    <span className="min-w-0">
                      <span className="flex min-w-0 items-center gap-1.5 text-[15px]">
                        <WalletName wallet={m.wallet} profile={p} you={m.wallet === me} />
                        <DojangMark verified={p?.verified} />
                        {isHead ? <span className="shrink-0 rounded-full bg-gold/12 px-1.5 py-px text-[11px] font-semibold text-gold">head</span> : null}
                      </span>
                      <span className="block text-xs text-muted">since {when(m.since)}</span>
                    </span>
                    <span className="hidden text-right text-sm text-muted tabular-nums sm:block">{m.live > 0 ? `+${fmtPoints(m.live)}` : "—"}</span>
                    <span className="text-right text-[15px] font-semibold tabular-nums">{fmtPoints(m.season)}</span>
                    <span className="hidden justify-end sm:flex">
                      {head && !isHead ? (
                        confirm === m.wallet ? (
                          <button type="button" disabled={!!action.pending} onClick={() => void act({ type: "remove", wallet: m.wallet })} className="rounded-full bg-seal px-2.5 py-1 text-xs font-semibold text-onseal disabled:opacity-40">
                            {action.pending ? "…" : "Confirm"}
                          </button>
                        ) : (
                          <button type="button" onClick={() => setConfirm(m.wallet)} className="rounded-full px-2.5 py-1 text-xs text-muted hover:bg-fg/6 hover:text-fg">
                            Remove
                          </button>
                        )
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>

          <div className="rounded-3xl border border-line bg-chip/70 p-5">
            <SectionLabel>DAY BY DAY</SectionLabel>
            {score.daily.length > 0 || score.live > 0 ? (
              <div className="mt-4">
                <DayBars days={score.daily} live={today ? { day: today, points: score.live } : null} color={INK_FOR_BARS[house.ink] ?? "#d24a2e"} height={96} />
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted">No points yet. Members’ trades count from the day they join.</p>
            )}
            <p className="mt-5 text-xs text-muted">Each day counts for the house its traders are in at midnight in Seoul.</p>
          </div>
        </div>
      </section>
      {editing === "seal" ? <EditSealDialog house={house} onClose={() => setEditing(null)} /> : null}
    </main>
  );
}

/** Bar colors for each ink, lifted so they read on the dark page. */
const INK_FOR_BARS: Record<string, string> = {
  seal: "#d24a2e",
  ink: "#b6a68a",
  indigo: "#6f8fc9",
  jade: "#5fb3a6",
  pine: "#7fae6f",
  plum: "#c06a9e",
  gold: "#e0b45a",
  rust: "#d07a3e",
};
