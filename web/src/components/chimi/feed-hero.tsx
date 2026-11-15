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
 * The top of the home page. A first visit gets the hero: the roof, what Chimi is, and where to start. Once a wallet
 * has connected here, or the visitor has closed it, the hero is gone for good and the roof sits behind the feed's
 * heading the way every other tab's scene does.
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

/** The hero for a first visit, or the roof behind the heading after it. */
export function HomeTop({ stats, live }: { stats: HeroStat[]; live: boolean }) {
  const { connect } = useChimi();
  const [mode, hide] = useHomeMode();
  return (
    <>
      {mode !== "hero" ? (
        <div className="home-roof">
          <RoofBackdrop />
        </div>
      ) : null}
      {mode !== "plain" ? (
        <section className="home-hero page pt-4">
          <div className="roof-frame relative isolate overflow-hidden rounded-3xl border border-line bg-[#0d1024]">
            <picture>
              <source media="(max-width: 640px)" srcSet="/banner-960.webp" />
              <img src="/banner.webp" alt="" fetchPriority="high" className="absolute inset-0 -z-20 size-full object-cover object-[center_42%]" />
            </picture>
            <LoopVideo wide={ROOF.wide} narrow={ROOF.narrow} className="absolute inset-0 -z-20 size-full object-cover object-[center_42%]" />
            <div className="banner-fog -z-10" />
            <div className="roof-scrim absolute inset-0 -z-10" />

            <div className="flex min-h-[300px] flex-col justify-between gap-6 p-5 sm:p-8">
              <div>
                <p className="flex items-center gap-2 text-[13px] font-medium text-fg/90">
                  <span className={`live-dot ${live ? "text-ok" : "text-gold"}`} />
                  {live ? "Live on GIWA Sepolia" : "Preview"}
                  <span className="font-serif text-[15px] text-gold">치미</span>
                </p>
                <h1 className="mt-3 max-w-[16ch] text-[38px] leading-[1] font-semibold tracking-[-0.04em] text-balance sm:text-[52px]">The crown goes on first.</h1>
                <p className="mt-3 max-w-[48ch] text-[15px] leading-relaxed text-fg/80 sm:text-[16px]">
                  Every coin starts where others finish: in a locked pool, trading from block one. One transaction, no bonding curve.
                </p>
              </div>
              <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
                <div className="flex flex-wrap gap-2.5">
                  <Link to="/launch" className="btn btn-lg btn-primary">
                    <IconPlus size={18} />
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
                    className="btn btn-lg btn-light"
                  >
                    Connect to build your feed
                  </button>
                  <HowItWorks className="btn btn-lg gap-2 px-3 text-fg/85 underline-offset-4 hover:text-fg hover:underline">
                    <IconInfo size={17} />
                    How it works
                  </HowItWorks>
                </div>
                <dl className="glass grid grid-cols-2 gap-y-3 rounded-2xl px-1 py-3 sm:grid-cols-4">
                  {stats.map(([label, value], i) => (
                    <div key={label} className={`min-w-0 px-4 ${i % 2 ? "border-l border-white/10" : ""} ${i ? "sm:border-l sm:border-white/10" : ""}`}>
                      <dt className="text-xs text-fg/60">{label}</dt>
                      <dd className="num mt-0.5 truncate text-[17px] font-semibold tracking-[-0.02em]">{value === null ? <span className="skeleton mt-1 h-5 w-14 opacity-60" /> : value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>

            <button type="button" onClick={hide} aria-label="Hide this banner" title="Hide this banner" className="glass absolute top-4 right-4 grid size-9 place-items-center rounded-full text-fg hover:bg-white/10">
              <IconClose size={16} />
            </button>
          </div>
        </section>
      ) : null}
    </>
  );
}
