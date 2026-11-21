/*
 * The mainnet waitlist (routes/mainnet.tsx, routes/api/waitlist.ts). A wallet joins by signing one message: free, no
 * transaction, no gas. Joining is first come, first served and for good: a wallet's place in the line never changes,
 * and joining again answers with the place it already has. The list is kept until GIWA mainnet opens, when it is
 * read out for the perks (docs/MAINNET.md). Nothing here imports anything, so node can test it directly.
 */

/** How long a signed join stays good, so an old signature can't be sent again later. */
export const WAITLIST_SIGNATURE_TTL_MS = 5 * 60_000;

/** The message a wallet signs to join. The wallet and the time are in it so the signature fits one join only. */
export function waitlistMessage(wallet: string, time: number) {
  return `Chimi mainnet waitlist: add my wallet\n\nWallet: ${wallet.toLowerCase()}\nTime: ${new Date(time).toISOString()}`;
}

/** One row of the admin list (GET /api/waitlist?export=json). */
export type WaitlistRow = { wallet: string; position: number; at: number };

/** A wallet's place on the waitlist: 1 is the first to join. */
export type WaitlistEntry = { position: number; at: number };

export type WaitlistStatus = {
  count: number;
  /** The asking wallet's place, when it has joined. */
  entry: WaitlistEntry | null;
  /** False while the waitlist can't take new names (no storage on this deployment). */
  open: boolean;
};

/** "1st", "2nd", "23rd", "111th". */
export function ordinal(n: number) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** What a waitlisted wallet shares on X. */
export function shareText(position: number) {
  return `I'm ${ordinal(position)} through the gate: on the Chimi mainnet waitlist.\n\nCoins on @GIWA_by_Upbit that open in a locked pool, trading from block one.`;
}

/** What waitlist wallets get once GIWA mainnet opens. The page lists them; keep them true. */
export const PERKS = [
  { title: "An OG seal", body: "Your profile carries the OG seal from mainnet's first day, for good." },
  { title: "A first-week points boost", body: "Your mainnet points count for more in Season 1's first week." },
] as const;

/** One row of the list read out for the perks: the wallet, its place and when it joined. */
export function csvRow(wallet: string, position: number, at: number) {
  return `${wallet.toLowerCase()},${position},${new Date(at).toISOString()}`;
}
