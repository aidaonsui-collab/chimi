import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import type { Address } from "viem";
import bundledDeployment from "../../public/deployments.json";
import { giwaChain, launchDex, type Deployment } from "@/lib/chimi/chain";
import { bpsLabel, hasFeeChoice, splitFor, type FeeSplit } from "@/lib/chimi/fee-split";
import { DOJANG_URL } from "@/lib/chimi/identity";
import { feeLabel, shortAddr } from "@/lib/chimi/market";
import { DAILY_POOL, LEAD_SHARE, LEAGUES } from "@/lib/chimi/points-rules";
import { MAX_MEMBERS, REQUEST_DAYS } from "@/lib/chimi/house-rules";
import { MAX_LENGTH } from "@/lib/chimi/comment-rules";
import { IconExternal } from "@/components/chimi/icons";
import { useChimi } from "@/components/chimi/provider";
import { CopyButton, PageHead } from "@/components/chimi/ui";
import { NETWORK } from "@/lib/chimi/network";

/**
 * How Chimi works, on one page: a short section per part of the app, with the numbers read from the same rules and
 * deployment the app runs on, so the page can't drift from what the contracts and the app do.
 */
export const Route = createFileRoute("/docs")({ component: Docs });

const explorer = giwaChain.blockExplorers.default.url;

const SECTIONS: [id: string, title: string][] = [
  ["start", "What Chimi is"],
  ["launch", "Launching a coin"],
  ["trade", "Trading"],
  ["fees", "Fees"],
  ["burns", "Burns"],
  ["creators", "Creator rewards"],
  ["streams", "Live streams"],
  ["points", "Points and leagues"],
  ["houses", "Houses"],
  ["social", "Following and posts"],
  ["dojang", "Dojang and up.id"],
  ["liquidity", "Liquidity"],
  ["contracts", "Contracts"],
  ["risks", "Risks"],
];

function Docs() {
  // The deployment the app fetches at runtime, or until it has come (and on the server, so the page is sent whole) the
  // copy bundled with this build: the same file.
  const deployment = useChimi().deployment ?? (bundledDeployment as Deployment);
  const active = useActiveSection();
  const now: FeeSplit | null = deployment ? splitFor(deployment) : null;
  // With the fee choice a creator picks one of two splits at launch: burning their coin (the default) or not.
  const choice = !!deployment && hasFeeChoice(deployment);
  const plain: FeeSplit | null = deployment && choice ? splitFor(deployment, false) : null;
  const flywheel = !!deployment?.flywheel;
  const dex = deployment ? launchDex(deployment) : null;
  const fee = now ? feeLabel(now.fee) : "";

  useEffect(() => {
    const before = document.title;
    document.title = "Docs · Chimi";
    return () => {
      document.title = before;
    };
  }, []);

  return (
    <main className="page pt-4 pb-16">
      <PageHead eyebrow="Docs" title="How Chimi works">
        Chimi is a launchpad on GIWA. Every coin goes straight into a locked Uniswap pool, so it trades from the first block, with no bonding curve to fill.
      </PageHead>

      {/* A phone gets the sections as a row of chips that scrolls sideways. */}
      <nav aria-label="Sections" className="docs-chips mt-6 lg:hidden">
        {SECTIONS.map(([id, title]) => (
          <a key={id} href={`#${id}`} className={`chip h-8 shrink-0 px-3 text-[13px] ${active === id ? "text-fg" : "text-muted"}`} aria-current={active === id ? "true" : undefined}>
            {title}
          </a>
        ))}
      </nav>

      <div className="mt-6 grid grid-cols-1 gap-8 lg:mt-10 lg:grid-cols-[210px_minmax(0,1fr)]">
        <nav aria-label="Sections" className="hidden lg:block">
          <ul className="sticky top-24 grid gap-0.5">
            {SECTIONS.map(([id, title]) => (
              <li key={id}>
                <a href={`#${id}`} aria-current={active === id ? "true" : undefined} className="docs-toc">
                  {title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="grid min-w-0 gap-5">
          <Section id="start" title="What Chimi is">
            <P>
              A launch is one transaction. It mints a billion coins and puts all of them into a Uniswap v3 pool against wrapped ETH, then locks that liquidity.
              From then on the pool is the market: buys and sales go straight through it, at its price, and there is no curve to graduate from or migration
              later.
            </P>
            <Facts
              rows={[
                ["Network", `${NETWORK.name} (${NETWORK.testnet ? "testnet, " : ""}chain ${NETWORK.id})`],
                ["Quote", "Wrapped ETH"],
                ["Supply", "1,000,000,000 per coin"],
                ["Trading fee", now ? `${fee} on every buy and sell, paid to the pool` : "Paid to the pool on every trade"],
                ["Transfer tax", "None. Sending coins between wallets is free"],
              ]}
            />
            {NETWORK.testnet ? (
              <P>
                Test ETH for {NETWORK.name} comes from GIWA's faucets. Everything here runs on the testnet, so nothing on it has real-money value.
              </P>
            ) : null}
          </Section>

          <Section id="launch" title="Launching a coin">
            <List
              items={[
                <>Pick a name, a ticker and a picture, and optionally a first buy that goes through in the same transaction.</>,
                ...(deployment?.creatorLock
                  ? [
                      <>
                        You can <b>lock your first buy</b>: it goes straight from the pool into a public lock in the launch transaction, so you never hold it
                        unlocked. Nothing unlocks before the cliff you pick, then it releases evenly over the vesting period (four years at most in all). Only you
                        can claim it, and you can push a lock later but never shorten it. The coin shows a "Dev locked" tag, and every lock is on the{" "}
                        <Link to="/locks" className="docs-link">
                          Locks
                        </Link>{" "}
                        page.
                      </>,
                    ]
                  : []),
                <>The coin opens at about a $2,000 market cap (it moves with the ETH price). There is no launch fee today, only gas.</>,
                ...(choice && now && plain
                  ? [
                      <>
                        Choose whether the coin burns itself: <b>10% of its ETH fees buy it back and burn it</b>. It's ticked to start with. Ticked, the creator's
                        share is {bpsLabel(now.creatorBps)}; unticked, {bpsLabel(plain.creatorBps)}. The choice is written into the coin's lock and can't be
                        changed later.
                      </>,
                    ]
                  : []),
                <>
                  Its pool charges {now ? fee : "a fee"} on every buy and sell. That is the whole cost of a trade: the coin itself has no tax.
                </>,
                <>The liquidity is locked for 100 years. Nobody can pull it during the lock; after it, the platform could reclaim it.</>,
              ]}
            />
            <P>
              <Link to="/launch" className="docs-link">
                Launch a coin
              </Link>
            </P>
          </Section>

          <Section id="trade" title="Trading">
            <List
              items={[
                <>
                  <b>Buy and sell</b> on any coin's page or on Swap. The panel shows the exact amount the pool would pay, worked out by running the swap as a
                  call first, and a minimum received that your slippage setting protects.
                </>,
                <>
                  <b>Sales pay ETH</b> in one transaction: the pool's wrapped ETH is unwrapped on the way out. The first sale of a coin also asks to approve it.
                </>,
                <>
                  <b>Quick buy</b> spends one amount, chosen once above the board or the feed, with a single confirmation in your wallet. It sets the minimum
                  received 2% under the pool's answer, so a big price move makes it fail rather than overpay.
                </>,
                <>A trade that would move a small pool a lot says so before you send it.</>,
              ]}
            />
          </Section>

          <Section id="fees" title="Fees">
            <P>
              Every buy and sell pays the pool {now ? fee : "its fee"}. That fee is how Chimi earns, not a tax built into the coin, so sending coins between
              wallets costs nothing. The part of the fee paid in ETH is shared out; the part paid in the coin is burned, which takes it out of the supply.
            </P>
            {choice && now && plain ? (
              <div className="overflow-x-auto">
                <table className="docs-table">
                  <thead>
                    <tr>
                      <th>The coin</th>
                      <th>Creator</th>
                      <th>Platform</th>
                      <th>Coin burn</th>
                      <th>CHIMI burn</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["Burns itself (the default)", now],
                      ["Doesn't burn itself", plain],
                    ].map(([label, split]) => {
                      const sp = split as FeeSplit;
                      return (
                        <tr key={label as string}>
                          <td>{label as string}</td>
                          <td className="num">{bpsLabel(sp.creatorBps)}</td>
                          <td className="num">{bpsLabel(sp.platformBps)}</td>
                          <td className="num">{sp.ownBurnBps ? bpsLabel(sp.ownBurnBps) : "—"}</td>
                          <td className="num">{bpsLabel(sp.chimiBurnBps)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : now ? (
              <div className="overflow-x-auto">
                <table className="docs-table">
                  <thead>
                    <tr>
                      <th>Pool fee</th>
                      <th>Creator</th>
                      <th>Platform</th>
                      <th>CHIMI burn</th>
                      <th>CHIMI holders</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="num">{fee}</td>
                      <td className="num">{bpsLabel(now.creatorBps)}</td>
                      <td className="num">{bpsLabel(now.platformBps)}</td>
                      <td className="num">{now.chimiBurnBps ? bpsLabel(now.chimiBurnBps) : "—"}</td>
                      <td className="num">{now.holdersBps ? bpsLabel(now.holdersBps) : "—"}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : null}
            <P>
              Shares are of the ETH side of the {fee} fee. A coin's split is written into its lock when it launches and can't be changed later; its page shows
              it under About.{choice ? " Coins launched before the choice keep the split they launched with." : ""}
            </P>
          </Section>

          <Section id="burns" title="Burns">
            {choice ? (
              <>
                <P>Part of every coin's fees buys coins back and sends them to the burn address, where nobody can ever move them. Both burns run once a day at 00:10 in Seoul.</P>
                <List
                  items={[
                    <>
                      <b>CHIMI burn.</b> {now ? bpsLabel(now.chimiBurnBps) : "5%"} of the ETH fees of every coin buys CHIMI in CHIMI's own pool and burns it. It applies
                      to every coin, whatever the creator chose. Coins launched on the {fee} pools before the choice send their 15% here too.
                    </>,
                    <>
                      <b>Coin burn.</b> A coin whose creator left the box ticked has its own burner contract. {now ? bpsLabel(now.ownBurnBps) : "10%"} of its ETH
                      fees collects there, and once a day it buys the coin in its own pool and burns all of it. The coin's page shows how much it has burned.
                    </>,
                    <>Each buy spends at most 0.25 ETH a day and never takes less than 98% of the price checked just before it.</>,
                    <>
                      The burn contracts' owner can only change the wallet that runs the daily job. That wallet can buy and burn, and nothing else: the ETH can't
                      go anywhere but into a buy that burns.
                    </>,
                  ]}
                />
                <P>
                  <Link to="/points" className="docs-link">
                    See the CHIMI burn
                  </Link>
                </P>
              </>
            ) : flywheel ? (
              <>
                <P>
                  15% of the ETH fees on every {fee} pool goes to the flywheel, a contract that splits each arrival in half. The more Chimi trades, the harder
                  it spins.
                </P>
                <List
                  items={[
                    <>
                      <b>Half buys CHIMI and burns it.</b> The buy goes through CHIMI's own pool and every coin it gets is sent to the burn address, at most 0.25
                      ETH a day and never below 98% of the price checked just before.
                    </>,
                    <>
                      <b>Half is paid to CHIMI holders, in ETH.</b> Every wallet that held 10,000 CHIMI or more on average over a day gets a share of that day's
                      pot in proportion to its average balance. It is paid at 00:10 in Seoul, straight to the wallet, with nothing to claim.
                    </>,
                    <>
                      It is an average over the whole day, so buying just before the payout and selling just after earns next to nothing. Pools, contracts, the
                      burn address and Chimi's own wallets are left out.
                    </>,
                    <>The contract's owner can only change the wallet that runs the daily job. That wallet can burn and pay holders, and nothing else.</>,
                  ]}
                />
                <P>
                  <Link to="/points" className="docs-link">
                    See the flywheel and your share
                  </Link>
                </P>
              </>
            ) : (
              <P>The flywheel isn't running yet.</P>
            )}
          </Section>

          <Section id="creators" title="Creator rewards">
            <List
              items={[
                choice && now && plain ? (
                  <>
                    The wallet that launches a coin earns {bpsLabel(now.creatorBps)} of the ETH side of every fee its pool takes, or {bpsLabel(plain.creatorBps)} if it
                    unticked the coin burn at launch, for as long as the coin trades.
                  </>
                ) : (
                  <>The wallet that launches a coin earns {now ? bpsLabel(now.creatorBps) : "its share"} of the ETH side of every fee its pool takes, for as long as the coin trades.</>
                ),
                <>
                  Fees build up in the locked position until it is swept. Anyone can sweep a coin's fees, and the money still goes to the wallets on its lock.
                  {flywheel || choice ? " Every coin's fees are swept once a day automatically, so they arrive without anyone claiming." : ""}
                </>,
                <>
                  The creator sees a card on the coin's page with what is waiting and a Claim button. The fees arrive as wrapped ETH, so claiming is two
                  confirmations: the sweep, then turning it into ETH.
                </>,
              ]}
            />
          </Section>

          <Section id="streams" title="Live streams">
            <List
              items={[
                <>
                  The creator can link a YouTube or SOOP channel to their coin with one signature, no gas. Whenever that channel is live, the stream plays at
                  the top of the coin's page and the coin shows LIVE on the board.
                </>,
                <>The stream plays in YouTube's or SOOP's own player. Chimi doesn't record or host it.</>,
                ...(deployment?.tips
                  ? [
                      <>
                        Viewers can tip the creator in ETH from the stream, with a short message. 90% goes to the creator and 10% to Chimi, in the same
                        transaction. A tip can't be undone, and its message stays on the chain.
                      </>,
                      <>The creator can add a tip-alerts link to OBS, so each tip pops up on their broadcast with the name, amount and message.</>,
                    ]
                  : []),
                <>A SOOP stream marked 19+ or behind a password shows a button to watch it on SOOP instead.</>,
                <>Chimi can take down a link that breaks the rules.</>,
              ]}
            />
          </Section>

          <Section id="points" title="Points and leagues">
            <List
              items={[
                <>
                  Every day in Seoul, {DAILY_POOL.toLocaleString("en-US")} points are shared by the wallets with a Dojang that traded Chimi coins that day, by
                  how much ETH they bought and sold.
                </>,
                <>Creators also earn on what others trade in the coins they launched. Their own trades in their own coins don't count.</>,
                <>
                  Leading counts too: when someone who follows you buys a coin within a day after you did, {Math.round(LEAD_SHARE * 100)}% of their buy counts
                  for you, up to the size of your own buy. Nothing is taken from them.
                </>,
                <>
                  A wallet without a Dojang still trades, but its days are left out when they close, and they aren't paid back later.
                </>,
                <>
                  The season's board is split into leagues by rank: {LEAGUES.map((l) => `${l.name} (${l.top >= 1 ? "everyone else" : `top ${Math.round(l.top * 100)}%`})`).join(", ")}.
                </>,
              ]}
            />
            <P>
              <Link to="/points" className="docs-link">
                Points
              </Link>
            </P>
          </Section>

          <Section id="houses" title="Houses">
            <List
              items={[
                <>A house is a team of up to {MAX_MEMBERS} traders whose points add up. Founding or joining one needs a Dojang.</>,
                <>A wallet is in one house at a time. After joining, it can leave whenever it likes, but it has to wait a week before joining a different one.</>,
                <>
                  The head chooses how new members come in: anyone can join, or the head approves each one. In a house that approves, joining sends a request
                  the head accepts or turns down; a wallet has one request out at a time, and it lapses after {REQUEST_DAYS} days.
                </>,
                <>A house's seal is a stamped character in the house's ink, or a picture the head uploads.</>,
                <>A day's points go to the house a wallet is in when that day ends in Seoul.</>,
              ]}
            />
            <P>
              <Link to="/houses" className="docs-link">
                Houses
              </Link>
            </P>
          </Section>

          <Section id="social" title="Following and posts">
            <List
              items={[
                <>Follow a wallet and its buys, sales, launches and posts show up in your Following feed. Following is a signature, not a transaction.</>,
                <>
                  Posts are comments on a coin. Write one on the coin's page or in the box at the top of the Clubhouse feed: up to {MAX_LENGTH} characters, text
                  only, no links, one every 15 seconds per coin, signed with your wallet and no gas.
                </>,
                <>Following, liking and posting need a Dojang, so a follower count or a like is a count of people.</>,
              ]}
            />
          </Section>

          <Section id="dojang" title="Dojang and up.id">
            <P>
              A Dojang is GIWA's proof that a wallet belongs to a verified person, written on the chain.{" "}
              {NETWORK.testnet
                ? "On the testnet, anyone can get one from the GIWA Sepolia Playground: connect, then Issue Dojang, for 0.001 test ETH plus gas."
                : "Issuers such as Upbit give one to their verified users."}
            </P>
            <List
              items={[
                <>
                  <b>You don't need one to trade.</b> Buying, selling, launching and liquidity work for any wallet.
                </>,
                <>
                  <b>It unlocks</b> points, lead points, following, likes, posts and houses, and puts the Dojang mark next to your name.
                </>,
                <>
                  <b>An up.id name</b> (Upbit's names on GIWA) shows in place of your 0x address. It unlocks nothing else.
                </>,
              ]}
            />
            <P>
              <a href={DOJANG_URL} target="_blank" rel="noreferrer" className="docs-link">
                Get a Dojang <IconExternal size={12} />
              </a>
            </P>
          </Section>

          <Section id="liquidity" title="Liquidity">
            <P>
              Anyone can add liquidity to a coin's pool on the Pools page, across the whole price range or a band of it, and earn a share of the pool's fee
              while the price is inside the band. That is separate from the launch liquidity, which stays locked. Liquidity you add, you can remove or collect
              from at any time.
            </P>
            <P>
              <Link to="/pools" className="docs-link">
                Pools
              </Link>
            </P>
          </Section>

          <Section id="contracts" title="Contracts">
            {deployment ? (
              <div className="grid gap-1.5">
                <AddressRow label="Launch factory (the pad)" address={deployment.factory} />
                {dex ? (
                  <div className="mt-2 grid gap-1.5">
                    <p className="th uppercase">DEX</p>
                    <AddressRow label="Uniswap v3 factory" address={dex.uniFactory} />
                    <AddressRow label="Position manager" address={dex.positionManager} />
                    <AddressRow label="Router" address={dex.swapRouter} />
                    <AddressRow label="Liquidity locker" address={dex.locker} />
                  </div>
                ) : null}
                {deployment.burner ? (
                  <div className="mt-2 grid gap-1.5">
                    <p className="th uppercase">CHIMI</p>
                    <AddressRow label="CHIMI" address={deployment.burner.chimi} />
                    <AddressRow label="Burns (CHIMI and each coin's burner)" address={deployment.burner.address} />
                  </div>
                ) : deployment.flywheel ? (
                  <div className="mt-2 grid gap-1.5">
                    <p className="th uppercase">CHIMI</p>
                    <AddressRow label="CHIMI" address={deployment.flywheel.chimi} />
                    <AddressRow label="Flywheel" address={deployment.flywheel.address} />
                  </div>
                ) : null}
                {deployment.tips ? (
                  <div className="mt-2 grid gap-1.5">
                    <p className="th uppercase">Streams</p>
                    <AddressRow label="Tips" address={deployment.tips.address} />
                  </div>
                ) : null}
                <div className="mt-2 grid gap-1.5">
                  <p className="th uppercase">Network</p>
                  <AddressRow label="Wrapped ETH" address={deployment.weth} />
                </div>
              </div>
            ) : (
              <P>Reading the deployment…</P>
            )}
            <P>
              Chimi's DEX is a copy of Uniswap v3 from its published code, with its owner given up, so nobody can switch on a protocol fee or change its fees.
            </P>
          </Section>

          <Section id="risks" title="Risks">
            <List
              items={[
                ...(NETWORK.testnet ? [<>This is a testnet. Coins, ETH and points here have no real-money value.</>] : []),
                <>Anyone can launch a coin, and a coin can go to zero. Trade what you can lose.</>,
                <>
                  The liquidity locker is an upgradeable contract. Its admin, the platform, could replace it; the lock is only as strong as that key.
                </>,
                <>The contracts have been reviewed and tested by the team but not audited by an outside firm.</>,
              ]}
            />
          </Section>
        </div>
      </div>
    </main>
  );
}

/** The section in view, for the index: the last whose heading has scrolled past the top third of the screen. */
function useActiveSection() {
  const [active, setActive] = useState(SECTIONS[0]![0]);
  useEffect(() => {
    const onScroll = () => {
      let current = SECTIONS[0]![0];
      for (const [id] of SECTIONS) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top < window.innerHeight * 0.33) current = id;
      }
      setActive(current);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return active;
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="card scroll-mt-24 p-5 sm:p-6" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="text-[19px] font-semibold tracking-[-0.015em]">
        {title}
      </h2>
      <div className="mt-3 grid gap-3">{children}</div>
    </section>
  );
}

function P({ children }: { children: ReactNode }) {
  return <p className="text-[14.5px] leading-relaxed text-muted [&_b]:font-semibold [&_b]:text-fg">{children}</p>;
}

function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="docs-list">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid gap-x-8 gap-y-2.5 text-sm sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-4 border-b border-line/70 pb-2.5">
          <dt className="text-muted">{label}</dt>
          <dd className="text-right">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function AddressRow({ label, address }: { label: string; address: Address }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-line/70 px-3.5 py-2">
      <span className="min-w-0 truncate text-sm text-muted">{label}</span>
      <span className="flex shrink-0 items-center gap-1">
        <a href={`${explorer}/address/${address}`} target="_blank" rel="noreferrer" title={address} className="num inline-flex items-center gap-1 text-sm hover:text-gold">
          {shortAddr(address)}
          <IconExternal size={12} />
        </a>
        <CopyButton text={address} label={`Copy the ${label} address`} />
      </span>
    </div>
  );
}
