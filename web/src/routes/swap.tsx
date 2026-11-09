import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { formatEther, parseEther } from "viem";
import { POOL_FEE, erc20Abi, giwaSepolia } from "@/lib/chimi/chain";
import { publicClient } from "@/lib/chimi/client";
import { amountText, compactUsd, ethText } from "@/lib/chimi/format";
import { SUPPLY, useEthUsd } from "@/lib/chimi/live";
import { estimatedOut, feeLabel, short, wethPerToken, type Coin } from "@/lib/chimi/market";
import { useTokenImages } from "@/lib/chimi/token-image";
import { IconArrowDown, IconChevronDown, IconChevronRight, IconSearch, IconSliders } from "@/components/chimi/icons";
import { useChimi } from "@/components/chimi/provider";
import { toast } from "@/components/chimi/toast";
import { EthLogo, TokenLogo } from "@/components/chimi/token-logo";
import { Modal, Note } from "@/components/chimi/ui";

export const Route = createFileRoute("/swap")({
  head: () => ({ meta: [{ title: "Swap · Chimi" }] }),
  component: SwapPage,
});

const SLIPPAGE = [100, 200, 500];
const GAS_RESERVE = 200_000_000_000_000n;

function SwapPage() {
  const { coins, account, connect, trade, live, loading } = useChimi();
  const [token, setToken] = useState("");
  const [payEth, setPayEth] = useState(true);
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(200);
  const [settings, setSettings] = useState(false);
  const [picker, setPicker] = useState(false);
  const images = useTokenImages(useMemo(() => coins.map((item) => item.token), [coins]));
  const ethUsd = useEthUsd();
  const [payBal, setPayBal] = useState<bigint>();
  const [recvBal, setRecvBal] = useState<bigint>();
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<"" | "bad" | "good">("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  const coin = useMemo(() => coins.find((c) => c.token.toLowerCase() === token.toLowerCase()) ?? coins[0], [coins, token]);

  useEffect(() => {
    if (!account || !coin || coin.preview) {
      setPayBal(undefined);
      setRecvBal(undefined);
      return;
    }
    let cancel = false;
    const eth = publicClient.getBalance({ address: account });
    const tok = publicClient.readContract({ address: coin.token, abi: erc20Abi, functionName: "balanceOf", args: [account] });
    void Promise.all([eth, tok])
      .then(([e, t]) => {
        if (cancel) return;
        setPayBal(payEth ? e : t);
        setRecvBal(payEth ? t : e);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [account, coin, payEth, reload]);

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
  const priceEth = Number(price) / 1e18;
  const usdOf = (wei: bigint, isEth: boolean) => (ethUsd && wei > 0n ? compactUsd((Number(wei) / 1e18) * (isEth ? 1 : priceEth) * ethUsd) : undefined);
  const payUsd = !badAmount ? usdOf(parsed, payEth) : undefined;
  const recvUsd = usdOf(quote, !payEth);
  const lacking = !!account && payBal !== undefined && parsed > payBal;

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
      setNote(payEth ? "Confirm in your wallet." : "Approve, then confirm the sale in your wallet.");
      const hash = await trade(coin, payEth ? "buy" : "sell", amount.trim(), minOut);
      setKind("good");
      setNote(payEth ? "Bought." : "Sold for wrapped ETH.");
      toast({
        kind: "good",
        title: payEth ? `Bought ${coin.symbol}` : `Sold ${coin.symbol}`,
        body: payEth ? undefined : "You received wrapped ETH. Unwrap it from the coin’s page.",
        href: `${giwaSepolia.blockExplorers.default.url}/tx/${hash}`,
      });
      setAmount("");
      setReload((n) => n + 1);
    } catch (err) {
      setKind("bad");
      setNote(short(err));
    } finally {
      setBusy(false);
    }
  }

  const paySymbol = payEth ? "ETH" : (coin?.symbol ?? "Select");
  const recvSymbol = payEth ? (coin?.symbol ?? "Select") : "ETH";
  const coinImage = coin ? images[coin.token.toLowerCase()] : undefined;
  const flip = () => {
    setPayEth((v) => !v);
    setAmount("");
    setNote("");
  };
  const max = () => {
    if (payBal === undefined) return;
    setAmount(formatEther(payEth ? (payBal > GAS_RESERVE ? payBal - GAS_RESERVE : 0n) : payBal));
  };

  return (
    <main className="page flex flex-col items-center pt-8 pb-20 sm:pt-12">
      <div className="w-full max-w-[480px]">
        <div className="flex items-end justify-between gap-3 px-1">
          <div>
            <p className="eyebrow">{loading ? "GIWA Sepolia" : live ? "GIWA Sepolia" : "Preview"}</p>
            <h1 className="mt-2 text-[34px] leading-none font-semibold tracking-[-0.03em] sm:text-[40px]">Swap</h1>
          </div>
          <button type="button" aria-expanded={settings} onClick={() => setSettings((v) => !v)} className={`btn btn-secondary gap-1.5 px-3 ${settings ? "border-edge bg-raise2" : ""}`}>
            <IconSliders size={16} />
            <span className="num text-[13px]">{slippageBps / 100}% slippage</span>
          </button>
        </div>

        <div className="card relative mt-5 p-2.5 shadow-[0_40px_80px_-40px_rgba(0,0,0,.9)]">
          <div className="pointer-events-none absolute -top-20 left-1/2 -z-10 h-[220px] w-[380px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(212,67,43,.16),transparent)]" />
          {settings ? (
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-bg px-4 py-3">
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

          <div className="relative flex flex-col gap-1">
            <Field
              label="You pay"
              balance={payBal}
              value={amount}
              onChange={setAmount}
              symbol={paySymbol}
              eth={payEth}
              image={payEth ? undefined : coinImage}
              onPick={!payEth && coins.length > 0 ? () => setPicker(true) : undefined}
              onMax={payBal !== undefined ? max : undefined}
              usd={payUsd}
              bad={lacking}
            />
            <button
              type="button"
              aria-label="Flip direction"
              onClick={flip}
              className="absolute top-1/2 left-1/2 z-10 grid size-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-xl border-[3px] border-chip bg-raise2 text-fg transition-transform duration-200 hover:rotate-180"
            >
              <IconArrowDown size={16} />
            </button>
            <Field
              label="You receive"
              balance={recvBal}
              value={quote === 0n ? "0" : amountText(quote, 6)}
              symbol={recvSymbol}
              eth={!payEth}
              image={payEth ? coinImage : undefined}
              onPick={payEth && coins.length > 0 ? () => setPicker(true) : undefined}
              readOnly
              dim={quote === 0n}
              usd={recvUsd}
            />
          </div>

          <button type="button" disabled={busy || !tradable || lacking} onClick={() => void submit()} className="btn btn-xl btn-primary mt-2.5 w-full">
            {loading ? "Loading coins…" : busy ? "Swapping…" : !coin ? "No coins yet" : !tradable ? "Preview coin" : !account ? "Connect wallet" : lacking ? `Not enough ${paySymbol}` : payEth ? `Buy ${coin.symbol}` : `Sell ${coin.symbol}`}
          </button>
          <Note kind={kind} className="mt-2.5 mb-1 text-center">
            {note}
          </Note>
        </div>

        {coin ? (
          <dl className="mt-4 space-y-2.5 px-3 text-[13px]">
            <Row label="Rate" value={`1 ${coin.symbol} = ${priceEth > 0 ? ethText(priceEth) : "0"} ETH`} />
            <Row label="Minimum received" value={quote === 0n ? "—" : `${amountText(minOut, 6)} ${recvSymbol}`} />
            <Row label="Route" value={`Chimi pool · ${feeLabel(coin.fee ?? POOL_FEE)} fee`} />
          </dl>
        ) : null}

        {coin ? (
          <Link to="/coin/$address" params={{ address: coin.token }} className="card card-lift group mt-5 flex items-center gap-3.5 p-4">
            <TokenLogo symbol={coin.symbol} image={coinImage} size={40} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-semibold">{coin.name}</span>
              <span className="block text-[13px] text-muted">Chart, trades and holders</span>
            </span>
            <IconChevronRight size={17} className="text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-fg" />
          </Link>
        ) : null}

        {!loading && !live ? <p className="mt-4 text-center text-sm text-muted">Preview pools. Swaps open once a coin is on the factory.</p> : null}
      </div>

      {picker ? (
        <Picker
          coins={coins}
          images={images}
          current={coin?.token}
          ethUsd={ethUsd}
          onClose={() => setPicker(false)}
          onPick={(c) => {
            setToken(c.token);
            setPicker(false);
            setAmount("");
            setNote("");
          }}
        />
      ) : null}
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="num text-right">{value}</dd>
    </div>
  );
}

function Field({
  label,
  balance,
  value,
  onChange,
  symbol,
  eth,
  image,
  onPick,
  onMax,
  readOnly,
  dim,
  usd,
  bad,
}: {
  label: string;
  balance?: bigint;
  value: string;
  onChange?: (value: string) => void;
  symbol: string;
  eth: boolean;
  image?: string;
  onPick?: () => void;
  onMax?: () => void;
  readOnly?: boolean;
  dim?: boolean;
  usd?: string;
  bad?: boolean;
}) {
  const chip = (
    <>
      {eth ? <EthLogo size={26} /> : <TokenLogo symbol={symbol} image={image} size={26} />}
      {symbol}
      {onPick ? <IconChevronDown size={14} className="text-muted" /> : null}
    </>
  );
  const chipClass = "flex shrink-0 items-center gap-2 rounded-full bg-raise2 py-1.5 pr-3 pl-1.5 text-base font-semibold";
  return (
    <div className={`rounded-xl border px-4 py-4 transition-colors sm:px-5 ${bad ? "border-down/60" : "border-transparent focus-within:border-edge"} ${readOnly ? "bg-bg/60" : "bg-bg"}`}>
      <div className="flex justify-between text-[13px] text-muted">
        <span>{label}</span>
        {balance === undefined ? null : onMax ? (
          <button type="button" onClick={onMax} className="num hover:text-fg">
            Balance {amountText(balance)} · <span className="font-semibold text-gold">Max</span>
          </button>
        ) : (
          <span className="num">Balance {amountText(balance)}</span>
        )}
      </div>
      <div className="mt-2 flex items-center gap-3">
        {readOnly ? (
          <span className={`num min-w-0 flex-1 truncate text-[36px] leading-[1.1] font-medium tracking-[-0.03em] ${dim ? "text-faint" : ""}`}>{value}</span>
        ) : (
          <input
            inputMode="decimal"
            value={value}
            placeholder="0"
            aria-label="Amount to pay"
            autoComplete="off"
            onChange={(e) => onChange?.(e.target.value.replace(",", "."))}
            className="num min-w-0 flex-1 bg-transparent text-[36px] leading-[1.1] font-medium tracking-[-0.03em] outline-none placeholder:text-faint"
          />
        )}
        {onPick ? (
          <button type="button" onClick={onPick} className={`${chipClass} transition-colors hover:bg-edge`}>
            {chip}
          </button>
        ) : (
          <span className={chipClass}>{chip}</span>
        )}
      </div>
      <p className="num mt-1.5 h-[18px] text-[13px] text-muted">{usd ?? ""}</p>
    </div>
  );
}

function Picker({
  coins,
  images,
  current,
  ethUsd,
  onClose,
  onPick,
}: {
  coins: Coin[];
  images: Record<string, string>;
  current?: string;
  ethUsd?: number;
  onClose: () => void;
  onPick: (coin: Coin) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const list = q ? coins.filter((c) => c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q) || c.token.toLowerCase() === q) : coins;
  return (
    <Modal title="Select a coin" onClose={onClose} width={480}>
      <label className="field mt-4 flex items-center gap-2.5 py-0">
        <IconSearch size={16} className="shrink-0 text-faint" />
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, ticker or address" aria-label="Find a coin" className="h-11 min-w-0 flex-1 bg-transparent outline-none" />
      </label>
      <div className="-mx-2 mt-3 flex max-h-[52dvh] flex-col gap-0.5 overflow-y-auto">
        {list.length === 0 ? <p className="px-3 py-8 text-center text-sm text-muted">No coin matches “{query.trim()}”.</p> : null}
        {list.map((c) => {
          const eth = Number(wethPerToken(c.sqrtPriceX96, c.tokenIs0)) / 1e18;
          return (
            <button key={c.token} type="button" onClick={() => onPick(c)} className={`flex items-center gap-3.5 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-raise2 ${c.token === current ? "bg-raise" : ""}`}>
              <TokenLogo symbol={c.symbol} image={images[c.token.toLowerCase()]} size={40} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium">{c.name}</span>
                <span className="block text-[13px] text-muted">
                  ${c.symbol}
                  {c.preview ? " · preview" : ""}
                </span>
              </span>
              <span className="num text-right text-[13px] text-muted">{ethUsd ? compactUsd(eth * SUPPLY * ethUsd) : `${ethText(eth)} ETH`}</span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
