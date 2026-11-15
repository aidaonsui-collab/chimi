import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { giwaSepolia } from "@/lib/chimi/chain";
import { NEED_DOJANG_TO_LIKE } from "@/lib/chimi/comment-rules";
import { useLike } from "@/lib/chimi/comments";
import { knownTime } from "@/lib/chimi/feed";
import { ordinal, type BurstItem, type FeedItem } from "@/lib/chimi/feed-rules";
import { ago, compactCount, compactUsd, ethText } from "@/lib/chimi/format";
import { DOJANG_URL } from "@/lib/chimi/identity";
import { fetchSwaps, type CoinStats } from "@/lib/chimi/live";
import { short, type Coin } from "@/lib/chimi/market";
import type { Profile } from "@/lib/chimi/points-rules";
import { QUICK_CHOICES, setQuickAmount, useQuickAmount } from "@/lib/chimi/quick";
import { shortWallet } from "@/lib/chimi/rewards";
import { LikeButton } from "@/components/chimi/comments";
import { FollowButton } from "@/components/chimi/follow";
import { IconBolt, IconCheck, IconChevronDown, IconComment, IconExternal, IconLock, IconPoints } from "@/components/chimi/icons";
import { useChimi } from "@/components/chimi/provider";
import { DojangMark } from "@/components/chimi/rewards-bits";
import { toast } from "@/components/chimi/toast";
import { TokenLogo } from "@/components/chimi/token-logo";
import { Blockie, Change, Sparkline } from "@/components/chimi/ui";

/*
 * The cards of the home feed: one per thing that happened. A card is two lines: who did what, and the coin with the
 * one thing to do about it. Buying is always the same single button, spending the amount set in the bar above the
 * feed, so a long feed reads as a list and not as a wall of controls.
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

const nameOf = (ctx: CardContext, wallet: string) => ctx.profiles[wallet]?.name?.replace(/\.up\.id$/, "") ?? shortWallet(wallet);
const money = (ctx: CardContext, eth: number | undefined) => (eth === undefined ? "—" : ctx.ethUsd ? compactUsd(eth * ctx.ethUsd) : `${ethText(eth)} ETH`);
const when = (ctx: CardContext, time: number) => (knownTime(time) ? ago(Math.max(0, ctx.now - time)) : "earlier");

/**
 * Buy this coin with the quick-buy amount: one press, one confirmation in the wallet. The button says what is
 * happening the whole way: asking the wallet, then done.
 */
export function QuickBuy({ coin, wide = false }: { coin: Coin; wide?: boolean }) {
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

  return (
    <button
      type="button"
      disabled={state !== "idle" || coin.preview}
      onClick={() => void buy()}
      aria-label={`Buy ${coin.symbol} with ${eth} ETH`}
      className={`btn btn-sm quick-buy num ${state === "done" ? "quick-buy-done" : "btn-light"} ${wide ? "flex-1 sm:flex-none" : ""}`}
    >
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

/** The quick-buy amount, set once for every card. It sits in the bar above the feed. */
export function QuickAmount() {
  const eth = useQuickAmount();
  return (
    <label className="chip h-9 shrink-0 gap-1.5 rounded-xl pr-1.5 pl-3 text-[13px] text-muted" title="How much ETH the Buy button on a card spends">
      <IconBolt size={14} className="text-seal" />
      <span className="hidden sm:inline">Quick buy</span>
      <select value={eth} onChange={(e) => setQuickAmount(e.target.value)} aria-label="Quick buy amount" className="num cursor-pointer rounded-lg bg-transparent py-1 pr-1 font-semibold text-fg outline-none">
        {QUICK_CHOICES.map((choice) => (
          <option key={choice} value={choice}>
            {choice} ETH
          </option>
        ))}
      </select>
    </label>
  );
}

function Who({ ctx, wallet }: { ctx: CardContext; wallet: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 align-bottom">
      <Link to="/u/$address" params={{ address: wallet }} title={wallet} className="num truncate font-semibold hover:text-gold">
        {wallet === ctx.me ? "You" : nameOf(ctx, wallet)}
      </Link>
      <DojangMark verified={ctx.profiles[wallet]?.verified} />
    </span>
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
  return <span className={`chip h-5 px-2 text-[11px] font-semibold ${tone === "gold" ? "border-gold/25 text-gold" : ""}`}>{children}</span>;
}

/** One card. A card that has just arrived rises into place; the ones already there stay still. */
function Card({ fresh, className = "", children }: { fresh?: boolean; className?: string; children: ReactNode }) {
  return <article className={`card feed-card p-4 sm:px-5 ${fresh ? "feed-card-new" : ""} ${className}`}>{children}</article>;
}

/** The first line of a card: who, what they did, when, and a quieter line of detail under it. */
function Head({ ctx, wallet, time, children, meta }: { ctx: CardContext; wallet: string; time: number; children: ReactNode; meta?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <Link to="/u/$address" params={{ address: wallet }} aria-label={nameOf(ctx, wallet)} className="shrink-0">
        <Blockie address={wallet} size={36} />
      </Link>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] leading-snug [overflow-wrap:anywhere]">{children}</p>
        {meta ? <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] leading-snug text-muted">{meta}</div> : null}
      </div>
      <span className="num shrink-0 pt-px text-[13px] text-muted">{when(ctx, time)}</span>
    </div>
  );
}

/** The coin a card is about, as one tappable strip: picture, name, market cap, the day's line and move. */
function CoinChip({ ctx, coin, big }: { ctx: CardContext; coin: Coin; big?: boolean }) {
  const stats = ctx.stats[coin.token.toLowerCase()];
  return (
    <Link to="/coin/$address" params={{ address: coin.token }} className="coin-chip flex min-w-0 flex-[1_1_220px] items-center gap-2.5 rounded-xl bg-raise px-3 py-2 transition-colors hover:bg-raise2">
      <TokenLogo symbol={coin.symbol} image={ctx.images[coin.token.toLowerCase()]} size={big ? 40 : 28} shape={big ? "rounded" : "circle"} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] leading-tight font-semibold">
          {coin.name}
          {big ? <span className="ml-1.5 font-medium text-muted">${coin.symbol}</span> : null}
        </span>
        <span className="num flex items-center gap-1.5 truncate text-[12.5px] leading-tight text-muted">
          {money(ctx, stats?.capEth)}
          {big ? (
            <>
              <span className="text-faint">·</span>
              <IconLock size={12} />
              Locked pool
            </>
          ) : null}
        </span>
      </span>
      {stats && stats.spark.length > 2 ? <Sparkline values={stats.spark} width={72} height={26} className="hidden shrink-0 min-[420px]:block" /> : null}
      <Change value={stats?.change} className="shrink-0 text-[13px]" />
    </Link>
  );
}

/** The second line of a card: the coin, and what to do about it. On a phone the buttons take their own row. */
function Row({ children }: { children: ReactNode }) {
  return <div className="mt-3 flex flex-wrap items-stretch gap-2">{children}</div>;
}

function TradeCard({ item, ctx, coin, fresh }: { item: Extract<FeedItem, { kind: "trade" }>; ctx: CardContext; coin: Coin; fresh?: boolean }) {
  const stranger = !item.mine && !item.followed;
  const usd = ctx.ethUsd ? compactUsd(item.eth * ctx.ethUsd) : null;
  return (
    <Card fresh={fresh}>
      <Head
        ctx={ctx}
        wallet={item.wallet}
        time={item.time}
        meta={
          <>
            {item.followed ? <Tag tone="gold">You follow</Tag> : null}
            {item.largest ? <Tag>Largest buy today</Tag> : null}
            {item.buy && item.nth > 1 ? (
              <span>
                {item.mine ? "Your" : "Their"} {ordinal(item.nth)} buy of it today
              </span>
            ) : null}
            {usd ? <span className="num">{usd}</span> : null}
            <a href={`${explorer}/tx/${item.tx}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-fg" title="Transaction on the explorer">
              <IconExternal size={12} />
              <span className="sr-only">Transaction on the explorer</span>
            </a>
          </>
        }
      >
        <Who ctx={ctx} wallet={item.wallet} /> <span className={`font-medium ${item.buy ? "text-ok" : "text-down"}`}>{item.buy ? "bought" : "sold"}</span>{" "}
        <span className="num font-semibold">{compactCount(item.tokens)}</span> <CoinName coin={coin} /> <span className="text-muted">for</span>{" "}
        <span className="num font-semibold whitespace-nowrap">{ethText(item.eth)} ETH</span>
      </Head>
      <Row>
        <CoinChip ctx={ctx} coin={coin} />
        {stranger ? <FollowButton wallet={item.wallet} name={ctx.profiles[item.wallet]?.name} size="sm" quiet className="flex-1 sm:flex-none" /> : null}
        {item.buy && !item.mine ? (
          // The coin's page opens on the buy side with their size filled in; nothing is sent until Buy is pressed there.
          <Link to="/coin/$address" params={{ address: coin.token }} search={{ copy: item.wallet, eth: item.eth }} className="btn btn-sm btn-secondary num flex-1 sm:flex-none" title={`Open ${coin.symbol} with their ${ethText(item.eth)} ETH filled in`}>
            Copy
          </Link>
        ) : null}
        <QuickBuy coin={coin} wide />
      </Row>
    </Card>
  );
}

/** How long a burst took, said the way the feed says times: "under a minute", "4 minutes". */
function spanText(seconds: number) {
  if (seconds < 60) return "under a minute";
  const minutes = Math.round(seconds / 60);
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

const BURST_ROWS = 8;

/**
 * A run of trades on one coin as one card: how many wallets, which way, how much, and how fast. The trades
 * themselves are a press away, so a busy coin takes one card's room instead of the whole page.
 */
function BurstCard({ item, ctx, coin, fresh }: { item: BurstItem; ctx: CardContext; coin: Coin; fresh?: boolean }) {
  const [open, setOpen] = useState(false);
  const faces = item.wallets.slice(0, 3);
  const n = item.wallets.length;
  const count = item.trades.length;
  const usd = ctx.ethUsd ? compactUsd(item.eth * ctx.ethUsd) : null;
  const allBuys = item.sells === 0;
  const allSells = item.buys === 0;
  const verb = allBuys ? "bought" : allSells ? "sold" : "traded";
  const names = item.wallets.slice(0, 2).map((w) => nameOf(ctx, w));
  return (
    <Card fresh={fresh}>
      <div className="flex items-start gap-3">
        <span className="flex shrink-0 items-center pt-0.5" aria-hidden>
          {faces.map((wallet, i) => (
            <Blockie key={wallet} address={wallet} size={faces.length === 1 ? 36 : 28} className={`ring-2 ring-chip ${i > 0 ? "-ml-3" : ""}`} />
          ))}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-snug [overflow-wrap:anywhere]">
            {n === 1 ? (
              <>
                <Who ctx={ctx} wallet={item.wallets[0]!} /> <span className={`font-medium ${allBuys ? "text-ok" : allSells ? "text-down" : ""}`}>{verb}</span> <CoinName coin={coin} />{" "}
                <span className="num font-semibold">{count} times</span>
              </>
            ) : (
              <>
                <span className="num font-semibold">{n} wallets</span> <span className={`font-medium ${allBuys ? "text-ok" : allSells ? "text-down" : ""}`}>{verb}</span> <CoinName coin={coin} />
              </>
            )}{" "}
            <span className="text-muted">for</span> <span className="num font-semibold whitespace-nowrap">{ethText(item.eth)} ETH</span>
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] leading-snug text-muted">
            <Tag>{count} trades</Tag>
            <span>in {spanText(item.time - item.since)}</span>
            {allBuys || allSells ? null : (
              <span className="num">
                <span className="text-ok">{item.buys} {item.buys === 1 ? "buy" : "buys"}</span>, <span className="text-down">{item.sells} {item.sells === 1 ? "sale" : "sales"}</span>
              </span>
            )}
            {usd ? <span className="num">{usd}</span> : null}
            {n > 1 ? (
              <span className="truncate">
                {names.join(", ")}
                {n > 2 ? ` and ${n - 2} more` : ""}
              </span>
            ) : null}
          </div>
        </div>
        <span className="num shrink-0 pt-px text-[13px] text-muted">{when(ctx, item.time)}</span>
      </div>
      <Row>
        <CoinChip ctx={ctx} coin={coin} />
        <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="btn btn-sm btn-secondary flex-1 sm:flex-none">
          {open ? "Hide trades" : "See trades"}
          <IconChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        <QuickBuy coin={coin} wide />
      </Row>
      {open ? (
        <ul className="burst-rows mt-3 border-t border-line/70 pt-1">
          {item.trades.slice(0, BURST_ROWS).map((t) => (
            <li key={t.key} className="num flex items-center gap-2.5 py-1.5 text-[13.5px]">
              <Link to="/u/$address" params={{ address: t.wallet }} title={t.wallet} className="flex min-w-0 flex-1 items-center gap-2 hover:text-gold">
                <Blockie address={t.wallet} size={20} />
                <span className="truncate font-medium">{nameOf(ctx, t.wallet)}</span>
              </Link>
              <span className={`shrink-0 font-medium ${t.buy ? "text-ok" : "text-down"}`}>{t.buy ? "Buy" : "Sell"}</span>
              <span className="w-28 shrink-0 text-right whitespace-nowrap">{ethText(t.eth)} ETH</span>
              <a href={`${explorer}/tx/${t.tx}`} target="_blank" rel="noreferrer" title="Transaction on the explorer" className="w-9 shrink-0 text-right text-muted hover:text-fg">
                {when(ctx, t.time)}
              </a>
            </li>
          ))}
          {count > BURST_ROWS ? (
            <li className="pt-1.5 text-[13px]">
              <Link to="/coin/$address" params={{ address: coin.token }} search={{ tab: "trades" }} className="font-semibold text-gold hover:underline">
                All {count} on {coin.symbol}’s page
              </Link>
            </li>
          ) : null}
        </ul>
      ) : null}
    </Card>
  );
}

function LaunchCard({ item, ctx, coin, fresh }: { item: Extract<FeedItem, { kind: "launch" }>; ctx: CardContext; coin: Coin; fresh?: boolean }) {
  const isNew = knownTime(item.time) && ctx.now - item.time < 24 * 60 * 60;
  const mine = item.creator === ctx.me;
  return (
    <Card fresh={fresh}>
      <Head
        ctx={ctx}
        wallet={item.creator}
        time={item.time}
        meta={
          isNew || item.followed || item.earlier > 0 ? (
            <>
              {isNew ? <Tag>New</Tag> : null}
              {item.followed ? <Tag tone="gold">You follow</Tag> : null}
              {item.earlier > 0 ? (
                <span>
                  {mine ? "Your" : "Their"} {ordinal(item.earlier + 1)} launch on Chimi
                </span>
              ) : null}
            </>
          ) : undefined
        }
      >
        <Who ctx={ctx} wallet={item.creator} /> <span className="text-muted">launched</span> <CoinName coin={coin} />
      </Head>
      <Row>
        <CoinChip ctx={ctx} coin={coin} big />
        {!mine && !item.followed ? <FollowButton wallet={item.creator} name={ctx.profiles[item.creator]?.name} size="sm" quiet className="flex-1 self-center sm:flex-none" /> : null}
        <span className="flex flex-1 items-center sm:flex-none">
          <QuickBuy coin={coin} wide />
        </span>
      </Row>
    </Card>
  );
}

/** The heart on a comment in the feed. It moves at once, and moves back if the like doesn't land. */
function FeedLike({ item }: { item: Extract<FeedItem, { kind: "comment" }> }) {
  const send = useLike();
  // What the feed last said, until this card is pressed; then what was pressed, until the feed catches up.
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

function CommentCard({ item, ctx, coin, fresh }: { item: Extract<FeedItem, { kind: "comment" }>; ctx: CardContext; coin: Coin; fresh?: boolean }) {
  const creator = item.wallet === coin.creator.toLowerCase();
  return (
    <Card fresh={fresh}>
      <Head
        ctx={ctx}
        wallet={item.wallet}
        time={item.time}
        meta={
          item.followed || creator ? (
            <>
              {item.followed ? <Tag tone="gold">You follow</Tag> : null}
              {creator ? <Tag>Creator</Tag> : null}
            </>
          ) : undefined
        }
      >
        <Who ctx={ctx} wallet={item.wallet} /> <span className="text-muted">{item.replyTo ? "replied on" : "on"}</span> <CoinName coin={coin} />
      </Head>
      <p className="mt-2.5 ml-12 text-[15px] leading-relaxed [overflow-wrap:anywhere]">{item.text}</p>
      <div className="mt-1.5 ml-[42px] flex items-center gap-1 text-[13px] text-muted">
        <FeedLike item={item} />
        <Link to="/coin/$address" params={{ address: coin.token }} search={{ tab: "comments", c: item.id }} className="comment-act">
          <IconComment size={14} />
          {item.replies > 0 ? <span className="num">{item.replies}</span> : null}
          Reply
        </Link>
      </div>
      <Row>
        <CoinChip ctx={ctx} coin={coin} />
        <QuickBuy coin={coin} wide />
      </Row>
    </Card>
  );
}

function MilestoneCard({ item, ctx, coin, fresh }: { item: Extract<FeedItem, { kind: "milestone" }>; ctx: CardContext; coin: Coin; fresh?: boolean }) {
  const stats = ctx.stats[coin.token.toLowerCase()];
  return (
    <Card fresh={fresh}>
      <div className="flex items-start gap-3">
        <Link to="/coin/$address" params={{ address: coin.token }} aria-label={coin.name} className="shrink-0">
          <TokenLogo symbol={coin.symbol} image={ctx.images[coin.token.toLowerCase()]} size={36} />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-snug">
            <CoinName coin={coin} /> <span className="text-muted">crossed</span> <span className="num font-semibold">{compactUsd(item.cap)}</span> <span className="text-muted">market cap</span>
          </p>
          {stats?.trades ? (
            <p className="num mt-1 text-[12.5px] leading-snug text-muted">
              {stats.trades} {stats.trades === 1 ? "trade" : "trades"} today
            </p>
          ) : null}
        </div>
        <span className="num shrink-0 pt-px text-[13px] text-muted">{when(ctx, item.time)}</span>
      </div>
      <Row>
        <CoinChip ctx={ctx} coin={coin} />
        <QuickBuy coin={coin} wide />
      </Row>
    </Card>
  );
}

function CopiedCard({ item, ctx, coin, fresh }: { item: Extract<FeedItem, { kind: "copied" }>; ctx: CardContext; coin: Coin; fresh?: boolean }) {
  const n = item.by.length;
  return (
    <Card fresh={fresh} className="border-gold/25">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-gold/10 text-gold">
          <IconPoints size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-snug">
            <span className="font-semibold">{n === 1 ? nameOf(ctx, item.by[0]!) : `${n} wallets that follow you`}</span> <span className="text-muted">bought</span> <CoinName coin={coin} /> <span className="text-muted">after you</span>
          </p>
          <p className="mt-1 text-[12.5px] leading-snug text-muted">
            Within a day of your {ethText(item.eth)} ETH buy. Leading a buy earns you points.{" "}
            <Link to="/points" className="font-semibold text-gold hover:underline">
              Your points
            </Link>
          </p>
        </div>
        <span className="num shrink-0 pt-px text-[13px] text-muted">{when(ctx, item.time)}</span>
      </div>
    </Card>
  );
}

/**
 * One feed item as its card. An item about a coin the board doesn't list (it was just launched, say) is skipped.
 * `fresh` marks a card that arrived while the page was open, so it animates in.
 */
export function FeedCard({ item, ctx, fresh }: { item: FeedItem; ctx: CardContext; fresh?: boolean }) {
  const coin = ctx.byToken.get(item.token);
  if (!coin) return null;
  if (item.kind === "trade") return <TradeCard item={item} ctx={ctx} coin={coin} fresh={fresh} />;
  if (item.kind === "burst") return <BurstCard item={item} ctx={ctx} coin={coin} fresh={fresh} />;
  if (item.kind === "launch") return <LaunchCard item={item} ctx={ctx} coin={coin} fresh={fresh} />;
  if (item.kind === "comment") return <CommentCard item={item} ctx={ctx} coin={coin} fresh={fresh} />;
  if (item.kind === "milestone") return <MilestoneCard item={item} ctx={ctx} coin={coin} fresh={fresh} />;
  return <CopiedCard item={item} ctx={ctx} coin={coin} fresh={fresh} />;
}

/** A placeholder the shape of a card, so nothing jumps when the real ones arrive. */
export function CardSkeleton() {
  return (
    <div className="card p-4 sm:px-5" aria-hidden>
      <div className="flex items-start gap-3">
        <span className="skeleton size-9 shrink-0 rounded-full" />
        <span className="flex-1 space-y-2 pt-0.5">
          <span className="skeleton block h-4 w-3/5" />
          <span className="skeleton block h-3 w-1/4" />
        </span>
        <span className="skeleton h-3 w-6" />
      </div>
      <div className="mt-3 flex gap-2">
        <span className="skeleton block h-11 flex-1 rounded-xl" />
        <span className="skeleton hidden h-11 w-32 rounded-xl sm:block" />
      </div>
    </div>
  );
}

/** The wallets a page of the feed names, so their up.id names can be looked up in one go. */
export function walletsIn(items: FeedItem[]): string[] {
  const out = new Set<string>();
  for (const item of items) {
    if (item.kind === "trade" || item.kind === "comment") out.add(item.wallet);
    else if (item.kind === "launch") out.add(item.creator);
    else if (item.kind === "copied") for (const w of item.by) out.add(w);
    else if (item.kind === "burst") for (const w of item.wallets.slice(0, BURST_ROWS)) out.add(w);
  }
  return [...out];
}

/**
 * The strip under the top bar: the last day's trades and launches moving past. It stops while the pointer is on it,
 * and stands still for visitors who ask for less motion (.ticker in styles.css).
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
                <span className={`num font-medium ${item.buy ? "text-ok" : "text-down"}`}>{ethText(item.eth)} ETH</span>
                of
              </>
            ) : (
              "launched"
            )}
            <Link to="/coin/$address" params={{ address: coin.token }} tabIndex={hidden ? -1 : undefined} className="inline-flex items-center gap-1.5 font-medium text-fg hover:text-gold">
              <TokenLogo symbol={coin.symbol} image={ctx.images[coin.token.toLowerCase()]} size={16} ring={false} />
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
