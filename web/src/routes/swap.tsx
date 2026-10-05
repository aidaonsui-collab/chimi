import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { formatEther, parseEther } from "viem";
import { erc20Abi } from "@/lib/chimi/chain";
import { publicClient } from "@/lib/chimi/client";
import { estimatedOut, fmt, short, wethPerToken, type Coin } from "@/lib/chimi/market";
import { useChimi } from "@/components/chimi/provider";

export const Route = createFileRoute("/swap")({ component: SwapPage });

const SLIPPAGE = [100, 200, 500];

function Chip({ kind, label }: { kind: "eth" | "coin"; label: string }) {
  return (
    <span
      className={`grid size-[26px] place-items-center rounded-full font-display text-[7px] ${kind === "eth" ? "border-[1.5px] border-gold text-gold" : "border-[1.5px] border-seal text-seal"}`}
    >
      {label.slice(0, 4)}
    </span>
  );
}

function SwapPage() {
  const { coins, account, connect, trade, live } = useChimi();
  const listed = coins;
  const [token, setToken] = useState("");
  const [payEth, setPayEth] = useState(true);
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(200);
  const [settings, setSettings] = useState(false);
  const [picker, setPicker] = useState(false);
  const [payBal, setPayBal] = useState<bigint>();
  const [recvBal, setRecvBal] = useState<bigint>();
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<"" | "bad" | "good">("");
  const [busy, setBusy] = useState(false);

  const coin = useMemo(
    () => listed.find((c) => c.token.toLowerCase() === token.toLowerCase()) ?? listed[0],
    [listed, token],
  );

  useEffect(() => {
    if (!account || !coin) {
      setPayBal(undefined);
      setRecvBal(undefined);
      return;
    }
    let cancel = false;
    const eth = publicClient.getBalance({ address: account });
    const tok = publicClient.readContract({
      address: coin.token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account],
    });
    void Promise.all([eth, tok]).then(([e, t]) => {
      if (cancel) return;
      setPayBal(payEth ? e : t);
      setRecvBal(payEth ? t : e);
    });
    return () => {
      cancel = true;
    };
  }, [account, coin, payEth]);

  const price = coin ? wethPerToken(coin.sqrtPriceX96, coin.tokenIs0) : 0n;
  let parsed = 0n;
  let badAmount = false;
  try {
    parsed = amount.trim() ? parseEther(amount.trim()) : 0n;
  } catch {
    badAmount = true;
  }
  const tradable = Boolean(coin && live && !coin.preview);
  const quote = coin && !badAmount ? estimatedOut(parsed, price, payEth) : 0n;
  const minOut = (quote * BigInt(10_000 - slippageBps)) / 10_000n;

  async function submit() {
    if (!coin || !tradable) return;
    if (!amount.trim() || badAmount || parsed === 0n) {
      setKind("bad");
      setNote("Enter an amount.");
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
    try {
      setBusy(true);
      setKind("");
      setNote("Confirm in your wallet.");
      await trade(coin, payEth ? "buy" : "sell", amount.trim(), minOut);
      setKind("good");
      setNote(payEth ? "Bought." : "Sold for wrapped ETH.");
      setAmount("");
    } catch (err) {
      setKind("bad");
      setNote(short(err));
    } finally {
      setBusy(false);
    }
  }

  const paySymbol = payEth ? "ETH" : coin?.symbol ?? "Select";
  const recvSymbol = payEth ? coin?.symbol ?? "Select" : "ETH";

  return (
    <main>
      <section className="mx-auto flex max-w-[1180px] flex-col items-center px-4 pt-14 pb-24 sm:px-6">
        <div className="w-full max-w-[480px]">
          <p className="text-[13px] font-semibold tracking-[0.14em] text-gold">
            {live ? "GIWA SEPOLIA" : "PREVIEW"}
          </p>
          <h2 className="mt-1.5 text-[44px] leading-none font-semibold tracking-[-0.035em]">Swap</h2>
        </div>
        <div className="relative mt-6 w-full max-w-[480px] rounded-[32px] border border-line bg-chip/90 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,.06),0_40px_80px_-30px_rgba(0,0,0,.8)]">
          <div className="pointer-events-none absolute -top-16 left-1/2 -z-10 h-[200px] w-[360px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(210,74,46,.16),transparent)]" />
          <div className="flex items-center justify-between px-2 pt-1.5 pb-3">
            <div className="flex rounded-[10px] border border-line bg-bg p-[3px]">
              {(["Buy", "Sell"] as const).map((label) => {
                const on = label === "Buy" ? payEth : !payEth;
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => {
                      setPayEth(label === "Buy");
                      setAmount("");
                      setNote("");
                    }}
                    className={`rounded-[7px] px-4 py-1.5 text-[13px] font-medium ${on ? "bg-[#3a2d22] text-fg shadow-[inset_0_1px_0_rgba(255,255,255,.06)]" : "text-muted"}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              aria-label="Slippage settings"
              onClick={() => setSettings((v) => !v)}
              className="flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-[13px] font-medium text-muted tabular-nums"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M2 4.5h7M12 4.5h2M2 11.5h2M7 11.5h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <circle cx="10.5" cy="4.5" r="1.6" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="5.5" cy="11.5" r="1.6" stroke="currentColor" strokeWidth="1.5" />
              </svg>
              {slippageBps / 100}%
            </button>
          </div>
          {settings ? (
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-line bg-bg px-4 py-3.5">
              <span className="text-sm text-muted">Max slippage</span>
              <div className="flex gap-1.5">
                {SLIPPAGE.map((bps) => {
                  const on = slippageBps === bps;
                  return (
                    <button
                      key={bps}
                      type="button"
                      onClick={() => setSlippageBps(bps)}
                      className={`rounded-full border px-3.5 py-1.5 text-[13px] font-medium tabular-nums ${on ? "border-fg bg-fg text-bg" : "border-line text-muted"}`}
                    >
                      {bps / 100}%
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="relative flex flex-col gap-1.5">
            <Field
              label="You pay"
              balance={payBal}
              value={amount}
              onChange={setAmount}
              symbol={paySymbol}
              kind={payEth ? "eth" : "coin"}
              mono={payEth ? "ETH" : coin?.symbol.slice(0, 4) ?? "?"}
              onPick={!payEth && listed.length > 0 ? () => setPicker(true) : undefined}
              onMax={payBal !== undefined ? () => setAmount(formatEther(payBal)) : undefined}
            />
            <button
              type="button"
              aria-label="Flip direction"
              onClick={() => {
                setPayEth((v) => !v);
                setAmount("");
              }}
              className="absolute top-1/2 left-1/2 z-10 grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-[14px] border-4 border-chip bg-chip text-fg shadow-[0_0_0_1px_#3f3325,0_6px_16px_rgba(0,0,0,.4)]"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M8 2.5v11M3.5 9 8 13.5 12.5 9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <Field
              label="You receive"
              balance={recvBal}
              value={quote === 0n ? "0" : fmt(quote)}
              symbol={recvSymbol}
              kind={payEth ? "coin" : "eth"}
              mono={payEth ? coin?.symbol.slice(0, 4) ?? "?" : "ETH"}
              onPick={payEth && listed.length > 0 ? () => setPicker(true) : undefined}
              readOnly
              dim={quote === 0n}
            />
          </div>

          <div className="mt-2.5 rounded-[20px] border border-line/70 px-4">
            <Row label="Rate" value={coin ? `1 ${coin.symbol} = ${fmt(price, 8)} ETH` : "—"} />
            <Row label="Minimum received" value={quote === 0n ? "—" : `${fmt(minOut)} ${recvSymbol}`} />
            <Row label="Route" value="Chimi pool · 1% fee" last />
          </div>

          <button
            type="button"
            disabled={busy || !tradable}
            onClick={() => void submit()}
            className="mt-3 w-full rounded-[20px] bg-seal py-[17px] text-[17px] font-semibold text-onseal shadow-[inset_0_1px_0_rgba(255,255,255,.22),0_10px_30px_rgba(210,74,46,.28)] disabled:opacity-40"
          >
            {busy ? "Swapping…" : !coin ? "Select a coin" : !tradable ? "Preview" : account ? (payEth ? "Buy" : "Sell") : "Connect wallet"}
          </button>
          {note ? (
            <p className={`mt-3 mb-1 text-center text-sm ${kind === "bad" ? "text-seal" : kind === "good" ? "text-ok" : "text-muted"}`}>
              {note}
            </p>
          ) : null}

          {picker ? (
            <div className="absolute inset-0 z-20 flex flex-col rounded-[32px] bg-[rgba(28,21,16,.97)] p-4 backdrop-blur-xl">
              <div className="flex items-center justify-between px-2 pt-1.5 pb-3.5">
                <span className="text-xl font-semibold tracking-[-0.02em]">Select a coin</span>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => setPicker(false)}
                  className="grid size-8 place-items-center rounded-full bg-fg/8"
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <div className="flex flex-1 flex-col gap-0.5 overflow-auto">
                {listed.map((c) => (
                  <PickRow
                    key={c.token}
                    coin={c}
                    on={c.token === coin?.token}
                    onPick={() => {
                      setToken(c.token);
                      setPicker(false);
                      setAmount("");
                    }}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
        {!live ? (
          <p className="mt-4 max-w-[480px] text-center text-sm text-muted">
            Preview pools. Swaps open once a coin is on the factory.
          </p>
        ) : null}
      </section>
    </main>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 py-2.5 text-sm ${last ? "" : "border-b border-line/55"}`}>
      <span className="text-muted">{label}</span>
      <span className="text-right tabular-nums">{value}</span>
    </div>
  );
}

function Field({
  label,
  balance,
  value,
  onChange,
  symbol,
  kind,
  mono,
  onPick,
  onMax,
  readOnly,
  dim,
}: {
  label: string;
  balance?: bigint;
  value: string;
  onChange?: (value: string) => void;
  symbol: string;
  kind: "eth" | "coin";
  mono: string;
  onPick?: () => void;
  onMax?: () => void;
  readOnly?: boolean;
  dim?: boolean;
}) {
  return (
    <div className={`rounded-[22px] border border-line px-5 py-[18px] ${readOnly ? "bg-bg/55" : "bg-bg"}`}>
      <div className="flex justify-between text-[13px] text-muted">
        <span>{label}</span>
        <span className="tabular-nums">{balance === undefined ? "Balance unavailable" : `Balance ${fmt(balance, 4)}`}</span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        {readOnly ? (
          <span className={`min-w-0 flex-1 truncate text-[40px] leading-[1.1] font-medium tracking-[-0.03em] tabular-nums ${dim ? "text-muted" : ""}`}>
            {value}
          </span>
        ) : (
          <input
            inputMode="decimal"
            value={value}
            placeholder="0"
            aria-label="Amount to pay"
            onChange={(e) => onChange?.(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[40px] leading-[1.1] font-medium tracking-[-0.03em] tabular-nums outline-none"
          />
        )}
        <button
          type="button"
          onClick={onPick}
          className="flex shrink-0 items-center gap-2 rounded-full border border-line bg-chip py-1.5 pr-3 pl-1.5 text-[15px] font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,.05)]"
        >
          <Chip kind={kind} label={mono} />
          {symbol}
          {onPick ? (
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="text-muted" aria-hidden>
              <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : null}
        </button>
      </div>
      <div className="mt-2 flex min-h-[22px] items-center justify-end">
        {onMax ? (
          <button type="button" onClick={onMax} className="rounded-full bg-gold/12 px-2.5 py-0.5 text-xs font-semibold tracking-[0.04em] text-gold">
            MAX
          </button>
        ) : null}
      </div>
    </div>
  );
}

function PickRow({ coin, on, onPick }: { coin: Coin; on: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={`flex items-center gap-3.5 rounded-2xl px-3 py-3 text-left ${on ? "bg-fg/6" : ""}`}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-full border-[1.5px] border-seal font-display text-[9px] text-seal">
        {coin.symbol.slice(0, 4)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-medium">{coin.name}</span>
        <span className="block text-[13px] text-muted">${coin.symbol}</span>
      </span>
      <span className="text-[13px] text-muted tabular-nums">{fmt(wethPerToken(coin.sqrtPriceX96, coin.tokenIs0), 6)} ETH</span>
    </button>
  );
}
