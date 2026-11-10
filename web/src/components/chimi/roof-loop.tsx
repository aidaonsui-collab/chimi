import { useEffect, useRef, useState } from "react";

type Loop = { webm: string; mp4: string };

const WIDE: Loop = { webm: "/banner-loop.webm", mp4: "/banner-loop.mp4" };
const NARROW: Loop = { webm: "/banner-loop-960.webm", mp4: "/banner-loop-960.mp4" };

/**
 * The roof art in motion: a short silent loop of the same picture, laid over the still once the page has settled.
 * The still stays underneath as the first paint and as the fallback, so nothing waits on the video. It is left out
 * for visitors who ask for less motion or less data, and it stops while the banner is off screen.
 */
export function RoofLoop({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [loop, setLoop] = useState<Loop | null>(null);
  const [showing, setShowing] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (connection?.saveData) return;

    const pick = () => setLoop(window.matchMedia("(max-width: 640px)").matches ? NARROW : WIDE);
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(pick, { timeout: 2500 });
      return () => window.cancelIdleCallback(id);
    }
    const timer = setTimeout(pick, 1200);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let onScreen = false;
    const sync = () => {
      if (onScreen && document.visibilityState === "visible") video.play().catch(() => {});
      else video.pause();
    };
    const watcher = new IntersectionObserver(
      ([entry]) => {
        onScreen = !!entry?.isIntersecting;
        sync();
      },
      { threshold: 0.05 },
    );
    watcher.observe(video);
    document.addEventListener("visibilitychange", sync);
    return () => {
      watcher.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [loop]);

  if (!loop) return null;

  return (
    <video
      ref={ref}
      muted
      loop
      playsInline
      preload="auto"
      disablePictureInPicture
      aria-hidden="true"
      tabIndex={-1}
      onPlaying={() => setShowing(true)}
      className={`pointer-events-none transition-opacity duration-1000 ease-out ${showing ? "opacity-100" : "opacity-0"} ${className}`}
    >
      <source src={loop.webm} type="video/webm" />
      <source src={loop.mp4} type="video/mp4" />
    </video>
  );
}
