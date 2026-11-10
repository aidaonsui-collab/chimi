import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { giwaSepolia } from "@/lib/chimi/chain";
import { followingOf } from "@/lib/chimi/follow-rules";
import { useFeed, useFollows } from "@/lib/chimi/follows";
import { ago, compactCount, ethText } from "@/lib/chimi/format";
import { short, type Coin, type PoolSwap } from "@/lib/chimi/market";
import type { Profile } from "@/lib/chimi/points-rules";
import { fmtPoints, shortWallet, usePoints, useProfiles } from "@/lib/chimi/rewards";
import { FollowButton } from "@/components/chimi/follow";
import { IconSwap } from "@/components/chimi/icons";
import { useChimi } from "@/components/chimi/provider";
import { DojangMark, useNow } from "@/components/chimi/rewards-bits";
import { toast } from "@/components/chimi/toast";
import { TokenLogo } from "@/components/chimi/token-logo";
import { Blockie, Empty, Seg, TraderLink } from "@/components/chimi/ui";

type Listed = { coin: Coin; image?: string };
type Tab = "all" | "following";

/** One trade, whichever place it was read from. */
type Item = { key: string; time: number; wallet: string; coin: Coin; image?: string; buy: boolean; tokens: number; eth: number; tx: string };

const TAB_KEY = "chimi.tape.tab";
const PAGE = 8;

/**
 * The latest trades: across every pool, or only by the wallets you follow. Trades from about the last day are read
 * live from the chain; the Following tab reaches further back through the server's trade record.
 */
export function Tape({ listed, byPool, ready, loading }: { listed: Listed[]; byPool: Record<string, PoolSwap[]>; ready: boolean; loading: boolean }) {
  const { account, connect } = useChimi();
  const { data: follows } = useFollows();
  const { data: points } = usePoints();
  const now = useNow(15_000);
  const [tab, setTab] = useState<Tab>("all");
  const [shown, setShown] = useState(PAGE);
  const me = account?.toLowerCase();

  useEffect(() => {
    try {
      if (localStorage.getItem(TAB_KEY) === "following") setTab("following");
    } catch {
      /* private mode */
    }
  }, []);
  const pick = (next: Tab) => {
    setTab(next);
    setShown(PAGE);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      /* private mode */
    }
  };

  const following = useMemo(() => followingOf(follows?.state, me), [follows, me]);
  // The record is only asked for while its tab is open.
  const feed = useFeed(tab === "following" ? me : undefined, follows?.state);

  const live = useMemo(() => {
    const all: Item[] = [];
    for (const { coin, image } of listed) {
      for (const swap of byPool[coin.pool.toLowerCase()] ?? []) {
        all.push({
          key: `${swap.tx}:${swap.index ?? 0}`,
          time: swap.time,
          wallet: swap.recipient.toLowerCase(),
          coin,
          image,
          buy: swap.buy,
          tokens: Number(swap.tokenAmount) / 1e18,
          eth: Number(swap.ethAmount) / 1e18,
          tx: swap.tx,
        });
      }
    }
    return all.sort((a, b) => b.time - a.time);
  }, [listed, byPool]);

  const followed = useMemo(() => {
    const mine = new Set(following);
    const byToken = new Map(listed.map((l) => [l.coin.token.toLowerCase(), l]));
    const out = new Map<string, Item>();
    for (const item of live) if (mine.has(item.wallet)) out.set(item.key, item);
    for (const t of feed.trades ?? []) {
      const key = `${t.tx}:${t.i}`;
      const on = byToken.get(t.token);
      if (!on || out.has(key) || !mine.has(t.wallet)) continue;
      out.set(key, { key, time: t.t, wallet: t.wallet, coin: on.coin, image: on.image, buy: t.buy, tokens: t.tokens, eth: t.eth, tx: t.tx });
    }
    return [...out.values()].sort((a, b) => b.time - a.time);
  }, [live, feed.trades, following, listed]);

  // People worth following when the list is empty: the season's leaders, or failing that whoever traded most today.
  const suggestions = useMemo(() => {
    const known = new Set([me, ...following]);
    const season = (points?.season ?? []).filter((s) => !known.has(s.wallet)).map((s) => ({ wallet: s.wallet, note: `${fmtPoints(s.points)} points this season` }));
    if (season.length > 0) return season.slice(0, 5);
    const volume = new Map<string, number>();
    for (const item of live) volume.set(item.wallet, (volume.get(item.wallet) ?? 0) + item.eth);
    return [...volume.entries()]
      .filter(([wallet]) => !known.has(wallet))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([wallet, eth]) => ({ wallet, note: `${ethText(eth)} ETH traded today` }));
  }, [points, live, me, following]);

  const list = tab === "all" ? live : followed;
  const page = list.slice(0, tab === "all" ? PAGE : shown);
  const profiles = useProfiles(
    useMemo(() => (tab === "following" ? [...new Set([...page.map((i) => i.wallet), ...suggestions.map((s) => s.wallet)])] : []), [tab, page, suggestions]),
    points?.file.profiles,
  );
  const anyLive = listed.some((l) => !l.coin.preview);
  const waiting = loading || (anyLive && !ready && live.length === 0);
  const nowSec = now === null ? undefined : Math.floor(now / 1000);

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 className="flex items-center gap-2.5 text-[17px] font-semibold tracking-[-0.01em]">
          <span className="live-dot text-ok" />
          Live trades
        </h2>
        <Seg
          label="Whose trades"
          value={tab}
          onChange={pick}
          options={[
            ["all", "Everyone"],
            ["following", `Following${me && following.length ? ` · ${following.length}` : ""}`],
          ]}
        />
      </div>

      {tab === "following" && !me ? (
        <Empty
          mark="팔로우"
          title="See what the traders you follow are doing"
          action={
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
              Connect wallet
            </button>
          }
        >
          Follow a wallet from its page and every trade it makes on Chimi shows up here.
        </Empty>
      ) : tab === "following" && following.length === 0 ? (
        suggestions.length === 0 ? (
          <Empty mark="팔로우" title="You aren’t following anyone yet">
            Open any trader’s page and press Follow. Their trades will show up here.
          </Empty>
        ) : (
          <div className="px-5 py-5">
            <p className="text-[15px] font-semibold">You aren’t following anyone yet</p>
            <p className="mt-1 text-sm text-muted">Start with a few of the busiest traders. Following is a signature, not a transaction, and needs a Dojang.</p>
            <Suggestions items={suggestions} profiles={profiles} />
          </div>
        )
      ) : waiting || (tab === "following" && feed.loading && page.length === 0) ? (
        <div className="divide-y divide-line/70">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 px-5 py-3.5">
              <span className="skeleton size-8 rounded-full" />
              <span className="skeleton h-4 flex-1" />
              <span className="skeleton h-4 w-16" />
            </div>
          ))}
        </div>
      ) : page.length === 0 ? (
        tab === "all" ? (
          <Empty
            mark="첫 거래"
            title="No trades in the last day"
            action={
              <Link to="/swap" className="btn btn-secondary">
                <IconSwap size={16} />
                Make the first one
              </Link>
            }
          >
            When someone buys or sells a Chimi coin, it shows up here within a minute.
          </Empty>
        ) : (
          <Empty mark="조용함" title="Nothing from the wallets you follow yet">
            When any of the {following.length} you follow buys or sells a Chimi coin, it shows up here.
          </Empty>
        )
      ) : (
        <>
          <ul>
            {page.map((item) => (
              <TradeRow key={item.key} item={item} lead={tab === "all" ? "coin" : "trader"} name={profiles[item.wallet]?.name} nowSec={nowSec} />
            ))}
          </ul>
          {tab === "following" && list.length > shown ? (
            <button type="button" onClick={() => setShown((n) => n + 16)} className="w-full border-t border-line py-3 text-sm font-medium text-muted hover:text-fg">
              Show more ({list.length - shown} left)
            </button>
          ) : null}
        </>
      )}

      {/* With only a wallet or two followed the feed is thin, so keep offering more. */}
      {tab === "following" && me && following.length > 0 && following.length < 3 && suggestions.length > 0 ? (
        <div className="border-t border-line px-5 py-4">
          <p className="th uppercase">More to follow</p>
          <Suggestions items={suggestions.slice(0, 3)} profiles={profiles} />
        </div>
      ) : null}
    </div>
  );
}

function Suggestions({ items, profiles }: { items: { wallet: string; note: string }[]; profiles: Record<string, Profile> }) {
  return (
    <ul className="mt-3 grid gap-1">
      {items.map((s) => (
        <li key={s.wallet} className="-mx-2 flex items-center justify-between gap-3 rounded-xl px-2 py-2 hover:bg-raise">
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-[15px] font-medium">
              <TraderLink address={s.wallet} name={profiles[s.wallet]?.name} size={28} className="gap-3" />
              <DojangMark verified={profiles[s.wallet]?.verified} />
            </span>
            <span className="num mt-0.5 block pl-10 text-xs text-muted">{s.note}</span>
          </span>
          <FollowButton wallet={s.wallet} name={profiles[s.wallet]?.name} size="sm" />
        </li>
      ))}
    </ul>
  );
}

/** Three things to open from one row: the coin, the trader, and the transaction itself. */
function TradeRow({ item, lead, name, nowSec }: { item: Item; lead: "coin" | "trader"; name?: string | null; nowSec?: number }) {
  const explorer = giwaSepolia.blockExplorers.default.url;
  const amount = `${compactCount(item.tokens)} ${item.coin.symbol}`;
  const when = nowSec === undefined ? "" : `${ago(nowSec - item.time)} ago`;
  const tx = (
    <a href={`${explorer}/tx/${item.tx}`} target="_blank" rel="noreferrer" title="Transaction on the explorer" className="group shrink-0 text-right">
      <span className="num block font-medium group-hover:text-gold">{ethText(item.eth)} ETH</span>
      <span className="num block text-xs text-muted">{when}</span>
    </a>
  );
  if (lead === "trader") {
    return (
      <li className="row-hover flex items-center gap-3 border-b border-line/70 px-5 py-3 text-sm last:border-0">
        <Link to="/u/$address" params={{ address: item.wallet }} aria-label={name ?? item.wallet} className="shrink-0">
          <Blockie address={item.wallet} size={32} />
        </Link>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <Link to="/u/$address" params={{ address: item.wallet }} title={item.wallet} className="num truncate font-semibold hover:text-gold">
              {name ? name.replace(/\.up\.id$/, "") : shortWallet(item.wallet)}
            </Link>
            <span className={`shrink-0 font-medium ${item.buy ? "text-ok" : "text-down"}`}>{item.buy ? "bought" : "sold"}</span>
          </span>
          <Link to="/coin/$address" params={{ address: item.coin.token }} className="group mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted">
            <TokenLogo symbol={item.coin.symbol} image={item.image} size={15} ring={false} />
            <span className="num truncate group-hover:text-fg">{amount}</span>
          </Link>
        </span>
        {tx}
      </li>
    );
  }
  return (
    <li className="row-hover flex items-center gap-3 border-b border-line/70 px-5 py-3 text-sm last:border-0">
      <Link to="/coin/$address" params={{ address: item.coin.token }} aria-label={item.coin.name} className="shrink-0">
        <TokenLogo symbol={item.coin.symbol} image={item.image} size={32} />
      </Link>
      <span className="min-w-0 flex-1">
        <Link to="/coin/$address" params={{ address: item.coin.token }} className="group flex items-center gap-2">
          <span className={`font-semibold ${item.buy ? "text-ok" : "text-down"}`}>{item.buy ? "Buy" : "Sell"}</span>
          <span className="num truncate font-medium group-hover:text-gold">{amount}</span>
        </Link>
        <TraderLink address={item.wallet} size={14} className="mt-0.5 gap-1.5 text-xs text-muted" />
      </span>
      {tx}
    </li>
  );
}
