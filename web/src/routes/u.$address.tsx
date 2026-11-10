import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { isAddress } from "viem";
import { giwaSepolia } from "@/lib/chimi/chain";
import { ago, compactCount, compactUsd, ethText, money } from "@/lib/chimi/format";
import { houseOfWallet } from "@/lib/chimi/house-rules";
import { position, standing, type CoinTally, type Position } from "@/lib/chimi/ledger-rules";
import { SUPPLY, useEthUsd } from "@/lib/chimi/live";
import { shortAddr, wethPerToken, type Coin } from "@/lib/chimi/market";
import { leagueOf } from "@/lib/chimi/points-rules";
import { fmtPoints, useHouses, usePoints, useProfiles } from "@/lib/chimi/rewards";
import { useTokenImages } from "@/lib/chimi/token-image";
import { useBalances, useTrader } from "@/lib/chimi/trader";
import { HouseSeal } from "@/components/chimi/house-seal";
import { IconChevronRight, IconExternal, IconPlus, IconSwap } from "@/components/chimi/icons";
import { useChimi } from "@/components/chimi/provider";
import { DayBars, DojangMark, LeagueChip, useNow } from "@/components/chimi/rewards-bits";
import { TokenLogo } from "@/components/chimi/token-logo";
import { Blockie, CopyButton, Empty, Seg, walletGradient } from "@/components/chimi/ui";

export const Route = createFileRoute("/u/$address")({ component: TraderPage });

type Tab = "holdings" | "trades" | "launched";
type Row = { token: string; coin?: Coin; tally?: CoinTally; held: number; price: number; at: Position };

/** Below this many ETH a profit or loss is rounding, not a result. */
const DUST = 1e-9;

function TraderPage() {
  const { address } = Route.useParams();
  const valid = isAddress(address, { strict: false });
  const wallet = valid ? address.toLowerCase() : undefined;
  const { coins, account, loading: booting } = useChimi();
  const { data: trader, loading, error } = useTrader(wallet);
  const { data: points } = usePoints();
  const { data: houses } = useHouses();
  const profiles = useProfiles(wallet ? [wallet] : [], points?.file.profiles);
  const ethUsd = useEthUsd();
  const now = useNow(30_000);
  const live = useMemo(() => coins.filter((c) => !c.preview), [coins]);
  const images = useTokenImages(useMemo(() => live.map((c) => c.token), [live]));
  const held = useBalances(wallet, live);
  const [tab, setTab] = useState<Tab>("holdings");
  const [shown, setShown] = useState(25);

  const profile = wallet ? profiles[wallet] : undefined;
  const name = profile?.name ?? undefined;
  const display = name ? name.replace(/\.up\.id$/, "") : valid ? shortAddr(address) : "";

  useEffect(() => {
    if (!valid) return;
    const before = document.title;
    document.title = `${name ?? shortAddr(address)} · Chimi`;
    return () => {
      document.title = before;
    };
  }, [valid, address, name]);
  useEffect(() => {
    setTab("holdings");
    setShown(25);
  }, [wallet]);

  const book = trader?.book ?? null;
  const byToken = useMemo(() => new Map(live.map((c) => [c.token.toLowerCase(), c])), [live]);
  const prices = useMemo(() => Object.fromEntries(live.map((c) => [c.token.toLowerCase(), Number(wethPerToken(c.sqrtPriceX96, c.tokenIs0)) / 1e18])), [live]);

  const rows = useMemo<Row[]>(() => {
    const tokens = new Set([...Object.keys(book?.coins ?? {}), ...Object.entries(held ?? {}).flatMap(([t, n]) => (n > 0 ? [t] : []))]);
    return [...tokens]
      .map((token) => {
        const tally = book?.coins[token];
        const have = held?.[token] ?? 0;
        const price = prices[token] ?? 0;
        return { token, coin: byToken.get(token), tally, held: have, price, at: position(tally, have, price) };
      })
      .sort((a, b) => b.at.value - a.at.value || Math.abs(b.at.pnl) - Math.abs(a.at.pnl));
  }, [book, held, prices, byToken]);

  if (!valid || !wallet) {
    return (
      <main className="page pt-4 pb-16">
        <div className="card mt-4">
          <Empty
            mark="없음"
            title="That isn’t a wallet address"
            action={
              <Link to="/" className="btn btn-secondary">
                Back to the board
              </Link>
            }
          >
            A trader’s page lives at its 0x address, 42 characters long.
          </Empty>
        </div>
      </main>
    );
  }

  const explorer = giwaSepolia.blockExplorers.default.url;
  const mine = account?.toLowerCase() === wallet;
  const total = held ? standing(book, held, prices) : undefined;
  const launched = live.filter((c) => c.creator.toLowerCase() === wallet);
  const season = points?.season.find((s) => s.wallet === wallet);
  const today = points?.live?.standings.find((s) => s.wallet === wallet);
  const league = season && points ? leagueOf(season.rank, points.season.length) : null;
  const house = houseOfWallet(houses?.state).get(wallet);
  const trades = book ? [...book.recent].reverse() : [];
  const waiting = loading && !trader;
  const behind = !!trader && trader.through > 0 && now !== null && now - trader.throughTs * 1000 > 15 * 60_000;
  const cash = (eth: number | undefined) => (eth === undefined ? "—" : ethUsd ? money(eth * ethUsd) : `${ethText(eth)} ETH`);
  const nowSec = now === null ? undefined : Math.floor(now / 1000);

  return (
    <main className="page pt-2 pb-16">
      <nav className="flex items-center gap-1.5 text-sm text-muted" aria-label="Breadcrumb">
        <Link to="/points" className="hover:text-fg">
          Traders
        </Link>
        <IconChevronRight size={13} className="text-faint" />
        <span className="truncate text-fg">{display}</span>
      </nav>

      <header className="card relative mt-3 overflow-hidden">
        <div className="relative h-[112px] overflow-hidden sm:h-[152px]">
          <img src="/banner-960.webp" alt="" decoding="async" className="absolute inset-0 size-full object-cover object-[center_40%]" />
          <div className="absolute inset-0 scale-125 opacity-45 blur-3xl saturate-150" style={{ background: walletGradient(wallet) }} />
          <div className="absolute inset-0 bg-gradient-to-t from-chip via-chip/35 to-transparent" />
        </div>
        <div className="relative px-4 pb-5 sm:px-7 sm:pb-6">
          <div className="-mt-11 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 sm:-mt-12">
            <div className="flex min-w-0 items-end gap-4">
              <span className="rounded-[20px] bg-chip p-1">
                <Blockie address={wallet} size={88} shape="rounded" />
              </span>
              <div className="min-w-0 pb-1">
                <h1 className="flex min-w-0 items-center gap-2 text-[28px] leading-tight font-semibold tracking-[-0.03em] sm:text-[34px]">
                  <span className="truncate">
                    {display}
                    {name ? <span className="font-normal text-muted">.up.id</span> : null}
                  </span>
                  <DojangMark verified={profile?.verified} />
                </h1>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  {mine ? <span className="chip border-gold/30 bg-gold/10 text-gold">You</span> : null}
                  {league ? <LeagueChip league={league} /> : null}
                  {house ? (
                    <Link to="/houses/$tag" params={{ tag: house.tag }} className="chip hover:text-fg">
                      <HouseSeal seal={house.seal} ink={house.ink} size={14} />
                      {house.name}
                    </Link>
                  ) : null}
                  {book ? <span className="chip">Trading since {new Date(book.first * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span> : null}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="chip h-9 gap-1 rounded-xl pr-1 pl-3">
                <span className="num text-[13px]">{shortAddr(wallet)}</span>
                <CopyButton text={address} label="Copy wallet address" className="btn btn-icon btn-sm btn-ghost size-7" size={14} />
              </span>
              <a href={`${explorer}/address/${wallet}`} target="_blank" rel="noreferrer" aria-label="Wallet on the explorer" title="Wallet on the explorer" className="btn btn-icon btn-sm btn-secondary size-9 rounded-xl">
                <IconExternal size={16} />
              </a>
              <CopyButton text={typeof window === "undefined" ? "" : window.location.href} label="Copy link to this trader" className="btn btn-icon btn-sm btn-secondary size-9 rounded-xl" size={16} />
            </div>
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-5 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Profit and loss" wait={waiting || !total} sub={total ? `${signedCash(total.realized, cash)} taken · ${signedCash(total.unrealized, cash)} on paper` : undefined}>
              <span className={tone(total?.pnl)}>{signedCash(total?.pnl, cash)}</span>
            </Stat>
            <Stat label="Holdings" wait={!total}>
              {cash(total?.value)}
            </Stat>
            <Stat label="Volume" wait={waiting} sub={book ? `${book.trades.toLocaleString("en-US")} trade${book.trades === 1 ? "" : "s"}` : undefined}>
              {cash(book?.volume ?? 0)}
            </Stat>
            <Stat label="Coins traded" wait={waiting}>
              {Object.keys(book?.coins ?? {}).length}
            </Stat>
            <Stat label="Coins launched" wait={booting}>
              {launched.length}
            </Stat>
            <Stat label="Season points" sub={season ? `Rank #${season.rank}` : today ? "First day still open" : undefined}>
              {fmtPoints(season?.points ?? 0)}
            </Stat>
          </dl>
        </div>
      </header>

      {error && !trader ? <Notice>{error} Balances below still come straight from the chain.</Notice> : null}
      {trader && !trader.writable ? <Notice>The trade record isn’t switched on yet (it needs the site’s database), so only balances show here.</Notice> : null}
      {trader?.writable && trader.through === 0 ? <Notice>Reading Chimi’s trades from the chain for the first time. This page fills in over the next minute or two.</Notice> : null}
      {behind ? (
        <Notice>
          Catching up with GIWA: trades are counted through {new Date(trader.throughTs * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} so far.
        </Notice>
      ) : null}

      <div className="mt-5 grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="card min-w-0 overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
            <Seg
              label="What to show"
              value={tab}
              onChange={setTab}
              options={[
                ["holdings", `Coins · ${rows.length}`],
                ["trades", `Trades${book ? ` · ${book.trades}` : ""}`],
                ["launched", `Launched · ${launched.length}`],
              ]}
            />
            {tab === "trades" && book && book.trades > trades.length ? <span className="hidden text-xs text-faint sm:block">The latest {trades.length}</span> : null}
          </div>

          {tab === "holdings" ? (
            waiting || !held ? (
              <RowsSkeleton />
            ) : rows.length === 0 ? (
              <Empty
                mark="빈 손"
                title={mine ? "You haven’t traded on Chimi yet" : "This wallet hasn’t traded on Chimi"}
                action={
                  <Link to="/" className="btn btn-primary">
                    Find a coin
                  </Link>
                }
              >
                Coins it buys, sells or holds show up here with what they cost and what they’re worth.
              </Empty>
            ) : (
              <>
                <div className={`${HOLD_GRID} th border-b border-line py-2.5`}>
                  <span>Coin</span>
                  <span className="hidden text-right md:block">Holding</span>
                  <span className="text-right">Value</span>
                  <span className="hidden text-right md:block">Bought</span>
                  <span className="hidden text-right md:block">Sold</span>
                  <span className="text-right">Profit</span>
                </div>
                {rows.map((row) => {
                  const closed = row.held === 0;
                  const spent = row.tally?.spent ?? 0;
                  const inner = (
                    <>
                      <span className="flex min-w-0 items-center gap-3">
                        <TokenLogo symbol={row.coin?.symbol ?? "?"} image={images[row.token]} size={36} className={closed ? "opacity-60" : ""} />
                        <span className="min-w-0">
                          <span className="block truncate text-[15px] font-semibold">{row.coin?.name ?? shortAddr(row.token)}</span>
                          <span className="block truncate text-[13px] text-muted">
                            {row.coin ? `$${row.coin.symbol}` : "Unknown coin"}
                            {closed ? " · sold out" : ""}
                          </span>
                        </span>
                      </span>
                      <span className="num hidden text-right text-[15px] md:block">{closed ? "—" : compactCount(row.held)}</span>
                      <span className="num text-right text-[15px] font-medium">
                        {closed ? "—" : cash(row.at.value)}
                        {!closed && row.coin ? <span className="block text-xs font-normal text-muted">{((row.held / SUPPLY) * 100).toFixed(2)}% of supply</span> : null}
                      </span>
                      <span className="num hidden text-right text-[15px] md:block">
                        {spent > 0 ? cash(spent) : "—"}
                        {row.tally?.buys ? <span className="block text-xs text-muted">{row.tally.buys} buy{row.tally.buys === 1 ? "" : "s"}</span> : null}
                      </span>
                      <span className="num hidden text-right text-[15px] md:block">
                        {row.tally && row.tally.got > 0 ? cash(row.tally.got) : "—"}
                        {row.tally?.sells ? <span className="block text-xs text-muted">{row.tally.sells} sell{row.tally.sells === 1 ? "" : "s"}</span> : null}
                      </span>
                      <span className={`num text-right text-[15px] font-medium ${tone(row.at.pnl)}`}>
                        {signedCash(row.at.pnl, cash)}
                        {spent > 0 && Math.abs(row.at.pnl) > DUST ? <span className="block text-xs font-normal">{pct((row.at.pnl / spent) * 100)}</span> : null}
                      </span>
                    </>
                  );
                  return row.coin ? (
                    <Link key={row.token} to="/coin/$address" params={{ address: row.coin.token }} className={`${HOLD_GRID} row-hover border-b border-line/70 py-3 last:border-0`}>
                      {inner}
                    </Link>
                  ) : (
                    <div key={row.token} className={`${HOLD_GRID} border-b border-line/70 py-3 last:border-0`}>
                      {inner}
                    </div>
                  );
                })}
                <p className="border-t border-line px-5 py-3 text-xs leading-relaxed text-faint">
                  Profit is what selling brought in plus what is still held, less what was paid, at each pool’s current price. Tokens sent to another wallet or placed in a liquidity position leave the balance without counting as a sale.
                </p>
              </>
            )
          ) : tab === "trades" ? (
            waiting ? (
              <RowsSkeleton />
            ) : trades.length === 0 ? (
              <Empty mark="첫 거래" title="No trades yet">
                {trader?.writable === false ? "The trade record isn’t switched on for this site yet." : "Every buy and sell this wallet makes on a Chimi coin is listed here."}
              </Empty>
            ) : (
              <>
                <div className={`${TRADE_GRID} th border-b border-line py-2.5`}>
                  <span>Time</span>
                  <span>Coin</span>
                  <span>Type</span>
                  <span className="hidden text-right sm:block">Tokens</span>
                  <span className="text-right">ETH</span>
                  <span />
                </div>
                {trades.slice(0, shown).map((trade) => {
                  const coin = byToken.get(trade.token);
                  return (
                    <div key={`${trade.b}:${trade.i}`} className={`${TRADE_GRID} row-hover num border-b border-line/70 py-2.5 text-sm last:border-0`}>
                      <span className="text-muted" title={new Date(trade.t * 1000).toLocaleString("en-US")}>
                        {nowSec === undefined ? "" : ago(nowSec - trade.t)}
                      </span>
                      {coin ? (
                        <Link to="/coin/$address" params={{ address: coin.token }} className="flex min-w-0 items-center gap-2.5 hover:text-gold">
                          <TokenLogo symbol={coin.symbol} image={images[trade.token]} size={26} />
                          <span className="truncate font-medium">{coin.symbol}</span>
                        </Link>
                      ) : (
                        <span className="truncate text-muted">{shortAddr(trade.token)}</span>
                      )}
                      <span className={`font-semibold ${trade.buy ? "text-ok" : "text-down"}`}>{trade.buy ? "Buy" : "Sell"}</span>
                      <span className="hidden truncate text-right sm:block">{compactCount(trade.tokens)}</span>
                      <span className="text-right">
                        {ethText(trade.eth)}
                        {ethUsd ? <span className="block text-xs text-muted">{money(trade.eth * ethUsd)}</span> : null}
                      </span>
                      <a href={`${explorer}/tx/${trade.tx}`} target="_blank" rel="noreferrer" aria-label="Transaction on the explorer" title="Transaction on the explorer" className="flex justify-end text-faint hover:text-fg">
                        <IconExternal size={14} />
                      </a>
                    </div>
                  );
                })}
                {trades.length > shown ? (
                  <button type="button" onClick={() => setShown((n) => n + 50)} className="w-full border-t border-line py-3 text-sm font-medium text-muted hover:text-fg">
                    Show more ({trades.length - shown} left)
                  </button>
                ) : null}
              </>
            )
          ) : booting ? (
            <RowsSkeleton />
          ) : launched.length === 0 ? (
            <Empty
              mark="아직"
              title={mine ? "You haven’t launched a coin yet" : "No coins launched from this wallet"}
              action={
                mine ? (
                  <Link to="/launch" className="btn btn-primary">
                    <IconPlus size={16} />
                    Launch a coin
                  </Link>
                ) : null
              }
            />
          ) : (
            launched.map((coin) => {
              const cap = (prices[coin.token.toLowerCase()] ?? 0) * SUPPLY;
              return (
                <Link key={coin.token} to="/coin/$address" params={{ address: coin.token }} className="row-hover flex items-center gap-3 border-b border-line/70 px-4 py-3 last:border-0 sm:px-5">
                  <TokenLogo symbol={coin.symbol} image={images[coin.token.toLowerCase()]} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold">{coin.name}</span>
                    <span className="block truncate text-[13px] text-muted">${coin.symbol}</span>
                  </span>
                  <span className="text-right">
                    <span className="num block text-[15px] font-medium">{ethUsd ? compactUsd(cap * ethUsd) : `${ethText(cap)} ETH`}</span>
                    <span className="block text-xs text-muted">Market cap</span>
                  </span>
                  <IconChevronRight size={16} className="shrink-0 text-faint" />
                </Link>
              );
            })
          )}
        </section>

        <aside className="grid min-w-0 grid-cols-1 gap-5">
          <section className="card relative overflow-hidden p-5">
            <div className="pointer-events-none absolute -top-24 -right-20 size-64 rounded-full bg-[radial-gradient(closest-side,rgba(212,67,43,.16),transparent)]" />
            <div className="relative">
              <div className="flex items-center justify-between gap-3">
                <p className="eyebrow">Season 1</p>
                {season ? <span className="num chip text-fg">Rank #{season.rank}</span> : null}
              </div>
              <p className="num mt-3 text-[28px] leading-none font-semibold tracking-[-0.03em]">{fmtPoints(season?.points ?? 0)}</p>
              <p className="mt-1.5 text-sm text-muted">
                {season ? "points this season" : profile?.verified === false ? "No Dojang on this wallet, so it earns no points." : "No points yet this season."}
              </p>
              {points && (season || today) ? (
                <div className="mt-5">
                  <DayBars days={points.history(wallet)} live={points.live ? { day: points.live.day, points: today?.points ?? 0 } : null} color="#e4563d" />
                </div>
              ) : null}
              <Link to="/points" className="group mt-5 flex items-center justify-between rounded-xl bg-raise px-4 py-3 text-sm font-medium transition-colors hover:bg-raise2">
                <span>The season board</span>
                <IconChevronRight size={15} className="text-muted transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>
          </section>

          {house ? (
            <Link to="/houses/$tag" params={{ tag: house.tag }} className="card card-lift group flex items-center gap-4 p-5">
              <HouseSeal seal={house.seal} ink={house.ink} size={52} />
              <span className="min-w-0 flex-1">
                <span className="eyebrow block">House</span>
                <span className="mt-0.5 block truncate text-[17px] font-semibold">{house.name}</span>
                {house.motto ? <span className="block truncate font-serif text-sm text-muted">{house.motto}</span> : null}
              </span>
              <IconChevronRight size={17} className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-fg" />
            </Link>
          ) : null}

          {mine ? (
            <Link to="/swap" className="btn btn-lg btn-secondary w-full">
              <IconSwap size={17} />
              Trade
            </Link>
          ) : null}
        </aside>
      </div>
    </main>
  );
}

const HOLD_GRID = "grid items-center gap-3 px-4 sm:px-5 grid-cols-[minmax(0,1fr)_6rem_6rem] md:grid-cols-[minmax(0,1.5fr)_repeat(5,minmax(0,1fr))]";
const TRADE_GRID = "grid items-center gap-3 px-4 sm:px-5 grid-cols-[2.5rem_minmax(0,1fr)_2.5rem_5.5rem_1rem] sm:grid-cols-[3.5rem_minmax(0,1.2fr)_3.5rem_minmax(0,1fr)_minmax(0,1fr)_1rem]";

function tone(eth: number | undefined) {
  if (eth === undefined || Math.abs(eth) <= DUST) return "";
  return eth > 0 ? "text-ok" : "text-down";
}

/** An amount with its sign in front: +$12.40, −$3.10, or plain $0.00 when it is nothing either way. */
function signedCash(eth: number | undefined, cash: (eth: number | undefined) => string) {
  if (eth === undefined) return "—";
  if (Math.abs(eth) <= DUST) return cash(0);
  return `${eth > 0 ? "+" : "−"}${cash(Math.abs(eth))}`;
}

function pct(n: number) {
  const abs = Math.abs(n);
  return `${n > 0 ? "+" : "−"}${abs >= 1000 ? Math.round(abs).toLocaleString("en-US") : abs.toFixed(abs >= 100 ? 0 : abs >= 10 ? 1 : 2)}%`;
}

function Stat({ label, children, sub, wait }: { label: string; children: ReactNode; sub?: string; wait?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="num mt-1 truncate text-[19px] font-semibold tracking-[-0.02em]">{wait ? <span className="skeleton mt-1.5 h-5 w-20" /> : children}</dd>
      {sub && !wait ? <dd className="num mt-0.5 text-xs leading-snug text-muted">{sub}</dd> : null}
    </div>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return <p className="mt-4 rounded-xl border border-gold/25 bg-gold/8 px-4 py-3 text-sm">{children}</p>;
}

function RowsSkeleton() {
  return (
    <div className="divide-y divide-line/70">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-3.5">
          <span className="skeleton size-9 rounded-full" />
          <span className="skeleton h-4 flex-1" />
          <span className="skeleton h-4 w-20" />
        </div>
      ))}
    </div>
  );
}
