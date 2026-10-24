import { LEAGUES } from "@/lib/chimi/points-rules";

const [CHIMI, YONGMARU, GIWA, SEOKKARAE, JUCHUTDOL] = LEAGUES.map((l) => l.color) as [string, string, string, string, string];

/** The chimi ornament from Chimi's seal, in a 32-unit box (public/favicon.svg). */
const CHIMI_PATH =
  "M17.2 3.3 21.6 3.4 24.2 5.3 23.6 7.6 20.8 8.6 18.4 8.2 18.6 10 21 14.6 21.6 19.6 23.5 21 24.1 24.4 23.2 26.9 20.6 28.8 17.8 29.3 12.2 29 8.5 26.8 7.6 24.6 7.5 21.2 8.4 19 10.4 17.2 15.6 16.6 16.6 14.4 15.4 12.4 11 12.2 6.8 11 7.2 8 11.4 4.8Z";

const ROOF = "M18 112C74 118 122 100 162 64H438C478 100 526 118 582 112 560 128 520 136 470 136H130C80 136 40 128 18 112Z";

/**
 * A hanok roof, front on, with each league drawn as the part it's named for: the chimi ornaments at the ends of the
 * ridge (top 1%), the ridge itself, the tiles, the rafters under the eaves, and the foundation stones (everyone).
 */
export function LeaguesRoof({ active }: { active?: string }) {
  const dim = (name: string) => (active && active !== name ? 0.32 : 1);
  return (
    <svg viewBox="0 0 600 270" className="w-full" role="img" aria-label="The five leagues as parts of a hanok roof">
      <defs>
        <clipPath id="roof-clip">
          <path d={ROOF} />
        </clipPath>
      </defs>
      {/* ground */}
      <path d="M40 252H560" stroke="#3f3325" strokeWidth="2" strokeLinecap="round" />

      {/* 주춧돌: foundation stones under the pillars */}
      <g opacity={dim("Juchutdol")} fill={JUCHUTDOL}>
        {[180, 420].map((x) => (
          <path key={x} d={`M${x - 30} 252 ${x - 24} 232Q${x} 224 ${x + 24} 232L${x + 30} 252Z`} />
        ))}
      </g>
      {/* pillars and the beam */}
      <g fill="#2c2219" stroke="#3f3325" strokeWidth="1.5">
        <rect x="170" y="158" width="20" height="74" rx="2" />
        <rect x="410" y="158" width="20" height="74" rx="2" />
        <rect x="146" y="154" width="308" height="10" rx="2" />
      </g>

      {/* 서까래: rafter ends along the underside of the eaves */}
      <g opacity={dim("Seokkarae")} fill={SEOKKARAE}>
        {Array.from({ length: 21 }, (_, i) => {
          const x = 100 + i * 20;
          const t = Math.abs(x - 300) / 200;
          return <circle key={x} cx={x} cy={147 - 7 * t ** 3} r="3.6" />;
        })}
      </g>

      {/* 기와: the tiled roof, rows of tiles and the round tile ends along the eaves */}
      <g opacity={dim("Giwa")}>
        <path d={ROOF} fill={GIWA} opacity=".22" />
        <g clipPath="url(#roof-clip)" stroke={GIWA} strokeWidth="5" opacity=".75">
          {Array.from({ length: 30 }, (_, i) => {
            const x = 24 + i * 19.5;
            return <path key={x} d={`M${x} 140C${x + (x - 300) * 0.06} 110 ${x + (x - 300) * 0.12} 80 ${x + (x - 300) * 0.2} 56`} fill="none" />;
          })}
        </g>
        <path d={ROOF} fill="none" stroke={GIWA} strokeWidth="2" />
        {Array.from({ length: 24 }, (_, i) => {
          const x = 48 + i * 22;
          const t = Math.abs(x - 300) / 252;
          return <circle key={x} cx={x} cy={136 - 22 * t ** 3} r="5.5" fill="#17120e" stroke={GIWA} strokeWidth="2" />;
        })}
      </g>

      {/* 용마루: the ridge */}
      <g opacity={dim("Yongmaru")}>
        <rect x="156" y="50" width="288" height="16" rx="5" fill={YONGMARU} />
        <rect x="168" y="42" width="264" height="10" rx="4" fill={YONGMARU} opacity=".7" />
      </g>

      {/* 치미: the ornaments at either end of the ridge */}
      <g opacity={dim("Chimi")} fill={CHIMI}>
        <path d={CHIMI_PATH} transform="translate(186 -4) scale(-1.85 1.85)" />
        <path d={CHIMI_PATH} transform="translate(414 -4) scale(1.85)" />
      </g>
    </svg>
  );
}
