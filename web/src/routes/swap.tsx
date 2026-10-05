import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { formatEther, parseEther } from "viem";
import { erc20Abi } from "@/lib/chimi/chain";
import { publicClient } from "@/lib/chimi/client";
import { estimatedOut, fmt, short, wethPerToken } from "@/lib/chimi/market";
import { useChimi } from "@/components/chimi/provider";

export const Route = createFileRoute("/swap")({ component: SwapPage });

const SLIPPAGE = [100, 200, 500];

function SwapPage() {
  const { coins, account, connect, trade } = useChimi();
  const listed = coins.filter((c) => !c.preview);
  const [token, setToken] = useState<string>("");
  const [payEth, setPayEth] = useState(true);
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(200);
  const [settings, setSettings] = useState(false);
  const [picker, setPicker] = useState(false);
  const [balance, setBalance] = useState<bigint>();
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<"" | "bad" | "good">("");
  const [busy, setBusy] = useState(false);

  const coin = useMemo(
    () => listed.find((c) => c.token.toLowerCase() === token.toLowerCase()) ?? listed[0],
    [listed, token],
  );

  useEffect(() => {
    if (!account || !coin) {
      setBalance(undefined);
      return;
    }
    let cancel = false;
    const read = payEth
      ? publicClient.getBalance({ address: account })
      : publicClient.readContract({ address: coin.token, abi: erc20Abi, functionName: "balanceOf", args: [account] });
    void read.then((wei) => {
      if (!cancel) setBalance(wei);
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
  const quote = coin && !badAmount ? estimatedOut(parsed, price, payEth) : 0n;
  const minOut = (quote * BigInt(10_000 - slippageBps)) / 10_000n;

  async function submit() {
    if (!coin) return;
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

  return (
    <main className="mx-auto max-w-md px-4 py-10 sm:py-16">
      <section className="rounded-3xl border border-line bg-chip p-4">
        <div className="flex items-center justify-between px-1">
          <h1 className="font-display text-3xl leading-none">Swap</h1>
          <button
            type="button"
            aria-label="Slippage settings"
            onClick={() => setSettings((v) => !v)}
            className="grid size-9 place-items-center rounded-full border border-line text-lg"
          >
            ⚙
          </button>
        </div>
        {settings ? (
          <div className="mt-3 rounded-2xl border border-line bg-bg p-3">
            <p className="text-xs tracking-[0.14em] text-muted uppercase">Slippage</p>
            <div className="mt-2 flex gap-2">
              {SLIPPAGE.map((bps) => (
                <button
                  key={bps}
                  type="button"
                  onClick={() => setSlippageBps(bps)}
                  className={`rounded-full px-3 py-1 text-sm ${slippageBps === bps ? "bg-fg text-bg" : "border border-line text-muted"}`}
                >
                  {bps / 100}%
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="relative mt-3">
          <SwapBox
            label="You pay"
            amount={amount}
            onAmount={setAmount}
            symbol={payEth ? "ETH" : coin?.symbol ?? "Select"}
            onPick={!payEth && listed.length > 0 ? () => setPicker(true) : undefined}
            balance={balance}
            onMax={coin && balance !== undefined ? () => setAmount(formatEther(balance)) : undefined}
          />
          <button
            type="button"
            aria-label="Flip direction"
            onClick={() => {
              setPayEth((v) => !v);
              setAmount("");
            }}
            className="absolute top-1/2 left-1/2 z-10 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-xl border border-line bg-chip"
          >
            ↓
          </button>
          <div className="h-2" />
          <SwapBox
            label="You receive"
            amount={quote === 0n ? "" : fmt(quote)}
            symbol={payEth ? coin?.symbol ?? "Select" : "ETH"}
            onPick={payEth && listed.length > 0 ? () => setPicker(true) : undefined}
            readOnly
          />
          {picker ? (
            <ul className="absolute inset-x-0 top-16 z-20 max-h-64 overflow-auto rounded-2xl border border-line bg-bg p-2 shadow-xl">
              {listed.map((c) => (
                <li key={c.token}>
                  <button
                    type="button"
                    onClick={() => {
                      setToken(c.token);
                      setPicker(false);
                    }}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left hover:bg-chip"
                  >
                    <span>
                      {c.name}
                      <span className="ml-2 text-xs text-muted">${c.symbol}</span>
                    </span>
                    <span className="text-xs text-muted">{fmt(wethPerToken(c.sqrtPriceX96, c.tokenIs0), 6)} ETH</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {coin ? (
          <p className="mt-3 px-1 text-sm">
            1 {coin.symbol} = {fmt(price, 8)} ETH
          </p>
        ) : (
          <p className="mt-3 px-1 text-sm text-muted">
            No Chimi pool yet. <Link to="/launch" className="text-gold">Launch a token</Link>
          </p>
        )}
        <p className="px-1 text-xs text-muted">Chimi pool · 1% fee · slippage {slippageBps / 100}%</p>
        <button
          type="button"
          disabled={busy || !coin}
          onClick={() => void submit()}
          className="mt-4 w-full rounded-2xl bg-seal py-3 text-sm font-semibold text-onseal disabled:opacity-40"
        >
          {busy ? "Swapping…" : !coin ? "Select a token" : account ? "Swap" : "Connect wallet"}
        </button>
        {note ? (
          <p className={`mt-3 px-1 text-sm ${kind === "bad" ? "text-seal" : kind === "good" ? "text-ok" : "text-muted"}`}>
            {note}
          </p>
        ) : null}
      </section>
    </main>
  );
}

function SwapBox({
  label,
  amount,
  onAmount,
  symbol,
  onPick,
  balance,
  onMax,
  readOnly,
}: {
  label: string;
  amount: string;
  onAmount?: (value: string) => void;
  symbol: string;
  onPick?: () => void;
  balance?: bigint;
  onMax?: () => void;
  readOnly?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-line bg-bg px-3 py-3">
      <div className="flex items-center justify-between text-xs text-muted">
        <span>{label}</span>
        {balance !== undefined ? <span>Balance {fmt(balance, 4)}</span> : <span />}
      </div>
      <div className="mt-1 flex items-center gap-2">
        <input
          inputMode="decimal"
          readOnly={readOnly}
          value={amount}
          placeholder="0"
          onChange={(e) => onAmount?.(e.target.value)}
          className="w-full bg-transparent text-3xl outline-none"
        />
        <button
          type="button"
          onClick={onPick}
          className="flex shrink-0 items-center gap-1 rounded-full border border-line bg-chip px-3 py-1.5 text-sm"
        >
          {symbol}
          {onPick ? <span aria-hidden>▾</span> : null}
        </button>
      </div>
      {onMax ? (
        <button type="button" onClick={onMax} className="mt-1 text-xs text-gold">
          Max
        </button>
      ) : null}
    </div>
  );
}

