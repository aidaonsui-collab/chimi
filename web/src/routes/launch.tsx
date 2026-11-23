import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { formatEther, parseEther } from "viem";
import { POOL_FEE, factoryAbi, giwaChain } from "@/lib/chimi/chain";
import { publicClient } from "@/lib/chimi/client";
import { ethText, money } from "@/lib/chimi/format";
import { useEthUsd } from "@/lib/chimi/live";
import { bpsLabel, hasFeeChoice, splitFor, type FeeSplit } from "@/lib/chimi/fee-split";
import { CLIFF_PRESETS, DAY, VEST_PRESETS, describePlan, planProblem } from "@/lib/chimi/creator-lock-rules";
import { feeLabel, fmt, short } from "@/lib/chimi/market";
import { saveTokenMeta, shrinkImage } from "@/lib/chimi/meta";
import { publishTokenProfile, refreshTokenProfiles } from "@/lib/chimi/token-image";
import { IconCheck, IconClose, IconImage, IconLock, IconPlus, IconTelegram, IconX } from "@/components/chimi/icons";
import { useChimi } from "@/components/chimi/provider";
import { toast } from "@/components/chimi/toast";
import { TokenArt } from "@/components/chimi/token-logo";
import { Note, PageHead } from "@/components/chimi/ui";
import { NETWORK } from "@/lib/chimi/network";

export const Route = createFileRoute("/launch")({
  head: () => ({ meta: [{ title: "Launch a coin · Chimi" }] }),
  component: LaunchPage,
});

const VIRTUAL_TOKEN = 1_066_666_666_666_666_666_666_666_666n;
const SUPPLY = 1_000_000_000n * 10n ** 18n;
const GAS_RESERVE = 300_000_000_000_000n;

/** Coins for a first buy at the opening price, after the pool's fee (`fee` in hundredths of a bip, 20000 = 2%). */
function tokensOut(ethIn: bigint, virtualQuote: bigint, fee: number): bigint {
  if (ethIn === 0n || virtualQuote === 0n) return 0n;
  return (ethIn * BigInt(1_000_000 - fee) * VIRTUAL_TOKEN) / (1_000_000n * virtualQuote);
}

function compactTokens(raw: bigint): string {
  const whole = Number(raw / 10n ** 18n);
  if (!Number.isFinite(whole)) return "0";
  return whole.toLocaleString("en-US", { maximumFractionDigits: whole >= 1000 ? 0 : 2 });
}

function LaunchPage() {
  const { account, connect, deployment, live, createCoin, signMessage, loading } = useChimi();
  const navigate = useNavigate();
  const ethUsd = useEthUsd();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  const [website, setWebsite] = useState("");
  const [devBuy, setDevBuy] = useState("");
  // Burn the coin with 10% of its fees: ticked unless the creator unticks it.
  const [burnOwn, setBurnOwn] = useState(true);
  // Lock the first buy in the public creator lock: off unless the creator ticks it.
  const [lockOn, setLockOn] = useState(false);
  const [cliffDays, setCliffDays] = useState("90");
  const [vestDays, setVestDays] = useState("0");
  const [balance, setBalance] = useState<bigint>();
  const [fee, setFee] = useState<bigint>();
  const [virtualQuote, setVirtualQuote] = useState<bigint>();
  const [tried, setTried] = useState(false);
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<"" | "bad" | "good">("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!account) {
      setBalance(undefined);
      return;
    }
    let cancel = false;
    void publicClient
      .getBalance({ address: account })
      .then((wei) => {
        if (!cancel) setBalance(wei);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [account]);

  useEffect(() => {
    if (!deployment || !live || !account) {
      setFee(undefined);
      return;
    }
    let cancel = false;
    void publicClient
      .readContract({ address: deployment.factory, abi: factoryAbi, functionName: "creationFeeDue", args: [account] })
      .then((due) => {
        if (!cancel) setFee(due);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [account, deployment, live]);

  useEffect(() => {
    if (!deployment || !live) return;
    let cancel = false;
    void publicClient
      .readContract({ address: deployment.factory, abi: factoryAbi, functionName: "launchVirtualQuote" })
      .then((q) => {
        if (!cancel) setVirtualQuote(q);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [deployment, live]);

  async function onImage(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setKind("bad");
      setNote("That file isn’t an image.");
      return;
    }
    try {
      setImage(await shrinkImage(file));
      setNote("");
    } catch (err) {
      setKind("bad");
      setNote(short(err));
    }
  }

  async function submit() {
    setTried(true);
    if (!name.trim() || !symbol.trim()) {
      setKind("bad");
      setNote("Name and symbol are required.");
      return;
    }
    if (!account) {
      try {
        await connect();
      } catch (err) {
        setKind("bad");
        setNote(short(err));
      }
      return;
    }
    if (lockOn && canLock && (buy === 0n || lockProblem)) {
      setKind("bad");
      setNote(buy === 0n ? "Set a first buy to lock, or untick the lock." : lockProblem!);
      return;
    }
    try {
      setBusy(true);
      setKind("");
      setNote("Confirm the launch in your wallet.");
      const token = await createCoin(name.trim(), symbol.trim(), devBuy.trim() || "0", burnOwn, locking ? { cliff: cliffN * DAY, vesting: vestN * DAY } : undefined);
      const profile = {
        description: description.trim(),
        image,
        twitter: twitter.trim(),
        telegram: telegram.trim(),
        website: website.trim(),
      };
      saveTokenMeta(token, profile);
      refreshTokenProfiles();
      if (image || profile.description || profile.twitter || profile.telegram || profile.website) {
        // Share the picture with every visitor, not just this browser. A failure here never
        // blocks the launch; the creator can publish later from the coin page.
        setKind("");
        setNote(`${symbol.trim()} is in its pool. Sign once (no gas) to share its picture with everyone.`);
        try {
          await publishTokenProfile(token, profile, signMessage);
        } catch {
          /* kept locally; coin page offers "Set picture" to retry */
        }
      }
      setKind("good");
      setNote(`${symbol.trim()} is in its pool.`);
      toast({ kind: "good", title: `${symbol.trim()} is live`, body: "Its pool is open and locked. Trading starts now.", href: `${giwaChain.blockExplorers.default.url}/address/${token}`, linkLabel: "View contract" });
      await navigate({ to: "/coin/$address", params: { address: token } });
    } catch (err) {
      setKind("bad");
      setNote(short(err));
    } finally {
      setBusy(false);
    }
  }

  const due = fee ?? 0n;
  let buy = 0n;
  let buyOk = true;
  try {
    buy = parseEther(devBuy.trim() || "0");
  } catch {
    buy = 0n;
    buyOk = devBuy.trim() === "";
  }
  const total = due + buy;
  const mark = symbol.trim() || "TICKER";
  const quote = virtualQuote ?? 0n;
  // New coins launch on the last DEX: its fee and how the ETH side of fees is shared.
  const choice = !!deployment && hasFeeChoice(deployment);
  const split = deployment ? splitFor(deployment, burnOwn) : null;
  const coinName = symbol.trim() || "your coin";
  const launchFee = split?.fee ?? POOL_FEE;
  const received = buyOk ? tokensOut(buy, quote, launchFee) : 0n;
  const share = received === 0n ? 0 : Number((received * 10_000n) / SUPPLY) / 100;
  const fdvEth = quote === 0n ? 0 : Number((quote * SUPPLY) / VIRTUAL_TOKEN) / 1e18;
  const opensAt = fdvEth ? (ethUsd ? money(fdvEth * ethUsd) : `${ethText(fdvEth)} ETH`) : undefined;
  const broke = !!account && balance !== undefined && total > balance;
  // The first-buy lock, where the pad offers it.
  const canLock = !!deployment?.creatorLock;
  const cliffN = Math.floor(Number(cliffDays || "0"));
  const vestN = Math.floor(Number(vestDays || "0"));
  const lockProblem = lockOn ? planProblem(cliffN, vestN) : null;
  const locking = canLock && lockOn && buy > 0n && !lockProblem;
  const missing = tried && (!name.trim() || !symbol.trim());
  const ready = !!name.trim() && !!symbol.trim();

  return (
    <main className="page pt-4 pb-16">
      <PageHead eyebrow={NETWORK.name} title="Launch a coin">
        One transaction mints a billion tokens straight into a locked pool against ETH. No bonding curve, nothing to graduate, tradable from the first block.
      </PageHead>

      {!loading && !live ? (
        <p className="mt-6 rounded-xl border border-gold/25 bg-gold/8 px-4 py-3 text-sm">The factory isn’t on this chain yet, so launching is switched off. You can still fill the form to see how it looks.</p>
      ) : null}

      <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid min-w-0 gap-5">
          <Panel step="1" title="The coin" sub="The name and ticker are written on-chain and can’t be changed.">
            <div className="grid gap-5 sm:grid-cols-[168px_minmax(0,1fr)]">
              <div>
                <span className="label">Picture</span>
                <label
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    void onImage(e.dataTransfer.files?.[0]);
                  }}
                  className={`group relative grid aspect-square w-full max-w-[168px] cursor-pointer place-items-center overflow-hidden rounded-2xl border border-dashed transition-colors ${
                    dragging ? "border-gold bg-gold/8" : image ? "border-transparent" : "border-edge bg-bg hover:border-muted"
                  }`}
                >
                  {image ? (
                    <>
                      <img src={image} alt="" className="size-full object-cover" />
                      <span className="absolute inset-0 grid place-items-center bg-black/55 text-sm font-medium opacity-0 transition-opacity group-hover:opacity-100">Replace</span>
                    </>
                  ) : (
                    <span className="flex flex-col items-center gap-2 px-3 text-center">
                      <span className="grid size-10 place-items-center rounded-xl bg-raise2 text-muted">
                        <IconImage size={20} />
                      </span>
                      <span className="text-[13px] font-medium">Add a picture</span>
                      <span className="text-[11px] leading-tight text-faint">Drop it here or click. Square works best.</span>
                    </span>
                  )}
                  <input type="file" accept="image/*" className="sr-only" onChange={(e) => void onImage(e.target.files?.[0])} />
                </label>
                {image ? (
                  <button type="button" onClick={() => setImage(undefined)} className="mt-2 flex items-center gap-1 text-xs text-muted hover:text-fg">
                    <IconClose size={12} />
                    Remove
                  </button>
                ) : null}
              </div>
              <div className="grid content-start gap-4">
                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_150px]">
                  <label>
                    <span className="label">Name</span>
                    <input value={name} maxLength={32} onChange={(e) => setName(e.target.value)} placeholder="Ridge Coin" aria-invalid={missing && !name.trim()} className={`field ${missing && !name.trim() ? "!border-down/70" : ""}`} />
                  </label>
                  <label>
                    <span className="label">Ticker</span>
                    <input
                      value={symbol}
                      maxLength={8}
                      onChange={(e) => setSymbol(e.target.value.toUpperCase().replace(/\s/g, ""))}
                      placeholder="RIDGE"
                      aria-invalid={missing && !symbol.trim()}
                      className={`field font-semibold tracking-[0.08em] ${missing && !symbol.trim() ? "!border-down/70" : ""}`}
                    />
                  </label>
                </div>
                <label>
                  <span className="label flex justify-between">
                    <span>
                      Description <span className="font-normal text-faint">· optional</span>
                    </span>
                    <span className="num font-normal text-faint">{description.length}/280</span>
                  </span>
                  <textarea value={description} maxLength={280} onChange={(e) => setDescription(e.target.value)} placeholder="What is it, in a sentence or two?" rows={3} className="field resize-none" />
                </label>
              </div>
            </div>
          </Panel>

          <Panel step="2" title="Links" sub="Optional. They show on the coin’s page.">
            <div className="grid gap-4 sm:grid-cols-3">
              <label>
                <span className="label">X</span>
                <span className="field flex items-center gap-2 py-0">
                  <IconX size={14} className="shrink-0 text-faint" />
                  <input value={twitter} onChange={(e) => setTwitter(e.target.value.replace(/^@/, ""))} placeholder="handle" className="h-[42px] w-full min-w-0 bg-transparent outline-none" />
                </span>
              </label>
              <label>
                <span className="label">Telegram</span>
                <span className="field flex items-center gap-2 py-0">
                  <IconTelegram size={15} className="shrink-0 text-faint" />
                  <input value={telegram} onChange={(e) => setTelegram(e.target.value)} placeholder="group" className="h-[42px] w-full min-w-0 bg-transparent outline-none" />
                </span>
              </label>
              <label>
                <span className="label">Website</span>
                <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" className="field" />
              </label>
            </div>
          </Panel>

          <Panel step="3" title="First buy" sub="Optional. Buy some of your own coin in the same transaction, before anyone else can.">
            <div className="flex items-center justify-between">
              <span className="label mb-0">Amount</span>
              {balance !== undefined ? (
                <button type="button" onClick={() => setDevBuy(formatEther(balance > due + GAS_RESERVE ? balance - due - GAS_RESERVE : 0n))} className="num text-xs text-muted hover:text-fg">
                  Balance {fmt(balance, 4)} ETH · <span className="font-semibold text-gold">Max</span>
                </button>
              ) : null}
            </div>
            <div className={`field mt-1.5 flex items-center gap-3 py-0 ${!buyOk || broke ? "!border-down/70" : ""}`}>
              <input
                inputMode="decimal"
                value={devBuy}
                placeholder="0"
                autoComplete="off"
                onChange={(e) => setDevBuy(e.target.value.replace(",", "."))}
                aria-label="First buy in ETH"
                className="num h-14 w-full min-w-0 bg-transparent text-2xl font-medium tracking-[-0.02em] outline-none placeholder:text-faint"
              />
              <span className="shrink-0 text-[15px] font-semibold">ETH</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {["0.01", "0.05", "0.1", "0.5"].map((v) => (
                <button key={v} type="button" onClick={() => setDevBuy(v)} className="btn btn-sm btn-secondary">
                  {v} ETH
                </button>
              ))}
            </div>
            <p className="num mt-3 text-sm">
              {!buyOk ? (
                <span className="text-down">Enter a number, like 0.05.</span>
              ) : buy > 0n && quote > 0n ? (
                <>
                  ≈ <span className="font-semibold">{compactTokens(received)}</span> {mark} <span className="text-muted">· {share.toFixed(2)}% of supply</span>
                </>
              ) : (
                <span className="text-muted">Leave it empty to launch without buying.</span>
              )}
            </p>
            {buy > 0n && quote > 0n ? <p className="mt-1 text-xs text-faint">An estimate at the opening price, after the {feeLabel(launchFee)} pool fee.</p> : null}
            {canLock ? (
              <LockChoice
                on={lockOn}
                onToggle={() => setLockOn(!lockOn)}
                cliffDays={cliffDays}
                vestDays={vestDays}
                onCliff={setCliffDays}
                onVest={setVestDays}
                problem={lockProblem}
                plan={describePlan(cliffN, vestN)}
                noBuy={buy === 0n}
              />
            ) : null}
          </Panel>

          {choice && split ? (
            <Panel step="4" title="Trading fees" sub={`Every trade pays the pool ${feeLabel(launchFee)}. Choose what your coin’s share of it does. This can’t be changed after launch.`}>
              <button
                type="button"
                role="checkbox"
                aria-checked={burnOwn}
                aria-labelledby="burn-own-title"
                aria-describedby="burn-own-body"
                onClick={() => setBurnOwn(!burnOwn)}
                className={`flex w-full items-start gap-3.5 rounded-2xl border px-4 py-3.5 text-left transition-colors ${burnOwn ? "border-gold/45 bg-gold/8" : "border-line hover:border-edge"}`}
              >
                <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border transition-colors ${burnOwn ? "border-gold bg-gold text-bg" : "border-edge bg-bg"}`} aria-hidden>
                  {burnOwn ? <IconCheck size={13} /> : null}
                </span>
                <span className="min-w-0">
                  <span id="burn-own-title" className="block text-[15px] font-semibold">
                    Burn {coinName} with 10% of its fees
                  </span>
                  <span id="burn-own-body" className="mt-0.5 block text-sm leading-relaxed text-muted">
                    Every day, 10% of the ETH your pool earns buys {coinName} back and burns it, taking it out of the supply for good. Your share is 70% instead of
                    80%.
                  </span>
                </span>
              </button>
              <FeeBreakdown split={split} coin={symbol.trim() || "Coin"} />
            </Panel>
          ) : null}

          <details className="card group px-5 py-4 sm:px-6">
            <summary className="flex cursor-pointer list-none items-center justify-between text-[15px] font-semibold [&::-webkit-details-marker]:hidden">
              What every Chimi coin gets
              <IconPlus size={16} className="text-muted transition-transform group-open:rotate-45" />
            </summary>
            <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
              {[
                ["Supply", "1,000,000,000"],
                ["Quote", "Wrapped ETH"],
                ["Pool fee", feeLabel(launchFee)],
                ["Lock", "100 years, then the beneficiary"],
                ["Creator share", `${bpsLabel(split?.creatorBps ?? 7_000)} of the ETH trading fees`],
                ...(split ? shareRows(split, symbol.trim()) : []),
                ["Token-side fees", "Burned"],
                ["Transfer tax", "None. The pool fee is the only cost of a trade"],
                ["Opens at", opensAt ? `About ${opensAt} market cap` : "—"],
              ].map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-4 border-b border-line/70 pb-3">
                  <dt className="text-muted">{label}</dt>
                  <dd className="text-right">{value}</dd>
                </div>
              ))}
            </dl>
          </details>
        </div>

        <aside className="grid min-w-0 grid-cols-1 gap-4 lg:sticky lg:top-20">
          <div className="card overflow-hidden">
            <div className="relative aspect-[16/10] overflow-hidden bg-raise [container-type:inline-size]">
              <TokenArt symbol={mark} image={image} />
              <span className="glass absolute top-3 left-3 rounded-lg px-2 py-1 text-[11px] font-medium tracking-wide uppercase">Preview</span>
            </div>
            <div className="p-5">
              <p className="truncate text-xl font-semibold tracking-[-0.02em]">{name.trim() || "Your coin"}</p>
              <p className="text-sm text-muted">${mark}</p>
              {description.trim() ? <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-muted">{description.trim()}</p> : null}
              <dl className="mt-4 space-y-2.5 border-t border-line pt-4 text-sm">
                <Row label="Opens at" value={opensAt ? `${opensAt} cap` : "—"} />
                <Row label="Creation fee" value={!account ? "Connect to see" : due === 0n ? "None" : `${fmt(due, 4)} ETH`} />
                <Row label="First buy" value={buy > 0n ? `${fmt(buy, 4)} ETH${quote > 0n ? ` · ${share.toFixed(2)}%` : ""}` : "None"} />
                {canLock && buy > 0n ? <Row label="Lock" value={locking ? describePlan(cliffN, vestN) : lockOn ? "Fix the lock" : "None"} /> : null}
                {choice && split ? <Row label="Your share of fees" value={bpsLabel(split.creatorBps)} /> : null}
                <div className="flex items-baseline justify-between gap-4 border-t border-line pt-3">
                  <dt className="font-medium">You pay</dt>
                  <dd className="num text-right text-lg font-semibold tracking-[-0.01em]">
                    {fmt(total, 4)} ETH
                    {ethUsd && total > 0n ? <span className="block text-xs font-normal text-muted">{money((Number(total) / 1e18) * ethUsd)} + gas</span> : null}
                  </dd>
                </div>
              </dl>
              <button type="button" disabled={!live || busy || broke || !buyOk} onClick={() => void submit()} className="btn btn-xl btn-primary mt-5 w-full">
                {busy ? "Launching…" : !account ? "Connect wallet" : broke ? "Not enough ETH" : `Launch ${symbol.trim() || "coin"}`}
              </button>
              <Note kind={kind} className="mt-3 text-center">
                {note}
              </Note>
            </div>
          </div>

          <ul className="card grid gap-3 p-5 text-sm">
            <Check on={ready}>Name and ticker go on-chain in the launch transaction.</Check>
            <Check on>
              <span className="inline-flex items-center gap-1.5">
                <IconLock size={13} className="text-gold" />
                The launch liquidity is locked for 100 years.
              </span>
            </Check>
            {locking ? (
              <Check on>
                <span className="inline-flex items-center gap-1.5">
                  <IconLock size={13} className="text-gold" />
                  Your first buy goes straight into the public creator lock: {describePlan(cliffN, vestN)}.
                </span>
              </Check>
            ) : null}
            <Check on={!!image || !!description.trim()}>After launching you sign once, with no gas, to share the picture and links with everyone.</Check>
          </ul>
        </aside>
      </div>
    </main>
  );
}

/** The rows after "Creator share" in "What every Chimi coin gets". `ticker` is empty until one is typed. */
function shareRows(split: FeeSplit, ticker: string): [string, string][] {
  const rows: [string, string][] = [["Platform share", bpsLabel(split.platformBps)]];
  if (split.ownBurnBps) rows.push([`${ticker || "Coin"} burn`, `${bpsLabel(split.ownBurnBps)}: buys ${ticker || "your coin"} and burns it`]);
  if (split.holdersBps) rows.push(["CHIMI flywheel", `${bpsLabel(split.chimiBurnBps + split.holdersBps)}: half burns CHIMI, half is paid to CHIMI holders`]);
  else if (split.chimiBurnBps) rows.push(["CHIMI burn", `${bpsLabel(split.chimiBurnBps)}: buys CHIMI and burns it`]);
  return rows;
}

/** Where the ETH side of the fee goes, as a bar and a key. */
function FeeBreakdown({ split, coin }: { split: FeeSplit; coin: string }) {
  const parts = [
    { label: "You", bps: split.creatorBps, tone: "bg-gold" },
    { label: `${coin} burn`, bps: split.ownBurnBps, tone: "bg-ok" },
    { label: "CHIMI burn", bps: split.chimiBurnBps, tone: "bg-ok/45" },
    { label: "Platform", bps: split.platformBps, tone: "bg-edge" },
  ].filter((p) => p.bps > 0);
  return (
    <div className="mt-4">
      <div className="flex h-2 overflow-hidden rounded-full bg-raise2" aria-hidden>
        {parts.map((p) => (
          <span key={p.label} className={`${p.tone} h-full transition-[width] duration-200`} style={{ width: `${p.bps / 100}%` }} />
        ))}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
        {parts.map((p) => (
          <div key={p.label} className="flex min-w-0 items-center gap-2">
            <span className={`size-2 shrink-0 rounded-full ${p.tone}`} aria-hidden />
            <dt className="truncate text-muted">{p.label}</dt>
            <dd className="num ml-auto font-semibold">{bpsLabel(p.bps)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * "Lock my first buy": it goes straight from the pool into the public creator lock in the launch transaction, so the
 * creator never holds it unlocked. Nothing unlocks before the cliff, then it releases evenly over the vesting period.
 */
function LockChoice({
  on,
  onToggle,
  cliffDays,
  vestDays,
  onCliff,
  onVest,
  problem,
  plan,
  noBuy,
}: {
  on: boolean;
  onToggle: () => void;
  cliffDays: string;
  vestDays: string;
  onCliff: (v: string) => void;
  onVest: (v: string) => void;
  problem: string | null;
  plan: string;
  noBuy: boolean;
}) {
  return (
    <div className="mt-5">
      <button
        type="button"
        role="checkbox"
        aria-checked={on}
        aria-labelledby="lock-title"
        aria-describedby="lock-body"
        onClick={onToggle}
        className={`flex w-full items-start gap-3.5 rounded-2xl border px-4 py-3.5 text-left transition-colors ${on ? "border-gold/45 bg-gold/8" : "border-line hover:border-edge"}`}
      >
        <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border transition-colors ${on ? "border-gold bg-gold text-bg" : "border-edge bg-bg"}`} aria-hidden>
          {on ? <IconCheck size={13} /> : null}
        </span>
        <span className="min-w-0">
          <span id="lock-title" className="flex items-center gap-1.5 text-[15px] font-semibold">
            <IconLock size={14} className="text-gold" />
            Lock my first buy
          </span>
          <span id="lock-body" className="mt-0.5 block text-sm leading-relaxed text-muted">
            It goes straight into the public creator lock in the launch transaction, so you never hold it unlocked. Nothing unlocks before the cliff, then it
            releases evenly. You can push a lock later, never shorten it. Everyone sees it on the coin’s page.
          </span>
        </span>
      </button>
      {on ? (
        <div className="mt-4 grid gap-4 rounded-2xl border border-line bg-bg p-4">
          <DayPresets label="Cliff · nothing unlocks before" value={cliffDays} options={CLIFF_PRESETS} onChange={onCliff} fmt={(d) => (d >= 365 ? `${d / 365} year` : `${d} days`)} />
          <DayPresets
            label="Then release evenly over"
            value={vestDays}
            options={VEST_PRESETS}
            onChange={onVest}
            fmt={(d) => (d === 0 ? "All at the cliff" : d >= 365 ? `${d / 365} year` : `${d} days`)}
          />
          <p className={`text-sm ${problem ? "text-down" : "text-fg"}`}>{problem ?? `Your first buy: ${plan}.`}</p>
          {noBuy && !problem ? <p className="text-xs text-gold">Set a first buy above, or there’s nothing to lock.</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Day presets plus a box for any number of days. */
function DayPresets({ label, value, options, onChange, fmt }: { label: string; value: string; options: readonly number[]; onChange: (v: string) => void; fmt: (d: number) => string }) {
  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {options.map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={value === String(d)}
            onClick={() => onChange(String(d))}
            className={`btn btn-sm ${value === String(d) ? "border-gold/60 bg-gold/12 text-fg" : "btn-secondary"}`}
          >
            {fmt(d)}
          </button>
        ))}
        <span className="day-field">
          <input value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))} inputMode="numeric" aria-label={`${label}, in days`} className="num w-full min-w-0 bg-transparent outline-none" />
          <span className="shrink-0 text-faint">days</span>
        </span>
      </div>
    </div>
  );
}

function Panel({ step, title, sub, children }: { step: string; title: string; sub: string; children: ReactNode }) {
  return (
    <section className="card p-5 sm:p-6">
      <div className="flex items-start gap-3.5">
        <span className="num grid size-7 shrink-0 place-items-center rounded-lg bg-raise2 text-[13px] font-semibold text-gold">{step}</span>
        <div className="min-w-0">
          <h2 className="text-[17px] leading-7 font-semibold tracking-[-0.01em]">{title}</h2>
          <p className="text-sm text-muted">{sub}</p>
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="num text-right">{value}</dd>
    </div>
  );
}

function Check({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className={`mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full ${on ? "bg-ok/15 text-ok" : "bg-raise2 text-faint"}`}>
        <IconCheck size={11} />
      </span>
      <span className="leading-snug text-muted">{children}</span>
    </li>
  );
}
