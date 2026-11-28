/*
 * The Bridge page's rules, apart from the page: reading an amount, what stops a bridge, a bridge's stage, and the
 * wallet's list of bridges. Pure, so they're tested on their own (web/test/bridge.test.ts).
 *
 * A bridge is a deposit through GIWA's own bridge on Ethereum (L1StandardBridge.bridgeETHTo, to the sender's own
 * address). GIWA's sequencer picks it up from Ethereum and pays the ETH out on GIWA, usually within a few minutes.
 */

/** Gas the deposit leaves for its call on GIWA. Paying ETH to an address needs far less; GIWA's own bridge app sends this too. */
export const DEPOSIT_L2_GAS = 200_000;

/** Gas a deposit uses on Ethereum (about 637,650 measured on GIWA Sepolia's bridge), for the estimate before a wallet can be asked. */
export const DEPOSIT_L1_GAS = 640_000n;

/** Marks a deposit as made from Chimi: "chimi" in the bridge's extraData. */
export const CHIMI_TAG = "0x6368696d69" as const;

export const PRESETS = ["0.01", "0.05", "0.1", "0.5"] as const;

const WEI = 10n ** 18n;

/** An amount of ETH as typed ("0.05", ".5", "1"), in wei. Null when it isn't one, or isn't more than zero. */
export function parseAmount(text: string): bigint | null {
  const t = text.trim();
  if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const [whole = "", frac = ""] = t.split(".");
  if (frac.length > 18) return null;
  const wei = BigInt(whole || "0") * WEI + BigInt((frac + "0".repeat(18)).slice(0, 18));
  return wei > 0n ? wei : null;
}

/** Wei as ETH, with up to `places` decimals and no trailing zeros: 0.05, 1.2345, 0. */
export function ethOf(wei: bigint, places = 6): string {
  const neg = wei < 0n;
  const abs = neg ? -wei : wei;
  const scale = 10n ** BigInt(18 - places);
  const rounded = (abs + scale / 2n) / scale;
  const whole = rounded / 10n ** BigInt(places);
  const frac = (rounded % 10n ** BigInt(places)).toString().padStart(places, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole.toLocaleString("en-US")}${frac ? `.${frac}` : ""}`;
}

/** The most that can be bridged: the balance less the gas, with room for the gas price to move. Zero when that is nothing. */
export function maxBridge(balance: bigint, gas: bigint): bigint {
  const left = balance - (gas * 3n) / 2n;
  return left > 0n ? left : 0n;
}

/** Why the Bridge button can't send yet, as its label; null when it can. */
export function bridgeProblem({ text, balance, gas, l1Name }: { text: string; balance?: bigint; gas: bigint; l1Name: string }): string | null {
  if (!text.trim()) return "Enter an amount";
  const amount = parseAmount(text);
  if (amount === null) return "Enter an amount above 0";
  if (balance !== undefined && amount + gas > balance) return `Not enough ETH on ${l1Name}`;
  return null;
}

/** A wallet that is a smart contract on Ethereum may not be the same wallet at that address on GIWA. An EIP-7702 account (a key's own address, delegated) is. */
export function sameOwnerOnGiwa(code: string | undefined): boolean {
  if (!code || code === "0x") return true;
  return code.toLowerCase().startsWith("0xef0100");
}

/** One bridge, as this browser remembers it and the chains have confirmed it. */
export type BridgeItem = {
  /** The deposit on Ethereum. */
  l1Hash: `0x${string}`;
  /** Lowercase wallet. */
  from: string;
  /** Wei, as a decimal string. */
  amount: string;
  /** Unix seconds when it was sent (or its block's time). */
  time: number;
  /** Set once the deposit is in an Ethereum block. */
  l1Block?: number;
  /** The payout transaction on GIWA the deposit becomes. */
  l2Hash?: `0x${string}`;
  /** Set once that payout is in a GIWA block. */
  arrived?: boolean;
  /** The deposit reverted on Ethereum: nothing left the wallet but gas. */
  failed?: boolean;
};

export type BridgeStage = "sending" | "onItsWay" | "arrived" | "failed";

export function stageOf(item: BridgeItem): BridgeStage {
  if (item.failed) return "failed";
  if (item.arrived) return "arrived";
  return item.l1Block !== undefined ? "onItsWay" : "sending";
}

export const STAGE_LABEL: Record<BridgeStage, string> = {
  sending: "Confirming on Ethereum",
  onItsWay: "On its way to GIWA",
  arrived: "Arrived",
  failed: "Failed",
};

const order = (item: BridgeItem) => (item.failed ? 0 : item.arrived ? 3 : item.l1Block !== undefined ? 2 : 1);

/** One list from what this browser remembers and what the chain shows: one row per deposit (the one that knows more wins), newest first. */
export function mergeBridges(...lists: BridgeItem[][]): BridgeItem[] {
  const byHash = new Map<string, BridgeItem>();
  for (const list of lists) {
    for (const item of list) {
      const key = item.l1Hash.toLowerCase();
      const had = byHash.get(key);
      if (!had) byHash.set(key, item);
      else byHash.set(key, order(item) >= order(had) ? { ...had, ...item, time: Math.min(had.time, item.time) } : { ...item, ...had, time: Math.min(had.time, item.time) });
    }
  }
  return [...byHash.values()].sort((a, b) => b.time - a.time).slice(0, 20);
}
