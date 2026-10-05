import { useEffect, useState } from "react";
import {
  createWalletClient,
  custom,
  encodeFunctionData,
  formatEther,
  maxUint256,
  parseEther,
  type Address,
  type EIP1193Provider,
  type WalletClient,
} from "viem";
import {
  erc20Abi,
  giwaSepolia,
  POOL_FEE,
  positionManagerAbi,
  wethAbi,
  type Deployment,
} from "@/lib/chimi/chain";
import { publicClient } from "@/lib/chimi/client";
import { fmt, short, type Coin, type PoolSwap } from "@/lib/chimi/market";
import {
  bandPercents,
  depositSide,
  formatTokenPrice,
  isFullRange,
  MAX_TICK,
  MIN_TICK,
  pairAmount,
  parseTokenPrice,
  presetRange,
  ticksFromTokenPrices,
  tickFromSqrtPriceX96,
  tokenPriceBounds,
  tokensPerEthFromTick,
  type DepositSide,
  type RangePreset,
  type TickRange,
} from "@/lib/chimi/range";

const MAX128 = 2n ** 128n - 1n;
const GAS_RESERVE = 50_000_000_000_000n;

type Held = {
  id: bigint;
  liquidity: bigint;
  tickLower: number;
  tickUpper: number;
};

const PRESETS: { id: RangePreset; title: string; blurb: string }[] = [
  { id: "tight", title: "Tight", blurb: "Smallest band on a 1% pool." },
  { id: "wide", title: "Wide", blurb: "Around the current price." },
  { id: "lower", title: "Below price", blurb: "Earns fees if the price falls." },
  { id: "upper", title: "Above price", blurb: "Earns fees if the price rises." },
];

function clientFor(account: Address): WalletClient {
  const ethereum = (window as Window & { ethereum?: EIP1193Provider }).ethereum;
  if (!ethereum) throw new Error("No wallet found in this browser.");
  return createWalletClient({ account, chain: giwaSepolia, transport: custom(ethereum) });
}

function readAmount(value: string): bigint | null {
  const trimmed = value.trim();
  if (!trimmed) return 0n;
  try {
    return parseEther(trimmed);
  } catch {
    return null;
  }
}

function trimWei(wei: bigint): string {
  if (wei <= 0n) return "";
  const [whole, frac = ""] = formatEther(wei).split(".");
  const places = whole.replace("-", "").length > 3 ? 2 : whole === "0" ? 8 : 4;
  const cut = frac.slice(0, places).replace(/0+$/, "");
  return cut ? `${whole}.${cut}` : whole;
}

function signed(n: number): string {
  const body = Math.abs(n) < 10 ? Math.abs(n).toFixed(1) : String(Math.round(Math.abs(n)));
  return n < 0 ? `−${body}%` : `+${body}%`;
}

function presetLabel(preset: RangePreset, sqrtPriceX96: bigint, tokenIs0: boolean): string {
  if (preset === "wide") return "−50% to +100%";
  if (preset === "lower") return "−50%";
  if (preset === "upper") return "+100%";
  const band = bandPercents(presetRange(preset, sqrtPriceX96, tokenIs0), sqrtPriceX96, tokenIs0);
  return `${signed(band.down)} to ${signed(band.up)}`;
}

function sideCopy(side: DepositSide, symbol: string): string {
  if (side === "eth") return "Only ETH goes in. It converts once the price trades inside this range.";
  if (side === "token") return `Only ${symbol} goes in. It converts once the price trades inside this range.`;
  return "Both tokens are used at the current price. Anything that does not fit is returned.";
}

function rangeLabel(range: TickRange, tokenIs0: boolean, symbol: string): string {
  if (isFullRange(range)) return "Full range";
  const bounds = tokenPriceBounds(range.tickLower, range.tickUpper, tokenIs0);
  return `${formatTokenPrice(bounds.min)} – ${formatTokenPrice(bounds.max)} ${symbol} per ETH`;
}

function PriceChart({
  swaps,
  sqrtPriceX96,
  range,
  tokenIs0,
}: {
  swaps: PoolSwap[];
  sqrtPriceX96: bigint;
  range: TickRange;
  tokenIs0: boolean;
}) {
  const current = tokensPerEthFromTick(tickFromSqrtPriceX96(sqrtPriceX96), tokenIs0);
  const series = swaps
    .filter((swap) => swap.sqrtPriceX96 > 0n)
    .map((swap) => tokensPerEthFromTick(tickFromSqrtPriceX96(swap.sqrtPriceX96), tokenIs0));
  const points = series.length > 0 ? series : [current];
  const full = isFullRange(range);
  const bounds = full ? null : tokenPriceBounds(range.tickLower, range.tickUpper, tokenIs0);
  const samples = bounds ? [...points, current, bounds.min, bounds.max] : [...points, current];
  const lo = Math.min(...samples);
  const hi = Math.max(...samples);
  const pad = (hi - lo) * 0.28 || Math.abs(hi) * 0.08 || 1;
  const yLo = lo - pad;
  const yHi = hi + pad;
  const yOf = (price: number) => 148 - ((price - yLo) / (yHi - yLo)) * 124;
  const line = points.length < 2
    ? `M 20 ${yOf(points[0] ?? current).toFixed(1)} L 580 ${yOf(points[0] ?? current).toFixed(1)}`
    : points.map((price, i) => `${i === 0 ? "M" : "L"} ${(20 + (i * 560) / (points.length - 1)).toFixed(1)} ${yOf(price).toFixed(1)}`).join(" ");
  const bandTop = bounds ? yOf(bounds.max) : 12;
  const bandBottom = bounds ? yOf(bounds.min) : 148;

  return (
    <svg viewBox="0 0 600 170" className="mt-4 h-40 w-full" role="img" aria-label="Price and selected range">
      <rect x="20" y={Math.min(bandTop, bandBottom)} width="560" height={Math.max(4, Math.abs(bandBottom - bandTop))} fill="rgba(224,180,90,0.18)" />
      <path d={line} fill="none" stroke="#e0b45a" strokeWidth="2" />
      <line x1="20" x2="580" y1={yOf(current)} y2={yOf(current)} stroke="#d24a2e" strokeDasharray="4 4" />
      {full ? (
        <text x="32" y="28" fill="#b6a68a" fontSize="13">Full range</text>
      ) : null}
    </svg>
  );
}

function AmountField({
  label,
  value,
  onChange,
  balance,
  onMax,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  balance: string;
  onMax?: () => void;
  disabled?: boolean;
}) {
  return (
    <label className="block text-sm text-muted">
      <span className="flex items-center justify-between">
        <span>{label}</span>
        <span className="text-xs">{balance}</span>
      </span>
      <span className="mt-1 flex items-center gap-2 rounded-xl border border-line bg-bg px-3">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          inputMode="decimal"
          placeholder="0"
          disabled={disabled}
          className="w-full bg-transparent py-2.5 outline-none disabled:opacity-40"
        />
        {onMax && !disabled ? (
          <button type="button" onClick={onMax} className="text-xs font-semibold text-gold">Max</button>
        ) : null}
      </span>
    </label>
  );
}

export function PositionDesk({
  coin,
  deployment,
  account,
  connect,
  swaps,
  onChanged,
}: {
  coin: Coin;
  deployment: Deployment;
  account?: Address;
  connect: () => Promise<unknown>;
  swaps: PoolSwap[];
  onChanged: () => void;
}) {
  const [positions, setPositions] = useState<Held[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [reload, setReload] = useState(0);
  const [rangeMode, setRangeMode] = useState<"full" | "custom">("full");
  const [preset, setPreset] = useState<RangePreset | null>("wide");
  const [ticks, setTicks] = useState<TickRange>({ tickLower: MIN_TICK, tickUpper: MAX_TICK });
  const [minText, setMinText] = useState("");
  const [maxText, setMaxText] = useState("");
  const [createEth, setCreateEth] = useState("");
  const [createToken, setCreateToken] = useState("");
  const [createAsEth, setCreateAsEth] = useState(true);
  const [incEth, setIncEth] = useState("");
  const [incToken, setIncToken] = useState("");
  const [incAsEth, setIncAsEth] = useState(true);
  const [receiveEth, setReceiveEth] = useState(true);
  const [ethBal, setEthBal] = useState(0n);
  const [wethBal, setWethBal] = useState(0n);
  const [tokenBal, setTokenBal] = useState(0n);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const selected = positions.find((position) => position.id.toString() === selectedId) ?? positions[0];
  const createRange: TickRange = rangeMode === "full" ? { tickLower: MIN_TICK, tickUpper: MAX_TICK } : ticks;
  const createSide = depositSide(coin.sqrtPriceX96, createRange, coin.tokenIs0);
  const currentTokens = coin.sqrtPriceX96 > 0n
    ? tokensPerEthFromTick(tickFromSqrtPriceX96(coin.sqrtPriceX96), coin.tokenIs0)
    : 0;

  useEffect(() => {
    if (!account) {
      setPositions([]);
      return;
    }
    let cancel = false;
    void (async () => {
      const count = await publicClient.readContract({
        address: deployment.positionManager,
        abi: positionManagerAbi,
        functionName: "balanceOf",
        args: [account],
      });
      const next: Held[] = [];
      for (let i = 0n; i < count; i++) {
        const id = await publicClient.readContract({
          address: deployment.positionManager,
          abi: positionManagerAbi,
          functionName: "tokenOfOwnerByIndex",
          args: [account, i],
        });
        const pos = await publicClient.readContract({
          address: deployment.positionManager,
          abi: positionManagerAbi,
          functionName: "positions",
          args: [id],
        });
        const tokens = [pos[2].toLowerCase(), pos[3].toLowerCase()];
        if (pos[4] !== POOL_FEE) continue;
        if (!tokens.includes(coin.token.toLowerCase()) || !tokens.includes(deployment.weth.toLowerCase())) continue;
        next.push({ id, liquidity: pos[7], tickLower: Number(pos[5]), tickUpper: Number(pos[6]) });
      }
      if (cancel) return;
      setPositions(next);
      setSelectedId((current) => (next.some((position) => position.id.toString() === current) ? current : next[0]?.id.toString()));
    })().catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [account, coin.token, deployment, reload]);

  useEffect(() => {
    if (!account) return;
    let cancel = false;
    void Promise.all([
      publicClient.getBalance({ address: account }),
      publicClient.readContract({ address: deployment.weth, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
      publicClient.readContract({ address: coin.token, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
    ]).then(([native, wrapped, token]) => {
      if (cancel) return;
      setEthBal(native);
      setWethBal(wrapped);
      setTokenBal(token);
    }).catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [account, coin.token, deployment, reload]);

  function applyPreset(next: RangePreset) {
    const range = presetRange(next, coin.sqrtPriceX96, coin.tokenIs0);
    const bounds = tokenPriceBounds(range.tickLower, range.tickUpper, coin.tokenIs0);
    setPreset(next);
    setRangeMode("custom");
    setTicks(range);
    setMinText(formatTokenPrice(bounds.min));
    setMaxText(formatTokenPrice(bounds.max));
    setCreateEth("");
    setCreateToken("");
    setNote("");
  }

  function pricesToRange(min: number, max: number): TickRange {
    return ticksFromTokenPrices(min, max, coin.tokenIs0);
  }

  function commitPrices() {
    const min = parseTokenPrice(minText);
    const max = parseTokenPrice(maxText);
    if (!(min > 0) || !(max > 0) || min === max) {
      setNote("Enter a min and a max price.");
      return;
    }
    const range = pricesToRange(min, max);
    const bounds = tokenPriceBounds(range.tickLower, range.tickUpper, coin.tokenIs0);
    setTicks(range);
    setMinText(formatTokenPrice(bounds.min));
    setMaxText(formatTokenPrice(bounds.max));
    setNote("");
  }

  function fillCreate(edited: "eth" | "token", value: string) {
    if (edited === "eth") setCreateEth(value);
    else setCreateToken(value);
    const amount = readAmount(value);
    if (amount === null) return;
    const paired = pairAmount({
      sqrtPriceX96: coin.sqrtPriceX96,
      range: createRange,
      tokenIs0: coin.tokenIs0,
      amount,
      edited,
    });
    if (edited === "eth") setCreateToken(createSide === "eth" ? "" : trimWei(paired.tokenAmount));
    else setCreateEth(createSide === "token" ? "" : trimWei(paired.ethAmount));
  }

  function fillIncrease(edited: "eth" | "token", value: string) {
    if (!selected) return;
    if (edited === "eth") setIncEth(value);
    else setIncToken(value);
    const amount = readAmount(value);
    if (amount === null) return;
    const range = { tickLower: selected.tickLower, tickUpper: selected.tickUpper };
    const side = depositSide(coin.sqrtPriceX96, range, coin.tokenIs0);
    const paired = pairAmount({
      sqrtPriceX96: coin.sqrtPriceX96,
      range,
      tokenIs0: coin.tokenIs0,
      amount,
      edited,
    });
    if (edited === "eth") setIncToken(side === "eth" ? "" : trimWei(paired.tokenAmount));
    else setIncEth(side === "token" ? "" : trimWei(paired.ethAmount));
  }

  async function approveAndSend(eth: bigint, tokens: bigint, asEth: boolean, range: TickRange, position?: Held) {
    if (!account) return;
    const wallet = clientFor(account);
    const npm = deployment.positionManager;
    const weth = deployment.weth;
    const [token0, token1] = weth.toLowerCase() < coin.token.toLowerCase() ? [weth, coin.token] : [coin.token, weth];
    const amount0 = token0.toLowerCase() === weth.toLowerCase() ? eth : tokens;
    const amount1 = token1.toLowerCase() === weth.toLowerCase() ? eth : tokens;
    if (eth > 0n && asEth) {
      setNote("Wrapping ETH.");
      const wrap = await wallet.writeContract({
        account,
        chain: giwaSepolia,
        address: weth,
        abi: wethAbi,
        functionName: "deposit",
        value: eth,
      });
      await publicClient.waitForTransactionReceipt({ hash: wrap });
    }
    for (const [asset, amt] of [[weth, eth], [coin.token, tokens]] as const) {
      if (amt === 0n) continue;
      const allowance = await publicClient.readContract({
        address: asset,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account, npm],
      });
      if (allowance < amt) {
        setNote("Approving the position manager.");
        const approve = await wallet.writeContract({
          account,
          chain: giwaSepolia,
          address: asset,
          abi: erc20Abi,
          functionName: "approve",
          args: [npm, maxUint256],
        });
        await publicClient.waitForTransactionReceipt({ hash: approve });
      }
    }
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
    if (position) {
      setNote("Increasing this position.");
      const hash = await wallet.writeContract({
        account,
        chain: giwaSepolia,
        address: npm,
        abi: positionManagerAbi,
        functionName: "increaseLiquidity",
        args: [{
          tokenId: position.id,
          amount0Desired: amount0,
          amount1Desired: amount1,
          amount0Min: 0n,
          amount1Min: 0n,
          deadline,
        }],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setNote("Liquidity added. Unused tokens were returned.");
      setIncEth("");
      setIncToken("");
    } else {
      setNote("Creating a position.");
      const hash = await wallet.writeContract({
        account,
        chain: giwaSepolia,
        address: npm,
        abi: positionManagerAbi,
        functionName: "mint",
        args: [{
          token0,
          token1,
          fee: POOL_FEE,
          tickLower: range.tickLower,
          tickUpper: range.tickUpper,
          amount0Desired: amount0,
          amount1Desired: amount1,
          amount0Min: 0n,
          amount1Min: 0n,
          recipient: account,
          deadline,
        }],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setNote("Position created. Unused tokens were returned.");
      setCreateEth("");
      setCreateToken("");
    }
    setReload((n) => n + 1);
    onChanged();
  }

  async function submit(kind: "new" | "increase") {
    if (!account) {
      await connect();
      return;
    }
    const position = kind === "increase" ? selected : undefined;
    if (kind === "increase" && !position) return;
    let range = createRange;
    if (kind === "new" && rangeMode === "custom") {
      const min = parseTokenPrice(minText);
      const max = parseTokenPrice(maxText);
      if (!(min > 0) || !(max > 0) || min === max) {
        setNote("Enter a min and a max price.");
        return;
      }
      range = pricesToRange(min, max);
      setTicks(range);
    }
    if (kind === "increase" && position) {
      range = { tickLower: position.tickLower, tickUpper: position.tickUpper };
    }
    const ethText = kind === "new" ? createEth : incEth;
    const tokenText = kind === "new" ? createToken : incToken;
    let eth = readAmount(ethText);
    let tokens = readAmount(tokenText);
    if (eth === null || tokens === null) {
      setNote("Enter a valid amount.");
      return;
    }
    const side = depositSide(coin.sqrtPriceX96, range, coin.tokenIs0);
    if (side === "eth") tokens = 0n;
    if (side === "token") eth = 0n;
    if (eth === 0n && tokens === 0n) {
      setNote("Enter an amount.");
      return;
    }
    if (side === "both" && (eth === 0n || tokens === 0n)) {
      setNote("This range needs both tokens.");
      return;
    }
    try {
      setBusy(true);
      await approveAndSend(eth, tokens, kind === "new" ? createAsEth : incAsEth, range, position);
    } catch (err) {
      setNote(short(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(pct: number) {
    if (!account || !selected || selected.liquidity === 0n) return;
    const liquidity = (selected.liquidity * BigInt(pct)) / 100n;
    if (liquidity === 0n) {
      setNote("That share is too small to remove.");
      return;
    }
    try {
      setBusy(true);
      setNote(pct === 100 ? "Removing all liquidity." : `Removing ${pct}%.`);
      const wallet = clientFor(account);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
      const calls: `0x${string}`[] = [
        encodeFunctionData({
          abi: positionManagerAbi,
          functionName: "decreaseLiquidity",
          args: [{ tokenId: selected.id, liquidity, amount0Min: 0n, amount1Min: 0n, deadline }],
        }),
      ];
      calls.push(...collectCalls(selected.id, receiveEth));
      if (pct === 100 && liquidity === selected.liquidity) {
        calls.push(encodeFunctionData({ abi: positionManagerAbi, functionName: "burn", args: [selected.id] }));
      }
      const hash = await wallet.writeContract({
        account,
        chain: giwaSepolia,
        address: deployment.positionManager,
        abi: positionManagerAbi,
        functionName: "multicall",
        args: [calls],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setNote(pct === 100 ? "Position closed. Tokens are in your wallet." : `${pct}% removed. Tokens are in your wallet.`);
      setReload((n) => n + 1);
      onChanged();
    } catch (err) {
      setNote(short(err));
    } finally {
      setBusy(false);
    }
  }

  function collectCalls(tokenId: bigint, asEth: boolean): `0x${string}`[] {
    if (!account) return [];
    if (!asEth) {
      return [
        encodeFunctionData({
          abi: positionManagerAbi,
          functionName: "collect",
          args: [{ tokenId, recipient: account, amount0Max: MAX128, amount1Max: MAX128 }],
        }),
      ];
    }
    return [
      encodeFunctionData({
        abi: positionManagerAbi,
        functionName: "collect",
        args: [{ tokenId, recipient: deployment.positionManager, amount0Max: MAX128, amount1Max: MAX128 }],
      }),
      encodeFunctionData({
        abi: positionManagerAbi,
        functionName: "unwrapWETH9",
        args: [0n, account],
      }),
      encodeFunctionData({
        abi: positionManagerAbi,
        functionName: "sweepToken",
        args: [coin.token, 0n, account],
      }),
    ];
  }

  async function collect() {
    if (!account || !selected) return;
    try {
      setBusy(true);
      setNote("Collecting fees.");
      const wallet = clientFor(account);
      const hash = await wallet.writeContract({
        account,
        chain: giwaSepolia,
        address: deployment.positionManager,
        abi: positionManagerAbi,
        functionName: "multicall",
        args: [collectCalls(selected.id, receiveEth)],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setNote("Fees collected.");
      setReload((n) => n + 1);
      onChanged();
    } catch (err) {
      setNote(short(err));
    } finally {
      setBusy(false);
    }
  }

  const spendableEth = (asEth: boolean) => {
    if (!asEth) return wethBal;
    return ethBal > GAS_RESERVE ? ethBal - GAS_RESERVE : 0n;
  };
  const increaseRange = selected
    ? { tickLower: selected.tickLower, tickUpper: selected.tickUpper }
    : createRange;
  const increaseSide = depositSide(coin.sqrtPriceX96, increaseRange, coin.tokenIs0);

  return (
    <div className="mt-4 grid gap-4">
      {selected ? (
        <section className="rounded-3xl border border-line bg-chip p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Your position</h2>
              <p className="mt-1 text-sm text-muted">{rangeLabel(increaseRange, coin.tokenIs0, coin.symbol)}</p>
            </div>
            {positions.length > 1 ? (
              <div className="flex flex-wrap gap-2">
                {positions.map((position, index) => (
                  <button
                    key={position.id.toString()}
                    type="button"
                    onClick={() => setSelectedId(position.id.toString())}
                    className={`rounded-full px-3 py-1.5 text-sm ${position.id === selected.id ? "bg-seal text-onseal" : "border border-line"}`}
                  >
                    Position {index + 1}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <p className="mt-4 text-sm text-muted">The range cannot change. Adding more uses this same position.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <AmountField
              label={incAsEth ? "ETH" : "WETH"}
              value={increaseSide === "token" ? "" : incEth}
              onChange={(value) => fillIncrease("eth", value)}
              balance={account ? fmt(spendableEth(incAsEth), 4) : "—"}
              disabled={increaseSide === "token"}
              onMax={() => fillIncrease("eth", trimWei(spendableEth(incAsEth)))}
            />
            <AmountField
              label={coin.symbol}
              value={increaseSide === "eth" ? "" : incToken}
              onChange={(value) => fillIncrease("token", value)}
              balance={account ? fmt(tokenBal, 2) : "—"}
              disabled={increaseSide === "eth"}
              onMax={() => fillIncrease("token", trimWei(tokenBal))}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <EthToggle on={incAsEth} onChange={setIncAsEth} label="Add as ETH" />
            <button type="button" disabled={busy} onClick={() => void submit("increase")} className="rounded-full bg-seal px-5 py-2.5 text-sm font-semibold text-onseal disabled:opacity-40">
              {busy ? "Confirming…" : account ? "Increase liquidity" : "Connect wallet"}
            </button>
          </div>
          {selected.liquidity > 0n ? (
            <div className="mt-6 border-t border-line pt-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">Remove liquidity</h3>
                <EthToggle on={receiveEth} onChange={setReceiveEth} label="Receive ETH" />
              </div>
              <p className="mt-1 text-sm text-muted">Burns that share, then sends the tokens to your wallet.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {[25, 50, 75, 100].map((pct) => (
                  <button key={pct} type="button" disabled={busy} onClick={() => void remove(pct)} className="rounded-full border border-line px-3 py-1.5 text-sm">
                    {pct === 100 ? "Remove all" : `${pct}%`}
                  </button>
                ))}
                <button type="button" disabled={busy} onClick={() => void collect()} className="rounded-full border border-line px-3 py-1.5 text-sm">
                  Collect fees
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted">This position is empty. Increase it to use the same range again.</p>
          )}
        </section>
      ) : null}

      <section id="new" className="rounded-3xl border border-line bg-chip p-5">
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(260px,0.85fr)]">
          <div>
            <h2 className="text-lg font-semibold">Set price range</h2>
            <p className="mt-1 text-sm text-muted">
              Current price · 1 ETH = {currentTokens > 0 ? formatTokenPrice(currentTokens) : "—"} {coin.symbol}
            </p>
            <div className="mt-4 grid grid-cols-2 rounded-full border border-line p-1 text-sm font-semibold">
              <button type="button" onClick={() => setRangeMode("full")} className={`rounded-full py-2 ${rangeMode === "full" ? "bg-seal text-onseal" : "text-muted"}`}>
                Full range
              </button>
              <button type="button" onClick={() => (minText && maxText ? setRangeMode("custom") : applyPreset(preset ?? "wide"))} className={`rounded-full py-2 ${rangeMode === "custom" ? "bg-seal text-onseal" : "text-muted"}`}>
                Custom range
              </button>
            </div>
            <PriceChart swaps={swaps} sqrtPriceX96={coin.sqrtPriceX96} range={createRange} tokenIs0={coin.tokenIs0} />
            {rangeMode === "full" ? (
              <p className="mt-3 text-sm text-muted">Earns fees at every price.</p>
            ) : (
              <>
                <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {PRESETS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => applyPreset(item.id)}
                      className={`rounded-2xl border px-3 py-3 text-left ${preset === item.id ? "border-gold bg-bg" : "border-line"}`}
                    >
                      <span className="block text-sm font-semibold">{item.title}</span>
                      <span className="mt-1 block text-sm text-gold">{presetLabel(item.id, coin.sqrtPriceX96, coin.tokenIs0)}</span>
                      <span className="mt-2 block text-xs text-muted">{item.blurb}</span>
                    </button>
                  ))}
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm text-muted">
                    Min price
                    <input
                      value={minText}
                      onChange={(event) => {
                        setMinText(event.target.value);
                        setPreset(null);
                      }}
                      onBlur={commitPrices}
                      inputMode="decimal"
                      className="mt-1 w-full rounded-xl border border-line bg-bg px-3 py-2.5 outline-none"
                    />
                    <span className="mt-1 block text-xs">{coin.symbol} = 1 ETH</span>
                  </label>
                  <label className="block text-sm text-muted">
                    Max price
                    <input
                      value={maxText}
                      onChange={(event) => {
                        setMaxText(event.target.value);
                        setPreset(null);
                      }}
                      onBlur={commitPrices}
                      inputMode="decimal"
                      className="mt-1 w-full rounded-xl border border-line bg-bg px-3 py-2.5 outline-none"
                    />
                    <span className="mt-1 block text-xs">{coin.symbol} = 1 ETH</span>
                  </label>
                </div>
              </>
            )}
            {rangeMode === "full" ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <PriceReadout label="Min price" value="0" unit={`${coin.symbol} = 1 ETH`} />
                <PriceReadout label="Max price" value="∞" unit={`${coin.symbol} = 1 ETH`} />
              </div>
            ) : null}
          </div>

          <div>
            <h2 className="text-lg font-semibold">Deposit tokens</h2>
            <p className="mt-1 text-sm text-muted">{sideCopy(createSide, coin.symbol)}</p>
            <div className="mt-4 grid gap-3">
              <AmountField
                label={createAsEth ? "ETH" : "WETH"}
                value={createSide === "token" ? "" : createEth}
                onChange={(value) => fillCreate("eth", value)}
                balance={account ? `${fmt(spendableEth(createAsEth), 4)} ${createAsEth ? "ETH" : "WETH"}` : "Connect to see balance"}
                disabled={createSide === "token"}
                onMax={() => fillCreate("eth", trimWei(spendableEth(createAsEth)))}
              />
              <EthToggle on={createAsEth} onChange={setCreateAsEth} label="Add as ETH" />
              <AmountField
                label={coin.symbol}
                value={createSide === "eth" ? "" : createToken}
                onChange={(value) => fillCreate("token", value)}
                balance={account ? `${fmt(tokenBal, 2)} ${coin.symbol}` : "Connect to see balance"}
                disabled={createSide === "eth"}
                onMax={() => fillCreate("token", trimWei(tokenBal))}
              />
            </div>
            <button type="button" disabled={busy} onClick={() => void submit("new")} className="mt-4 w-full rounded-full bg-seal py-2.5 text-sm font-semibold text-onseal disabled:opacity-40">
              {busy ? "Confirming…" : account ? "Create position" : "Connect wallet"}
            </button>
          </div>
        </div>
        {note ? <p className="mt-4 text-sm text-muted">{note}</p> : null}
      </section>
    </div>
  );
}

function PriceReadout({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="rounded-xl border border-line bg-bg px-3 py-2.5">
      <p className="text-sm text-muted">{label}</p>
      <p className="text-2xl">{value}</p>
      <p className="text-xs text-muted">{unit}</p>
    </div>
  );
}

function EthToggle({ on, onChange, label }: { on: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button type="button" aria-pressed={on} onClick={() => onChange(!on)} className="flex items-center gap-2 text-sm text-muted">
      {label}
      <span className={`relative h-6 w-11 rounded-full ${on ? "bg-seal" : "bg-line"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-fg ${on ? "left-5" : "left-0.5"}`} />
      </span>
    </button>
  );
}
