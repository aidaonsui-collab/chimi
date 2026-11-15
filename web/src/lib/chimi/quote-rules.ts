/*
 * The numbers under the trade panel: what a trade would really pay out, how far that is from the price on the
 * screen, and the least the trader will accept. It imports nothing, so the rules can be tested on their own.
 */

const WAD = 10n ** 18n;

/** What `amountIn` would fetch at the price on the screen, with no fee and no movement. Amounts and price in wei. */
export function atSpot(amountIn: bigint, priceWethPerToken: bigint, buying: boolean): bigint {
  if (amountIn <= 0n || priceWethPerToken <= 0n) return 0n;
  return buying ? (amountIn * WAD) / priceWethPerToken : (amountIn * priceWethPerToken) / WAD;
}

/**
 * How much the trade moves the price against the trader, as a fraction: 0.012 is 1.2%. The pool's fee is not part
 * of it (that is shown on its own line). Never negative; 0 when there is nothing to compare.
 */
export function priceImpact(amountIn: bigint, out: bigint, priceWethPerToken: bigint, buying: boolean, feePips: number): number {
  const ideal = atSpot(amountIn, priceWethPerToken, buying);
  if (ideal <= 0n || out <= 0n) return 0;
  const afterFee = (ideal * BigInt(1_000_000 - feePips)) / 1_000_000n;
  if (afterFee <= 0n || out >= afterFee) return 0;
  return Number(((afterFee - out) * 1_000_000n) / afterFee) / 1_000_000;
}

/** The least to accept: the quote less the slippage the trader allows, in hundredths of a percent. */
export const minimumOut = (out: bigint, slippageBps: number) => (out * BigInt(10_000 - slippageBps)) / 10_000n;

/** How loudly to say the impact: nothing under 1%, a caution to 5%, a warning past it. */
export function impactLevel(impact: number): "fine" | "caution" | "warning" {
  return impact >= 0.05 ? "warning" : impact >= 0.01 ? "caution" : "fine";
}

/** "0.4%", "<0.01%", "12%". */
export function impactText(impact: number): string {
  const pct = impact * 100;
  if (pct <= 0) return "0%";
  if (pct < 0.01) return "<0.01%";
  return `${pct >= 10 ? pct.toFixed(0) : pct >= 1 ? pct.toFixed(1) : pct.toFixed(2)}%`;
}
