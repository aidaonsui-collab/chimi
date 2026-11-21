import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { DOJANG_URL } from "@/lib/chimi/identity";
import { NETWORK } from "@/lib/chimi/network";
import { ordinal, PERKS, shareText } from "@/lib/chimi/waitlist-rules";
import { useWaitlist } from "@/lib/chimi/waitlist";
import { IconArrowRight, IconCheck, IconExternal, IconHouse, IconPoints, IconWallet, IconX } from "@/components/chimi/icons";
import { Note } from "@/components/chimi/ui";

/*
 * The mainnet waitlist. Chimi runs on GIWA Sepolia until GIWA mainnet opens; a wallet that joins here (one signature,
 * free, no gas) gets the perks on mainnet (PERKS in lib/chimi/waitlist-rules.ts). The roof carries the pitch, the
 * count and the join; under it what joining gets you, what to do meanwhile, and the plain answers.
 */

export const Route = createFileRoute("/mainnet")({
  head: () => ({
    meta: [
      { title: "Mainnet waitlist · Chimi" },
      { name: "description", content: "Be first through the gate: join the Chimi mainnet waitlist. One signature, no gas." },
      { property: "og:title", content: "Chimi mainnet waitlist" },
      { property: "og:description", content: "Be first through the gate: join the Chimi mainnet waitlist. One signature, no gas." },
    ],
  }),
  component: MainnetPage,
});

const FAQ: [q: string, a: string][] = [
  ["Does joining cost anything?", "No. You sign one message in your wallet. It isn't a transaction, so there's no gas and nothing leaves your wallet."],
  ["Do I need a Dojang?", "Not to join. Points on Chimi only go to wallets with a GIWA Dojang, on mainnet as now, so the points boost needs one."],
  ["When does mainnet open?", "When GIWA opens its mainnet. GIWA hasn't announced a date; the waitlist hears first."],
  ["Can I lose my place?", "No. Your place is the order you joined in, and it doesn't change."],
];

function MainnetPage() {
  const { status, joining, error, join, account } = useWaitlist();
  const entry = status?.entry ?? null;
  const count = status?.count;
  const origin = typeof window === "undefined" ? "https://www.chimi.club" : window.location.origin;
  const share = entry ? `https://x.com/intent/post?text=${encodeURIComponent(shareText(entry.position))}&url=${encodeURIComponent(`${origin}/mainnet`)}` : "";

  if (!NETWORK.testnet) {
    return (
      <main className="page pt-10 pb-16">
        <div className="card p-8 text-center">
          <p className="font-serif text-xl text-gold">메인넷</p>
          <h1 className="mt-2 text-[28px] font-semibold tracking-[-0.03em]">Chimi is live on {NETWORK.name}.</h1>
          <p className="mt-2 text-muted">The gate is open.</p>
          <Link to="/" className="btn btn-primary mt-5">
            Go to the board
            <IconArrowRight size={16} />
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="pb-16">
      <section className="page pt-3 sm:pt-4">
        <div className="home-banner roof-frame relative isolate overflow-hidden rounded-[24px] border border-line bg-[#0d1024]">
          <picture>
            <source media="(max-width: 640px)" srcSet="/banner-960.webp" />
            <img src="/banner.webp" alt="" fetchPriority="high" className="absolute inset-0 -z-20 size-full object-cover object-[center_42%] max-sm:object-[100%_42%]" />
          </picture>
          <div className="banner-fog -z-10" />
          <div className="roof-scrim absolute inset-0 -z-10" />

          <div className="relative flex min-h-[360px] flex-col justify-end gap-5 p-5 pb-7 sm:min-h-[380px] sm:p-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-[560px]">
              <p className="flex items-center gap-2 text-[13px] font-medium text-fg/90">
                <span className="font-serif text-[15px] text-gold">메인넷</span>
                The road to GIWA mainnet
              </p>
              <h1 className="mt-2 text-[32px] leading-[1.02] font-semibold tracking-[-0.04em] text-balance sm:text-[44px]">Be first through the gate.</h1>
              <p className="mt-3 text-[15px] leading-relaxed text-fg/80">
                Chimi moves to GIWA mainnet when it opens. Join the waitlist and your wallet gets the OG seal and a first-week points boost there. One signature: free, no gas.
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-2">
                {entry ? (
                  <>
                    <span className="btn btn-light pointer-events-none">
                      <IconCheck size={16} />
                      You’re {ordinal(entry.position)} through the gate
                    </span>
                    <a href={share} target="_blank" rel="noopener noreferrer" className="btn btn-glass">
                      <IconX size={14} />
                      Share on X
                    </a>
                  </>
                ) : (
                  <button type="button" onClick={() => void join()} disabled={joining || status?.open === false} className="btn btn-primary btn-lg">
                    <IconWallet size={17} />
                    {joining ? "Sign in your wallet…" : account ? "Join the waitlist" : "Connect and join"}
                  </button>
                )}
              </div>
              {entry ? (
                <p className="mt-2.5 text-[13px] text-fg/60">
                  Joined {new Date(entry.at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}. Your place doesn’t change.
                </p>
              ) : status?.open === false ? (
                <p className="mt-2.5 text-[13px] text-fg/60">The waitlist opens soon.</p>
              ) : null}
              {error ? (
                <Note kind="bad" className="mt-3 max-w-[420px]">
                  {error}
                </Note>
              ) : null}
            </div>

            <div className="glass shrink-0 rounded-2xl px-5 py-4 lg:min-w-[220px]">
              <p className="num text-[34px] leading-none font-semibold tracking-[-0.03em]">
                {count === undefined ? <span className="skeleton block h-8 w-24 opacity-60" /> : count.toLocaleString("en-US")}
              </p>
              <p className="mt-1.5 text-xs text-fg/60">already on the waitlist</p>
            </div>
          </div>
        </div>
      </section>

      <section className="page mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="card p-5 sm:p-6">
          <p className="eyebrow">On mainnet</p>
          <h2 className="mt-1 text-[20px] font-semibold tracking-[-0.02em]">What the waitlist gets</h2>
          <ul className="mt-4 grid gap-3">
            {PERKS.map((perk, i) => (
              <li key={perk.title} className="flex gap-3.5 rounded-xl border border-line bg-bg p-4">
                <span className="num grid size-8 shrink-0 place-items-center rounded-full border border-gold/40 bg-gold/10 text-[13px] font-semibold text-gold">{i + 1}</span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold">{perk.title}</span>
                  <span className="mt-0.5 block text-sm leading-relaxed text-muted">{perk.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="card p-5 sm:p-6">
          <p className="eyebrow">Meanwhile, on the testnet</p>
          <h2 className="mt-1 text-[20px] font-semibold tracking-[-0.02em]">Get ready now</h2>
          <ul className="mt-4 grid gap-2">
            <Step href={DOJANG_URL} icon={<IconCheck size={17} />} title="Get a Dojang" body="GIWA’s ID for real people. Points only go to wallets with one." external />
            <Step to="/houses" icon={<IconHouse size={17} />} title="Join a house" body="Up to 100 traders under one seal, points added up together." />
            <Step to="/points" icon={<IconPoints size={17} />} title="Earn points" body="100,000 points a day, shared by everyone with a Dojang who trades." />
          </ul>
        </div>
      </section>

      <section className="page mt-5">
        <div className="card p-5 sm:p-6">
          <h2 className="text-[20px] font-semibold tracking-[-0.02em]">Questions</h2>
          <dl className="mt-3 divide-y divide-line/70">
            {FAQ.map(([q, a]) => (
              <div key={q} className="py-3.5">
                <dt className="text-[15px] font-semibold">{q}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-muted">{a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </main>
  );
}

function Step({ icon, title, body, to, href, external }: { icon: ReactNode; title: string; body: string; to?: "/houses" | "/points"; href?: string; external?: boolean }) {
  const inner = (
    <>
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-raise2 text-gold">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold">{title}</span>
        <span className="mt-0.5 block text-sm text-muted">{body}</span>
      </span>
      {external ? <IconExternal size={15} className="shrink-0 text-faint" /> : <IconArrowRight size={15} className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5" />}
    </>
  );
  const cls = "group flex items-center gap-3.5 rounded-xl border border-line bg-bg p-3.5 transition-colors hover:border-edge hover:bg-raise";
  return (
    <li>
      {to ? (
        <Link to={to} className={cls}>
          {inner}
        </Link>
      ) : (
        <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
          {inner}
        </a>
      )}
    </li>
  );
}
