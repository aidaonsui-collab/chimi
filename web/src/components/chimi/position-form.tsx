import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
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
import { readTokenMeta } from "@/lib/chimi/meta";
import { PairMark } from "@/components/chimi/pair-mark";
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
  if (!Number.isFinite(n)) return "";
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
  ethUsd,
  stats,
  onBack,
}: {
  coin: Coin;
  deployment: Deployment;
  account?: Address;
  connect: () => Promise<unknown>;
  swaps: PoolSwap[];
  onChanged: () => void;
  ethUsd?: number;
  stats?: { tvl: string; vol: string; fees: string; apr: string };
  onBack?: () => void;
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
  const [zoom, setZoom] = useState(1);
  const [tf, setTf] = useState<"1D" | "1W" | "1M" | "1Y" | "All">("1D");
  const [image, setImage] = useState<string>();
  const chartRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<"min" | "max" | null>(null);

  const selected = positions.find((position) => position.id.toString() === selectedId) ?? positions[0];
  const createRange: TickRange = rangeMode === "full" ? { tickLower: MIN_TICK, tickUpper: MAX_TICK } : ticks;

  useEffect(() => {
    setImage(readTokenMeta(coin.token)?.image);
  }, [coin.token]);
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
  const shownBounds = tokenPriceBounds(createRange.tickLower, createRange.tickUpper, coin.tokenIs0);
  const windows = { "1D": 86_400, "1W": 86_400 * 7, "1M": 86_400 * 30, "1Y": 86_400 * 365, All: Infinity } as const;
  const now = Math.floor(Date.now() / 1000);
  const series = swaps
    .filter((swap) => swap.sqrtPriceX96 > 0n && now - swap.time <= windows[tf])
    .map((swap) => tokensPerEthFromTick(tickFromSqrtPriceX96(swap.sqrtPriceX96), coin.tokenIs0));
  const points = series.length > 0 ? series : currentTokens > 0 ? [currentTokens] : [];
  const span = 0.95 * zoom;
  const yOf = (price: number) => {
    if (!(price > 0) || !(currentTokens > 0)) return 50;
    return ((Math.log(currentTokens) + span - Math.log(price)) / (2 * span)) * 100;
  };
  const full = rangeMode === "full";
  const bandTop = full ? 0 : Math.max(0, Math.min(100, yOf(shownBounds.max)));
  const bandBot = full ? 100 : Math.max(0, Math.min(100, yOf(shownBounds.min)));
  const line = points
    .map((price, i) => {
      const x = points.length === 1 ? 500 : (i / (points.length - 1)) * 1000;
      const y = Math.min(108, Math.max(-8, yOf(price))) * 2.8;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const depth = Array.from({ length: 28 }, (_, i) => {
    const q = (i + 0.5) / 28;
    const logV = Math.log(Math.max(currentTokens, 1e-12)) + span - q * 2 * span;
    const price = Math.exp(logV);
    const dist = currentTokens > 0 ? (logV - Math.log(currentTokens)) / 0.4 : 0;
    const inside = full || (price >= shownBounds.min && price <= shownBounds.max);
    return { width: `${Math.round(Math.exp(-dist * dist) * 80 + 8)}%`, inside };
  });
  const spark = (() => {
    const recent = series.slice(-24);
    const row = recent.length > 1 ? recent : points;
    if (row.length < 2) return "";
    const lo = Math.min(...row);
    const hi = Math.max(...row);
    return row
      .map((price, i) => {
        const x = (i / (row.length - 1)) * 300;
        const y = 62 - ((price - lo) / (hi - lo || 1)) * 54;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
  })();
  const usd = (wei: bigint, eth: boolean) => {
    if (!ethUsd || wei <= 0n) return "";
    const n = Number(wei) / 1e18;
    const value = eth ? n * ethUsd : currentTokens > 0 ? (n / currentTokens) * ethUsd : 0;
    if (!Number.isFinite(value) || value <= 0) return "";
    return value >= 1000 ? `$${Math.round(value).toLocaleString("en-US")}` : `$${value.toFixed(2)}`;
  };
  const stepBound = (which: "min" | "max", dir: 1 | -1) => {
    if (rangeMode !== "custom") return;
    const factor = dir > 0 ? 1.02 : 1 / 1.02;
    const min = which === "min" ? shownBounds.min * factor : shownBounds.min;
    const max = which === "max" ? shownBounds.max * factor : shownBounds.max;
    if (!(max > min)) return;
    const range = ticksFromTokenPrices(min, max, coin.tokenIs0);
    const next = tokenPriceBounds(range.tickLower, range.tickUpper, coin.tokenIs0);
    setTicks(range);
    setPreset(null);
    setMinText(formatTokenPrice(next.min));
    setMaxText(formatTokenPrice(next.max));
    setCreateEth("");
    setCreateToken("");
  };

  useEffect(() => {
    function move(event: PointerEvent) {
      const which = dragRef.current;
      const el = chartRef.current;
      if (!which || !el || !(currentTokens > 0)) return;
      const rect = el.getBoundingClientRect();
      const t = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
      const price = Math.exp(Math.log(currentTokens) + span - t * 2 * span);
      const bounds = tokenPriceBounds(createRange.tickLower, createRange.tickUpper, coin.tokenIs0);
      const min = which === "min" ? price : bounds.min;
      const max = which === "max" ? price : bounds.max;
      if (!(Math.max(min, max) > Math.min(min, max) * 1.001)) return;
      const range = ticksFromTokenPrices(Math.min(min, max), Math.max(min, max), coin.tokenIs0);
      const next = tokenPriceBounds(range.tickLower, range.tickUpper, coin.tokenIs0);
      setRangeMode("custom");
      setTicks(range);
      setPreset(null);
      setMinText(formatTokenPrice(next.min));
      setMaxText(formatTokenPrice(next.max));
    }
    function up() {
      dragRef.current = null;
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [coin.tokenIs0, createRange.tickLower, createRange.tickUpper, currentTokens, span]);

  const currentTick = coin.sqrtPriceX96 > 0n ? tickFromSqrtPriceX96(coin.sqrtPriceX96) : 0;
  const heldInRange = selected ? currentTick >= selected.tickLower && currentTick < selected.tickUpper : false;

  return (
    <section className="mx-auto max-w-[1180px] px-4 py-10 sm:px-6">
      <nav className="flex flex-wrap items-center gap-2 text-sm">
        <Link to="/pools" className="text-muted">Pools</Link>
        <span className="text-[#7d6f5a]">/</span>
        <span>{coin.symbol} / ETH</span>
      </nav>
      <div className="mt-5 flex items-center gap-3.5">
        <button type="button" onClick={() => onBack?.()} aria-label="Back" className="grid size-10 place-items-center rounded-full border border-line bg-chip">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden><path d="M13 8H3M7.5 3.5 3 8l4.5 4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <h1 className="text-[clamp(30px,4vw,42px)] leading-none font-semibold tracking-[-0.035em]">Set your position</h1>
      </div>

      <div className="mt-7 flex flex-wrap items-start gap-5">
        <aside className="grid min-w-0 flex-[1_1_320px] gap-4">
          <div className="rounded-[28px] border border-line bg-chip/85 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,.04)]">
            <div className="flex items-center gap-3.5">
              <PairMark symbol={coin.symbol} image={image} size={44} />
              <div>
                <div className="text-xl font-semibold tracking-[-0.02em]">{coin.symbol} / ETH</div>
                <div className="mt-1 inline-flex overflow-hidden rounded-md bg-fg/7 text-xs text-muted"><span className="px-2 py-0.5">v3</span><span className="border-l border-chip px-2 py-0.5">1%</span></div>
              </div>
            </div>
            <p className="mt-5 text-[13px] text-muted">Current price</p>
            <p className="mt-0.5 text-lg font-medium tabular-nums">1 ETH = {currentTokens > 0 ? formatTokenPrice(currentTokens) : "—"} {coin.symbol}</p>
            <svg viewBox="0 0 300 70" className="mt-3.5 h-[70px] w-full bg-[radial-gradient(rgba(232,221,200,.09)_1px,transparent_1px)] bg-size-[14px_14px]">
              {spark ? <path d={spark} fill="none" stroke="#e0b45a" strokeWidth="1.8" strokeLinejoin="round" /> : null}
            </svg>
            <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-4 border-t border-line pt-4">
              <Stat label="TVL" value={stats?.tvl ?? "—"} />
              <Stat label="24h volume" value={stats?.vol ?? "—"} />
              <Stat label="24h fees" value={stats?.fees ?? "—"} />
              <Stat label="Fee APR" value={stats?.apr ?? "—"} gold />
            </div>
          </div>

          {selected ? (
            <div className="rounded-[28px] border border-line bg-chip/85 p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-[17px] font-semibold">Your position</h2>
                <span className={`flex items-center gap-1.5 text-[13px] ${heldInRange ? "text-ok" : "text-muted"}`}>
                  <span className={`size-1.5 rounded-full ${heldInRange ? "bg-ok" : "bg-muted"}`} />
                  {heldInRange ? "In range" : "Out of range"}
                </span>
              </div>
              <p className="mt-1 text-[13px] text-muted">{rangeLabel(increaseRange, coin.tokenIs0, coin.symbol)} · #{selected.id.toString()}</p>
              {selected.liquidity > 0n ? (
                <>
                  <div className="mt-4 flex items-center justify-between gap-3 text-sm">
                    <span className="text-muted">Remove liquidity</span>
                    <EthToggle on={receiveEth} onChange={setReceiveEth} label="Receive ETH" />
                  </div>
                  <div className="mt-2.5 grid grid-cols-4 gap-1.5">
                    {[25, 50, 75, 100].map((pct) => (
                      <button key={pct} type="button" disabled={busy} onClick={() => void remove(pct)} className="rounded-xl border border-line bg-bg py-2 text-[13px] font-medium">
                        {pct === 100 ? "All" : `${pct}%`}
                      </button>
                    ))}
                  </div>
                  <button type="button" disabled={busy} onClick={() => void collect()} className="mt-2.5 w-full rounded-[14px] bg-fg/7 py-2.5 text-sm font-medium">
                    Collect fees
                  </button>
                </>
              ) : (
                <p className="mt-3 text-sm text-muted">This position is empty. Increase it to use the same range again.</p>
              )}
              <div className="mt-4 grid gap-2 border-t border-line pt-4">
                <p className="text-sm text-muted">Increase this position. The range stays the same.</p>
                <AmountField label={incAsEth ? "ETH" : "WETH"} value={increaseSide === "token" ? "" : incEth} onChange={(value) => fillIncrease("eth", value)} balance={account ? fmt(spendableEth(incAsEth), 4) : "—"} disabled={increaseSide === "token"} onMax={() => fillIncrease("eth", trimWei(spendableEth(incAsEth)))} />
                <AmountField label={coin.symbol} value={increaseSide === "eth" ? "" : incToken} onChange={(value) => fillIncrease("token", value)} balance={account ? fmt(tokenBal, 2) : "—"} disabled={increaseSide === "eth"} onMax={() => fillIncrease("token", trimWei(tokenBal))} />
                <div className="flex items-center justify-between gap-3">
                  <EthToggle on={incAsEth} onChange={setIncAsEth} label="Add as ETH" />
                  <button type="button" disabled={busy} onClick={() => void submit("increase")} className="rounded-full bg-seal px-4 py-2 text-sm font-semibold text-onseal disabled:opacity-40">
                    {busy ? "Confirming…" : "Increase"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </aside>

        <div className="min-w-0 flex-[999_1_560px] rounded-[28px] border border-line bg-chip/85 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,.04)]">
          <h2 className="text-[22px] font-semibold tracking-[-0.02em]">Set price range</h2>
          <div className="mt-4 grid grid-cols-2 rounded-full border border-line bg-bg p-1 text-[15px] font-semibold">
            <button type="button" onClick={() => setRangeMode("full")} className={`rounded-full py-2.5 ${rangeMode === "full" ? "bg-seal text-onseal" : "text-muted"}`}>Full range</button>
            <button type="button" onClick={() => (minText && maxText ? setRangeMode("custom") : applyPreset(preset ?? "wide"))} className={`rounded-full py-2.5 ${rangeMode === "custom" ? "bg-seal text-onseal" : "text-muted"}`}>Custom range</button>
          </div>
          <p className="mt-3.5 text-sm text-muted">
            {full ? "Earns fees at every price. A 1% pool cannot hold a band tighter than about 2%." : "The band earns fees only while the price stays inside it."}
          </p>

          <div className="mt-4 overflow-hidden rounded-[22px] border border-line bg-bg">
            <div className="flex flex-wrap justify-between gap-3 px-5 pt-4">
              <div>
                <div className="text-[13px] text-muted">Current price</div>
                <div className="mt-0.5 text-xl font-medium tabular-nums">{currentTokens > 0 ? formatTokenPrice(currentTokens) : "—"} <span className="text-muted">{coin.symbol} per ETH</span></div>
              </div>
            </div>
            <div ref={chartRef} className="relative mt-4 h-[280px] bg-[radial-gradient(rgba(232,221,200,.07)_1px,transparent_1px)] bg-size-[22px_22px] touch-none select-none">
              <div className="absolute right-0 left-0 border-y border-gold/60 bg-gold/12" style={{ top: `${bandTop}%`, height: `${Math.max(0.6, bandBot - bandTop)}%` }} />
              <svg viewBox="0 0 1000 280" preserveAspectRatio="none" className="absolute top-0 left-0 h-full w-[calc(100%-140px)]">
                {line ? <path d={line} fill="none" stroke="#e0b45a" strokeWidth="2.2" strokeLinejoin="round" /> : null}
              </svg>
              <div className="absolute right-0 left-0 border-t-[1.5px] border-dashed border-seal/85" style={{ top: `${yOf(currentTokens)}%` }} />
              <div className="absolute top-0 right-[30px] bottom-0 flex w-[104px] flex-col items-end gap-0.5 py-1">
                {depth.map((bar, i) => (
                  <span key={i} className={`min-h-0 flex-1 rounded-l-[3px] ${bar.inside ? "bg-gold/70" : "bg-fg/14"}`} style={{ width: bar.width }} />
                ))}
              </div>
              {!full ? (
                <>
                  <button type="button" aria-label="Drag the max price" onPointerDown={(event) => { event.preventDefault(); dragRef.current = "max"; }} className="absolute right-[3px] size-6 -translate-y-1/2 cursor-ns-resize rounded-full border-4 border-gold bg-fg" style={{ top: `${bandTop}%` }} />
                  <button type="button" aria-label="Drag the min price" onPointerDown={(event) => { event.preventDefault(); dragRef.current = "min"; }} className="absolute right-[3px] size-6 -translate-y-1/2 cursor-ns-resize rounded-full border-4 border-gold bg-fg" style={{ top: `${bandBot}%` }} />
                </>
              ) : (
                <span className="absolute top-3.5 left-4 rounded-full border border-gold/40 bg-bg/80 px-2.5 py-1 text-xs font-semibold text-gold">Full range · earns at every price</span>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-line px-4 py-3.5">
              <div className="flex flex-wrap gap-2.5">
                <div className="flex rounded-full border border-line bg-chip p-[3px]">
                  {(["1D", "1W", "1M", "1Y", "All"] as const).map((item) => (
                    <button key={item} type="button" onClick={() => setTf(item)} className={`rounded-full px-3 py-1 text-xs font-semibold ${tf === item ? "bg-[#3a2d22] text-fg" : "text-muted"}`}>{item}</button>
                  ))}
                </div>
                <div className="flex overflow-hidden rounded-full border border-line bg-chip">
                  <button type="button" aria-label="Zoom out" onClick={() => setZoom((value) => Math.min(3, value / 0.7))} className="px-2.5 py-1.5 text-muted">−</button>
                  <button type="button" aria-label="Zoom in" onClick={() => setZoom((value) => Math.max(0.15, value * 0.7))} className="border-l border-line px-2.5 py-1.5 text-muted">+</button>
                </div>
              </div>
              <button type="button" onClick={() => { setZoom(1); applyPreset("wide"); }} className="rounded-full border border-line px-3.5 py-1.5 text-[13px] font-medium">Reset</button>
            </div>
          </div>

          {!full ? (
            <>
              <p className="mt-5 text-sm text-muted">Price strategies</p>
              <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
                {PRESETS.map((item) => (
                  <button key={item.id} type="button" onClick={() => applyPreset(item.id)} className={`rounded-[18px] border px-4 py-4 text-left ${preset === item.id ? "border-gold bg-gold/8" : "border-line bg-bg"}`}>
                    <span className="block text-[15px] font-semibold">{item.title}</span>
                    <span className="mt-1.5 block text-[17px] font-medium text-gold tabular-nums">{presetLabel(item.id, coin.sqrtPriceX96, coin.tokenIs0)}</span>
                    <span className="mt-1 block text-[13px] text-muted">{item.blurb}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}

          <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
            <PriceStep label="Min price" value={full ? "0" : minText} locked={full} sub={full ? `${coin.symbol} per ETH` : `${signed((shownBounds.min / currentTokens - 1) * 100)} · ${coin.symbol} per ETH`} onChange={(value) => { setMinText(value); setPreset(null); }} onBlur={commitPrices} onInc={() => stepBound("min", 1)} onDec={() => stepBound("min", -1)} />
            <PriceStep label="Max price" value={full ? "∞" : maxText} locked={full} sub={full ? `${coin.symbol} per ETH` : `${signed((shownBounds.max / currentTokens - 1) * 100)} · ${coin.symbol} per ETH`} onChange={(value) => { setMaxText(value); setPreset(null); }} onBlur={commitPrices} onInc={() => stepBound("max", 1)} onDec={() => stepBound("max", -1)} />
          </div>

          <div className="mt-8 border-t border-line pt-6">
            <h2 className="text-[22px] font-semibold tracking-[-0.02em]">Deposit tokens</h2>
            <p className="mt-1.5 text-sm text-muted">{sideCopy(createSide, coin.symbol)}</p>
            <div className={`mt-4 overflow-hidden rounded-[22px] border border-line bg-bg ${createSide === "token" ? "opacity-45" : ""}`}>
              <label className="block px-5 py-[18px]">
                <div className="flex items-center gap-3">
                  <input inputMode="decimal" value={createSide === "token" ? "" : createEth} disabled={createSide === "token"} placeholder="0" onChange={(event) => fillCreate("eth", event.target.value)} className="min-w-0 flex-1 bg-transparent text-4xl font-medium tracking-[-0.02em] tabular-nums outline-none disabled:opacity-40" />
                  <span className="flex items-center gap-2 rounded-full border border-line bg-chip py-1.5 pr-3 pl-1.5 text-base font-semibold">
                    <span className="grid size-7 place-items-center rounded-full bg-[#2a231d]">
                      <svg width="10" height="16" viewBox="0 0 14 22" aria-hidden><path d="M7 0 0 11.2 7 15.3l7-4.1z" fill="#e8ddc8" opacity=".9" /><path d="M7 16.6 0 12.5 7 22l7-9.5z" fill="#e8ddc8" opacity=".6" /></svg>
                    </span>
                    {createAsEth ? "ETH" : "WETH"}
                  </span>
                </div>
                <div className="mt-2 flex justify-between gap-3 text-[13px] text-muted tabular-nums">
                  <span>{usd(readAmount(createEth) ?? 0n, true)}</span>
                  <span className="flex items-center gap-2">
                    {account ? `${fmt(spendableEth(createAsEth), 4)} ${createAsEth ? "ETH" : "WETH"}` : "Connect to see balance"}
                    {account && createSide !== "token" ? <button type="button" onClick={() => fillCreate("eth", trimWei(spendableEth(createAsEth)))} className="rounded-md bg-gold/14 px-2 py-0.5 text-xs font-semibold text-gold">Max</button> : null}
                  </span>
                </div>
              </label>
              <div className="flex items-center justify-between gap-3 border-t border-line bg-fg/2 px-5 py-3.5">
                <span className="text-sm text-muted">Add as ETH</span>
                <EthToggle on={createAsEth} onChange={setCreateAsEth} label="" />
              </div>
            </div>
            <label className={`mt-2.5 block rounded-[22px] border border-line bg-bg px-5 py-[18px] ${createSide === "eth" ? "opacity-45" : ""}`}>
              <div className="flex items-center gap-3">
                <input inputMode="decimal" value={createSide === "eth" ? "" : createToken} disabled={createSide === "eth"} placeholder="0" onChange={(event) => fillCreate("token", event.target.value)} className="min-w-0 flex-1 bg-transparent text-4xl font-medium tracking-[-0.02em] tabular-nums outline-none disabled:opacity-40" />
                <span className="flex items-center gap-2 rounded-full border border-line bg-chip py-1.5 pr-3 pl-1.5 text-base font-semibold">
                  {image ? <img src={image} alt="" className="size-7 rounded-full object-cover shadow-[0_0_0_1.5px_#d24a2e]" /> : <span className="grid size-7 place-items-center font-display text-[7px] text-seal shadow-[inset_0_0_0_1.5px_#d24a2e]">{coin.symbol.slice(0, 4)}</span>}
                  {coin.symbol}
                </span>
              </div>
              <div className="mt-2 flex justify-between gap-3 text-[13px] text-muted tabular-nums">
                <span>{usd(readAmount(createToken) ?? 0n, false)}</span>
                <span className="flex items-center gap-2">
                  {account ? `${fmt(tokenBal, 2)} ${coin.symbol}` : "Connect to see balance"}
                  {account && createSide !== "eth" ? <button type="button" onClick={() => fillCreate("token", trimWei(tokenBal))} className="rounded-md bg-gold/14 px-2 py-0.5 text-xs font-semibold text-gold">Max</button> : null}
                </span>
              </div>
            </label>
            <button type="button" disabled={busy} onClick={() => void submit("new")} className="mt-4 w-full rounded-[20px] bg-seal py-[18px] text-[17px] font-semibold text-onseal shadow-[inset_0_1px_0_rgba(255,255,255,.22),0_12px_30px_rgba(210,74,46,.25)] disabled:opacity-40">
              {busy ? "Confirming…" : account ? "Create position" : "Connect wallet"}
            </button>
            {note ? <p className="mt-3 text-center text-sm text-muted">{note}</p> : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, gold }: { label: string; value: string; gold?: boolean }) {
  return (
    <div>
      <div className="text-[13px] text-muted">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${gold ? "text-ok" : ""}`}>{value}</div>
    </div>
  );
}

function PriceStep({
  label,
  value,
  locked,
  sub,
  onChange,
  onBlur,
  onInc,
  onDec,
}: {
  label: string;
  value: string;
  locked: boolean;
  sub: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  onInc: () => void;
  onDec: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-[20px] border border-line bg-bg px-5 py-[18px]">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-muted">{label}</div>
        <input value={value} disabled={locked} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} inputMode="decimal" className="mt-1 w-full bg-transparent text-[26px] font-semibold tracking-[-0.02em] tabular-nums outline-none disabled:opacity-80" />
        <div className="mt-0.5 text-[13px] text-muted tabular-nums">{sub}</div>
      </div>
      <div className={`grid gap-1.5 ${locked ? "opacity-35" : ""}`}>
        <button type="button" aria-label={`Increase ${label}`} disabled={locked} onClick={onInc} className="grid size-8 place-items-center rounded-full bg-fg/8">+</button>
        <button type="button" aria-label={`Decrease ${label}`} disabled={locked} onClick={onDec} className="grid size-8 place-items-center rounded-full bg-fg/8">−</button>
      </div>
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
