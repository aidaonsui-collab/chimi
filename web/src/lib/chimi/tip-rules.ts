/**
 * Tips to a coin's creator while they stream (contracts/src/ChimiTips.sol). The rules the page, the server and the
 * stream alerts share, so node can test them directly; it imports nothing.
 *
 * - A tip is ETH, sent in one transaction: 90% to the wallet that launched the coin, 10% to the platform.
 * - At least MIN_TIP_WEI, with an optional message of up to MAX_MESSAGE_BYTES (a Korean character is 3 bytes).
 * - The message is on the chain for good, so the page refuses links before sending, and everything that shows a
 *   message (the coin's page, the stream alerts) hides links and odd characters whatever was sent.
 */
export const TIP_FEE_BPS = 1_000;
export const MIN_TIP_WEI = 100_000_000_000_000n; // 0.0001 ETH
export const MAX_MESSAGE_BYTES = 280;
/** The amounts offered as one tap, in ETH. */
export const TIP_PRESETS = ["0.001", "0.005", "0.01", "0.05"] as const;

/** What the creator and the platform get from `wei`. */
export function splitTip(wei: bigint) {
  const platform = (wei * BigInt(TIP_FEE_BPS)) / 10_000n;
  return { creator: wei - platform, platform };
}

const LINK = /(?:https?:\/\/|www\.|t\.me\/)\S+|\b[a-z0-9-]+\.(?:com|io|xyz|fun|app|net|org|gg|me|co|finance|exchange|link|kr)\b/i;
// Control characters and the invisible ones that reorder or hide text.
const ODD = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g;

export const messageBytes = (text: string) => new TextEncoder().encode(text).length;

/** Tidies what was typed: no odd characters, one space between words, nothing at either end. */
export function cleanTipMessage(text: string) {
  return text.replace(ODD, "").replace(/\s+/g, " ").trim();
}

/** Why the message can't be sent, or null when it can. */
export function tipMessageProblem(text: string): string | null {
  const clean = cleanTipMessage(text);
  if (messageBytes(clean) > MAX_MESSAGE_BYTES) return "That message is too long.";
  if (LINK.test(clean)) return "Links aren't allowed in tips.";
  return null;
}

/** A message as it may be shown, whatever was sent on the chain: links and odd characters taken out, cut short. */
export function shownMessage(text: string, maxChars = 140) {
  const clean = cleanTipMessage(text).replace(new RegExp(LINK.source, "gi"), "…");
  const chars = [...clean];
  return chars.length <= maxChars ? clean : `${chars.slice(0, maxChars - 1).join("").trimEnd()}…`;
}

/** Reads a typed amount of ETH into wei, or says why it can't be tipped. */
export function tipAmount(input: string, balance?: bigint): { wei: bigint } | { error: string } {
  const text = input.trim();
  if (!/^\d*\.?\d+$|^\d+\.$/.test(text)) return { error: "Enter an amount of ETH." };
  const [whole, frac = ""] = text.split(".");
  if (frac.length > 18) return { error: "That's more decimals than ETH has." };
  const wei = BigInt(whole || "0") * 10n ** 18n + BigInt((frac + "0".repeat(18)).slice(0, 18) || "0");
  if (wei < MIN_TIP_WEI) return { error: "The smallest tip is 0.0001 ETH." };
  if (balance !== undefined && wei > balance) return { error: "That's more ETH than this wallet has." };
  return { wei };
}

/** "0.01" from wei, with no trailing zeros. */
export function ethAmount(wei: bigint) {
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "").slice(0, 6);
  return frac ? `${whole}.${frac}` : `${whole}`;
}
