import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { formatEther, parseEther, type Address } from "viem";
import { POOL_FEE, erc20Abi, giwaSepolia } from "@/lib/chimi/chain";
import { publicClient } from "@/lib/chimi/client";
import { ago, amountText, compactCount, ethText, money, tokenUsd } from "@/lib/chimi/format";
import { SUPPLY, coinStats, fetchSwaps, openingCap, useEthUsd } from "@/lib/chimi/live";
import { estimatedOut, feeLabel, loadCoin, loadHolders, short, shortAddr, wethPerToken, type Coin, type Holder, type PoolSwap } from "@/lib/chimi/market";
import { saveTokenMeta, shrinkImage } from "@/lib/chimi/meta";
import { publishTokenProfile, refreshTokenProfiles, sharedStorageEnabled, useTokenProfile } from "@/lib/chimi/token-image";
import { AreaChart, type ChartPoint } from "@/components/chimi/charts";
import {
  IconArrowDown,
  IconChevronRight,
  IconExternal,
  IconGlobe,
  IconImage,
  IconLock,
  IconSliders,
  IconTelegram,
  IconX,
} from "@/components/chimi/icons";
import { useChimi } from "@/components/chimi/provider";
import { Comments } from "@/components/chimi/comments";
import { useComments } from "@/lib/chimi/comments";
import { CopyNotice, copySize } from "@/components/chimi/copy";
import { toast } from "@/components/chimi/toast";
import { EthLogo, TokenLogo } from "@/components/chimi/token-logo";
import { Blockie, Change, CopyButton, Empty, Modal, Note, Seg, TraderLink } from "@/components/chimi/ui";

export const Route = createFileRoute("/coin/$address")({
  // ?copy=<wallet>&eth=<their size> opens the page ready to copy that wallet's buy (the Copy button in the feed).
  validateSearch: (search: Record<string, unknown>): { copy?: string; eth?: number } => ({
    copy: typeof search.copy === "string" && /^0x[0-9a-fA-F]{40}$/.test(search.copy) ? search.copy.toLowerCase() : undefined,
    eth: Number.isFinite(Number(search.eth)) && Number(search.eth) > 0 ? Number(search.eth) : undefined,
  }),
  component: CoinPage,
});

const SLIPPAGE = [100, 200, 500];
const RANGES = [
  ["1H", 60 * 60],
  ["6H", 6 * 60 * 60],
  ["1D", 24 * 60 * 60],
  ["ALL", 0],
] as const;
type Range = (typeof RANGES)[number][0];

/** Left in the wallet when buying with everything, so the swap can still pay for gas. */
const GAS_RESERVE = 200_000_000_000_000n;

function tinyEth(wei: bigint) {
  const s = formatEther(wei);
  const hit = s.search(/[1-9]/);
  if (hit < 0) return "0";
  return s.slice(0, Math.min(s.length, hit + 4));
}

function CoinPage() {
  const { address } = Route.useParams();
  const search = Route.useSearch();
  const { coins, deployment, account, connect, trade, unwrap, signMessage, loading } = useChimi();
  /** The wallet whose buy is being copied, until it is dismissed or the page moves on. */
  const [copying, setCopying] = useState<string | undefined>(search.copy);
  const listed = coins.find((c) => c.token.toLowerCase() === address.toLowerCase());
  const [coin, setCoin] = useState<Coin | null>(listed ?? null);
  const [phase, setPhase] = useState<"loading" | "ready" | "missing">(listed ? "ready" : "loading");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(200);
  const [adjust, setAdjust] = useState(false);
  const [tradeNote, setTradeNote] = useState("");
  const [kind, setKind] = useState<"" | "bad" | "good">("");
  const [busy, setBusy] = useState(false);
  const meta = useTokenProfile(address);
  const [editing, setEditing] = useState(false);
  const ethUsd = useEthUsd();
  const [payBal, setPayBal] = useState<bigint>();
  const [wethBal, setWethBal] = useState<bigint>();
  const [poolEth, setPoolEth] = useState<bigint>();
  const [swaps, setSwaps] = useState<PoolSwap[]>();
  const [holders, setHolders] = useState<Holder[]>();
  const [range, setRange] = useState<Range>("ALL");
  const [panel, setPanel] = useState<"trades" | "holders" | "comments">("trades");
  const thread = useComments(coin && !coin.preview ? coin.token : undefined);
  const [shown, setShown] = useState(25);
  const [hover, setHover] = useState<ChartPoint | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (listed) {
      setCoin(listed);
      setPhase("ready");
      return;
    }
    if (!deployment || loading) return;
    let cancel = false;
    setPhase("loading");
    void loadCoin(deployment, address as Address)
      .then((found) => {
        if (cancel) return;
        setCoin(found);
        setPhase(found ? "ready" : "missing");
      })
      .catch(() => {
        if (!cancel) setPhase("missing");
      });
    return () => {
      cancel = true;
    };
  }, [address, deployment, listed, loading]);

  const tradable = !!coin && !coin.preview;

  // Opened from a Copy button: start on the buy side with this browser's usual copy size, ready to confirm.
  useEffect(() => {
    setCopying(search.copy);
    if (!search.copy) return;
    setSide("buy");
    setAmount(copySize());
    setTradeNote("");
  }, [search.copy, address]);

  // The tab's title follows the coin, so several coins open at once can be told apart.
  useEffect(() => {
    if (!coin) return;
    const before = document.title;
    document.title = `${coin.name} ($${coin.symbol}) · Chimi`;
    return () => {
      document.title = before;
    };
  }, [coin?.name, coin?.symbol]);

  // The wallet's balance of whatever it would pay with, and any wrapped ETH left over from selling.
  useEffect(() => {
    if (!coin || !deployment || !account || coin.preview) {
      setPayBal(undefined);
      setWethBal(undefined);
      return;
    }
    let cancel = false;
    setPayBal(undefined);
    const read =
      side === "buy"
        ? publicClient.getBalance({ address: account })
        : publicClient.readContract({ address: coin.token, abi: erc20Abi, functionName: "balanceOf", args: [account] });
    void read
      .then((wei) => {
        if (!cancel) setPayBal(wei);
      })
      .catch(() => undefined);
    void publicClient
      .readContract({ address: deployment.weth, abi: erc20Abi, functionName: "balanceOf", args: [account] })
      .then((wei) => {
        if (!cancel) setWethBal(wei);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [account, coin, deployment, side, reload]);

  useEffect(() => {
    if (!coin || !deployment || coin.preview) {
      if (coin?.preview) {
        setSwaps([]);
        setHolders([]);
      }
      return;
    }
    let cancel = false;
    void publicClient
      .readContract({ address: deployment.weth, abi: erc20Abi, functionName: "balanceOf", args: [coin.pool] })
      .then((wei) => {
        if (!cancel) setPoolEth(wei);
      })
      .catch(() => undefined);
    void fetchSwaps(coin, reload > 0)
      .then(async (rows) => {
        if (cancel) return;
        setSwaps(rows);
        const found = await loadHolders(coin.token, coin.pool, [coin.creator, ...rows.map((row) => row.recipient)]);
        if (!cancel) setHolders(found);
      })
      .catch(() => {
        if (!cancel) {
          setSwaps((prev) => prev ?? []);
          setHolders((prev) => prev ?? []);
        }
      });
    return () => {
      cancel = true;
    };
    // Reads again when the pool or its price changes, and after each trade made here.
  }, [coin?.pool, coin?.sqrtPriceX96, deployment, reload]);

  const explorer = giwaSepolia.blockExplorers.default.url;
  const price = coin ? wethPerToken(coin.sqrtPriceX96, coin.tokenIs0) : 0n;
  const priceEth = Number(price) / 1e18;
  const capEth = priceEth * SUPPLY;
  const now = Math.floor(Date.now() / 1000);

  const market = useMemo(() => {
    const list = swaps ?? [];
    const is0 = coin?.tokenIs0 ?? true;
    const capOf = (sqrt: bigint) => (Number(wethPerToken(sqrt, is0)) / 1e18) * SUPPLY;
    const priced = list.filter((s) => s.sqrtPriceX96 > 0n);
    const windowSec = RANGES.find((item) => item[0] === range)?.[1] ?? 0;
    const from = windowSec === 0 ? (priced[0]?.time ?? now - 3600) : now - windowSec;
    const inside = priced.filter((s) => s.time >= from);
    const points: ChartPoint[] = [];
    // The cap the window opened at: where the trade before it left the price, or what its first trade started from.
    const opened = coin ? openingCap(list, coin, from) : undefined;
    if (opened !== undefined) points.push({ t: inside.length && windowSec === 0 ? Math.max(from - 60, inside[0]!.time - 60) : from, v: opened });
    for (const s of inside) points.push({ t: s.time, v: capOf(s.sqrtPriceX96) });
    if (points.length === 0) points.push({ t: from, v: capEth });
    points.push({ t: now, v: capEth });
    const first = points[0]!.v;
    const day = list.filter((s) => now - s.time <= 86_400);
    return {
      points,
      from: Math.min(from, points[0]!.t),
      change: first > 0 && inside.length > 0 ? ((capEth - first) / first) * 100 : undefined,
      volEth: day.reduce((sum, s) => sum + Number(s.ethAmount) / 1e18, 0),
      trades: day.length,
      athEth: Math.max(capEth, ...priced.map((s) => capOf(s.sqrtPriceX96))),
    };
    // `now` moves every render; the numbers only need to follow the trades, the range and the price.
  }, [swaps, range, capEth, coin?.tokenIs0]);

  let parsed = 0n;
  let badAmount = false;
  try {
    parsed = amount.trim() ? parseEther(amount.trim()) : 0n;
  } catch {
    badAmount = true;
  }
  const quote = coin && !badAmount ? estimatedOut(parsed, price, side === "buy") : 0n;
  const minOut = (quote * BigInt(10_000 - slippageBps)) / 10_000n;
  const short_ = account && payBal !== undefined && parsed > payBal;

  async function go() {
    if (!coin) return;
    if (!amount.trim() || badAmount || parsed === 0n) {
      setKind("bad");
      setTradeNote("Enter an amount.");
      return;
    }
    if (!account) {
      try {
        await connect();
      } catch (err) {
        setKind("bad");
        setTradeNote(short(err));
      }
      return;
    }
    try {
      setBusy(true);
      setKind("");
      setTradeNote(side === "sell" ? "Approve, then confirm the sale in your wallet." : "Confirm in your wallet.");
      const hash = await trade(coin, side, amount.trim(), minOut);
      setKind("good");
      setTradeNote(side === "buy" ? "Bought." : "Sold for wrapped ETH.");
      toast({
        kind: "good",
        title: side === "buy" ? `Bought ${coin.symbol}` : `Sold ${coin.symbol}`,
        body: side === "buy" ? `${amount.trim()} ETH in.${copying ? ` Copied from ${shortAddr(copying)}.` : ""}` : "You received wrapped ETH. Unwrap it below the trade button.",
        href: `${explorer}/tx/${hash}`,
      });
      if (side === "buy") setCopying(undefined);
      setAmount("");
      const fresh = deployment ? await loadCoin(deployment, coin.token) : null;
      if (fresh) setCoin(fresh);
      setReload((n) => n + 1);
    } catch (err) {
      setKind("bad");
      setTradeNote(short(err));
    } finally {
      setBusy(false);
    }
  }

  async function doUnwrap() {
    try {
      setBusy(true);
      setKind("");
      setTradeNote("Confirm the unwrap in your wallet.");
      const hash = await unwrap();
      setKind("good");
      setTradeNote("Unwrapped.");
      toast({ kind: "good", title: "Unwrapped to ETH", href: `${explorer}/tx/${hash}` });
      setReload((n) => n + 1);
    } catch (err) {
      setKind("bad");
      setTradeNote(short(err));
    } finally {
      setBusy(false);
    }
  }

  if (!coin) {
    return (
      <main className="page pt-2 pb-16">
        {phase === "missing" ? (
          <div className="card mt-6">
            <Empty
              mark="없음"
              title="This coin isn’t on Chimi’s factory"
              action={
                <Link to="/" className="btn btn-secondary">
                  Back to the board
                </Link>
              }
            >
              <span className="num">{shortAddr(address)}</span> wasn’t launched here, so there is no pool to show.
            </Empty>
          </div>
        ) : (
          <div className="space-y-5" aria-busy>
            <span className="skeleton h-[280px] w-full rounded-2xl" />
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
              <span className="skeleton h-[420px] rounded-2xl" />
              <span className="skeleton h-[420px] rounded-2xl" />
            </div>
          </div>
        )}
      </main>
    );
  }

  const paySymbol = side === "buy" ? "ETH" : coin.symbol;
  const recvSymbol = side === "buy" ? coin.symbol : "ETH";
  const coinLogo = (size: number) => <TokenLogo symbol={coin.symbol} image={meta?.image} size={size} />;
  const isCreator = Boolean(account && coin.creator && account.toLowerCase() === coin.creator.toLowerCase() && !coin.preview);
  const cash = (eth: number | undefined) => (eth === undefined ? "—" : ethUsd ? money(eth * ethUsd) : `${ethText(eth)} ETH`);
  const liqEth = poolEth === undefined ? undefined : Number(poolEth) / 1e18;
  const headline = hover ? hover.v : capEth;
  const tone = market.change === undefined || Math.abs(market.change) < 0.005 ? "gold" : market.change > 0 ? "up" : "down";
  const list = swaps ? [...swaps].reverse() : [];
  const supplyWei = BigInt(SUPPLY) * 10n ** 18n;

  return (
    <main className="page pt-2 pb-16">
      <nav className="flex items-center gap-1.5 text-sm text-muted" aria-label="Breadcrumb">
        <Link to="/" className="hover:text-fg">
          Board
        </Link>
        <IconChevronRight size={13} className="text-faint" />
        <span className="truncate text-fg">{coin.name}</span>
      </nav>

      <header className="card relative mt-3 overflow-hidden">
        <div className="relative h-[112px] overflow-hidden sm:h-[152px]">
          <img src="/banner-960.webp" alt="" decoding="async" className="absolute inset-0 size-full object-cover object-[center_40%]" />
          {meta?.image ? <img src={meta.image} alt="" referrerPolicy="no-referrer" className="absolute inset-0 size-full scale-125 object-cover opacity-55 blur-3xl saturate-150" /> : null}
          <div className="absolute inset-0 bg-gradient-to-t from-chip via-chip/35 to-transparent" />
        </div>
        <div className="relative px-4 pb-5 sm:px-7 sm:pb-6">
          <div className="-mt-11 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 sm:-mt-12">
            <div className="flex min-w-0 items-end gap-4">
              <span className="rounded-[20px] bg-chip p-1">
                <TokenLogo symbol={coin.symbol} image={meta?.image} size={88} shape="rounded" />
              </span>
              <div className="min-w-0 pb-1">
                <h1 className="truncate text-[28px] leading-tight font-semibold tracking-[-0.03em] sm:text-[34px]">{coin.name}</h1>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span className="chip text-fg">${coin.symbol}</span>
                  {coin.preview ? (
                    <span className="chip border-gold/30 bg-gold/10 text-gold">Preview</span>
                  ) : (
                    <span className="chip" title="The launch liquidity is locked for 100 years">
                      <IconLock size={12} />
                      Locked pool
                    </span>
                  )}
                  <Link to="/u/$address" params={{ address: coin.creator }} className="chip hover:text-fg" title="The wallet that launched this coin">
                    <Blockie address={coin.creator} size={14} />
                    <span className="num">{shortAddr(coin.creator)}</span>
                  </Link>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="chip h-9 gap-1 rounded-xl pr-1 pl-3">
                <span className="num text-[13px]">{shortAddr(coin.token)}</span>
                <CopyButton text={coin.token} label="Copy contract address" className="btn btn-icon btn-sm btn-ghost size-7" size={14} />
              </span>
              <IconLink href={`${explorer}/address/${coin.token}`} label="Contract on the explorer">
                <IconExternal size={16} />
              </IconLink>
              {meta?.twitter ? (
                <IconLink href={`https://x.com/${meta.twitter}`} label="X">
                  <IconX size={15} />
                </IconLink>
              ) : null}
              {meta?.telegram ? (
                <IconLink href={`https://t.me/${meta.telegram}`} label="Telegram">
                  <IconTelegram size={16} />
                </IconLink>
              ) : null}
              {meta?.website ? (
                <IconLink href={meta.website} label="Website">
                  <IconGlobe size={16} />
                </IconLink>
              ) : null}
              <CopyButton text={typeof window === "undefined" ? "" : window.location.href} label="Copy link to this coin" className="btn btn-icon btn-sm btn-secondary size-9 rounded-xl" size={16} />
              {isCreator ? (
                <button type="button" onClick={() => setEditing(true)} className="btn btn-sm h-9 rounded-xl border-gold/35 bg-gold/10 text-gold hover:bg-gold/15">
                  <IconImage size={15} />
                  {meta?.shared ? "Edit profile" : "Set picture"}
                </button>
              ) : null}
            </div>
          </div>

          {meta?.description ? <p className="mt-4 max-w-3xl text-[15px] leading-relaxed text-muted">{meta.description}</p> : null}

          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-5 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Market cap" value={cash(capEth)} />
            <Stat label="Price" value={ethUsd ? tokenUsd(priceEth * ethUsd) : `${tinyEth(price)} ETH`} />
            <Stat label="24h" value={<Change value={swaps ? coinStats(coin, swaps, now).change : undefined} />} wait={!swaps} />
            <Stat label="24h volume" value={cash(market.volEth)} wait={!swaps} />
            <Stat label="Liquidity" value={coin.preview ? "—" : cash(liqEth)} wait={!coin.preview && liqEth === undefined} />
            <Stat label="Holders" value={holders ? holders.length.toLocaleString("en-US") : "—"} wait={!holders} />
          </dl>
        </div>
      </header>

      <div className="mt-5 grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="card min-w-0 p-4 sm:p-6 lg:col-start-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[13px] text-muted">Market cap</p>
              <p className="num mt-1 text-[34px] leading-none font-semibold tracking-[-0.035em] sm:text-[40px]">{cash(headline)}</p>
              <p className="mt-2 flex items-center gap-2 text-sm">
                {hover ? (
                  <span className="num text-muted">{new Date(hover.t * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                ) : (
                  <>
                    <Change value={market.change} className="font-medium" />
                    <span className="text-muted">{range === "ALL" ? "since the first trade we can read" : `past ${range === "1H" ? "hour" : range === "6H" ? "6 hours" : "day"}`}</span>
                  </>
                )}
              </p>
            </div>
            <Seg label="Chart range" value={range} onChange={setRange} options={RANGES.map(([label]) => [label, label] as const)} />
          </div>
          <div className="mt-5">
            {swaps ? (
              <AreaChart points={market.points} from={market.from} to={now} format={(v) => cash(v)} tone={tone} height={280} onHover={setHover} />
            ) : (
              <span className="skeleton h-[304px] w-full rounded-xl" />
            )}
          </div>
        </section>

        <aside className="grid min-w-0 grid-cols-1 gap-5 lg:sticky lg:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <section className="card p-3 shadow-[0_30px_60px_-30px_rgba(0,0,0,.8)]">
            <div className="flex items-center gap-2">
              <div className="grid flex-1 grid-cols-2 gap-1 rounded-xl bg-bg p-1">
                {(["buy", "sell"] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={side === key}
                    onClick={() => {
                      setSide(key);
                      setAmount("");
                      setTradeNote("");
                    }}
                    className={`h-9 rounded-lg text-sm font-semibold capitalize transition-colors ${
                      side === key ? (key === "buy" ? "bg-ok/15 text-ok" : "bg-down/15 text-down") : "text-muted hover:text-fg"
                    }`}
                  >
                    {key}
                  </button>
                ))}
              </div>
              <button type="button" aria-expanded={adjust} aria-label="Slippage" onClick={() => setAdjust((v) => !v)} className={`btn btn-secondary h-11 gap-1.5 px-3 ${adjust ? "border-edge bg-raise2" : ""}`}>
                <IconSliders size={16} />
                <span className="num text-[13px]">{slippageBps / 100}%</span>
              </button>
            </div>
            {adjust ? (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-bg px-3.5 py-3">
                <span className="text-sm text-muted">Max slippage</span>
                <div className="flex gap-1.5">
                  {SLIPPAGE.map((bps) => (
                    <button
                      key={bps}
                      type="button"
                      aria-pressed={slippageBps === bps}
                      onClick={() => setSlippageBps(bps)}
                      className={`num h-8 rounded-lg border px-3 text-[13px] font-medium ${slippageBps === bps ? "border-fg bg-fg text-bg" : "border-line text-muted hover:text-fg"}`}
                    >
                      {bps / 100}%
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {copying && side === "buy" && tradable ? (
              <CopyNotice leader={copying} theirEth={search.copy === copying ? search.eth : undefined} symbol={coin.symbol} amount={amount} onAmount={setAmount} onDismiss={() => setCopying(undefined)} />
            ) : null}

            <div className="relative mt-2 flex flex-col gap-1">
              <TradeField
                label={side === "buy" ? "You pay" : "You sell"}
                symbol={paySymbol}
                logo={side === "buy" ? <EthLogo size={24} /> : coinLogo(24)}
                value={amount}
                onChange={setAmount}
                balance={payBal}
                onBalance={payBal !== undefined ? () => setAmount(formatEther(side === "buy" ? (payBal > GAS_RESERVE ? payBal - GAS_RESERVE : 0n) : payBal)) : undefined}
                usd={ethUsd && parsed > 0n ? money((Number(parsed) / 1e18) * (side === "buy" ? 1 : priceEth) * ethUsd) : undefined}
                bad={!!short_}
              />
              <button
                type="button"
                aria-label="Flip direction"
                onClick={() => {
                  setSide((v) => (v === "buy" ? "sell" : "buy"));
                  setAmount("");
                  setTradeNote("");
                }}
                className="absolute top-1/2 left-1/2 z-10 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-xl border-[3px] border-chip bg-raise2 text-fg transition-transform hover:rotate-180"
              >
                <IconArrowDown size={15} />
              </button>
              <TradeField
                label="You receive"
                symbol={recvSymbol}
                logo={side === "buy" ? coinLogo(24) : <EthLogo size={24} />}
                value={quote === 0n ? "0" : amountText(quote, 6)}
                readOnly
                usd={ethUsd && quote > 0n ? money((Number(quote) / 1e18) * (side === "buy" ? priceEth : 1) * ethUsd) : undefined}
              />
            </div>

            <div className="mt-2 grid grid-cols-4 gap-1.5">
              {[25, 50, 75, 100].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  disabled={payBal === undefined}
                  onClick={() => {
                    if (payBal === undefined) return;
                    const part = (payBal * BigInt(pct)) / 100n;
                    // A share of the balance is rounded to six decimals so it reads cleanly; Max stays exact.
                    const all = pct === 100 ? (side === "buy" ? (payBal > GAS_RESERVE ? payBal - GAS_RESERVE : 0n) : payBal) : part - (part % 10n ** 12n);
                    setAmount(formatEther(all));
                  }}
                  className="btn btn-sm btn-secondary w-full disabled:opacity-40"
                >
                  {pct === 100 ? "Max" : `${pct}%`}
                </button>
              ))}
            </div>

            <dl className="mt-3 space-y-2 px-1.5 text-[13px]">
              <Line label="Rate" value={`1 ${coin.symbol} = ${tinyEth(price)} ETH`} />
              <Line label="Minimum received" value={quote === 0n ? "—" : `${amountText(minOut, 6)} ${recvSymbol}`} />
              <Line label="Pool fee" value={feeLabel(coin.fee ?? POOL_FEE)} />
            </dl>

            <button type="button" disabled={busy || !tradable || !!short_} onClick={() => void go()} className={`btn btn-xl mt-3 w-full ${side === "sell" ? "btn-light" : "btn-primary"}`}>
              {!tradable
                ? "Preview coin"
                : busy
                  ? "Confirming…"
                  : !account
                    ? "Connect wallet"
                    : short_
                      ? `Not enough ${paySymbol}`
                      : side === "buy"
                        ? `Buy ${coin.symbol}`
                        : `Sell ${coin.symbol}`}
            </button>
            {wethBal !== undefined && wethBal > 0n ? (
              <button type="button" disabled={busy} onClick={() => void doUnwrap()} className="mt-2 flex w-full items-center justify-between rounded-xl bg-raise px-3.5 py-2.5 text-[13px] hover:bg-raise2">
                <span className="text-muted">
                  You hold <span className="num text-fg">{amountText(wethBal, 5)} WETH</span> from selling
                </span>
                <span className="font-semibold text-gold">Unwrap</span>
              </button>
            ) : null}
            <Note kind={kind} className="mt-2.5 px-1 text-center">
              {tradeNote}
            </Note>
          </section>

          <section className="card p-5">
            <h2 className="text-[15px] font-semibold">About {coin.symbol}</h2>
            {meta?.description ? null : <p className="mt-2 text-sm leading-relaxed text-muted">The full supply sits in a locked pool. There is no bonding curve.</p>}
            <dl className="mt-3 space-y-2.5 text-sm">
              <Line label="Supply" value="1,000,000,000" />
              <Line label="Pool" value={`${coin.symbol}/ETH · v3 · ${feeLabel(coin.fee ?? POOL_FEE)}`} />
              <Line label="Launch liquidity" value="Locked 100 years" />
              <Line label="All-time high" value={swaps ? cash(market.athEth) : "—"} />
              <Line
                label="Pool contract"
                value={
                  <a href={`${explorer}/address/${coin.pool}`} target="_blank" rel="noreferrer" className="num inline-flex items-center gap-1 hover:text-gold">
                    {shortAddr(coin.pool)}
                    <IconExternal size={12} />
                  </a>
                }
              />
            </dl>
          </section>
        </aside>

        <section className="card min-w-0 overflow-hidden lg:col-start-1">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
            <Seg
              label="Activity"
              value={panel}
              onChange={setPanel}
              options={[
                ["trades", `Trades${swaps ? ` · ${swaps.length}` : ""}`],
                ["holders", `Holders${holders ? ` · ${holders.length}` : ""}`],
                ["comments", `Comments${thread.view ? ` · ${thread.view.total}` : ""}`],
              ]}
            />
            <span className="hidden truncate text-xs text-faint sm:block lg:hidden xl:block">
              {panel === "trades" ? "About the last day of trades" : panel === "holders" ? "The pool, the creator and recent traders" : "From wallets with a Dojang"}
            </span>
          </div>
          {panel === "comments" ? (
            <Comments coin={coin} thread={thread} holders={holders} swaps={swaps} />
          ) : panel === "trades" ? (
            !swaps ? (
              <RowsSkeleton />
            ) : list.length === 0 ? (
              <Empty mark="첫 거래" title="No trades in the last day">
                {coin.preview ? "Preview coins can’t be traded." : `Be the first to trade ${coin.symbol} today.`}
              </Empty>
            ) : (
              <>
                <div className={`${TRADE_GRID} th border-b border-line py-2.5`}>
                  <span>Time</span>
                  <span>Type</span>
                  <span className="text-right">{coin.symbol}</span>
                  <span className="text-right">ETH</span>
                  <span className="text-right">Trader</span>
                  <span />
                </div>
                {list.slice(0, shown).map((swap) => (
                  <div key={`${swap.tx}:${swap.index ?? 0}`} className={`${TRADE_GRID} row-hover num border-b border-line/70 py-3 text-sm last:border-0`}>
                    <span className="text-muted">{ago(now - swap.time)}</span>
                    <span className={`font-semibold ${swap.buy ? "text-ok" : "text-down"}`}>{swap.buy ? "Buy" : "Sell"}</span>
                    <span className="truncate text-right">{compactCount(Number(swap.tokenAmount) / 1e18)}</span>
                    <span className="text-right">
                      {ethText(Number(swap.ethAmount) / 1e18)}
                      {ethUsd ? <span className="block text-xs text-muted">{money((Number(swap.ethAmount) / 1e18) * ethUsd)}</span> : null}
                    </span>
                    <span className="flex min-w-0 justify-end text-muted">
                      <TraderLink address={swap.recipient} />
                    </span>
                    <a href={`${explorer}/tx/${swap.tx}`} target="_blank" rel="noreferrer" aria-label="Transaction on the explorer" title="Transaction on the explorer" className="flex justify-end text-faint hover:text-fg">
                      <IconExternal size={14} />
                    </a>
                  </div>
                ))}
                {list.length > shown ? (
                  <button type="button" onClick={() => setShown((n) => n + 50)} className="w-full border-t border-line py-3 text-sm font-medium text-muted hover:text-fg">
                    Show more ({list.length - shown} left)
                  </button>
                ) : null}
              </>
            )
          ) : !holders ? (
            <RowsSkeleton />
          ) : holders.length === 0 ? (
            <Empty mark="없음" title="No holder balances yet" />
          ) : (
            <>
              <div className={`${HOLDER_GRID} th border-b border-line py-2.5`}>
                <span>#</span>
                <span>Wallet</span>
                <span className="text-right">{coin.symbol}</span>
                <span className="text-right">Share</span>
              </div>
              {holders.map((holder, i) => {
                const share = Number((holder.balance * 10_000n) / supplyWei) / 100;
                const isPool = holder.address.toLowerCase() === coin.pool.toLowerCase();
                const isDev = holder.address.toLowerCase() === coin.creator.toLowerCase();
                const rowClass = `${HOLDER_GRID} row-hover num border-b border-line/70 py-3 text-sm last:border-0`;
                const cells = (
                  <>
                    <span className="text-faint">{i + 1}</span>
                    <span className="flex min-w-0 items-center gap-2.5">
                      <Blockie address={holder.address} size={22} />
                      <span className="truncate">{shortAddr(holder.address)}</span>
                      {isPool ? <span className="chip h-5 px-1.5 text-[11px]">Pool</span> : null}
                      {isDev ? <span className="chip h-5 border-gold/30 bg-gold/10 px-1.5 text-[11px] text-gold">Creator</span> : null}
                    </span>
                    <span className="text-right">{compactCount(Number(holder.balance) / 1e18)}</span>
                    <span className="flex items-center justify-end gap-2.5">
                      <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-raise2 sm:block">
                        <span className="block h-full rounded-full bg-gold" style={{ width: `${Math.min(100, share)}%` }} />
                      </span>
                      <span className="w-14 text-right">{share.toFixed(2)}%</span>
                    </span>
                  </>
                );
                // The pool is a contract, so it opens on the explorer; every other holder has a trader page.
                return isPool ? (
                  <a key={holder.address} href={`${explorer}/address/${holder.address}`} target="_blank" rel="noreferrer" className={rowClass}>
                    {cells}
                  </a>
                ) : (
                  <Link key={holder.address} to="/u/$address" params={{ address: holder.address }} className={rowClass}>
                    {cells}
                  </Link>
                );
              })}
              <p className="border-t border-line px-5 py-3 text-xs text-faint">Shows the pool, the creator and wallets that traded in about the last day. Older holders appear on the explorer.</p>
            </>
          )}
        </section>
      </div>

      {isCreator && editing ? <ProfileEditor token={coin.token} symbol={coin.symbol} initial={meta} sign={signMessage} onDone={() => setEditing(false)} /> : null}
    </main>
  );
}

const TRADE_GRID = "grid items-center gap-2.5 sm:gap-3 px-4 sm:px-5 grid-cols-[2rem_2.25rem_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1.3fr)_0.875rem] sm:grid-cols-[3.5rem_3.5rem_minmax(0,1fr)_minmax(0,1fr)_9rem_1rem]";
const HOLDER_GRID = "grid items-center gap-3 px-4 sm:px-5 grid-cols-[1.5rem_minmax(0,1fr)_5rem_4rem] sm:grid-cols-[2rem_minmax(0,1fr)_7rem_9.5rem]";

function IconLink({ href, label, children }: { href: string; label: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" aria-label={label} title={label} className="btn btn-icon btn-sm btn-secondary size-9 rounded-xl">
      {children}
    </a>
  );
}

function Stat({ label, value, wait }: { label: string; value: ReactNode; wait?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="num mt-1 truncate text-[19px] font-semibold tracking-[-0.02em]">{wait ? <span className="skeleton mt-1.5 h-5 w-20" /> : value}</dd>
    </div>
  );
}

function Line({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="num text-right">{value}</dd>
    </div>
  );
}

function RowsSkeleton() {
  return (
    <div className="divide-y divide-line/70">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-3.5">
          <span className="skeleton h-4 w-8" />
          <span className="skeleton h-4 w-10" />
          <span className="skeleton h-4 flex-1" />
          <span className="skeleton h-4 w-20" />
        </div>
      ))}
    </div>
  );
}

function TradeField({
  label,
  symbol,
  logo,
  value,
  onChange,
  balance,
  onBalance,
  readOnly,
  usd,
  bad,
}: {
  label: string;
  symbol: string;
  logo: ReactNode;
  value: string;
  onChange?: (value: string) => void;
  balance?: bigint;
  onBalance?: () => void;
  readOnly?: boolean;
  usd?: string;
  bad?: boolean;
}) {
  return (
    <div className={`rounded-xl border px-4 py-3.5 transition-colors ${bad ? "border-down/60" : "border-transparent focus-within:border-edge"} ${readOnly ? "bg-bg/60" : "bg-bg"}`}>
      <div className="flex items-center justify-between gap-3 text-[13px] text-muted">
        <span>{label}</span>
        {balance === undefined ? null : onBalance ? (
          <button type="button" onClick={onBalance} className="num hover:text-fg">
            Balance {amountText(balance)}
          </button>
        ) : (
          <span className="num">Balance {amountText(balance)}</span>
        )}
      </div>
      <div className="mt-1.5 flex items-center gap-3">
        {readOnly ? (
          <p className={`num min-w-0 flex-1 truncate text-[30px] leading-[1.15] font-medium tracking-[-0.03em] ${value === "0" ? "text-faint" : ""}`}>{value}</p>
        ) : (
          <input
            inputMode="decimal"
            value={value}
            placeholder="0"
            aria-label={label}
            autoComplete="off"
            onChange={(e) => onChange?.(e.target.value.replace(",", "."))}
            className="num min-w-0 flex-1 bg-transparent text-[30px] leading-[1.15] font-medium tracking-[-0.03em] outline-none placeholder:text-faint"
          />
        )}
        <span className="flex shrink-0 items-center gap-2 rounded-full bg-raise2 py-1 pr-3 pl-1 text-[15px] font-semibold">
          {logo}
          {symbol}
        </span>
      </div>
      <p className="num mt-1 h-[18px] text-[13px] text-muted">{usd ?? ""}</p>
    </div>
  );
}

function ProfileEditor({
  token,
  symbol,
  initial,
  sign,
  onDone,
}: {
  token: Address;
  symbol: string;
  initial: { description?: string; image?: string; twitter?: string; telegram?: string; website?: string } | null;
  sign: (message: string) => Promise<`0x${string}`>;
  onDone: () => void;
}) {
  const [image, setImage] = useState(initial?.image);
  const [description, setDescription] = useState(initial?.description ?? "");
  const [twitter, setTwitter] = useState(initial?.twitter ?? "");
  const [telegram, setTelegram] = useState(initial?.telegram ?? "");
  const [website, setWebsite] = useState(initial?.website ?? "");
  const [note, setNote] = useState("");
  const [bad, setBad] = useState(false);
  const [busy, setBusy] = useState(false);

  async function publish() {
    const profile = { description, image, twitter, telegram, website };
    try {
      setBusy(true);
      setBad(false);
      setNote("Sign the message in your wallet. It costs no gas.");
      await publishTokenProfile(token, profile, sign);
      setNote("Published. Everyone now sees this picture.");
      toast({ kind: "good", title: "Profile published", body: `Everyone now sees ${symbol}’s picture and links.` });
      setTimeout(onDone, 900);
    } catch (err) {
      saveTokenMeta(token, { ...profile, description });
      refreshTokenProfiles();
      setBad(true);
      setNote(`${short(err)} Saved in this browser only.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal kicker={`$${symbol}`} title="Token profile" onClose={onDone} width={600}>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        You launched {symbol}. Sign once with your wallet to share its picture, description and links with everyone.
        {sharedStorageEnabled() === false ? " Shared pictures aren’t switched on for this site yet, so this will only save in this browser." : ""}
      </p>
      <div className="mt-5 grid gap-5 sm:grid-cols-[auto_minmax(0,1fr)]">
        <label className="group flex cursor-pointer flex-col items-center gap-2.5">
          <TokenLogo symbol={symbol} image={image} size={104} shape="rounded" />
          <span className="btn btn-sm btn-secondary">
            <IconImage size={14} />
            Choose image
          </span>
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              void shrinkImage(file)
                .then(setImage)
                .catch((err) => {
                  setBad(true);
                  setNote(short(err));
                });
            }}
          />
        </label>
        <div className="grid gap-3.5">
          <label>
            <span className="label">Description</span>
            <textarea value={description} maxLength={280} rows={3} onChange={(e) => setDescription(e.target.value)} className="field resize-none" />
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label>
              <span className="label">X handle</span>
              <input value={twitter} onChange={(e) => setTwitter(e.target.value.replace(/^@/, ""))} className="field" />
            </label>
            <label>
              <span className="label">Telegram</span>
              <input value={telegram} onChange={(e) => setTelegram(e.target.value)} className="field" />
            </label>
            <label>
              <span className="label">Website</span>
              <input value={website} placeholder="https://" onChange={(e) => setWebsite(e.target.value)} className="field" />
            </label>
          </div>
        </div>
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <Note kind={bad ? "bad" : ""} className="min-w-0 flex-1">
          {note}
        </Note>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={onDone} className="btn btn-ghost">
            Cancel
          </button>
          <button type="button" disabled={busy} onClick={() => void publish()} className="btn btn-primary">
            {busy ? "Publishing…" : "Sign and publish"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
