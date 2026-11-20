import { useSyncExternalStore } from "react";
import type { EIP1193Provider } from "viem";

/*
 * The wallets installed in this browser, and the one Chimi is using.
 *
 * Wallets announce themselves through EIP-6963 (each extension answers a "who's there?" event with its name, icon and
 * provider), so a browser with MetaMask and Rabby side by side lists both instead of whichever won `window.ethereum`.
 * A wallet that doesn't announce itself (older extensions, some in-app wallet browsers) is still found through
 * `window.ethereum` when nothing else answered.
 *
 * Connecting asks the chosen wallet to show its own account chooser (`wallet_requestPermissions`), so a wallet that
 * already trusts the site still asks which account to share instead of handing back the last one. Disconnecting asks
 * the wallet to forget the site (`wallet_revokePermissions`) where it can.
 */

export type WalletInfo = {
  /** Reverse-DNS name, stable across visits: "io.metamask", "io.rabby". */
  rdns: string;
  name: string;
  /** A data: URI picture the wallet gave, or "" when it gave none. */
  icon: string;
};

export type FoundWallet = { info: WalletInfo; provider: EIP1193Provider };

type Announcement = { info?: { uuid?: string; name?: string; icon?: string; rdns?: string }; provider?: EIP1193Provider };

/** The wallet this browser connected with last, so a reload reconnects to it and not another. */
const LAST = "chimi.wallet.last";
/** What `window.ethereum` is called in the list when it is the only wallet found. */
export const INJECTED = "injected";

const announced = new Map<string, FoundWallet>();
const listeners = new Set<() => void>();
let snapshot: FoundWallet[] = [];
let listening = false;
let active: EIP1193Provider | undefined;

function injected(): EIP1193Provider | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { ethereum?: EIP1193Provider }).ethereum;
}

/** A name for `window.ethereum` from the flags wallets set on it. */
function injectedName(eth: EIP1193Provider): string {
  const flags = eth as EIP1193Provider & Record<string, unknown>;
  if (flags.isRabby) return "Rabby";
  if (flags.isOkxWallet || flags.isOKExWallet) return "OKX Wallet";
  if (flags.isCoinbaseWallet) return "Coinbase Wallet";
  if (flags.isBraveWallet) return "Brave Wallet";
  if (flags.isTrust || flags.isTrustWallet) return "Trust Wallet";
  if (flags.isMetaMask) return "MetaMask";
  return "Browser wallet";
}

function rebuild() {
  const list = [...announced.values()];
  // Only when nothing announced itself: otherwise `window.ethereum` is one of the announced wallets under another name.
  const eth = injected();
  if (list.length === 0 && eth) list.push({ info: { rdns: INJECTED, name: injectedName(eth), icon: "" }, provider: eth });
  snapshot = list;
  for (const fn of listeners) fn();
}

function onAnnounce(event: Event) {
  const detail = (event as CustomEvent<Announcement>).detail;
  const provider = detail?.provider;
  const rdns = detail?.info?.rdns?.trim();
  if (!provider || typeof provider.request !== "function" || !rdns) return;
  const icon = detail.info?.icon ?? "";
  announced.set(rdns, {
    info: { rdns, name: (detail.info?.name ?? "").trim().slice(0, 40) || rdns, icon: /^data:image\//.test(icon) ? icon : "" },
    provider,
  });
  rebuild();
}

/** Asks the installed wallets to announce themselves. Wallets answer straight away, so the list is ready after it. */
export function findWallets(): FoundWallet[] {
  if (typeof window === "undefined") return [];
  if (!listening) {
    listening = true;
    window.addEventListener("eip6963:announceProvider", onAnnounce);
  }
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  rebuild();
  return snapshot;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The installed wallets, kept up to date as they announce themselves. */
export function useWallets(): FoundWallet[] {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
}

/** The provider transactions go through: the wallet connected on this site, else `window.ethereum`. */
export function activeProvider(): EIP1193Provider | undefined {
  return active ?? injected();
}

export function setActiveWallet(wallet: FoundWallet | undefined) {
  active = wallet?.provider;
  try {
    if (wallet) localStorage.setItem(LAST, wallet.info.rdns);
  } catch {
    /* private mode */
  }
}

/** The reverse-DNS name of the wallet this browser connected with last. */
export function lastRdns(): string | null {
  try {
    return localStorage.getItem(LAST);
  } catch {
    return null;
  }
}

/**
 * The wallet to pick back up on load: the one this browser connected with last, if it is still installed. A browser
 * that connected before Chimi remembered which (or with a wallet that doesn't announce itself) gets `window.ethereum`,
 * as it always did.
 */
export function lastWallet(): FoundWallet | undefined {
  const rdns = lastRdns();
  const list = findWallets();
  const eth = injected();
  if (!rdns || rdns === INJECTED) return list.find((w) => w.provider === eth) ?? (eth ? { info: { rdns: INJECTED, name: injectedName(eth), icon: "" }, provider: eth } : undefined);
  return list.find((w) => w.info.rdns === rdns);
}

/** A wallet's error code, where it gave one. */
function codeOf(err: unknown): number | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = e?.code ?? e?.cause?.code;
  return typeof code === "number" ? code : undefined;
}

/**
 * Asks the wallet which accounts to share, with its account chooser even when it already trusts this site. A wallet
 * that doesn't know `wallet_requestPermissions` is asked the plain way. Refusing in the wallet throws, as it did.
 */
export async function chooseAccounts(provider: EIP1193Provider): Promise<string[]> {
  try {
    await provider.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] } as never);
    const accounts = (await provider.request({ method: "eth_accounts" } as never)) as string[];
    if (accounts.length > 0) return accounts;
  } catch (err) {
    // 4001: the user said no in the wallet. Anything else: the wallet doesn't do permissions; ask the usual way.
    if (codeOf(err) === 4001) throw err;
  }
  return (await provider.request({ method: "eth_requestAccounts" } as never)) as string[];
}

/** Asks the wallet to forget this site, where it can; a wallet that can't keeps trusting it, and Connect still asks. */
export async function forgetSite(provider: EIP1193Provider | undefined) {
  if (!provider) return;
  await provider.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] } as never).catch(() => undefined);
}
