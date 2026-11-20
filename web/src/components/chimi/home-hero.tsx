import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { DAILY_POOL, dayEndMs, today } from "@/lib/chimi/points-rules";
import { fmtPoints } from "@/lib/chimi/rewards";
import { HowItWorks } from "@/components/chimi/how-it-works";
import { IconArrowRight, IconInfo, IconPlus } from "@/components/chimi/icons";
import { LoopVideo, ROOF } from "@/components/chimi/loop-video";
import { duration, useNow } from "@/components/chimi/rewards-bits";
import { NETWORK } from "@/lib/chimi/network";

/*
 * The banner at the top of the home page. The roof is always the picture; what turns over is the message on it: what
 * Chimi is, the traders to follow, the day's points and the houses. Each one is a step from what it is about. It
 * turns every few seconds, holds still under the pointer or the keyboard, and doesn't move at all for visitors who
 * ask for less motion.
 */

export type HeroStat = [label: string, value: ReactNode | null];

const TURN_MS = 7000;

type Slide = { key: string; kicker: ReactNode; title: string; body: ReactNode; actions: ReactNode };

/** The market in a few numbers, on glass over the roof. */
function Stats({ stats }: { stats: HeroStat[] }) {
  return (
    <dl className="glass grid grid-cols-3 rounded-2xl px-1 py-2.5">
      {stats.map(([label, value], i) => (
        <div key={label} className={`min-w-0 px-4 ${i ? "border-l border-white/10" : ""}`}>
          <dt className="truncate text-xs text-fg/60">{label}</dt>
          <dd className="num mt-0.5 truncate text-[16px] font-semibold tracking-[-0.02em]">{value === null ? <span className="skeleton mt-1 h-4 w-12 opacity-60" /> : value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function HomeBanner({ stats, live }: { stats: HeroStat[]; live: boolean }) {
  const now = useNow(30_000);
  const left = now === null ? null : dayEndMs(today(now)) - now;
  const [at, setAt] = useState(0);
  const held = useRef(false);

  const slides: Slide[] = [
    {
      key: "crown",
      kicker: (
        <>
          <span className={`live-dot ${live ? "text-ok" : "text-gold"}`} />
          {live ? `Live on ${NETWORK.name}` : "Preview"}
          <span className="font-serif text-[15px] text-gold">치미</span>
        </>
      ),
      title: "The crown goes on first.",
      body: "Every coin starts where others finish: in a locked pool, trading from block one. One transaction, no bonding curve.",
      actions: (
        <>
          <Link to="/launch" className="btn btn-primary">
            <IconPlus size={17} />
            Launch a coin
          </Link>
          <HowItWorks className="btn btn-glass">
            <IconInfo size={16} />
            How it works
          </HowItWorks>
        </>
      ),
    },
    {
      key: "traders",
      kicker: "Clubhouse",
      title: "Follow the traders.",
      body: "See who is buying, what they say about it and how they rank. Follow a wallet and its trades land in your feed.",
      actions: (
        <Link to="/clubhouse" className="btn btn-light">
          Open the Clubhouse
          <IconArrowRight size={16} />
        </Link>
      ),
    },
    {
      key: "points",
      kicker: "Season 1",
      title: `${fmtPoints(DAILY_POOL)} points, every day.`,
      body: (
        <>
          Shared by everyone with a Dojang who trades Chimi coins. Today’s pool is shared out in{" "}
          <span className="num font-semibold text-fg">{left === null ? "—" : left > 0 ? duration(left) : "a moment"}</span>.
        </>
      ),
      actions: (
        <Link to="/points" className="btn btn-light">
          See the points
          <IconArrowRight size={16} />
        </Link>
      ),
    },
    {
      key: "houses",
      kicker: "Houses · 가문",
      title: "Trade under one seal.",
      body: "A house is up to 100 traders whose points add up together. Found one or join one.",
      actions: (
        <Link to="/houses" className="btn btn-light">
          Find a house
          <IconArrowRight size={16} />
        </Link>
      ),
    },
  ];

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => {
      if (!held.current && document.visibilityState === "visible") setAt((n) => (n + 1) % slides.length);
    }, TURN_MS);
    return () => clearInterval(timer);
  }, [slides.length]);

  return (
    <section className="page pt-3 sm:pt-4" aria-roledescription="carousel" aria-label="About Chimi">
      <div
        className="home-banner roof-frame relative isolate overflow-hidden rounded-[24px] border border-line bg-[#0d1024]"
        onMouseEnter={() => (held.current = true)}
        onMouseLeave={() => (held.current = false)}
        onFocusCapture={() => (held.current = true)}
        onBlurCapture={() => (held.current = false)}
      >
        {/* A phone's banner is narrower than the 16:9 roof, so it crops the sides: it keeps the right end, where the
            chimi on the ridge sits clear of the text (the left one would be under the shading behind the text). */}
        <picture>
          <source media="(max-width: 640px)" srcSet="/banner-960.webp" />
          <img src="/banner.webp" alt="" fetchPriority="high" className="absolute inset-0 -z-20 size-full object-cover object-[center_42%] max-sm:object-[100%_42%]" />
        </picture>
        <LoopVideo wide={ROOF.wide} narrow={ROOF.narrow} className="absolute inset-0 -z-20 size-full object-cover object-[center_42%] max-sm:object-[100%_42%]" />
        <div className="banner-fog -z-10" />
        <div className="roof-scrim absolute inset-0 -z-10" />

        <div className="relative grid min-h-[300px] grid-cols-1 sm:min-h-[290px]">
          {slides.map((slide, i) => (
            <div
              key={slide.key}
              className={`home-slide col-start-1 row-start-1 flex flex-col justify-end p-5 pb-12 sm:p-7 sm:pb-12 ${i === at ? "home-slide-on" : ""}`}
              aria-hidden={i === at ? undefined : true}
              inert={i === at ? undefined : true}
            >
              <p className="flex items-center gap-2 text-[13px] font-medium text-fg/90">{slide.kicker}</p>
              <h1 className="mt-2 max-w-[18ch] text-[30px] leading-[1.02] font-semibold tracking-[-0.04em] text-balance sm:text-[40px] lg:max-w-none">{slide.title}</h1>
              <p className="mt-2 max-w-[54ch] text-[14.5px] leading-relaxed text-fg/80">{slide.body}</p>
              <div className="mt-4 flex flex-wrap gap-2">{slide.actions}</div>
            </div>
          ))}
        </div>

        <div className="absolute bottom-5 left-5 flex items-center gap-1.5 sm:left-7" role="group" aria-label="Messages">
          {slides.map((slide, i) => (
            <button
              key={slide.key}
              type="button"
              onClick={() => setAt(i)}
              aria-label={`Message ${i + 1} of ${slides.length}`}
              aria-current={i === at ? "true" : undefined}
              className="home-dot"
            />
          ))}
        </div>

        <div className="absolute right-6 bottom-5 hidden lg:block">
          <Stats stats={stats} />
        </div>
      </div>
    </section>
  );
}
