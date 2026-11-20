import { useEffect, useMemo, useRef, useState } from "react";
import type { Address } from "viem";
import { IconCheck, IconCoinTip, IconExternal } from "@/components/chimi/icons";
import { useChimi } from "@/components/chimi/provider";
import { LivePill } from "@/components/chimi/live-pill";
import { Blockie, Modal } from "@/components/chimi/ui";
import { giwaChain } from "@/lib/chimi/chain";
import { publicClient } from "@/lib/chimi/client";
import { ethText, money } from "@/lib/chimi/format";
import { useEthUsd } from "@/lib/chimi/live";
import { short, shortAddr } from "@/lib/chimi/market";
import type { Profile } from "@/lib/chimi/points-rules";
import { shortWallet } from "@/lib/chimi/rewards";
import {
  MAX_MESSAGE_BYTES,
  TIP_PRESETS,
  cleanTipMessage,
  ethAmount,
  messageBytes,
  shownMessage,
  splitTip,
  tipAmount,
  tipMessageProblem,
} from "@/lib/chimi/tip-rules";
import { announceTip, type Tip } from "@/lib/chimi/tips";

export const tipperName = (profiles: Record<string, Profile>, wallet: string) => profiles[wallet]?.name?.replace(/\.up\.id$/, "") ?? shortWallet(wallet);

const cancelled = (e: unknown) => /reject|denied|cancel/i.test(e instanceof Error ? `${e.name} ${e.message}` : String(e));
const usdOf = (wei: bigint, ethUsd: number | undefined) => (ethUsd ? money((Number(wei) / 1e18) * ethUsd) : undefined);
const explorerTx = (tx: string) => `${giwaChain.blockExplorers.default.url}/tx/${tx}`;

/** Who a tip goes to, as the tip form shows them. */
export type TipTo = { name: string; wallet: string; symbol: string; token: string; live?: boolean };

type Phase = { at: "form" } | { at: "wallet" } | { at: "sending" } | { at: "done"; tx: string; wei: bigint };

/**
 * The tip form: who it's for, a big amount with one-tap presets (in ETH, with dollars beside), an optional message,
 * then one transaction. It walks through confirming in the wallet and sending, and ends on a thank-you.
 */
export function TipSheet({ to, onClose, onSent }: { to: TipTo; onClose: () => void; onSent: () => void }) {
  const { account, connect, tip } = useChimi();
  const ethUsd = useEthUsd();
  const [amount, setAmount] = useState<string>(TIP_PRESETS[1]);
  const [message, setMessage] = useState("");
  const [balance, setBalance] = useState<bigint>();
  const [phase, setPhase] = useState<Phase>({ at: "form" });
  const [error, setError] = useState("");
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!account) return;
    let stop = false;
    void publicClient
      .getBalance({ address: account })
      .then((b) => !stop && setBalance(b))
      .catch(() => undefined);
    return () => {
      stop = true;
    };
  }, [account]);

  const parsed = tipAmount(amount);
  const wei = "wei" in parsed ? parsed.wei : undefined;
  const tooMuch = wei !== undefined && balance !== undefined && wei > balance;
  const messageError = tipMessageProblem(message);
  const bytesLeft = MAX_MESSAGE_BYTES - messageBytes(cleanTipMessage(message));
  const busy = phase.at === "wallet" || phase.at === "sending";
  const amountError = amount.trim() && "error" in parsed ? parsed.error : tooMuch ? "That's more ETH than this wallet has." : "";

  async function send() {
    if (!account) {
      await connect().catch(() => undefined);
      return;
    }
    if (wei === undefined || tooMuch || messageError || busy) return;
    setError("");
    setPhase({ at: "wallet" });
    try {
      const hash = await tip(to.token as Address, wei, cleanTipMessage(message), () => setPhase({ at: "sending" }));
      announceTip(hash);
      setPhase({ at: "done", tx: hash, wei });
      onSent();
    } catch (e) {
      setPhase({ at: "form" });
      if (!cancelled(e)) setError(short(e));
    }
  }

  if (phase.at === "done") {
    return (
      <Modal onClose={onClose} width={440} label="Tip sent">
        <div className="tip-done">
          <span className="tip-done-mark">
            <IconCheck size={30} />
          </span>
          <p className="font-serif text-[22px] text-gold">감사합니다</p>
          <p className="mt-1 text-[20px] font-semibold tracking-[-0.015em]">
            You tipped {to.name} <span className="num text-gold">{ethAmount(phase.wei)} ETH</span>
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            {to.live ? "It pops up on their stream and lands in their inbox." : "It lands in their inbox."} {to.name} got {ethAmount(splitTip(phase.wei).creator)} ETH.
          </p>
          <div className="mt-6 flex w-full gap-2">
            <a href={explorerTx(phase.tx)} target="_blank" rel="noopener noreferrer" className="btn btn-secondary flex-1">
              Transaction
              <IconExternal size={14} />
            </a>
            <button type="button" onClick={onClose} className="btn btn-primary flex-1" autoFocus>
              Done
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  const label = !account
    ? "Connect wallet to tip"
    : phase.at === "wallet"
      ? "Confirm in your wallet"
      : phase.at === "sending"
        ? "Sending tip…"
        : tooMuch
          ? "Not enough ETH"
          : wei !== undefined
            ? `Tip ${ethAmount(wei)} ETH`
            : "Tip";

  return (
    <Modal
      kicker={
        <span className="flex items-center gap-2">
          ${to.symbol}
          {to.live ? <LivePill small /> : null}
        </span>
      }
      title="Send a tip"
      onClose={onClose}
      width={460}
    >
      <form
        className="mt-5"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <div className="tip-to">
          <Blockie address={to.wallet} size={34} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14.5px] font-semibold">{to.name}</span>
            <span className="num block truncate text-[12.5px] text-muted">
              Creator of ${to.symbol} · {shortAddr(to.wallet)}
            </span>
          </span>
        </div>

        <label className="tip-amount" onClick={() => amountRef.current?.focus()}>
          <span className="sr-only">Amount in ETH</span>
          <input
            ref={amountRef}
            value={amount}
            onChange={(e) => {
              const v = e.target.value.replace(/,/g, ".").replace(/[^0-9.]/g, "");
              if ((v.match(/\./g) ?? []).length <= 1) setAmount(v);
              setError("");
            }}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            disabled={busy}
            className="tip-amount-input num"
            style={{ width: `${Math.max(1, amount.length || 1) + 0.4}ch` }}
          />
          <span className="tip-amount-unit">ETH</span>
        </label>
        <p className={`num mt-1 h-5 text-center text-[13px] ${amountError ? "text-down" : "text-muted"}`} aria-live="polite">
          {amountError || (wei !== undefined ? (usdOf(wei, ethUsd) ? `≈ ${usdOf(wei, ethUsd)}` : "") : "")}
        </p>

        <div className="mt-3 grid grid-cols-4 gap-2" role="group" aria-label="Quick amounts">
          {TIP_PRESETS.map((p) => {
            const pw = (tipAmount(p) as { wei: bigint }).wei;
            return (
              <button key={p} type="button" disabled={busy} aria-pressed={amount === p} onClick={() => setAmount(p)} className={`tip-preset ${amount === p ? "tip-preset-on" : ""}`}>
                <span className="num">{p}</span>
                <span className="num text-[11px] font-medium text-faint">{usdOf(pw, ethUsd) ?? "ETH"}</span>
              </button>
            );
          })}
        </div>

        <label className="mt-4 block">
          <span className="sr-only">Message</span>
          <span className="tip-message">
            <textarea
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                setError("");
              }}
              rows={2}
              disabled={busy}
              placeholder={`Say something to ${to.name} (optional)`}
              className="field tip-message-input"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            {bytesLeft < 60 ? <span className={`num tip-message-left ${bytesLeft < 0 ? "text-down" : "text-faint"}`}>{bytesLeft}</span> : null}
          </span>
        </label>
        {messageError ? <p className="mt-1.5 text-[13px] text-down">{messageError}</p> : null}

        <p className="num mt-3 text-center text-[12.5px] text-muted">
          {wei !== undefined ? (
            <>
              {to.name} gets <span className="text-fg">{ethAmount(splitTip(wei).creator)} ETH</span> · 10% to Chimi
              {balance !== undefined ? <span className="text-faint"> · you have {ethText(Number(balance) / 1e18)} ETH</span> : null}
            </>
          ) : (
            "90% goes to the creator, 10% to Chimi"
          )}
        </p>

        {error ? (
          <p role="alert" className="mt-3 text-center text-[13px] text-down">
            {error}
          </p>
        ) : null}

        <button type="submit" disabled={!!account && (busy || wei === undefined || tooMuch || !!messageError)} className="btn btn-primary btn-lg mt-4 w-full">
          {busy ? <span className="spinner" aria-hidden /> : null}
          {label}
        </button>
        <p className="mt-2.5 text-center text-[12px] text-faint">Tips are final, and your message is stored on GIWA. Links aren&rsquo;t allowed.</p>
      </form>
    </Modal>
  );
}

/**
 * Under a live stream: what's been tipped lately and by whom, newest first. A tip that arrives while the page is open
 * slides in lit up. With no tips yet, an invitation to be the first (or, for the creator, what will show here).
 */
export function TipsBar({
  tips,
  profiles,
  me,
  creatorName,
  own,
  onTip,
}: {
  tips: Tip[];
  profiles: Record<string, Profile>;
  me?: string;
  creatorName: string;
  own: boolean;
  onTip: () => void;
}) {
  const ethUsd = useEthUsd();
  // Tips already there when the page opened don't light up; only ones that arrive after.
  const firstSeen = useRef<Set<string> | null>(null);
  if (firstSeen.current === null) firstSeen.current = new Set(tips.map((t) => t.key));
  const total = useMemo(() => tips.reduce((sum, t) => sum + t.amount, 0n), [tips]);

  if (tips.length === 0) {
    const body = (
      <>
        <span className="font-serif text-[15px] text-gold">첫 후원</span>
        <span className="tips-empty-text text-[13px] text-muted">{own ? "Tips you get show here and pop up on your stream." : `No tips yet. Be the first to tip ${creatorName}.`}</span>
      </>
    );
    return own ? (
      <div className="tips-bar tips-empty">{body}</div>
    ) : (
      <button type="button" onClick={onTip} className="tips-bar tips-empty tips-empty-cta">
        {body}
        <span className="tips-empty-go">
          <IconCoinTip size={14} />
          Tip
        </span>
      </button>
    );
  }

  return (
    <div className="tips-bar">
      <span className="tips-total" title={usdOf(total, ethUsd) ? `≈ ${usdOf(total, ethUsd)}` : undefined}>
        <span className="eyebrow">Tips</span>
        <span className="num text-[13px] font-semibold text-gold">{ethAmount(total)} ETH</span>
      </span>
      <ul className="tips-strip no-scrollbar" aria-label="Latest tips">
        {tips.slice(0, 12).map((t) => {
          const said = shownMessage(t.message, 60);
          const mine = !!me && t.from === me.toLowerCase();
          return (
            <li key={t.key} className={firstSeen.current!.has(t.key) ? "" : "tip-new"}>
              <a href={explorerTx(t.tx)} target="_blank" rel="noopener noreferrer" className="tip-chip" title={[said, `${ethAmount(t.amount)} ETH`].filter(Boolean).join(" · ")}>
                <Blockie address={t.from} size={18} />
                <span className={`truncate font-semibold ${mine ? "text-gold" : "text-fg"}`}>{mine ? "You" : tipperName(profiles, t.from)}</span>
                <span className="num tip-amt shrink-0 font-semibold text-gold">{ethAmount(t.amount)}</span>
                {said ? <span className="tip-msg max-w-[15rem] truncate text-muted">{said}</span> : null}
              </a>
            </li>
          );
        })}
      </ul>
      {own ? null : (
        <button type="button" onClick={onTip} className="btn btn-sm tip-btn tips-side-cta">
          <IconCoinTip size={15} />
          Tip {creatorName}
        </button>
      )}
    </div>
  );
}
