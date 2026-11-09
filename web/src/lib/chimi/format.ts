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

/** Full USD for headline numbers: $2,341 · $12.40 · $0.0042 · $1.24M. */
export function money(n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `$${Math.round(n).toLocaleString("en-US")}`;
  if (abs >= 1) return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (abs === 0) return "$0.00";
  if (abs < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}

/** An ETH amount with just enough digits to read: 12.4 · 0.842 · 0.00031. */
export function ethText(n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1000) return Math.round(n).toLocaleString("en-US");
  if (abs >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
  return n.toLocaleString("en-US", { maximumSignificantDigits: 3, maximumFractionDigits: 18 });
}

/** A token count, compact: 812 · 4.2K · 1.08M · 1B. */
export function compactCount(n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const units: [number, string][] = [
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [size, suffix] of units) {
    if (abs >= size) {
      const v = n / size;
      return `${Number(v.toFixed(Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2))}${suffix}`;
    }
  }
  return Number(n.toFixed(abs >= 10 ? 0 : 2)).toString();
}

/** "12s", "4m", "3h", "2d": how long ago, short. */
export function ago(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}

/** A token or ETH amount held in wei, for reading: 9,999.3498 · 271,429,710 · 0.00004211. */
export function amountText(wei: bigint, digits = 4): string {
  const n = Number(wei) / 1e18;
  if (!Number.isFinite(n) || n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (abs >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (abs >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: digits });
  return n.toLocaleString("en-US", { maximumSignificantDigits: 4, maximumFractionDigits: 18 });
}
