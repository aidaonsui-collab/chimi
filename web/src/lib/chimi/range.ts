/**
 * Uniswap v3 tick math for Chimi's pools. A pool's tick spacing is its price step: 200 on the 1% pools (about 2%),
 * 400 on the 2% pools (about 4%). Every function takes the spacing and defaults to the 1% pool's.
 */

export const TICK_SPACING = 200;
export const MIN_TICK = -887200;
export const MAX_TICK = 887200;

/** The highest tick a position can use at this spacing (887200 at 200 and 400). */
export const maxTickFor = (spacing: number = TICK_SPACING) => Math.floor(887_272 / spacing) * spacing;
/** The whole price range at this spacing. */
export const fullRange = (spacing: number = TICK_SPACING): TickRange => ({ tickLower: -maxTickFor(spacing), tickUpper: maxTickFor(spacing) });

const Q96 = 2n ** 96n;

export type RangePreset = "tight" | "wide" | "lower" | "upper";
export type DepositSide = "both" | "eth" | "token";

export type TickRange = { tickLower: number; tickUpper: number };

function floorSpacing(tick: number, s: number): number {
  return Math.max(-maxTickFor(s), Math.floor(tick / s) * s);
}

function ceilSpacing(tick: number, s: number): number {
  return Math.min(maxTickFor(s), Math.ceil(tick / s - 1e-9) * s);
}

function clampRange(tickLower: number, tickUpper: number, s: number): TickRange {
  const max = maxTickFor(s);
  let lower = Math.max(-max, Math.min(max - s, tickLower));
  let upper = Math.max(-max + s, Math.min(max, tickUpper));
  lower = Math.round(lower / s) * s;
  upper = Math.round(upper / s) * s;
  if (lower >= upper) upper = Math.min(max, lower + s);
  if (lower >= upper) lower = upper - s;
  return { tickLower: lower, tickUpper: upper };
}

export function tickFromSqrtPriceX96(sqrtPriceX96: bigint): number {
  if (sqrtPriceX96 <= 0n) return 0;
  const s = sqrtPriceX96.toString();
  const exp = s.length - 1;
  const mantissa = Number(`${s[0]}.${s.slice(1, 16)}`);
  const logSqrt = Math.log(mantissa) + exp * Math.LN10;
  const logPrice = 2 * logSqrt - 192 * Math.LN2;
  return logPrice / Math.log(1.0001);
}

export function sqrtPriceX96FromTick(tick: number): bigint {
  const log2 = (tick / 2) * Math.log2(1.0001) + 96;
  const exp = Math.floor(log2);
  const mant = 2 ** (log2 - exp);
  const shift = 60;
  const mantInt = BigInt(Math.round(mant * 2 ** shift));
  if (exp >= shift) return mantInt << BigInt(exp - shift);
  return mantInt >> BigInt(shift - exp);
}

function rawPrice(tick: number): number {
  return Math.exp(tick * Math.log(1.0001));
}

export function ethPerTokenFromTick(tick: number, tokenIs0: boolean): number {
  const raw = rawPrice(tick);
  return tokenIs0 ? raw : 1 / raw;
}

export function tokensPerEthFromTick(tick: number, tokenIs0: boolean): number {
  return 1 / ethPerTokenFromTick(tick, tokenIs0);
}

function tickFromEthPerToken(ethPerToken: number, tokenIs0: boolean): number {
  const raw = tokenIs0 ? ethPerToken : 1 / ethPerToken;
  return Math.log(raw) / Math.log(1.0001);
}

export function tokenPriceBounds(tickLower: number, tickUpper: number, tokenIs0: boolean): { min: number; max: number } {
  const a = tokensPerEthFromTick(tickLower, tokenIs0);
  const b = tokensPerEthFromTick(tickUpper, tokenIs0);
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

/** How far the band sits from the current tokens-per-ETH price, in percent. */
export function bandPercents(range: TickRange, sqrtPriceX96: bigint, tokenIs0: boolean): { down: number; up: number } {
  const current = tokensPerEthFromTick(tickFromSqrtPriceX96(sqrtPriceX96), tokenIs0);
  const bounds = tokenPriceBounds(range.tickLower, range.tickUpper, tokenIs0);
  return { down: (bounds.min / current - 1) * 100, up: (bounds.max / current - 1) * 100 };
}

function tight(current: number, s: number): TickRange {
  const max = maxTickFor(s);
  let lower = floorSpacing(current, s);
  let upper = lower + s;
  if (upper > max) {
    upper = max;
    lower = max - s;
  }
  return { tickLower: lower, tickUpper: upper };
}

function wide(current: number, tokenIs0: boolean, s: number): TickRange {
  const eth = ethPerTokenFromTick(current, tokenIs0);
  const down = tickFromEthPerToken(eth * 0.5, tokenIs0);
  const up = tickFromEthPerToken(eth * 2, tokenIs0);
  let tickLower = floorSpacing(Math.min(down, up), s);
  let tickUpper = ceilSpacing(Math.max(down, up), s);
  if (current < tickLower) tickLower = floorSpacing(current, s);
  if (current >= tickUpper) tickUpper = Math.min(maxTickFor(s), ceilSpacing(current, s) + s);
  return clampRange(tickLower, tickUpper, s);
}

/** `below` sits under the tokens-per-ETH price. `above` sits over it. */
function displayedSide(current: number, tokenIs0: boolean, side: "below" | "above", s: number): TickRange {
  const shown = tokensPerEthFromTick(current, tokenIs0);
  const farTick = tickFromEthPerToken(1 / (shown * (side === "below" ? 0.5 : 2)), tokenIs0);
  const fallsAsTickRises = tokensPerEthFromTick(current + 10, tokenIs0) < shown;
  const towardHigherTicks = side === "below" ? fallsAsTickRises : !fallsAsTickRises;
  if (towardHigherTicks) {
    let tickLower = ceilSpacing(current, s);
    if (tickLower <= current) tickLower = Math.min(maxTickFor(s), tickLower + s);
    const tickUpper = ceilSpacing(Math.max(farTick, tickLower + s), s);
    return clampRange(tickLower, tickUpper, s);
  }
  let tickUpper = floorSpacing(current, s);
  if (tickUpper > current) tickUpper = Math.max(-maxTickFor(s), tickUpper - s);
  const tickLower = floorSpacing(Math.min(farTick, tickUpper - s), s);
  return clampRange(tickLower, tickUpper, s);
}

export function presetRange(preset: RangePreset, sqrtPriceX96: bigint, tokenIs0: boolean, spacing: number = TICK_SPACING): TickRange {
  const current = tickFromSqrtPriceX96(sqrtPriceX96);
  if (preset === "tight") return tight(current, spacing);
  if (preset === "wide") return wide(current, tokenIs0, spacing);
  if (preset === "lower") return displayedSide(current, tokenIs0, "below", spacing);
  return displayedSide(current, tokenIs0, "above", spacing);
}

export function ticksFromTokenPrices(minTokensPerEth: number, maxTokensPerEth: number, tokenIs0: boolean, spacing: number = TICK_SPACING): TickRange {
  const low = Math.min(minTokensPerEth, maxTokensPerEth);
  const high = Math.max(minTokensPerEth, maxTokensPerEth);
  const tickAt = (tokensPerEth: number) => tickFromEthPerToken(1 / tokensPerEth, tokenIs0);
  const a = tickAt(low);
  const b = tickAt(high);
  return clampRange(floorSpacing(Math.min(a, b), spacing), ceilSpacing(Math.max(a, b), spacing), spacing);
}

export function isFullRange(range: TickRange, spacing: number = TICK_SPACING): boolean {
  return range.tickLower <= -maxTickFor(spacing) && range.tickUpper >= maxTickFor(spacing);
}

export function formatTokenPrice(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  return Number(n.toPrecision(12)).toLocaleString("en-US", { maximumSignificantDigits: 12 });
}

export function parseTokenPrice(input: string): number {
  const n = Number(input.replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : Number.NaN;
}

function getAmount0ForLiquidity(sqrtA: bigint, sqrtB: bigint, liquidity: bigint): bigint {
  if (sqrtA > sqrtB) return getAmount0ForLiquidity(sqrtB, sqrtA, liquidity);
  if (sqrtA === 0n || sqrtB === sqrtA) return 0n;
  return (liquidity * Q96 * (sqrtB - sqrtA)) / sqrtB / sqrtA;
}

function getAmount1ForLiquidity(sqrtA: bigint, sqrtB: bigint, liquidity: bigint): bigint {
  if (sqrtA > sqrtB) return getAmount1ForLiquidity(sqrtB, sqrtA, liquidity);
  return (liquidity * (sqrtB - sqrtA)) / Q96;
}

function getLiquidityForAmount0(sqrtA: bigint, sqrtB: bigint, amount0: bigint): bigint {
  if (sqrtA > sqrtB) return getLiquidityForAmount0(sqrtB, sqrtA, amount0);
  if (sqrtB === sqrtA) return 0n;
  const intermediate = (sqrtA * sqrtB) / Q96;
  return (amount0 * intermediate) / (sqrtB - sqrtA);
}

function getLiquidityForAmount1(sqrtA: bigint, sqrtB: bigint, amount1: bigint): bigint {
  if (sqrtA > sqrtB) return getLiquidityForAmount1(sqrtB, sqrtA, amount1);
  if (sqrtB === sqrtA) return 0n;
  return (amount1 * Q96) / (sqrtB - sqrtA);
}

export function depositSide(sqrtPriceX96: bigint, range: TickRange, tokenIs0: boolean): DepositSide {
  const sqrtA = sqrtPriceX96FromTick(range.tickLower);
  const sqrtB = sqrtPriceX96FromTick(range.tickUpper);
  let need0 = true;
  let need1 = true;
  if (sqrtPriceX96 <= sqrtA) need1 = false;
  else if (sqrtPriceX96 >= sqrtB) need0 = false;
  const eth = tokenIs0 ? need1 : need0;
  const token = tokenIs0 ? need0 : need1;
  if (eth && token) return "both";
  return eth ? "eth" : "token";
}

function owed(sqrt: bigint, sqrtA: bigint, sqrtB: bigint, liquidity: bigint): { amount0: bigint; amount1: bigint } {
  if (sqrt <= sqrtA) return { amount0: getAmount0ForLiquidity(sqrtA, sqrtB, liquidity), amount1: 0n };
  if (sqrt >= sqrtB) return { amount0: 0n, amount1: getAmount1ForLiquidity(sqrtA, sqrtB, liquidity) };
  return {
    amount0: getAmount0ForLiquidity(sqrt, sqrtB, liquidity),
    amount1: getAmount1ForLiquidity(sqrtA, sqrt, liquidity),
  };
}

/** Fill the other side of a deposit from the amount the user typed. */
export function pairAmount(args: {
  sqrtPriceX96: bigint;
  range: TickRange;
  tokenIs0: boolean;
  amount: bigint;
  edited: "eth" | "token";
}): { ethAmount: bigint; tokenAmount: bigint } {
  const side = depositSide(args.sqrtPriceX96, args.range, args.tokenIs0);
  if (args.edited === "eth" && side === "token") return { ethAmount: 0n, tokenAmount: 0n };
  if (args.edited === "token" && side === "eth") return { ethAmount: 0n, tokenAmount: 0n };
  if (args.edited === "eth" && side === "eth") return { ethAmount: args.amount, tokenAmount: 0n };
  if (args.edited === "token" && side === "token") return { ethAmount: 0n, tokenAmount: args.amount };
  if (args.amount === 0n) return { ethAmount: 0n, tokenAmount: 0n };

  const sqrtA = sqrtPriceX96FromTick(args.range.tickLower);
  const sqrtB = sqrtPriceX96FromTick(args.range.tickUpper);
  const sqrt = args.sqrtPriceX96;
  const ethIs0 = !args.tokenIs0;
  const editing0 = args.edited === "eth" ? ethIs0 : args.tokenIs0;
  let liquidity = 0n;
  if (editing0) {
    if (sqrt >= sqrtB) return { ethAmount: 0n, tokenAmount: 0n };
    const a = sqrt > sqrtA ? sqrt : sqrtA;
    liquidity = getLiquidityForAmount0(a, sqrtB, args.amount);
  } else {
    if (sqrt <= sqrtA) return { ethAmount: 0n, tokenAmount: 0n };
    const b = sqrt < sqrtB ? sqrt : sqrtB;
    liquidity = getLiquidityForAmount1(sqrtA, b, args.amount);
  }
  const amounts = owed(sqrt, sqrtA, sqrtB, liquidity);
  const ethAmount = ethIs0 ? amounts.amount0 : amounts.amount1;
  const tokenAmount = args.tokenIs0 ? amounts.amount0 : amounts.amount1;
  return args.edited === "eth" ? { ethAmount: args.amount, tokenAmount } : { ethAmount, tokenAmount: args.amount };
}
