import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { short } from "@/lib/chimi/market";
import { RoofBackdrop } from "@/components/chimi/backdrop";
import { HowItWorks } from "@/components/chimi/how-it-works";
import { IconClose, IconInfo, IconPlus } from "@/components/chimi/icons";
import { LoopVideo, ROOF } from "@/components/chimi/loop-video";
import { useChimi } from "@/components/chimi/provider";
import { toast } from "@/components/chimi/toast";

/*
 * The top of the home page. A first visit gets the hero: the roof, what Chimi is, and where to start. It is a band,
 * not a screen, so the feed and the board start right under it. Once a wallet has connected here, or the visitor has
 * closed it, the hero is gone for good: the roof sits behind a single line of heading and the market's numbers, the
 * way every other tab's scene sits behind its heading.
 *
 * Which of the two shows is remembered in this browser. A line of script in the page's head (HOME_MODE_SCRIPT) reads
 * it before the first paint and marks <html>, and styles.css hides the other one, so a returning visitor never sees
 * the hero flash by while the page loads.
 */

const PLAIN_KEY = "chimi.home.plain";

/** Runs in <head>, before anything is drawn. */
export const HOME_MODE_SCRIPT = `try{if(localStorage.getItem("${PLAIN_KEY}"))document.documentElement.dataset.home="plain"}catch(e){}`;

function markPlain() {
  try {
    localStorage.setItem(PLAIN_KEY, "1");
  } catch {
    /* private mode: it lasts for this page only */
  }
  document.documentElement.dataset.home = "plain";
}

/** "both" until the browser has been asked, so the server and the first client render agree. */
type Mode = "both" | "hero" | "plain";

function useHomeMode(): [Mode, () => void] {
  const { account } = useChimi();
  const [mode, setMode] = useState<Mode>("both");
  useEffect(() => {
    setMode(document.documentElement.dataset.home === "plain" ? "plain" : "hero");
  }, []);
  // Connecting a wallet is the end of the first visit.
  useEffect(() => {
    if (!account) return;
    markPlain();
    setMode("plain");
  }, [account]);
  return [
    mode,
    () => {
      markPlain();
      setMode("plain");
    },
  ];
}

export type HeroStat = [label: string, value: ReactNode | null];

/** The market in four numbers, on glass over the roof. */
function Stats({ stats, className = "" }: { stats: HeroStat[]; className?: string }) {
  return (
    <dl className={`glass grid grid-cols-4 rounded-2xl px-0.5 py-2.5 sm:px-1 ${className}`}>
      {stats.map(([label, value], i) => (
        <div key={label} className={`min-w-0 px-2.5 sm:px-4 ${i ? "border-l border-white/10" : ""}`}>
          <dt className="truncate text-[11px] text-fg/60 sm:text-xs">{label}</dt>
          <dd className="num mt-0.5 truncate text-[14px] font-semibold tracking-[-0.02em] sm:text-[16px]">{value === null ? <span className="skeleton mt-1 h-4 w-12 opacity-60" /> : value}</dd>
        </div>
      ))}
    </dl>
  );
}

function LiveLabel({ live }: { live: boolean }) {
  return (
    <p className="flex items-center gap-2 text-[13px] font-medium text-fg/90">
      <span className={`live-dot ${live ? "text-ok" : "text-gold"}`} />
      {live ? "Live on GIWA Sepolia" : "Preview"}
      <span className="font-serif text-[15px] text-gold">치미</span>
    </p>
  );
}

/** The hero for a first visit, or the roof behind one line of heading after it. */
export function HomeTop({ stats, live }: { stats: HeroStat[]; live: boolean }) {
  const { connect } = useChimi();
  const [mode, hide] = useHomeMode();
  return (
    <>
      {mode !== "hero" ? (
        <>
          <div className="home-roof">
            <RoofBackdrop />
          </div>
          <section className="home-roof page flex flex-wrap items-end justify-between gap-x-8 gap-y-3 pt-4 sm:pt-5">
            <div className="min-w-0">
              <LiveLabel live={live} />
              <h1 className="mt-1 text-[22px] leading-tight font-semibold tracking-[-0.03em] sm:text-[26px]">Follow the traders. Trade the board.</h1>
            </div>
            <Stats stats={stats} className="w-full sm:w-auto" />
          </section>
        </>
      ) : null}
      {mode !== "plain" ? (
        <section className="home-hero page pt-3 sm:pt-4">
          <div className="roof-frame relative isolate overflow-hidden rounded-3xl border border-line bg-[#0d1024]">
            <picture>
              <source media="(max-width: 640px)" srcSet="/banner-960.webp" />
              <img src="/banner.webp" alt="" fetchPriority="high" className="absolute inset-0 -z-20 size-full object-cover object-[center_42%]" />
            </picture>
            <LoopVideo wide={ROOF.wide} narrow={ROOF.narrow} className="absolute inset-0 -z-20 size-full object-cover object-[center_42%]" />
            <div className="banner-fog -z-10" />
            <div className="roof-scrim absolute inset-0 -z-10" />

            <div className="grid grid-cols-1 gap-x-8 gap-y-4 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:pr-16">
              <div className="min-w-0">
                <LiveLabel live={live} />
                <h1 className="mt-2 max-w-[18ch] text-[30px] leading-[1.02] font-semibold tracking-[-0.04em] text-balance sm:text-[40px] lg:max-w-none">The crown goes on first.</h1>
                <p className="mt-2 max-w-[56ch] text-[14.5px] leading-relaxed text-fg/80">
                  Every coin starts where others finish: in a locked pool, trading from block one. One transaction, no bonding curve.
                </p>
              </div>
              <div className="flex min-w-0 flex-col gap-3 lg:items-end">
                <Stats stats={stats} />
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  <Link to="/launch" className="btn btn-primary">
                    <IconPlus size={17} />
                    Launch a coin
                  </Link>
                  <button
                    type="button"
                    onClick={() =>
                      void connect().catch((err: unknown) => {
                        const text = short(err);
                        if (!/reject|denied|cancel/i.test(text)) toast({ kind: "bad", title: "Couldn’t connect", body: text });
                      })
                    }
                    className="btn btn-light"
                  >
                    Connect to build your feed
                  </button>
                  <HowItWorks className="btn gap-2 px-3 text-fg/85 underline-offset-4 hover:text-fg hover:underline">
                    <IconInfo size={16} />
                    How it works
                  </HowItWorks>
                </div>
              </div>
            </div>

            <button type="button" onClick={hide} aria-label="Hide this banner" title="Hide this banner" className="glass absolute top-3 right-3 grid size-8 place-items-center rounded-full text-fg hover:bg-white/10">
              <IconClose size={15} />
            </button>
          </div>
        </section>
      ) : null}
    </>
  );
}
