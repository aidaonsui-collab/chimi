import type { CSSProperties } from "react";
import { LoopVideo, ROOF, type Loop } from "@/components/chimi/loop-video";

type Scene = {
  still: string;
  loop: Loop;
  /** A smaller copy of the loop for phones, when there is one. */
  narrow?: Loop;
  /** Which part of the picture stays in view when the band is a different shape (CSS object-position). */
  at: string;
  /** The same on a phone, where the band is far narrower than the picture and has to be aimed at its subject. */
  atPhone: string;
};

function scene(name: string, at: string, atPhone: string): Scene {
  return { still: `/scenes/${name}.webp`, loop: { webm: `/scenes/${name}.webm`, mp4: `/scenes/${name}.mp4` }, at, atPhone };
}

/** The roof itself: the feed's scene once the first-visit hero is gone, and the board's and the traders' too. */
const ROOF_SCENE: Scene = { still: "/banner.webp", loop: ROOF.wide, narrow: ROOF.narrow, at: "50% 40%", atPhone: "14% 42%" };

/**
 * One scene per tab, all from the same night as the roof: a bridge to cross for Swap, a pond for Pools, the old
 * observatory for Analytics, lanterns going up for Points, a hillside of houses for Houses and a gate standing ajar
 * for Launch. The board and the traders share the roof with the feed.
 */
const SCENES: Record<string, Scene> = {
  "/traders": ROOF_SCENE,
  "/swap": scene("swap", "50% 0%", "74% 0%"),
  "/pools": scene("pools", "50% 0%", "84% 0%"),
  "/analytics": scene("analytics", "50% 0%", "88% 0%"),
  "/points": scene("points", "50% 0%", "78% 0%"),
  "/houses": scene("houses", "50% 0%", "66% 0%"),
  "/launch": scene("launch", "50% 0%", "82% 0%"),
};

function Backdrop({ scene }: { scene: Scene }) {
  const fit = "absolute inset-0 size-full object-cover";
  return (
    <div aria-hidden="true" className="page-backdrop" style={{ "--at": scene.at, "--at-phone": scene.atPhone } as CSSProperties}>
      <img src={scene.still} alt="" decoding="async" className={fit} />
      <LoopVideo wide={scene.loop} narrow={scene.narrow} className={fit} />
    </div>
  );
}

/**
 * The scene behind a tab's heading: a still that paints with the page, and the same picture in slow motion over it
 * once the page has settled. It runs up under the top bar and fades into the page below the heading. Pages without
 * a scene (a coin, a pool, a trader and a house have their own headers) get nothing. The feed places its own, because
 * a first visit shows the hero there instead (feed-hero.tsx).
 */
export function PageBackdrop({ path }: { path: string }) {
  const found = SCENES[path.length > 1 ? path.replace(/\/+$/, "") : path];
  if (!found) return null;
  return <Backdrop key={found.still} scene={found} />;
}

/** The roof behind the feed's heading. */
export function RoofBackdrop() {
  return <Backdrop scene={ROOF_SCENE} />;
}
