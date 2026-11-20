import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { giwaSepolia } from "@/lib/chimi/chain";
import { NEED_DOJANG_TO_LIKE, stance } from "@/lib/chimi/comment-rules";
import { useLike } from "@/lib/chimi/comments";
import { knownTime, type TickItem } from "@/lib/chimi/feed";
import { ordinal, type BurstItem, type FeedItem, type TradeItem } from "@/lib/chimi/feed-rules";
import { ago, compactCount, compactUsd, ethText, tokenUsd } from "@/lib/chimi/format";
import { heldKey } from "@/lib/chimi/holdings";
import { DOJANG_URL } from "@/lib/chimi/identity";
import { fetchSwaps, type CoinStats } from "@/lib/chimi/live";
import { short, type Coin } from "@/lib/chimi/market";
import type { Profile } from "@/lib/chimi/points-rules";
import { QUICK_CHOICES, setQuickAmount, useQuickAmount } from "@/lib/chimi/quick";
import { shortWallet } from "@/lib/chimi/rewards";
import { LikeButton } from "@/components/chimi/comments";
import { FollowButton } from "@/components/chimi/follow";
import { IconBolt, IconCheck, IconChevronDown, IconComment, IconExternal, IconPoints } from "@/components/chimi/icons";
import { useChimi } from "@/components/chimi/provider";
import { DojangMark } from "@/components/chimi/rewards-bits";
import { toast } from "@/components/chimi/toast";
import { TokenLogo } from "@/components/chimi/token-logo";
import { LivePill } from "@/components/chimi/live-pill";
import { useLiveTokens, useStream } from "@/lib/chimi/streams";
import { Blockie, Change, Sparkline } from "@/components/chimi/ui";
import { XPostCard } from "@/components/chimi/x-post";

/*
 * The rows of the home feed: one per thing that happened. The feed is a list to scan, not a wall of cards, so a row
 * is a line of who did what and a quieter line of detail, with the coin's move, the time and one buy button at the
 * end. A screen holds ten or so. What a crowd did (a burst) and what you or the wallets you follow did get the full
 * two lines; a lone trade by a stranger gets one.
 */

const explorer = giwaSepolia.blockExplorers.default.url;

/** What every row needs to know about the coins and wallets it names. */
export type RowContext = {
  byToken: Map<string, Coin>;
  images: Record<string, string | undefined>;
  stats: Record<string, CoinStats>;
  profiles: Record<string, Profile>;
  ethUsd?: number;
  /** Unix seconds. */
  now: number;
  me?: string;
  /** Share of a coin's supply a wallet holds, by `heldKey(token, wallet)`. Absent until it has been read. */
  held: Record<string, number>;
  /** `heldKey`s of wallets seen buying that coin, so an empty balance can be called "sold". */
  bought: Set<string>;
  /** The season's top wallets and their rank. */
  ranks: Map<string, number>;
};

const nameOf = (ctx: RowContext, wallet: string) => ctx.profiles[wallet]?.name?.replace(/\.up\.id$/, "") ?? shortWallet(wallet);
const money = (ctx: RowContext, eth: number | undefined) => (eth === undefined ? "—" : ctx.ethUsd ? compactUsd(eth * ctx.ethUsd) : `${ethText(eth)} ETH`);
const when = (ctx: RowContext, time: number) => (knownTime(time) ? ago(Math.max(0, ctx.now - time)) : "earlier");

/**
 * Buy this coin with the quick-buy amount: one press, one confirmation in the wallet. In a row it is a small pill
 * that says the amount; it turns to a spinner while the wallet is asked and to a tick when the buy has landed.
 */
export function QuickBuy({ coin, compact = false }: { coin: Coin; compact?: boolean }) {
  const { quickBuy } = useChimi();
  const eth = useQuickAmount();
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function buy() {
    setState("busy");
    try {
      const hash = await quickBuy(coin, eth);
      toast({ kind: "good", title: `Bought ${coin.symbol}`, body: `${eth} ETH in.`, href: `${explorer}/tx/${hash}` });
      // Read the pool again now, so the buy shows in the feed without waiting for the next round.
      void fetchSwaps(coin, true).catch(() => undefined);
      setState("done");
      timer.current = setTimeout(() => setState("idle"), 2200);
    } catch (err) {
      const text = short(err);
      if (!/reject|denied|cancel/i.test(text)) toast({ kind: "bad", title: `Couldn’t buy ${coin.symbol}`, body: text });
      setState("idle");
    }
  }

  const label = `Buy ${coin.symbol} with ${eth} ETH`;
  if (compact) {
    return (
      <button type="button" disabled={state !== "idle" || coin.preview} onClick={() => void buy()} aria-label={label} title={label} className={`buy-pill num ${state === "done" ? "buy-pill-done" : ""}`}>
        {state === "busy" ? <span className="spinner" aria-hidden /> : state === "done" ? <IconCheck size={14} /> : <IconBolt size={13} />}
        {state === "idle" ? eth : state === "busy" ? <span className="sr-only">Confirm in your wallet</span> : <span className="sr-only">Bought</span>}
      </button>
    );
  }
  return (
    <button type="button" disabled={state !== "idle" || coin.preview} onClick={() => void buy()} aria-label={label} className={`btn btn-sm quick-buy num ${state === "done" ? "quick-buy-done" : "btn-light"}`}>
      {state === "busy" ? (
        <>
          <span className="spinner" aria-hidden />
          Confirm in wallet
        </>
      ) : state === "done" ? (
        <>
          <IconCheck size={15} />
          Bought
        </>
      ) : (
        <>
          <IconBolt size={14} className="text-seal" />
          Buy {eth} ETH
        </>
      )}
    </button>
  );
}

/** The quick-buy amount, set once for every row. It sits in the bar above the feed. */
export function QuickAmount({ className = "" }: { className?: string }) {
  const eth = useQuickAmount();
  return (
    <label className={`chip h-8 shrink-0 gap-1.5 rounded-lg pr-1 pl-2.5 text-[12.5px] text-muted ${className}`} title="How much ETH the buy button on a row spends">
      <IconBolt size={13} className="text-seal" />
      <span className="hidden lg:inline">Quick buy</span>
      <select value={eth} onChange={(e) => setQuickAmount(e.target.value)} aria-label="Quick buy amount" className="num cursor-pointer rounded-md bg-transparent py-1 pr-0.5 font-semibold text-fg outline-none">
        {QUICK_CHOICES.map((choice) => (
          <option key={choice} value={choice}>
            {choice} ETH
          </option>
        ))}
      </select>
    </label>
  );
}

/** A small label beside a name or in a row's second line. */
function Tag({ children, tone = "plain", title }: { children: ReactNode; tone?: "plain" | "gold" | "ok" | "down"; title?: string }) {
  return (
    <span title={title} className={`tag ${tone === "plain" ? "" : `tag-${tone}`}`}>
      {children}
    </span>
  );
}

/** A wallet's name, its Dojang, and its place in the season when that is near the top. */
function Who({ ctx, wallet }: { ctx: RowContext; wallet: string }) {
  const rank = ctx.ranks.get(wallet);
  return (
    <span className="inline-flex max-w-full items-center gap-1 align-bottom">
      <Link to="/u/$address" params={{ address: wallet }} title={wallet} className="num truncate font-semibold text-fg hover:text-gold">
        {wallet === ctx.me ? "You" : nameOf(ctx, wallet)}
      </Link>
      <DojangMark verified={ctx.profiles[wallet]?.verified} />
      {rank ? (
        <Tag tone="gold" title={`Rank ${rank} in this season’s points`}>
          #{rank}
        </Tag>
      ) : null}
    </span>
  );
}

function CoinName({ coin }: { coin: Coin }) {
  return (
    <Link to="/coin/$address" params={{ address: coin.token }} className="font-semibold text-fg hover:text-gold">
      {coin.symbol}
    </Link>
  );
}

/** What the wallet holds of the coin right now: the proof beside what it did or said. */
function Held({ ctx, token, wallet }: { ctx: RowContext; token: string; wallet: string }) {
  const key = heldKey(token, wallet);
  const share = ctx.held[key];
  if (share === undefined) return null;
  const said = stance(share, ctx.bought.has(key));
  if (!said) return null;
  return <Tag tone={said === "sold" ? "down" : "ok"}>{said === "sold" ? "sold all" : said}</Tag>;
}

/** The coin at the end of a row on a wide screen: its picture, market cap, the day's line and move. */
function CoinTick({ ctx, coin }: { ctx: RowContext; coin: Coin }) {
  const stats = ctx.stats[coin.token.toLowerCase()];
  return (
    <Link to="/coin/$address" params={{ address: coin.token }} aria-label={`${coin.name}, ${money(ctx, stats?.capEth)} market cap`} className="coin-tick">
      <TokenLogo symbol={coin.symbol} image={ctx.images[coin.token.toLowerCase()]} size={20} />
      <span className="num w-[3.4rem] truncate text-right text-muted">{money(ctx, stats?.capEth)}</span>
      {stats && stats.spark.length > 2 ? <Sparkline values={stats.spark} width={44} height={18} className="hidden shrink-0 xl:block" /> : <span className="hidden w-[44px] xl:block" />}
      <Change value={stats?.change} className="w-[4.1rem] justify-end" />
    </Link>
  );
}

/**
 * One row. `lead` is the picture at its start, `acts` the quieter things to do (they show under the pointer on a
 * wide screen and are left out on a phone), `below` whatever opens under it. A row that has just arrived is marked
 * for a moment; the ones already there stay still.
 */
function Row({
  ctx,
  coin,
  time,
  lead,
  children,
  acts,
  end,
  below,
  fresh,
  tone,
  quiet,
  followed,
}: {
  ctx: RowContext;
  coin?: Coin;
  time: number;
  lead: ReactNode;
  children: ReactNode;
  acts?: ReactNode;
  /** Replaces the buy button at the end of the row. */
  end?: ReactNode;
  below?: ReactNode;
  fresh?: boolean;
  tone?: "gold";
  quiet?: boolean;
  /** By a wallet you follow: the row carries a gold edge, so it is found at a glance. */
  followed?: boolean;
}) {
  return (
    <li className={`feed-item ${fresh ? "feed-item-new" : ""} ${tone === "gold" ? "feed-item-gold" : ""} ${followed ? "feed-item-followed" : ""}`}>
      <div className={`feed-row ${quiet ? "feed-row-quiet" : ""}`}>
        <span className="feed-lead">{lead}</span>
        <div className="feed-text">{children}</div>
        {acts ? <span className="row-acts">{acts}</span> : null}
        {coin ? <CoinTick ctx={ctx} coin={coin} /> : null}
        <span className="num hidden w-8 shrink-0 text-right text-[12px] text-faint sm:block">{when(ctx, time)}</span>
        <span className="feed-end">{end !== undefined ? end : coin ? <QuickBuy coin={coin} compact /> : null}</span>
      </div>
      {below}
    </li>
  );
}

/** The time in a row's second line on a phone, where there is no column for it. */
function MetaTime({ ctx, time }: { ctx: RowContext; time: number }) {
  return <span className="num shrink-0 text-faint sm:hidden">{when(ctx, time)}</span>;
}

/** "You follow", spelled out where there is room; on a phone the row's gold edge says it. */
const Followed = () => (
  <span className="hidden sm:contents">
    <Tag tone="gold">You follow</Tag>
  </span>
);

/** The coin's move in a row's second line on a phone, where there is no column for it. */
function InlineChange({ ctx, coin }: { ctx: RowContext; coin: Coin }) {
  const change = ctx.stats[coin.token.toLowerCase()]?.change;
  return change === undefined ? null : <Change value={change} className="md:hidden" />;
}

const Avatar = ({ ctx, wallet, size = 28 }: { ctx: RowContext; wallet: string; size?: number }) => (
  <Link to="/u/$address" params={{ address: wallet }} aria-label={nameOf(ctx, wallet)}>
    <Blockie address={wallet} size={size} />
  </Link>
);

function TradeRow({ item, ctx, coin, fresh }: { item: TradeItem; ctx: RowContext; coin: Coin; fresh?: boolean }) {
  const stranger = !item.mine && !item.followed;
  // A lone trade by someone you don't follow, and not the day's largest, is one quiet line.
  const quiet = stranger && !item.largest;
  const usd = ctx.ethUsd ? compactUsd(item.eth * ctx.ethUsd) : null;
  const eth = <span className="num font-semibold whitespace-nowrap text-fg">{ethText(item.eth)} ETH</span>;
  return (
    <Row
      ctx={ctx}
      coin={coin}
      time={item.time}
      fresh={fresh}
      quiet={quiet}
      followed={item.followed}
      lead={<Avatar ctx={ctx} wallet={item.wallet} size={quiet ? 22 : 28} />}
      acts={
        <>
          {stranger ? <FollowButton wallet={item.wallet} name={ctx.profiles[item.wallet]?.name} size="sm" quiet /> : null}
          {item.buy && !item.mine ? (
            // The coin's page opens on the buy side with their size filled in; nothing is sent until Buy is pressed there.
            <Link to="/coin/$address" params={{ address: coin.token }} search={{ copy: item.wallet, eth: item.eth }} className="btn btn-sm btn-ghost num" title={`Open ${coin.symbol} with their ${ethText(item.eth)} ETH filled in`}>
              Copy
            </Link>
          ) : null}
        </>
      }
    >
      {/* On a phone the line is who traded what, and the ETH leads the line under it. With more room it is one sentence. */}
      <p className="feed-line">
        <Who ctx={ctx} wallet={item.wallet} /> <span className={`font-medium ${item.buy ? "text-ok" : "text-down"}`}>{item.buy ? "bought" : "sold"}</span>{" "}
        <span className="num font-semibold text-fg">{compactCount(item.tokens)}</span> <CoinName coin={coin} />
        <span className="hidden sm:inline">
          {" "}
          <span className="text-muted">for</span> {eth}
        </span>
      </p>
      <div className={`feed-meta ${quiet ? "feed-meta-phone" : ""}`}>
        <span className="sm:hidden">{eth}</span>
        <MetaTime ctx={ctx} time={item.time} />
        {quiet ? null : (
          <>
            {item.followed ? <Followed /> : null}
            {item.largest ? <Tag>Largest buy today</Tag> : null}
            {usd ? <span className="num hidden shrink-0 sm:inline">{usd}</span> : null}
            {item.buy && item.nth > 1 ? (
              <span className="shrink-0">
                {item.mine ? "Your" : "Their"} {ordinal(item.nth)} buy today
              </span>
            ) : null}
          </>
        )}
        <Held ctx={ctx} token={item.token} wallet={item.wallet} />
        <InlineChange ctx={ctx} coin={coin} />
        {quiet ? null : (
          <a href={`${explorer}/tx/${item.tx}`} target="_blank" rel="noreferrer" className="hidden shrink-0 hover:text-fg sm:inline-flex" title="Transaction on the explorer">
            <IconExternal size={12} />
            <span className="sr-only">Transaction on the explorer</span>
          </a>
        )}
      </div>
    </Row>
  );
}

/** How long a burst took: "under 1 min", "4 min". */
function spanText(seconds: number) {
  if (seconds < 60) return "under 1 min";
  return `${Math.round(seconds / 60)} min`;
}

const BURST_ROWS = 8;

/**
 * A run of trades on one coin as one row: how many wallets, which way, how much, and how fast. This is what the
 * crowd is doing, so it gets the full two lines; the trades themselves open underneath.
 */
function BurstRow({ item, ctx, coin, fresh }: { item: BurstItem; ctx: RowContext; coin: Coin; fresh?: boolean }) {
  const [open, setOpen] = useState(false);
  const n = item.wallets.length;
  const count = item.trades.length;
  const usd = ctx.ethUsd ? compactUsd(item.eth * ctx.ethUsd) : null;
  const allBuys = item.sells === 0;
  const allSells = item.buys === 0;
  const verb = allBuys ? "bought" : allSells ? "sold" : "traded";
  const tone = allBuys ? "text-ok" : allSells ? "text-down" : "text-fg";
  return (
    <Row
      ctx={ctx}
      coin={coin}
      time={item.time}
      fresh={fresh}
      lead={
        <span className="flex items-center" aria-hidden>
          {item.wallets.slice(0, 2).map((wallet, i) => (
            <Blockie key={wallet} address={wallet} size={n === 1 ? 28 : 20} className={`ring-2 ring-chip ${i > 0 ? "-ml-3" : ""}`} />
          ))}
        </span>
      }
      acts={
        <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="btn btn-sm btn-ghost">
          {open ? "Hide" : "Trades"}
          <IconChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      }
      below={
        open ? (
          <ul className="feed-sub">
            {item.trades.slice(0, BURST_ROWS).map((t) => (
              <li key={t.key} className="num flex items-center gap-2.5 py-1 text-[13px]">
                <Link to="/u/$address" params={{ address: t.wallet }} title={t.wallet} className="flex min-w-0 flex-1 items-center gap-2 text-fg/85 hover:text-gold">
                  <Blockie address={t.wallet} size={16} />
                  <span className="truncate">{nameOf(ctx, t.wallet)}</span>
                </Link>
                <span className={`shrink-0 font-medium ${t.buy ? "text-ok" : "text-down"}`}>{t.buy ? "Buy" : "Sell"}</span>
                <span className="w-28 shrink-0 text-right whitespace-nowrap text-fg/85">{ethText(t.eth)} ETH</span>
                <a href={`${explorer}/tx/${t.tx}`} target="_blank" rel="noreferrer" title="Transaction on the explorer" className="w-8 shrink-0 text-right text-faint hover:text-fg">
                  {when(ctx, t.time)}
                </a>
              </li>
            ))}
            {count > BURST_ROWS ? (
              <li className="pt-1 text-[13px]">
                <Link to="/coin/$address" params={{ address: coin.token }} search={{ tab: "trades" }} className="font-semibold text-gold hover:underline">
                  All {count} on {coin.symbol}’s page
                </Link>
              </li>
            ) : null}
          </ul>
        ) : null
      }
    >
      {/* On a phone there is no room for the Trades button, so the line itself opens the trades. */}
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="feed-line block w-full text-left sm:pointer-events-none">
        {n === 1 ? (
          <>
            <span className="num font-semibold text-fg">{nameOf(ctx, item.wallets[0]!)}</span> <span className={`font-medium ${tone}`}>{verb}</span> <span className="font-semibold text-fg">{coin.symbol}</span>{" "}
            <span className="num font-semibold text-fg">{count} times</span>
          </>
        ) : (
          <>
            <span className="num font-semibold text-fg">{n} wallets</span> <span className={`font-medium ${tone}`}>{verb}</span> <span className="font-semibold text-fg">{coin.symbol}</span>
          </>
        )}
        <span className="hidden sm:inline">
          {" "}
          <span className="text-muted">for</span> <span className="num font-semibold whitespace-nowrap text-fg">{ethText(item.eth)} ETH</span>
        </span>
      </button>
      <div className="feed-meta">
        <span className="num font-semibold whitespace-nowrap text-fg sm:hidden">{ethText(item.eth)} ETH</span>
        <MetaTime ctx={ctx} time={item.time} />
        <Tag>{count} trades</Tag>
        <span className="shrink-0">in {spanText(item.time - item.since)}</span>
        {allBuys || allSells ? null : (
          <span className="num shrink-0">
            <span className="text-ok">{item.buys} {item.buys === 1 ? "buy" : "buys"}</span>, <span className="text-down">{item.sells} {item.sells === 1 ? "sale" : "sales"}</span>
          </span>
        )}
        {usd ? <span className="num hidden shrink-0 sm:inline">{usd}</span> : null}
        <InlineChange ctx={ctx} coin={coin} />
        {n > 1 ? (
          <span className="hidden truncate sm:inline">
            {item.wallets
              .slice(0, 2)
              .map((w) => nameOf(ctx, w))
              .join(", ")}
            {n > 2 ? ` and ${n - 2} more` : ""}
          </span>
        ) : null}
      </div>
    </Row>
  );
}

function LaunchRow({ item, ctx, coin, fresh }: { item: Extract<FeedItem, { kind: "launch" }>; ctx: RowContext; coin: Coin; fresh?: boolean }) {
  const isNew = knownTime(item.time) && ctx.now - item.time < 24 * 60 * 60;
  const mine = item.creator === ctx.me;
  return (
    <Row
      ctx={ctx}
      coin={coin}
      time={item.time}
      fresh={fresh}
      followed={item.followed}
      lead={<Avatar ctx={ctx} wallet={item.creator} />}
      acts={!mine && !item.followed ? <FollowButton wallet={item.creator} name={ctx.profiles[item.creator]?.name} size="sm" quiet /> : undefined}
    >
      <p className="feed-line">
        <Who ctx={ctx} wallet={item.creator} /> <span className="text-muted">launched</span>{" "}
        <Link to="/coin/$address" params={{ address: coin.token }} className="font-semibold text-fg hover:text-gold">
          {coin.name}
        </Link>{" "}
        <span className="num text-muted">${coin.symbol}</span>
      </p>
      <div className="feed-meta">
        <MetaTime ctx={ctx} time={item.time} />
        {isNew ? <Tag tone="ok">New</Tag> : null}
        {item.followed ? <Followed /> : null}
        <span className="shrink-0">Locked pool</span>
        {item.earlier > 0 ? (
          <span className="truncate">
            {mine ? "Your" : "Their"} {ordinal(item.earlier + 1)} launch
          </span>
        ) : null}
        <InlineChange ctx={ctx} coin={coin} />
      </div>
    </Row>
  );
}

/** The heart on a comment in the feed. It moves at once, and moves back if the like doesn't land. */
function FeedLike({ item }: { item: Extract<FeedItem, { kind: "comment" }> }) {
  const send = useLike();
  // What the feed last said, until this row is pressed; then what was pressed, until the feed catches up.
  const [mine, setMine] = useState<{ liked: boolean; count: number; from: string } | null>(null);
  const from = `${item.liked}:${item.likes}`;
  const shown = mine && mine.from === from ? mine : { liked: item.liked, count: item.likes };
  const busy = useRef(false);

  async function toggle() {
    if (busy.current) return;
    busy.current = true;
    const on = !shown.liked;
    setMine({ liked: on, count: Math.max(0, shown.count + (on ? 1 : -1)), from });
    const out = await send(item.token, item.id, on);
    busy.current = false;
    if (out.ok) return;
    setMine(null);
    if (out.cancelled) return;
    const needsDojang = out.error === NEED_DOJANG_TO_LIKE;
    toast({
      kind: "bad",
      title: needsDojang ? "Likes need a Dojang" : "Couldn’t like that",
      body: needsDojang ? "Only verified wallets can like, so a count is a count of people. It’s free on GIWA." : out.error,
      href: needsDojang ? DOJANG_URL : undefined,
      linkLabel: "Get a Dojang",
    });
  }

  return <LikeButton count={shown.count} liked={shown.liked} own={item.mine} onToggle={() => void toggle()} />;
}

/**
 * The coin a post is about, as a card under what was said: its picture and name, its price and the day's move, and
 * the day's line. Pressing it opens the coin.
 */
function CoinCard({ ctx, coin }: { ctx: RowContext; coin: Coin }) {
  const stats = ctx.stats[coin.token.toLowerCase()];
  const live = useLiveTokens().has(coin.token.toLowerCase());
  const price = stats && ctx.ethUsd ? tokenUsd(stats.priceEth * ctx.ethUsd) : stats ? `${stats.priceEth.toPrecision(3)} ETH` : "—";
  return (
    <Link to="/coin/$address" params={{ address: coin.token }} className="post-coin" aria-label={`${coin.name}, ${money(ctx, stats?.capEth)} market cap`}>
      <TokenLogo symbol={coin.symbol} image={ctx.images[coin.token.toLowerCase()]} size={40} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[15px] font-semibold text-fg">{coin.name}</span>
          {live ? <LivePill small /> : null}
        </span>
        <span className="num flex min-w-0 items-center gap-2 overflow-hidden text-[13px] whitespace-nowrap">
          <span className="text-muted">${coin.symbol}</span>
          <span className="font-semibold text-fg">{price}</span>
          <Change value={stats?.change} />
          <span className="hidden truncate text-faint sm:inline">{money(ctx, stats?.capEth)} cap</span>
        </span>
      </span>
      {stats && stats.spark.length > 2 ? <Sparkline values={stats.spark} width={150} height={44} fluid className="post-coin-line" /> : null}
    </Link>
  );
}

/**
 * A comment, as a post: who said it and what they hold of the coin, what they said, the coin as a card under it, and
 * its likes and replies. This is the social part of the feed, so it gets room the trade rows don't.
 */
function CommentPost({ item, ctx, coin, fresh }: { item: Extract<FeedItem, { kind: "comment" }>; ctx: RowContext; coin: Coin; fresh?: boolean }) {
  const creator = item.wallet === coin.creator.toLowerCase();
  return (
    <li className={`feed-item post ${fresh ? "feed-item-new" : ""} ${item.followed ? "feed-item-followed" : ""}`}>
      <span className="post-lead">
        <Avatar ctx={ctx} wallet={item.wallet} size={38} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="post-head">
          <Who ctx={ctx} wallet={item.wallet} />
          {creator ? <Tag tone="gold">Creator</Tag> : null}
          <Held ctx={ctx} token={item.token} wallet={item.wallet} />
          {item.followed ? <Followed /> : null}
          <span className="num shrink-0 text-faint">· {when(ctx, item.time)}</span>
        </p>
        {item.replyTo ? (
          <p className="text-[12.5px] text-faint">
            Replying in a thread on <CoinName coin={coin} />
          </p>
        ) : null}
        <p className="post-text">{item.text}</p>
        <CoinCard ctx={ctx} coin={coin} />
        <div className="post-acts">
          <Link to="/coin/$address" params={{ address: coin.token }} search={{ tab: "comments", c: item.id }} className="comment-act" aria-label={item.replies > 0 ? `${item.replies} replies` : "Reply"}>
            <IconComment size={15} />
            {item.replies > 0 ? <span className="num">{item.replies}</span> : <span>Reply</span>}
          </Link>
          <FeedLike item={item} />
        </div>
      </div>
    </li>
  );
}

function MilestoneRow({ item, ctx, coin, fresh }: { item: Extract<FeedItem, { kind: "milestone" }>; ctx: RowContext; coin: Coin; fresh?: boolean }) {
  const stats = ctx.stats[coin.token.toLowerCase()];
  return (
    <Row
      ctx={ctx}
      coin={coin}
      time={item.time}
      fresh={fresh}
      lead={
        <Link to="/coin/$address" params={{ address: coin.token }} aria-label={coin.name}>
          <TokenLogo symbol={coin.symbol} image={ctx.images[coin.token.toLowerCase()]} size={28} />
        </Link>
      }
    >
      <p className="feed-line">
        <CoinName coin={coin} /> <span className="text-muted">crossed</span> <span className="num font-semibold text-fg">{compactUsd(item.cap)}</span> <span className="text-muted">market cap</span>
      </p>
      <div className="feed-meta">
        <MetaTime ctx={ctx} time={item.time} />
        <Tag tone="gold">Milestone</Tag>
        {stats?.trades ? (
          <span className="num shrink-0">
            {stats.trades} {stats.trades === 1 ? "trade" : "trades"} today
          </span>
        ) : null}
        <InlineChange ctx={ctx} coin={coin} />
      </div>
    </Row>
  );
}

function CopiedRow({ item, ctx, coin, fresh }: { item: Extract<FeedItem, { kind: "copied" }>; ctx: RowContext; coin: Coin; fresh?: boolean }) {
  const n = item.by.length;
  return (
    <Row
      ctx={ctx}
      time={item.time}
      fresh={fresh}
      tone="gold"
      lead={
        <span className="grid size-7 place-items-center rounded-full bg-gold/15 text-gold">
          <IconPoints size={14} />
        </span>
      }
      end={
        <Link to="/points" className="btn btn-sm btn-ghost shrink-0 text-gold hover:text-gold">
          Points
        </Link>
      }
    >
      <p className="feed-line">
        <span className="num font-semibold text-fg">{n === 1 ? nameOf(ctx, item.by[0]!) : `${n} of your followers`}</span> <span className="text-muted">bought</span> <CoinName coin={coin} /> <span className="text-muted">after you</span>
      </p>
      <div className="feed-meta">
        <MetaTime ctx={ctx} time={item.time} />
        <span className="truncate">Earns you points · after your {ethText(item.eth)} ETH buy</span>
      </div>
    </Row>
  );
}

/**
 * A tip to a creator while they streamed: who tipped whom how much, and what they said. Gold, like the alert on the
 * broadcast; while the coin is still live, the row's button goes to the stream instead of buying.
 */
function TipRow({ item, ctx, coin, fresh }: { item: Extract<FeedItem, { kind: "tip" }>; ctx: RowContext; coin: Coin; fresh?: boolean }) {
  const stream = useStream(coin.token);
  const live = !!stream?.status.live;
  // The streamer's channel name is who people know; the wallet's name stands in without one.
  const to = stream?.status.name ?? (item.creator === ctx.me ? "you" : nameOf(ctx, item.creator));
  return (
    <Row
      ctx={ctx}
      coin={coin}
      time={item.time}
      fresh={fresh}
      tone="gold"
      followed={item.followed}
      lead={<Avatar ctx={ctx} wallet={item.wallet} />}
      end={
        live ? (
          <Link to="/coin/$address" params={{ address: coin.token }} className="btn btn-sm tip-btn shrink-0">
            Watch
          </Link>
        ) : undefined
      }
    >
      <p className="feed-line">
        <Who ctx={ctx} wallet={item.wallet} /> <span className="text-muted">tipped</span> <span className="font-semibold text-fg">{to}</span>{" "}
        <span className="num font-semibold text-gold">{ethText(item.eth)} ETH</span>
      </p>
      <div className="feed-meta">
        <MetaTime ctx={ctx} time={item.time} />
        {live ? (
          <LivePill small />
        ) : (
          <Tag tone="gold">Tip</Tag>
        )}
        <span className="shrink-0">
          on <CoinName coin={coin} />
        </span>
        {item.text ? <span className="min-w-0 truncate text-fg/80">“{item.text}”</span> : null}
      </div>
    </Row>
  );
}

/** A post on X about the coin: the post as it reads on X, with the coin as a card under it, like a comment. */
function XRow({ item, ctx, coin, fresh }: { item: Extract<FeedItem, { kind: "x" }>; ctx: RowContext; coin: Coin; fresh?: boolean }) {
  return (
    <XPostCard post={item.post} now={ctx.now} symbol={coin.symbol} fresh={fresh}>
      <CoinCard ctx={ctx} coin={coin} />
    </XPostCard>
  );
}

/**
 * One feed item as its row. An item about a coin the board doesn't list (it was just launched, say) is skipped.
 * `fresh` marks a row that arrived while the page was open.
 */
export function FeedRow({ item, ctx, fresh }: { item: FeedItem; ctx: RowContext; fresh?: boolean }) {
  const coin = ctx.byToken.get(item.token);
  if (!coin) return null;
  if (item.kind === "trade") return <TradeRow item={item} ctx={ctx} coin={coin} fresh={fresh} />;
  if (item.kind === "burst") return <BurstRow item={item} ctx={ctx} coin={coin} fresh={fresh} />;
  if (item.kind === "launch") return <LaunchRow item={item} ctx={ctx} coin={coin} fresh={fresh} />;
  if (item.kind === "comment") return <CommentPost item={item} ctx={ctx} coin={coin} fresh={fresh} />;
  if (item.kind === "milestone") return <MilestoneRow item={item} ctx={ctx} coin={coin} fresh={fresh} />;
  if (item.kind === "tip") return <TipRow item={item} ctx={ctx} coin={coin} fresh={fresh} />;
  if (item.kind === "x") return <XRow item={item} ctx={ctx} coin={coin} fresh={fresh} />;
  return <CopiedRow item={item} ctx={ctx} coin={coin} fresh={fresh} />;
}

/** A placeholder the shape of a row, so nothing jumps when the real ones arrive. */
export function RowSkeleton() {
  return (
    <li className="feed-item" aria-hidden>
      <div className="feed-row">
        <span className="skeleton size-7 shrink-0 rounded-full" />
        <span className="flex-1 space-y-1.5">
          <span className="skeleton block h-3.5 w-3/5" />
          <span className="skeleton block h-3 w-1/4" />
        </span>
        <span className="skeleton h-7 w-16 rounded-lg" />
      </div>
    </li>
  );
}

/** The wallets a page of the feed names, so their up.id names can be looked up in one go. */
export function walletsIn(items: FeedItem[]): string[] {
  const out = new Set<string>();
  for (const item of items) {
    if (item.kind === "trade" || item.kind === "comment") out.add(item.wallet);
    else if (item.kind === "launch") out.add(item.creator);
    else if (item.kind === "copied") for (const w of item.by) out.add(w);
    else if (item.kind === "tip") {
      out.add(item.wallet);
      out.add(item.creator);
    }
    else if (item.kind === "burst") for (const w of item.wallets.slice(0, BURST_ROWS)) out.add(w);
  }
  return [...out];
}

/** The wallet and coin of every row that shows what its wallet holds. */
export function holdersIn(items: FeedItem[]): { token: string; wallet: string }[] {
  return items.flatMap((item) => (item.kind === "trade" || item.kind === "comment" ? [{ token: item.token, wallet: item.wallet }] : []));
}

/**
 * The strip along the top of every page: the last day's trades and launches moving past, the way a trading floor's
 * board does. It stops while the pointer is on it, and stands still for visitors who ask for less motion (.ticker in
 * styles.css). On a quiet day it says so instead of showing old news.
 */
export function Ticker({
  items,
  byToken,
  images,
  profiles,
  now,
  className = "",
}: {
  items: TickItem[];
  byToken: Map<string, Coin>;
  images: Record<string, string | undefined>;
  profiles: Record<string, Profile>;
  /** Unix seconds. */
  now: number;
  className?: string;
}) {
  const recent = items.filter((item) => byToken.has(item.token));
  const name = (wallet: string) => profiles[wallet]?.name?.replace(/\.up\.id$/, "") ?? shortWallet(wallet);
  const live = (
    <span className="ticker-live">
      <span className="live-dot text-ok" />
      Live
    </span>
  );
  if (recent.length === 0) {
    return (
      <div className={`ticker ${className}`}>
        {live}
        <span className="truncate text-faint">Quiet on GIWA: no trades in the last day</span>
      </div>
    );
  }
  const row = (hidden: boolean) => (
    <div className="ticker-row" aria-hidden={hidden || undefined}>
      {recent.map((item) => {
        const coin = byToken.get(item.token)!;
        return (
          <span key={item.key} className="flex shrink-0 items-center gap-1.5">
            <Link to="/u/$address" params={{ address: item.wallet }} tabIndex={hidden ? -1 : undefined} className="inline-flex items-center gap-1.5 font-medium text-fg/90 hover:text-gold">
              <Blockie address={item.wallet} size={16} />
              <span className="num">{name(item.wallet)}</span>
            </Link>
            {item.kind === "trade" ? (
              <>
                <span className={`num font-medium ${item.buy ? "text-ok" : "text-down"}`}>
                  {item.buy ? "bought" : "sold"} {ethText(item.eth ?? 0)} ETH
                </span>
                of
              </>
            ) : (
              <span className="font-medium text-gold">launched</span>
            )}
            <Link to="/coin/$address" params={{ address: coin.token }} tabIndex={hidden ? -1 : undefined} className="inline-flex items-center gap-1.5 font-medium text-fg hover:text-gold">
              <TokenLogo symbol={coin.symbol} image={images[coin.token.toLowerCase()]} size={16} ring={false} />${coin.symbol}
            </Link>
            <span className="num text-faint">{knownTime(item.time) ? ago(Math.max(0, now - item.time)) : ""}</span>
          </span>
        );
      })}
    </div>
  );
  // A handful of items fit without moving. More than that scroll, as two copies end to end so the loop has no seam.
  const moving = recent.length > 3;
  return (
    <div className={`ticker ${moving ? "ticker-moving" : ""} ${className}`} style={{ "--ticker-s": `${recent.length * 6}s` } as CSSProperties}>
      {live}
      <div className="ticker-window">
        <div className="ticker-track">
          {row(false)}
          {moving ? row(true) : null}
        </div>
      </div>
    </div>
  );
}
