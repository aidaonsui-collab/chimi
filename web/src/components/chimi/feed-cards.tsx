import { Link } from "@tanstack/react-router";
import { useState, type CSSProperties, type ReactNode } from "react";
import { giwaSepolia } from "@/lib/chimi/chain";
import { knownTime } from "@/lib/chimi/feed";
import { ordinal, type FeedItem } from "@/lib/chimi/feed-rules";
import { ago, compactCount, compactUsd, ethText } from "@/lib/chimi/format";
import { fetchSwaps, type CoinStats } from "@/lib/chimi/live";
import { short, type Coin } from "@/lib/chimi/market";
import type { Profile } from "@/lib/chimi/points-rules";
import { shortWallet } from "@/lib/chimi/rewards";
import { FollowButton } from "@/components/chimi/follow";
import { IconComment, IconExternal, IconLock, IconPoints } from "@/components/chimi/icons";
import { useChimi } from "@/components/chimi/provider";
import { toast } from "@/components/chimi/toast";
import { TokenLogo } from "@/components/chimi/token-logo";
import { Blockie, Change, Sparkline } from "@/components/chimi/ui";

/*
 * The cards of the home feed: one per thing that happened. Each can be acted on where it sits: buy the coin with a
 * set amount of ETH, copy a buy, follow the trader, open the thread.
 */

const explorer = giwaSepolia.blockExplorers.default.url;

/** What every card needs to know about the coins and wallets it names. */
export type CardContext = {
  byToken: Map<string, Coin>;
  images: Record<string, string | undefined>;
  stats: Record<string, CoinStats>;
  profiles: Record<string, Profile>;
  ethUsd?: number;
  /** Unix seconds. */
  now: number;
  me?: string;
};

/** The amounts on the quick-buy buttons, in ETH. */
export const QUICK_AMOUNTS = ["0.01", "0.05", "0.1"];

const nameOf = (ctx: CardContext, wallet: string) => ctx.profiles[wallet]?.name?.replace(/\.up\.id$/, "") ?? shortWallet(wallet);
const money = (ctx: CardContext, eth: number | undefined) => (eth === undefined ? "—" : ctx.ethUsd ? compactUsd(eth * ctx.ethUsd) : `${ethText(eth)} ETH`);
const when = (ctx: CardContext, time: number) => (knownTime(time) ? ago(Math.max(0, ctx.now - time)) : "earlier");

/** Buy this coin with a set amount of ETH: one press, one confirmation in the wallet. */
export function QuickBuy({ coin, amounts = QUICK_AMOUNTS, label = "Buy" }: { coin: Coin; amounts?: string[]; label?: string | null }) {
  const { quickBuy } = useChimi();
  const [busy, setBusy] = useState<string | null>(null);

  async function buy(eth: string) {
    setBusy(eth);
    try {
      const hash = await quickBuy(coin, eth);
      toast({ kind: "good", title: `Bought ${coin.symbol}`, body: `${eth} ETH in.`, href: `${explorer}/tx/${hash}` });
      // Read the pool again now, so the buy shows in the feed without waiting for the next round.
      void fetchSwaps(coin, true).catch(() => undefined);
    } catch (err) {
      const text = short(err);
      if (!/reject|denied|cancel/i.test(text)) toast({ kind: "bad", title: `Couldn’t buy ${coin.symbol}`, body: text });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div role="group" aria-label={`Buy ${coin.symbol} with a set amount`} className="flex flex-wrap items-center gap-1.5">
      {label ? <span className="mr-0.5 text-[13px] text-muted">{label}</span> : null}
      {amounts.map((eth) => (
        <button key={eth} type="button" disabled={busy !== null || coin.preview} onClick={() => void buy(eth)} className="btn btn-sm btn-secondary num disabled:opacity-50">
          {busy === eth ? "Confirming…" : `${eth} ETH`}
        </button>
      ))}
    </div>
  );
}

function Who({ ctx, wallet }: { ctx: CardContext; wallet: string }) {
  return (
    <Link to="/u/$address" params={{ address: wallet }} title={wallet} className="num font-semibold hover:text-gold">
      {wallet === ctx.me ? "You" : nameOf(ctx, wallet)}
    </Link>
  );
}

function CoinName({ coin }: { coin: Coin }) {
  return (
    <Link to="/coin/$address" params={{ address: coin.token }} className="font-semibold hover:text-gold">
      {coin.symbol}
    </Link>
  );
}

function Tag({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "gold" }) {
  return <span className={`chip h-5 px-2 text-[11px] font-semibold ${tone === "gold" ? "text-gold" : ""}`}>{children}</span>;
}

/** The top of a card: who, what they did, and when. */
function Head({ ctx, wallet, time, children, sub, aside }: { ctx: CardContext; wallet: string; time: number; children: ReactNode; sub?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <Link to="/u/$address" params={{ address: wallet }} aria-label={nameOf(ctx, wallet)} className="mt-0.5 shrink-0">
        <Blockie address={wallet} size={38} />
      </Link>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px]">{children}</p>
        {sub ? <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{sub}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        {aside}
        <span className="num text-[13px] text-muted">{when(ctx, time)}</span>
      </div>
    </div>
  );
}

/** The coin a card is about: its picture, market cap, the day's line and move. Opens the coin. */
function CoinStrip({ ctx, coin, big }: { ctx: CardContext; coin: Coin; big?: boolean }) {
  const stats = ctx.stats[coin.token.toLowerCase()];
  const trades = stats?.trades;
  return (
    <Link to="/coin/$address" params={{ address: coin.token }} className="flex items-center gap-3 rounded-xl bg-raise px-3.5 py-3 transition-colors hover:bg-raise2">
      <TokenLogo symbol={coin.symbol} image={ctx.images[coin.token.toLowerCase()]} size={big ? 56 : 40} shape={big ? "rounded" : "circle"} />
      <span className="min-w-0 flex-1">
        <span className={`block truncate font-semibold ${big ? "text-[16px]" : ""}`}>
          {coin.name}
          {big ? <span className="ml-1.5 font-medium text-muted">${coin.symbol}</span> : null}
        </span>
        <span className="num block truncate text-[13px] text-muted">
          {money(ctx, stats?.capEth)} market cap
          {trades ? ` · ${trades} ${trades === 1 ? "trade" : "trades"} today` : ""}
        </span>
        {big ? (
          <span className="mt-1 flex items-center gap-1.5 text-[13px] text-muted">
            <IconLock size={13} />
            Launch liquidity locked
          </span>
        ) : null}
      </span>
      {stats && stats.spark.length > 2 ? <Sparkline values={stats.spark} width={88} height={30} className="hidden shrink-0 sm:block" /> : null}
      <Change value={stats?.change} className="shrink-0 text-sm" />
    </Link>
  );
}

function TxLink({ tx }: { tx: string }) {
  return (
    <a href={`${explorer}/tx/${tx}`} target="_blank" rel="noreferrer" aria-label="Transaction on the explorer" title="Transaction on the explorer" className="btn btn-sm btn-icon btn-ghost text-muted">
      <IconExternal size={15} />
    </a>
  );
}

function TradeCard({ item, ctx, coin }: { item: Extract<FeedItem, { kind: "trade" }>; ctx: CardContext; coin: Coin }) {
  const tokens = `${compactCount(item.tokens)} ${coin.symbol}`;
  const eth = `${ethText(item.eth)} ETH`;
  const again = item.buy && item.nth > 1 ? ` ${item.mine ? "Your" : "Their"} ${ordinal(item.nth)} buy of it today.` : "";
  const stranger = !item.mine && !item.followed;
  return (
    <article className="card flex flex-col gap-3.5 p-4 sm:p-5">
      <Head
        ctx={ctx}
        wallet={item.wallet}
        time={item.time}
        sub={item.buy ? `Paid ${eth} for ${tokens}.${again}` : `Sold ${tokens} for ${eth}.`}
        aside={stranger ? <FollowButton wallet={item.wallet} name={ctx.profiles[item.wallet]?.name} size="sm" /> : null}
      >
        <Who ctx={ctx} wallet={item.wallet} />
        <span className={`font-medium ${item.buy ? "text-ok" : "text-down"}`}>{item.buy ? "bought" : "sold"}</span>
        <CoinName coin={coin} />
        {item.followed ? <Tag tone="gold">You follow</Tag> : null}
        {item.largest ? <Tag>Largest buy today</Tag> : null}
      </Head>
      <CoinStrip ctx={ctx} coin={coin} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {item.buy && !item.mine ? (
          <>
            <QuickBuy coin={coin} amounts={QUICK_AMOUNTS.filter((a) => Number(a) !== item.eth).slice(0, 2)} />
            {/* The coin's page opens on the buy side with their size filled in; nothing is sent until Buy is pressed. */}
            <Link to="/coin/$address" params={{ address: coin.token }} search={{ copy: item.wallet, eth: item.eth }} className="btn btn-sm btn-primary num">
              Copy their {ethText(item.eth)} ETH
            </Link>
          </>
        ) : null}
        <span className="ml-auto">
          <TxLink tx={item.tx} />
        </span>
      </div>
    </article>
  );
}

function LaunchCard({ item, ctx, coin }: { item: Extract<FeedItem, { kind: "launch" }>; ctx: CardContext; coin: Coin }) {
  const fresh = knownTime(item.time) && ctx.now - item.time < 24 * 60 * 60;
  const mine = item.creator === ctx.me;
  return (
    <article className="card flex flex-col gap-3.5 p-4 sm:p-5">
      <Head
        ctx={ctx}
        wallet={item.creator}
        time={item.time}
        sub={item.earlier > 0 ? `${mine ? "Your" : "Their"} ${ordinal(item.earlier + 1)} launch on Chimi.` : undefined}
        aside={!mine && !item.followed ? <FollowButton wallet={item.creator} name={ctx.profiles[item.creator]?.name} size="sm" /> : null}
      >
        <Who ctx={ctx} wallet={item.creator} />
        <span className="text-muted">launched a coin</span>
        {fresh ? <Tag>New</Tag> : null}
        {item.followed ? <Tag tone="gold">You follow</Tag> : null}
      </Head>
      <CoinStrip ctx={ctx} coin={coin} big />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <QuickBuy coin={coin} />
        <Link to="/coin/$address" params={{ address: coin.token }} className="btn btn-sm btn-ghost">
          Open coin
        </Link>
      </div>
    </article>
  );
}

function CommentCard({ item, ctx, coin }: { item: Extract<FeedItem, { kind: "comment" }>; ctx: CardContext; coin: Coin }) {
  return (
    <article className="card flex flex-col gap-3 p-4 sm:p-5">
      <Head ctx={ctx} wallet={item.wallet} time={item.time}>
        <Who ctx={ctx} wallet={item.wallet} />
        <span className="text-muted">commented on</span>
        <CoinName coin={coin} />
        {item.followed ? <Tag tone="gold">You follow</Tag> : null}
        {item.wallet === coin.creator.toLowerCase() ? <Tag>Creator</Tag> : null}
      </Head>
      <p className="rounded-xl bg-raise px-3.5 py-3 text-[15px] leading-relaxed [overflow-wrap:anywhere]">{item.text}</p>
      <div className="flex items-center justify-between gap-3">
        <Link to="/coin/$address" params={{ address: coin.token }} search={{ tab: "comments" }} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-gold hover:underline">
          <IconComment size={15} />
          Open the thread
        </Link>
        <span className="num text-[13px] text-muted">{money(ctx, ctx.stats[coin.token.toLowerCase()]?.capEth)} market cap</span>
      </div>
    </article>
  );
}

function MilestoneCard({ item, ctx, coin }: { item: Extract<FeedItem, { kind: "milestone" }>; ctx: CardContext; coin: Coin }) {
  const stats = ctx.stats[coin.token.toLowerCase()];
  return (
    <article className="card flex flex-col gap-3.5 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <Link to="/coin/$address" params={{ address: coin.token }} aria-label={coin.name} className="mt-0.5 shrink-0">
          <TokenLogo symbol={coin.symbol} image={ctx.images[coin.token.toLowerCase()]} size={38} />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold">
            <CoinName coin={coin} /> crossed {compactUsd(item.cap)} market cap
          </p>
          <p className="num mt-0.5 text-[13px] text-muted">
            Now {money(ctx, stats?.capEth)}
            {stats?.trades ? ` · ${stats.trades} ${stats.trades === 1 ? "trade" : "trades"} today` : ""}
          </p>
        </div>
        <span className="num shrink-0 text-[13px] text-muted">{when(ctx, item.time)}</span>
      </div>
      {stats && stats.spark.length > 2 ? (
        <Link to="/coin/$address" params={{ address: coin.token }} aria-label={`${coin.name} chart`} className="flex items-center justify-between gap-4 rounded-xl bg-raise px-3.5 py-3 transition-colors hover:bg-raise2">
          <Sparkline values={stats.spark} width={420} height={44} className="min-w-0 max-w-full flex-1" />
          <Change value={stats.change} className="shrink-0 text-sm" />
        </Link>
      ) : null}
      <QuickBuy coin={coin} />
    </article>
  );
}

function CopiedCard({ item, ctx, coin }: { item: Extract<FeedItem, { kind: "copied" }>; ctx: CardContext; coin: Coin }) {
  const n = item.by.length;
  return (
    <article className="card flex flex-wrap items-center gap-3 border-gold/25 p-4 sm:p-5">
      <span className="grid size-[38px] shrink-0 place-items-center rounded-full bg-gold/10 text-gold">
        <IconPoints size={18} />
      </span>
      <div className="min-w-0 flex-[1_1_260px]">
        <p className="text-[15px] font-semibold">
          {n === 1 ? `${nameOf(ctx, item.by[0]!)} bought` : `${n} wallets that follow you bought`} <CoinName coin={coin} /> after you
        </p>
        <p className="mt-0.5 text-[13px] text-muted">Within a day of your {ethText(item.eth)} ETH buy. Leading a buy earns you points.</p>
      </div>
      <Link to="/points" className="text-[13px] font-semibold text-gold hover:underline">
        Your points
      </Link>
      <span className="num text-[13px] text-muted">{when(ctx, item.time)}</span>
    </article>
  );
}

/** One feed item as its card. An item about a coin the board doesn't list (it was just launched, say) is skipped. */
export function FeedCard({ item, ctx }: { item: FeedItem; ctx: CardContext }) {
  const coin = ctx.byToken.get(item.token);
  if (!coin) return null;
  if (item.kind === "trade") return <TradeCard item={item} ctx={ctx} coin={coin} />;
  if (item.kind === "launch") return <LaunchCard item={item} ctx={ctx} coin={coin} />;
  if (item.kind === "comment") return <CommentCard item={item} ctx={ctx} coin={coin} />;
  if (item.kind === "milestone") return <MilestoneCard item={item} ctx={ctx} coin={coin} />;
  return <CopiedCard item={item} ctx={ctx} coin={coin} />;
}

/** The wallets a page of the feed names, so their up.id names can be looked up in one go. */
export function walletsIn(items: FeedItem[]): string[] {
  const out = new Set<string>();
  for (const item of items) {
    if (item.kind === "trade" || item.kind === "comment") out.add(item.wallet);
    else if (item.kind === "launch") out.add(item.creator);
    else if (item.kind === "copied") for (const w of item.by) out.add(w);
  }
  return [...out];
}

/**
 * The strip under the top bar: the latest trades and launches moving past. It stops while the pointer is on it, and
 * stands still for visitors who ask for less motion (.ticker in styles.css).
 */
export function Ticker({ items, ctx }: { items: FeedItem[]; ctx: CardContext }) {
  // Only the last day: a strip marked Live shouldn't lead with last week's news.
  const recent = items
    .filter((i): i is Extract<FeedItem, { kind: "trade" | "launch" }> => (i.kind === "trade" || i.kind === "launch") && knownTime(i.time) && ctx.now - i.time < 24 * 60 * 60 && ctx.byToken.has(i.token))
    .slice(0, 14);
  if (recent.length === 0) return null;
  const row = (hidden: boolean) => (
    <div className="ticker-row" aria-hidden={hidden || undefined}>
      {recent.map((item) => {
        const coin = ctx.byToken.get(item.token)!;
        const wallet = item.kind === "trade" ? item.wallet : item.creator;
        return (
          <span key={item.key} className="flex shrink-0 items-center gap-1.5">
            <Link to="/u/$address" params={{ address: wallet }} tabIndex={hidden ? -1 : undefined} className="num font-semibold text-fg hover:text-gold">
              {nameOf(ctx, wallet)}
            </Link>
            {item.kind === "trade" ? (
              <>
                {item.buy ? "bought" : "sold"}
                <span className={`num ${item.buy ? "text-ok" : "text-down"}`}>{ethText(item.eth)} ETH</span>
                of
              </>
            ) : (
              "launched"
            )}
            <Link to="/coin/$address" params={{ address: coin.token }} tabIndex={hidden ? -1 : undefined} className="font-medium text-fg hover:text-gold">
              {coin.symbol}
            </Link>
            <span className="num text-faint">· {when(ctx, item.time)}</span>
          </span>
        );
      })}
    </div>
  );
  // A handful of items fit without moving. More than that scroll, as two copies end to end so the loop has no seam.
  const moving = recent.length > 4;
  return (
    <div className={`ticker ${moving ? "ticker-moving" : ""}`} style={{ "--ticker-s": `${recent.length * 6}s` } as CSSProperties}>
      <span className="flex shrink-0 items-center gap-2 pr-5 text-[12px] font-semibold tracking-[0.06em] text-ok uppercase">
        <span className="live-dot text-ok" />
        Live
      </span>
      <div className="ticker-window">
        <div className="ticker-track">
          {row(false)}
          {moving ? row(true) : null}
        </div>
      </div>
    </div>
  );
}
