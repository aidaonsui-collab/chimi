import { useEffect, useId, useMemo, useRef, useState } from "react";
import { MAX_LENGTH, NEED_DOJANG, checkText, cleanText } from "@/lib/chimi/comment-rules";
import { usePostToCoin } from "@/lib/chimi/comments";
import { notePosted } from "@/lib/chimi/feed";
import { compactUsd, ethText } from "@/lib/chimi/format";
import { DOJANG_URL } from "@/lib/chimi/identity";
import type { CoinStats } from "@/lib/chimi/live";
import type { Coin } from "@/lib/chimi/market";
import { mentionedCoin, searchCoins } from "@/lib/chimi/post-rules";
import { useMyProfile } from "@/lib/chimi/rewards";
import { IconChevronDown, IconExternal, IconPlus, IconSearch } from "@/components/chimi/icons";
import { useChimi } from "@/components/chimi/provider";
import { toast } from "@/components/chimi/toast";
import { TokenLogo } from "@/components/chimi/token-logo";
import { Blockie } from "@/components/chimi/ui";

/**
 * The box at the top of the feed. A post is a comment on one coin: it goes on that coin's page with the rest of its
 * comments, and into the feed with the coin under it. The coin is the one picked, or else the first one the text names
 * with a $. Like any comment it is signed with the wallet (no gas), and only wallets with a Dojang can post.
 */
export function PostBox({ coins, images, stats, ethUsd }: { coins: Coin[]; images: Record<string, string | undefined>; stats: Record<string, CoinStats>; ethUsd?: number }) {
  const { account } = useChimi();
  const { profile, checking, check } = useMyProfile();
  const { post, pending } = usePostToCoin();
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);

  // Biggest first: the picker's order, and which coin wins when two share a $symbol.
  const ordered = useMemo(() => [...coins].sort((a, b) => (stats[b.token.toLowerCase()]?.capEth ?? 0) - (stats[a.token.toLowerCase()]?.capEth ?? 0)), [coins, stats]);
  const clean = cleanText(text);
  const count = [...clean].length;
  const problem = clean ? checkText(clean) : null;
  const chosen = picked ? ordered.find((c) => c.token.toLowerCase() === picked) : undefined;
  const named = useMemo(() => (chosen ? undefined : mentionedCoin(clean, ordered)), [chosen, clean, ordered]);
  const coin = chosen ?? named;
  // Known for sure to have no Dojang. While that is still being read, the server decides.
  const noDojang = !!account && profile !== null && !profile.verified;
  const cap = (c: Coin) => {
    const eth = stats[c.token.toLowerCase()]?.capEth;
    if (!eth) return "";
    return ethUsd ? compactUsd(eth * ethUsd) : `${ethText(eth)} ETH`;
  };

  async function submit() {
    if (!clean || problem || pending || noDojang) return;
    if (!coin) {
      setPicking(true);
      return;
    }
    const out = await post(coin.token, clean);
    if (out.ok) {
      // The next post starts clean: its coin comes from its own $ or a new pick, never this one's by surprise.
      setText("");
      setPicked(null);
      if (out.comment) {
        const c = out.comment;
        notePosted({ id: c.id, token: coin.token.toLowerCase(), wallet: c.wallet, text: c.text, time: Math.floor(c.time / 1000), likes: 0, liked: false, replies: 0 });
      }
      toast({ kind: "good", title: `Posted on $${coin.symbol}`, body: "It’s in the feed and on the coin’s page." });
      return;
    }
    if (out.cancelled) return;
    const needsDojang = out.error === NEED_DOJANG;
    toast({
      kind: "bad",
      title: needsDojang ? "Posts need a Dojang" : "Couldn’t post that",
      body: needsDojang ? "Only verified wallets can post, so the feed is people talking. It’s free on GIWA." : out.error,
      href: needsDojang ? DOJANG_URL : undefined,
      linkLabel: "Get a Dojang",
    });
    if (needsDojang) void check().catch(() => undefined);
  }

  return (
    <form
      className="post-box"
      aria-label="Write a post"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {account ? <Blockie address={account} size={36} /> : <span className="size-9 shrink-0 rounded-full border border-dashed border-edge" aria-hidden />}
      <div className="min-w-0 flex-1">
        <textarea
          ref={field}
          value={text}
          rows={2}
          maxLength={MAX_LENGTH * 2}
          aria-label="Your post"
          aria-invalid={!!problem}
          placeholder="What are you buying, and why? Name a coin with $"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
          }}
          className="field pbox-field resize-none leading-relaxed"
        />
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
          <CoinPicker
            coins={ordered}
            images={images}
            value={coin}
            fromText={!chosen && !!named}
            open={picking}
            setOpen={setPicking}
            cap={cap}
            onPick={(c) => {
              setPicked(c.token.toLowerCase());
              field.current?.focus();
            }}
          />
          <p className="pbox-hint min-w-0 flex-1 text-xs leading-relaxed">
            {noDojang ? (
              <span className="text-muted">
                Only wallets with a Dojang can post.{" "}
                <a href={DOJANG_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-gold hover:underline">
                  Get one on GIWA
                  <IconExternal size={11} />
                </a>
                <button type="button" disabled={checking} onClick={() => void check().catch(() => undefined)} className="ml-2 font-medium text-fg hover:underline disabled:opacity-60">
                  {checking ? "Checking…" : "Check again"}
                </button>
              </span>
            ) : problem ? (
              <span role="alert" className="text-down">
                {problem}
              </span>
            ) : coin ? (
              <span className="text-faint">{`Goes on $${coin.symbol}’s page too. Signed with your wallet, no gas.`}</span>
            ) : clean ? (
              <span className="text-muted">Pick the coin it’s about, or name it with $</span>
            ) : (
              <span className="text-faint">Signed with your wallet, no gas. Text only, no links.</span>
            )}
          </p>
          <div className="ml-auto flex items-center gap-2.5">
            {count > 0 ? <span className={`num text-xs ${count > MAX_LENGTH ? "text-down" : "text-faint"}`}>{`${count}/${MAX_LENGTH}`}</span> : null}
            <button type="submit" disabled={!clean || !!problem || pending || noDojang} className="btn btn-sm btn-light">
              {pending ? "Sign in your wallet…" : !account ? "Connect to post" : "Post"}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}

/**
 * The coin a post is about: a chip that opens a list to search and pick from. The search field leads the list as a
 * combobox, so arrows move through the coins, Enter picks one and Escape closes it.
 */
function CoinPicker({
  coins,
  images,
  value,
  fromText,
  open,
  setOpen,
  cap,
  onPick,
}: {
  coins: Coin[];
  images: Record<string, string | undefined>;
  value?: Coin;
  fromText: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  cap: (coin: Coin) => string;
  onPick: (coin: Coin) => void;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const chip = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const found = useMemo(() => searchCoins(query, coins).slice(0, 40), [query, coins]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [open, setOpen]);
  useEffect(() => setActive(0), [query]);
  // The highlighted coin stays in view as the arrows move through a long list.
  useEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);

  const pick = (coin: Coin) => {
    onPick(coin);
    setOpen(false);
  };

  return (
    <div ref={box} className="pbox-anchor">
      <button
        ref={chip}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={fromText ? "Picked from the $ in your post" : undefined}
        onClick={() => setOpen(!open)}
        className={`pbox-coin ${value ? "" : "pbox-coin-empty"}`}
      >
        {value ? (
          <>
            <TokenLogo symbol={value.symbol} image={images[value.token.toLowerCase()]} size={20} ring={false} />
            <span className="max-w-[9rem] truncate">${value.symbol}</span>
          </>
        ) : (
          <>
            <IconPlus size={14} />
            Pick a coin
          </>
        )}
        <IconChevronDown size={14} className="text-faint" />
      </button>
      {open ? (
        <div className="pbox-pick animate-pop">
          <label className="pbox-search">
            <IconSearch size={15} className="shrink-0 text-faint" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search coins"
              role="combobox"
              aria-label="Search coins"
              aria-expanded
              aria-controls={`${id}-list`}
              aria-activedescendant={found[active] ? `${id}-${active}` : undefined}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  if (found.length > 0) setActive((i) => (i + (e.key === "ArrowDown" ? 1 : found.length - 1)) % found.length);
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  if (found[active]) pick(found[active]);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setOpen(false);
                  chip.current?.focus();
                }
              }}
              className="min-w-0 flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-faint"
            />
          </label>
          <ul id={`${id}-list`} role="listbox" aria-label="Coins" className="pbox-list">
            {found.map((c, i) => (
              <li
                key={c.token}
                id={`${id}-${i}`}
                role="option"
                aria-selected={value?.token === c.token}
                data-active={i === active ? "" : undefined}
                onPointerMove={() => setActive(i)}
                onClick={() => pick(c)}
                className="pbox-row"
              >
                <TokenLogo symbol={c.symbol} image={images[c.token.toLowerCase()]} size={30} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold text-fg">${c.symbol}</span>
                  <span className="block truncate text-[12px] text-muted">{c.name}</span>
                </span>
                <span className="num shrink-0 text-[12px] text-muted">{cap(c)}</span>
              </li>
            ))}
            {found.length === 0 ? <li className="px-3 py-4 text-sm text-muted">No coin by that name on Chimi</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
