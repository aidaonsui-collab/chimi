import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { erc20Abi } from "@/lib/chimi/chain";
import { publicClient } from "@/lib/chimi/client";
import { MAX_LENGTH, NEED_DOJANG, checkText, cleanText, stance, type Comment } from "@/lib/chimi/comment-rules";
import type { CommentThread } from "@/lib/chimi/comments";
import { ago } from "@/lib/chimi/format";
import { DOJANG_URL } from "@/lib/chimi/identity";
import { SUPPLY } from "@/lib/chimi/live";
import type { Coin, Holder, PoolSwap } from "@/lib/chimi/market";
import { useMyProfile, usePoints, useProfiles } from "@/lib/chimi/rewards";
import { IconExternal } from "@/components/chimi/icons";
import { useChimi } from "@/components/chimi/provider";
import { toast } from "@/components/chimi/toast";
import { Blockie, Empty, TraderLink } from "@/components/chimi/ui";

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

/** A coin's comments: the box to write one, then the thread, newest first. */
export function Comments({ coin, thread, holders, swaps }: { coin: Coin; thread: CommentThread; holders: Holder[] | undefined; swaps: PoolSwap[] | undefined }) {
  const { account } = useChimi();
  const { data: points } = usePoints();
  const { view, failed, pending, send, showOlder } = thread;
  const items = view?.items ?? [];
  const wallets = useMemo(() => [...new Set(items.map((c) => c.wallet))], [items]);
  const profiles = useProfiles(wallets, points?.file.profiles);
  const held = useHeld(coin.token, wallets, holders);
  // Who has ever bought: the trade record, plus the buys this page has read itself (the record runs minutes behind).
  const bought = useMemo(() => {
    const set = new Set(view?.bought ?? []);
    for (const s of swaps ?? []) if (s.buy) set.add(s.recipient.toLowerCase());
    return set;
  }, [view?.bought, swaps]);
  const me = account?.toLowerCase();
  const now = Date.now();

  async function remove(comment: Comment) {
    const out = await send({ type: "delete", id: comment.id });
    if (out.ok) toast({ kind: "good", title: "Comment deleted" });
    else if (!out.cancelled) toast({ kind: "bad", title: "Couldn’t delete that", body: out.error });
  }

  if (coin.preview) {
    return (
      <Empty mark="미리보기" title="Preview coins have no comments">
        Comments open once a coin is live on GIWA.
      </Empty>
    );
  }

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
      ) : items.length === 0 ? (
        <Empty mark="첫 마디" title="No comments yet">
          Be the first to say something about {coin.symbol}.
        </Empty>
      ) : (
        <>
          <ul>
            {items.map((comment) => {
              const balance = held(comment.wallet);
              const isCreator = comment.wallet === coin.creator.toLowerCase();
              const position = balance === undefined ? null : stance(Number(balance) / 1e18 / SUPPLY, bought.has(comment.wallet));
              const mine = comment.wallet === me;
              return (
                <li key={comment.id} className="border-b border-line/70 px-4 py-3.5 last:border-0 sm:px-5">
                  <div className="flex min-w-0 items-center gap-2">
                    <TraderLink address={comment.wallet} name={profiles[comment.wallet]?.name} size={22} className="gap-2 text-sm font-semibold" />
                    {isCreator ? <span className="chip h-5 shrink-0 border-gold/30 bg-gold/10 px-1.5 text-[11px] text-gold">Creator</span> : null}
                    {position ? (
                      <span className={`chip num h-5 shrink-0 px-1.5 text-[11px] ${position === "sold" ? "border-down/30 bg-down/10 text-down" : "border-ok/30 bg-ok/10 text-ok"}`}>{position}</span>
                    ) : null}
                    <span className="num ml-auto shrink-0 text-xs text-faint" title={new Date(comment.time).toLocaleString()}>
                      {ago((now - comment.time) / 1000)}
                    </span>
                    {mine ? (
                      <button type="button" disabled={pending === comment.id} onClick={() => void remove(comment)} className="shrink-0 text-xs font-medium text-faint transition-colors hover:text-down disabled:opacity-60">
                        {pending === comment.id ? "Sign…" : "Delete"}
                      </button>
                    ) : null}
                  </div>
                  <p className="mt-1.5 pl-[30px] text-sm leading-relaxed break-words whitespace-pre-wrap text-fg/90">{comment.text}</p>
                </li>
              );
            })}
          </ul>
          {view.total > items.length ? (
            <button type="button" onClick={showOlder} className="w-full border-t border-line py-3 text-sm font-medium text-muted hover:text-fg">
              Show older comments ({view.total - items.length} more)
            </button>
          ) : null}
        </>
      )}
    </>
  );
}

function Composer({ symbol, thread }: { symbol: string; thread: CommentThread }) {
  const { account } = useChimi();
  const { profile, checking, check } = useMyProfile();
  const [text, setText] = useState("");
  const clean = cleanText(text);
  const count = [...clean].length;
  const problem = clean ? checkText(clean) : null;
  const posting = thread.pending === "post";
  // Known for sure to have no Dojang. While that is still being read, the server decides.
  const noDojang = !!account && profile !== null && !profile.verified;

  async function submit() {
    if (!clean || problem || posting || noDojang) return;
    const out = await thread.send({ type: "post", text: clean });
    if (out.ok) {
      setText("");
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
      className="border-b border-line px-4 py-4 sm:px-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex items-start gap-3">
        {account ? <Blockie address={account} size={32} /> : <span className="size-8 shrink-0 rounded-full border border-dashed border-edge" aria-hidden />}
        <div className="min-w-0 flex-1">
          <textarea
            value={text}
            rows={2}
            maxLength={MAX_LENGTH * 2}
            aria-label={`Comment on ${symbol}`}
            aria-invalid={!!problem}
            placeholder={`What do you think of ${symbol}?`}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submit();
              }
            }}
            className="field min-h-[4.25rem] resize-none leading-relaxed"
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
              <p className="text-xs text-faint">Signed with your wallet, no gas. Text only, no links.</p>
            )}
            <div className="ml-auto flex items-center gap-3">
              {count > 0 ? <span className={`num text-xs ${count > MAX_LENGTH ? "text-down" : "text-faint"}`}>{`${count}/${MAX_LENGTH}`}</span> : null}
              <button type="submit" disabled={!clean || !!problem || posting || noDojang} className="btn btn-sm btn-light">
                {posting ? "Sign in your wallet…" : account ? "Post" : "Connect to post"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}
