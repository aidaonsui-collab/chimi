import type { CSSProperties } from "react";
import { LoopVideo, type Loop } from "@/components/chimi/loop-video";

type Scene = {
  still: string;
  loop: Loop;
  /** Which part of the picture stays in view when the band is a different shape (CSS object-position). */
  at: string;
  /** The same on a phone, where the band is far narrower than the picture and has to be aimed at its subject. */
  atPhone: string;
};

function scene(name: string, at: string, atPhone: string): Scene {
  return { still: `/scenes/${name}.webp`, loop: { webm: `/scenes/${name}.webm`, mp4: `/scenes/${name}.mp4` }, at, atPhone };
}

/**
 * One scene per tab, all from the same night as the roof on the home page: a bridge to cross for Swap, a pond for
 * Pools, the old observatory for Analytics, lanterns going up for Points, a hillside of houses for Houses and a
 * gate standing ajar for Launch.
 */
const SCENES: Record<string, Scene> = {
  "/swap": scene("swap", "50% 0%", "74% 0%"),
  "/pools": scene("pools", "50% 0%", "84% 0%"),
  "/analytics": scene("analytics", "50% 0%", "88% 0%"),
  "/points": scene("points", "50% 0%", "78% 0%"),
  "/houses": scene("houses", "50% 0%", "66% 0%"),
  "/launch": scene("launch", "50% 0%", "82% 0%"),
};

/**
 * The scene behind a tab's heading: a still that paints with the page, and the same picture in slow motion over it
 * once the page has settled. It runs up under the top bar and fades into the page below the heading. Pages without
 * a scene of their own (the board has its roof; a coin, a pool, a trader and a house have their own headers) get
 * nothing.
 */
export function PageBackdrop({ path }: { path: string }) {
  const found = SCENES[path.length > 1 ? path.replace(/\/+$/, "") : path];
  if (!found) return null;
  const fit = "absolute inset-0 size-full object-cover";
  return (
    <div key={found.still} aria-hidden="true" className="page-backdrop" style={{ "--at": found.at, "--at-phone": found.atPhone } as CSSProperties}>
      <img src={found.still} alt="" decoding="async" className={fit} />
      <LoopVideo wide={found.loop} className={fit} />
    </div>
  );
}
