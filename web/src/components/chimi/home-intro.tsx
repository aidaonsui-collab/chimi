import { useEffect, useRef, useState } from "react";
import { INTRO_SEEN } from "@/lib/chimi/intro";

/*
 * The home page's opening, once per visit: out of a dark screen the roof comes up, a light runs along the ridge and
 * the two chimi at its ends catch it, the seal stamps under the roof with the name, then the screen opens from the
 * middle like a temple gate onto the board.
 *
 * It is one CSS timeline (styles.css, "The home page's opening") that starts with the first paint, so it never waits
 * on the page's scripts, and stops covering the page when the gate has opened even if they are slow. Whether it plays
 * at all is settled before the page paints (lib/chimi/intro.ts). This component remembers it played, holds the page
 * still while it runs, lets a click, tap or key open the gate at once, and takes it away when the gate has opened.
 * The scene is drawn twice, once per gate leaf, each clipped to its half, so the picture splits down the middle.
 */

/** From the first frame to the gate fully open, and a margin. Mirror styles.css. */
const RUN_MS = 4600;

// Only the page's first load can open with it: coming back to the home page from another page doesn't replay it.
let firstLoad = true;

export function HomeIntro() {
  const [on, setOn] = useState(firstLoad);
  const [skipping, setSkipping] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    firstLoad = false;
    const html = document.documentElement;
    const el = root.current;
    if (!on || !el || html.getAttribute("data-intro") !== "play") {
      setOn(false);
      return;
    }
    try {
      sessionStorage.setItem(INTRO_SEEN, "1");
    } catch {
      /* private mode: it may play again next time */
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      html.setAttribute("data-intro", "done");
      html.style.overflow = "";
      setOn(false);
    };
    // The page's scripts may wake up after the gate has already opened.
    const opening = el
      .querySelector(".intro-leaf-l")
      ?.getAnimations()
      .find((a) => (a as CSSAnimation).animationName === "intro-open-l");
    if (!opening || opening.playState === "finished") {
      finish();
      return;
    }
    html.style.overflow = "hidden";
    const onEnd = (e: AnimationEvent) => {
      if (e.animationName === "intro-open-l" || e.animationName === "intro-open-l-now") finish();
    };
    el.addEventListener("animationend", onEnd);
    const elapsed = typeof opening.currentTime === "number" ? opening.currentTime : 0;
    const fallback = setTimeout(finish, Math.max(800, RUN_MS - elapsed) + 600);
    return () => {
      el.removeEventListener("animationend", onEnd);
      clearTimeout(fallback);
      html.style.overflow = "";
    };
    // Runs once, on the first load.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Any key opens the gate at once.
  useEffect(() => {
    if (!on) return;
    const onKey = () => setSkipping(true);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [on]);

  if (!on) return null;
  return (
    <div ref={root} className={`intro ${skipping ? "intro-skip" : ""}`} onClick={() => setSkipping(true)} role="presentation">
      <div className="intro-leaf intro-leaf-l" aria-hidden>
        <Scene />
      </div>
      <div className="intro-leaf intro-leaf-r" aria-hidden>
        <Scene />
      </div>
      <span className="intro-seam" aria-hidden />
      <button type="button" className="intro-skip-btn" onClick={() => setSkipping(true)}>
        Skip
      </button>
    </div>
  );
}

/** The roof with its two chimi, and the seal and name under it. */
function Scene() {
  return (
    <div className="intro-scene">
      <div className="intro-roof">
        {/* The banner's own picture, so it is already cached. */}
        <picture>
          <source media="(max-width: 640px)" srcSet="/banner-960.webp" />
          <img src="/banner.webp" alt="" draggable={false} fetchPriority="high" />
        </picture>
        <span className="intro-ridge" />
        <span className="intro-glow intro-glow-l" />
        <span className="intro-glow intro-glow-r" />
      </div>
      <div className="intro-brand">
        <img src="/brand/mark.jpg" alt="" width={76} height={76} draggable={false} className="intro-seal" />
        <p className="intro-name">
          Chimi <span>치미</span>
        </p>
      </div>
    </div>
  );
}
