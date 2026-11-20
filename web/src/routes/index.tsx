import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { compactUsd, ethText } from "@/lib/chimi/format";
import { useHomeFeed } from "@/lib/chimi/feed";
import { usePoolEth } from "@/lib/chimi/live";
import { useBurned } from "@/lib/chimi/burned";
import { useTokenProfiles } from "@/lib/chimi/token-image";
import { LiveTrades, PairsBoard, type CoinLinks } from "@/components/chimi/home-board";
import { HomeBanner, type HeroStat } from "@/components/chimi/home-hero";
import { useChimi } from "@/components/chimi/provider";
import { useNow } from "@/components/chimi/rewards-bits";
import { Empty } from "@/components/chimi/ui";

/**
 * The home page is the board: the roof banner, then every pair on Chimi in one table. What the traders are doing
 * and saying, the feed, lives on the Traders page.
 */
export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const { coins, deployment, preview, note, refresh, loading } = useChimi();
  const nowMs = useNow(30_000);
  // The feed's hook paints the pairs this browser saw last time at once, and keeps them live.
  const feed = useHomeFeed(nowMs);
  const listed = preview ? coins : feed.live;
  const profiles = useTokenProfiles(useMemo(() => listed.map((coin) => coin.token), [listed]));
  const { images, links } = useMemo(() => {
    const images: Record<string, string> = {};
    const links: Record<string, CoinLinks> = {};
    for (const [token, p] of Object.entries(profiles)) {
      if (p.image) images[token] = p.image;
      if (p.twitter || p.telegram || p.website) links[token] = { twitter: p.twitter, telegram: p.telegram, website: p.website };
    }
    return { images, links };
  }, [profiles]);
  const reserves = usePoolEth(feed.live, deployment?.weth);
  const burned = useBurned(feed.live);
  // The platform's own coin: the one every coin's fee buys back and burns.
  const official = (deployment?.burner?.chimi ?? deployment?.flywheel?.chimi)?.toLowerCase();

  const usd = (eth: number | undefined) => (eth === undefined ? "—" : feed.ethUsd ? compactUsd(eth * feed.ethUsd) : `${ethText(eth)} ETH`);
  const totals = useMemo(() => {
    const all = Object.values(feed.stats);
    return {
      capEth: all.reduce((sum, s) => sum + s.capEth, 0),
      volEth: all.every((s) => s.volEth !== undefined) ? all.reduce((sum, s) => sum + (s.volEth ?? 0), 0) : undefined,
    };
  }, [feed.stats]);
  const heroStats: HeroStat[] = [
    ["Coins", loading ? null : feed.live.length.toLocaleString("en-US")],
    ["24h volume", loading ? null : usd(totals.volEth)],
    ["Market cap", loading ? null : usd(feed.hasCoins ? totals.capEth : undefined)],
  ];

  const failed = !loading && !feed.hasCoins && !preview && !!note;

  return (
    <main className="pb-16">
      <HomeBanner stats={heroStats} live={!preview} />
      <div className="page mt-8 sm:mt-10">
        {failed ? (
          <div className="card">
            <Empty
              mark="끊김"
              title="Couldn’t reach GIWA"
              action={
                <button type="button" onClick={() => void refresh().catch(() => undefined)} className="btn btn-secondary">
                  Try again
                </button>
              }
            >
              The board reads straight from the chain and the node didn’t answer. {note}
            </Empty>
          </div>
        ) : (
          <PairsBoard
            coins={listed}
            stats={feed.stats}
            images={images}
            reserves={reserves}
            burned={burned}
            links={links}
            official={official}
            ethUsd={feed.ethUsd}
            launched={feed.launched}
            known={feed.points?.file.profiles}
            now={feed.now}
            waiting={feed.waiting}
            tradesReady={feed.tradesReady}
            side={preview ? undefined : <LiveTrades coins={feed.live} byPool={feed.byPool} images={images} ethUsd={feed.ethUsd} now={feed.now} ready={!feed.waiting && feed.tradesReady} />}
          />
        )}
      </div>
    </main>
  );
}
