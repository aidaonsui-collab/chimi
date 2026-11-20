import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Address } from "viem";
import { timelineOf, type ActivityTrade, type TradeRun } from "@/lib/chimi/activity-rules";
import { erc20Abi, giwaChain } from "@/lib/chimi/chain";
import { publicClient } from "@/lib/chimi/client";
import { MAX_LENGTH, NEED_DOJANG, NEED_DOJANG_TO_LIKE, checkText, cleanText, stance, threadsOf, type Comment } from "@/lib/chimi/comment-rules";
import type { CommentThread } from "@/lib/chimi/comments";
import { ago, compactCount, ethText } from "@/lib/chimi/format";
import { DOJANG_URL } from "@/lib/chimi/identity";
import { SUPPLY } from "@/lib/chimi/live";
import type { Coin, Holder, PoolSwap } from "@/lib/chimi/market";
import type { Profile } from "@/lib/chimi/points-rules";
import { shortWallet, useMyProfile, usePoints, useProfiles } from "@/lib/chimi/rewards";
import { IconChevronDown, IconExternal, IconHeart, IconReply } from "@/components/chimi/icons";
import { useChimi } from "@/components/chimi/provider";
import { toast } from "@/components/chimi/toast";
import { Blockie, Empty, TraderLink } from "@/components/chimi/ui";

const explorer = giwaChain.blockExplorers.default.url;

/** Answers shown under a comment before "Show earlier replies" is pressed. */
const REPLIES_SHOWN = 3;
/** Trades listed when a line of trades is opened. */
const RUN_ROWS = 8;

/**
 * What these wallets hold of the coin. The page already knows the balances of recent traders; the rest are read here,
 * and read again whenever the page's own list is (after a trade, or when the price moves).
 */
function useHeld(token: Address, wallets: string[], holders: Holder[] | undefined) {
  const known = useMemo(() => Object.fromEntries((holders ?? []).map((h) => [h.address.toLowerCase(), h.balance])), [holders]);
  const missing = wallets.filter((w) => known[w] === undefined).sort().join(",");
  const [read, setRead] = useState<Record<string, bigint>>({});
  useEffect(() => {
    if (!missing || !holders) return;
    const list = missing.split(",");
    let cancel = false;
    void Promise.all(list.map((w) => publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [w as Address] })))
      .then((balances) => {
        if (!cancel) setRead((prev) => ({ ...prev, ...Object.fromEntries(list.map((w, i) => [w, balances[i]!])) }));
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [token, missing, holders]);
  return (wallet: string): bigint | undefined => known[wallet] ?? read[wallet];
}

const nameOf = (profiles: Record<string, Profile>, wallet: string) => profiles[wallet]?.name?.replace(/\.up\.id$/, "") ?? shortWallet(wallet);

/** The heart under a comment: how many wallets like it, and yours with one press. */
export function LikeButton({ count, liked, own, onToggle }: { count: number; liked: boolean; own?: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={liked}
      aria-label={own ? `${count} ${count === 1 ? "like" : "likes"}` : liked ? "Unlike" : "Like"}
      title={own ? "You can’t like your own comment" : undefined}
      disabled={own}
      onClick={onToggle}
      className={`like ${liked ? "like-on" : ""}`}
    >
      <IconHeart size={15} fill={liked ? "currentColor" : "none"} />
      {count > 0 ? <span className="num">{count}</span> : null}
    </button>
  );
}

/**
 * What is said about a coin: the box to write in, then the threads, newest first, each comment with its likes and
 * the answers to it. With `withTrades`, the day's trades run between the threads as single lines, so the talk and
 * the tape read as one story. `focus` is a comment to scroll to (a link from the feed or the inbox).
 */
export function Comments({
  coin,
  thread,
  holders,
  swaps,
  focus,
  withTrades = false,
  onAllTrades,
}: {
  coin: Coin;
  thread: CommentThread;
  holders: Holder[] | undefined;
  swaps: PoolSwap[] | undefined;
  focus?: string;
  withTrades?: boolean;
  /** Opens the full list of trades (the Trades tab). */
  onAllTrades?: () => void;
}) {
  const { account } = useChimi();
  const { data: points } = usePoints();
  const { view, failed, pending, send, like, showOlder } = thread;
  const items = view?.items ?? [];
  const threads = useMemo(() => threadsOf(items), [items]);
  const liked = useMemo(() => new Set(view?.liked ?? []), [view?.liked]);
  const [replying, setReplying] = useState<{ thread: string; to: Comment } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [openRuns, setOpenRuns] = useState<Set<string>>(() => new Set());
  const [flash, setFlash] = useState<string>();

  const trades: ActivityTrade[] = useMemo(
    () =>
      withTrades
        ? (swaps ?? []).map((s) => ({ key: `${s.tx}:${s.index ?? 0}`, time: s.time, wallet: s.recipient.toLowerCase(), buy: s.buy, eth: Number(s.ethAmount) / 1e18, tokens: Number(s.tokenAmount) / 1e18, tx: s.tx }))
        : [],
    [withTrades, swaps],
  );
  const timeline = useMemo(
    () =>
      timelineOf(
        threads.map((t) => ({ time: Math.floor(t.root.time / 1000), thread: t })),
        trades,
      ),
    [threads, trades],
  );

  const wallets = useMemo(() => [...new Set(items.map((c) => c.wallet))], [items]);
  // Names for the traders that are on screen: a lone trade's, and those of the lines that are open.
  const named = useMemo(() => {
    const out = new Set(wallets);
    for (const c of items) if (c.to) out.add(c.to);
    for (const entry of timeline) {
      if (entry.kind !== "trades") continue;
      if (entry.trades.length === 1) out.add(entry.trades[0]!.wallet);
      else if (openRuns.has(entry.key)) for (const t of entry.trades.slice(0, RUN_ROWS)) out.add(t.wallet);
    }
    return [...out];
  }, [wallets, items, timeline, openRuns]);
  const profiles = useProfiles(named, points?.file.profiles);
  const held = useHeld(coin.token, wallets, holders);
  // Who has ever bought: the trade record, plus the buys this page has read itself (the record runs minutes behind).
  const bought = useMemo(() => {
    const set = new Set(view?.bought ?? []);
    for (const s of swaps ?? []) if (s.buy) set.add(s.recipient.toLowerCase());
    return set;
  }, [view?.bought, swaps]);
  const me = account?.toLowerCase();
  const now = Date.now();

  // A link to one comment: open its thread, bring it into view, and mark it for a moment.
  const focused = useRef<string>(undefined);
  useEffect(() => {
    if (!focus || focused.current === focus) return;
    const target = items.find((c) => c.id === focus);
    if (!target) return;
    focused.current = focus;
    if (target.replyTo) setExpanded((prev) => new Set(prev).add(target.replyTo!));
    setFlash(focus);
    const frame = requestAnimationFrame(() => document.getElementById(`c-${focus}`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
    const timer = setTimeout(() => setFlash(undefined), 2600);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [focus, items]);

  async function remove(comment: Comment) {
    const out = await send({ type: "delete", id: comment.id });
    if (out.ok) toast({ kind: "good", title: "Comment deleted" });
    else if (!out.cancelled) toast({ kind: "bad", title: "Couldn’t delete that", body: out.error });
  }

  async function toggleLike(comment: Comment) {
    const out = await like(comment.id, !liked.has(comment.id));
    if (out.ok || out.cancelled) return;
    const needsDojang = out.error === NEED_DOJANG_TO_LIKE;
    toast({
      kind: "bad",
      title: needsDojang ? "Likes need a Dojang" : "Couldn’t like that",
      body: needsDojang ? "Only verified wallets can like, so a count is a count of people. It’s free on GIWA." : out.error,
      href: needsDojang ? DOJANG_URL : undefined,
      linkLabel: "Get a Dojang",
    });
  }

  if (coin.preview) {
    return (
      <Empty mark="미리보기" title="Preview coins have no comments">
        Comments open once a coin is live on GIWA.
      </Empty>
    );
  }

  const one = (comment: Comment, root: Comment) => {
    const balance = held(comment.wallet);
    const isCreator = comment.wallet === coin.creator.toLowerCase();
    const position = balance === undefined ? null : stance(Number(balance) / 1e18 / SUPPLY, bought.has(comment.wallet));
    const mine = comment.wallet === me;
    const isReply = comment.id !== root.id;
    const inset = isReply ? "pl-[26px]" : "pl-[30px]";
    return (
      <div id={`c-${comment.id}`} className={`comment ${flash === comment.id ? "comment-flash" : ""}`}>
        <div className="flex min-w-0 items-center gap-2">
          <TraderLink address={comment.wallet} name={profiles[comment.wallet]?.name} size={isReply ? 18 : 22} className="gap-2 text-sm font-semibold" />
          {isCreator ? <span className="chip h-5 shrink-0 border-gold/30 bg-gold/10 px-1.5 text-[11px] text-gold">Creator</span> : null}
          {position ? (
            <span className={`chip num h-5 shrink-0 px-1.5 text-[11px] ${position === "sold" ? "border-down/30 bg-down/10 text-down" : "border-ok/30 bg-ok/10 text-ok"}`}>{position}</span>
          ) : null}
          <span className="num ml-auto shrink-0 text-xs text-faint" title={new Date(comment.time).toLocaleString()}>
            {ago((now - comment.time) / 1000)}
          </span>
        </div>
        <p className={`mt-1.5 ${inset} text-sm leading-relaxed break-words whitespace-pre-wrap text-fg/90`}>
          {comment.to ? (
            <Link to="/u/$address" params={{ address: comment.to }} className="num mr-1 font-medium text-gold hover:underline">
              @{nameOf(profiles, comment.to)}
            </Link>
          ) : null}
          {comment.text}
        </p>
        <div className={`mt-1 ${inset} flex items-center gap-1 text-xs text-muted`}>
          <LikeButton count={view?.likes[comment.id] ?? 0} liked={liked.has(comment.id)} own={mine} onToggle={() => void toggleLike(comment)} />
          <button type="button" onClick={() => setReplying((prev) => (prev?.to.id === comment.id ? null : { thread: root.id, to: comment }))} className="comment-act" aria-expanded={replying?.to.id === comment.id}>
            <IconReply size={14} />
            Reply
          </button>
          {mine ? (
            <button type="button" disabled={pending === comment.id} onClick={() => void remove(comment)} className="comment-act hover:!text-down disabled:opacity-60">
              {pending === comment.id ? "Sign…" : "Delete"}
            </button>
          ) : null}
        </div>
      </div>
    );
  };

  const run = (entry: TradeRun) => {
    const open = openRuns.has(entry.key);
    const single = entry.trades.length === 1 ? entry.trades[0]! : null;
    if (single) {
      return (
        <li key={entry.key} className="trade-line num">
          <Link to="/u/$address" params={{ address: single.wallet }} title={single.wallet} className="flex min-w-0 items-center gap-2 hover:text-fg">
            <Blockie address={single.wallet} size={18} />
            <span className="truncate font-medium text-fg/85">{nameOf(profiles, single.wallet)}</span>
          </Link>
          <span className={`shrink-0 font-medium ${single.buy ? "text-ok" : "text-down"}`}>{single.buy ? "bought" : "sold"}</span>
          <span className="min-w-0 truncate">
            {compactCount(single.tokens)} {coin.symbol} for {ethText(single.eth)} ETH
          </span>
          <a href={`${explorer}/tx/${single.tx}`} target="_blank" rel="noreferrer" title="Transaction on the explorer" className="ml-auto flex shrink-0 items-center gap-1.5 text-faint hover:text-fg">
            {ago(now / 1000 - single.time)}
            <IconExternal size={12} />
          </a>
        </li>
      );
    }
    const mixed = entry.buys > 0 && entry.sells > 0;
    return (
      <li key={entry.key} className="border-b border-line/70 last:border-0">
        <button
          type="button"
          aria-expanded={open}
          onClick={() =>
            setOpenRuns((prev) => {
              const next = new Set(prev);
              if (!next.delete(entry.key)) next.add(entry.key);
              return next;
            })
          }
          className="trade-line num w-full !border-0 text-left hover:bg-raise/60"
        >
          <span className="flex shrink-0 items-center" aria-hidden>
            {entry.wallets.slice(0, 3).map((wallet, i) => (
              <Blockie key={wallet} address={wallet} size={18} className={`ring-2 ring-chip ${i > 0 ? "-ml-1.5" : ""}`} />
            ))}
          </span>
          {/* The split of buys and sales comes last, so it is what a narrow screen cuts short. */}
          <span className="min-w-0 truncate">
            <span className="font-medium text-fg/85">{entry.trades.length} trades</span>
            {" · "}
            {ethText(entry.eth)} ETH
            {" · "}
            {mixed ? (
              <>
                <span className="text-ok">{entry.buys} {entry.buys === 1 ? "buy" : "buys"}</span>, <span className="text-down">{entry.sells} {entry.sells === 1 ? "sale" : "sales"}</span>
              </>
            ) : (
              <span className={entry.buys > 0 ? "text-ok" : "text-down"}>{entry.buys > 0 ? "all buys" : "all sales"}</span>
            )}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-faint">
            {ago(now / 1000 - entry.time)}
            <IconChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
          </span>
        </button>
        {open ? (
          <ul className="pb-2">
            {entry.trades.slice(0, RUN_ROWS).map((t) => (
              <li key={t.key} className="num flex items-center gap-2.5 py-1.5 pr-4 pl-[42px] text-[13px] text-muted sm:pr-5 sm:pl-[46px]">
                <Link to="/u/$address" params={{ address: t.wallet }} title={t.wallet} className="flex min-w-0 flex-1 items-center gap-2 hover:text-fg">
                  <Blockie address={t.wallet} size={16} />
                  <span className="truncate text-fg/85">{nameOf(profiles, t.wallet)}</span>
                </Link>
                <span className={`shrink-0 font-medium ${t.buy ? "text-ok" : "text-down"}`}>{t.buy ? "Buy" : "Sell"}</span>
                <span className="w-28 shrink-0 text-right whitespace-nowrap text-fg/85">{ethText(t.eth)} ETH</span>
                <a href={`${explorer}/tx/${t.tx}`} target="_blank" rel="noreferrer" title="Transaction on the explorer" className="w-8 shrink-0 text-right text-faint hover:text-fg">
                  {ago(now / 1000 - t.time)}
                </a>
              </li>
            ))}
            {entry.trades.length > RUN_ROWS && onAllTrades ? (
              <li className="py-1.5 pl-[42px] text-[13px] sm:pl-[46px]">
                <button type="button" onClick={onAllTrades} className="font-semibold text-gold hover:underline">
                  See all {entry.trades.length} in Trades
                </button>
              </li>
            ) : null}
          </ul>
        ) : null}
      </li>
    );
  };

  const olderThreads = view ? view.threads - threads.length : 0;

  return (
    <>
      {view?.writable === false ? (
        <p className="border-b border-line px-5 py-3.5 text-sm text-muted">Comments aren’t switched on here yet. They need the site’s database.</p>
      ) : (
        <Composer symbol={coin.symbol} thread={thread} />
      )}
      {!view ? (
        failed ? (
          <Empty title="Comments are unavailable right now">Try again in a moment.</Empty>
        ) : (
          <div className="divide-y divide-line/70" aria-busy="true">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="px-5 py-4">
                <div className="flex items-center gap-2.5">
                  <span className="skeleton size-[22px] rounded-full" />
                  <span className="skeleton h-4 w-28" />
                </div>
                <span className="skeleton mt-2.5 ml-8 block h-4 w-2/3" />
              </div>
            ))}
          </div>
        )
      ) : timeline.length === 0 ? (
        <Empty mark="첫 마디" title="No comments yet">
          Be the first to say something about {coin.symbol}.
        </Empty>
      ) : (
        <>
          {threads.length === 0 ? (
            <p className="border-b border-line/70 px-4 py-3 text-sm text-muted sm:px-5">
              Nobody has said anything about {coin.symbol} yet. <span className="text-fg/85">Be the first.</span>
            </p>
          ) : null}
          <ul>
            {timeline.map((entry) => {
              if (entry.kind === "trades") return run(entry);
              const { root, replies } = entry.thread;
              const all = expanded.has(root.id) || replies.length <= REPLIES_SHOWN;
              const shown = all ? replies : replies.slice(-REPLIES_SHOWN);
              const box = replying?.thread === root.id ? replying : null;
              return (
                <li key={root.id} className="border-b border-line/70 px-4 py-3.5 last:border-0 sm:px-5">
                  {one(root, root)}
                  {replies.length > 0 ? (
                    <ul className="mt-3 ml-[10px] grid gap-3 border-l border-line pl-[19px]">
                      {all ? null : (
                        <li>
                          <button type="button" onClick={() => setExpanded((prev) => new Set(prev).add(root.id))} className="text-xs font-semibold text-gold hover:underline">
                            Show {replies.length - shown.length} earlier {replies.length - shown.length === 1 ? "reply" : "replies"}
                          </button>
                        </li>
                      )}
                      {shown.map((reply) => (
                        <li key={reply.id}>{one(reply, root)}</li>
                      ))}
                    </ul>
                  ) : null}
                  {box ? (
                    <div className="mt-3 ml-[10px] border-l border-line pl-[19px]">
                      <Composer symbol={coin.symbol} thread={thread} replyTo={box.to.id} replyName={nameOf(profiles, box.to.wallet)} onDone={() => setReplying(null)} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {olderThreads > 0 ? (
            <button type="button" onClick={showOlder} className="w-full border-t border-line py-3 text-sm font-medium text-muted hover:text-fg">
              Show older comments ({olderThreads} more {olderThreads === 1 ? "thread" : "threads"})
            </button>
          ) : null}
        </>
      )}
    </>
  );
}

/** The box a comment is written in. With `replyTo` it is the smaller box under a thread, answering that comment. */
function Composer({ symbol, thread, replyTo, replyName, onDone }: { symbol: string; thread: CommentThread; replyTo?: string; replyName?: string; onDone?: () => void }) {
  const { account } = useChimi();
  const { profile, checking, check } = useMyProfile();
  const [text, setText] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const clean = cleanText(text);
  const count = [...clean].length;
  const problem = clean ? checkText(clean) : null;
  const posting = thread.pending === (replyTo ? `reply:${replyTo}` : "post");
  // Known for sure to have no Dojang. While that is still being read, the server decides.
  const noDojang = !!account && profile !== null && !profile.verified;

  // An answer's box opens ready to type in.
  useEffect(() => {
    if (replyTo) field.current?.focus();
  }, [replyTo]);

  async function submit() {
    if (!clean || problem || posting || noDojang) return;
    const out = await thread.send(replyTo ? { type: "post", text: clean, replyTo } : { type: "post", text: clean });
    if (out.ok) {
      setText("");
      onDone?.();
      return;
    }
    if (out.cancelled) return;
    const needsDojang = out.error === NEED_DOJANG;
    toast({
      kind: "bad",
      title: needsDojang ? "Comments need a Dojang" : "Couldn’t post that",
      body: needsDojang ? "Only verified wallets can comment, so a thread is people talking. It’s free on GIWA." : out.error,
      href: needsDojang ? DOJANG_URL : undefined,
      linkLabel: "Get a Dojang",
    });
    if (needsDojang) void check().catch(() => undefined);
  }

  return (
    <form
      className={replyTo ? "" : "border-b border-line px-4 py-4 sm:px-5"}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex items-start gap-3">
        {replyTo ? null : account ? <Blockie address={account} size={32} /> : <span className="size-8 shrink-0 rounded-full border border-dashed border-edge" aria-hidden />}
        <div className="min-w-0 flex-1">
          <textarea
            ref={field}
            value={text}
            rows={2}
            maxLength={MAX_LENGTH * 2}
            aria-label={replyTo ? `Reply to ${replyName}` : `Comment on ${symbol}`}
            aria-invalid={!!problem}
            placeholder={replyTo ? `Reply to ${replyName}` : `What do you think of ${symbol}?`}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submit();
              }
              if (e.key === "Escape" && replyTo && !text) onDone?.();
            }}
            className={`field resize-none leading-relaxed ${replyTo ? "min-h-[3.25rem] text-sm" : "min-h-[4.25rem]"}`}
          />
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            {noDojang ? (
              <p className="text-xs leading-relaxed text-muted">
                Only wallets with a Dojang can comment.{" "}
                <a href={DOJANG_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-gold hover:underline">
                  Get one, it’s free
                  <IconExternal size={11} />
                </a>
                <button type="button" disabled={checking} onClick={() => void check().catch(() => undefined)} className="ml-2 font-medium text-fg hover:underline disabled:opacity-60">
                  {checking ? "Checking…" : "Check again"}
                </button>
              </p>
            ) : problem ? (
              <p role="alert" className="text-xs text-down">
                {problem}
              </p>
            ) : (
              <p className="text-xs text-faint">{replyTo ? "Signed with your wallet, no gas." : "Signed with your wallet, no gas. Text only, no links."}</p>
            )}
            <div className="ml-auto flex items-center gap-2.5">
              {count > 0 ? <span className={`num text-xs ${count > MAX_LENGTH ? "text-down" : "text-faint"}`}>{`${count}/${MAX_LENGTH}`}</span> : null}
              {replyTo ? (
                <button type="button" onClick={onDone} className="btn btn-sm btn-ghost">
                  Cancel
                </button>
              ) : null}
              <button type="submit" disabled={!clean || !!problem || posting || noDojang} className="btn btn-sm btn-light">
                {posting ? "Sign in your wallet…" : !account ? "Connect to post" : replyTo ? "Reply" : "Post"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}
