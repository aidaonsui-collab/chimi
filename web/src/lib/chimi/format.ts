/** Compact USD like a DEX table: $812.40, $2.98K, $24.4M, $1.5B. */
export function compactUsd(n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "—";
  if (n === 0) return "$0";
  const abs = Math.abs(n);
  const units: [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [size, suffix] of units) {
    if (abs >= size) {
      const v = n / size;
      const digits = Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2;
      return `$${Number(v.toFixed(digits))}${suffix}`;
    }
  }
  if (abs < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}

export function pct(n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(2)}%`;
}

const SUB = "₀₁₂₃₄₅₆₇₈₉";

/** Token price in USD. Tiny prices use DEX-style zero counts: $0.0₅2987. */
export function tokenUsd(n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "—";
  if (n === 0) return "$0";
  if (n >= 1) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
  if (n >= 0.001) return `$${n.toFixed(4)}`;
  const zeros = Math.floor(-Math.log10(n));
  // zeros = count of 0s right after the decimal point (0.000002978 -> 5 -> $0.0₅2978).
  const digits = Math.round(n * 10 ** (zeros + 4)).toString().slice(0, 4);
  const count = String(zeros)
    .split("")
    .map((d) => SUB[Number(d)])
    .join("");
  return `$0.0${count}${digits}`;
}
