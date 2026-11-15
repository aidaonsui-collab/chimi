import { useSyncExternalStore } from "react";

/*
 * The quick-buy amount: how much ETH the Buy button on a feed card spends. One setting for every card, chosen in the
 * bar above the feed and remembered in this browser, so a card needs only one button.
 */

export const QUICK_CHOICES = ["0.005", "0.01", "0.05", "0.1", "0.5"];
const DEFAULT = "0.01";
const KEY = "chimi.quick.eth";

let amount = DEFAULT;
let read = false;
const listeners = new Set<() => void>();

function load() {
  if (read) return;
  read = true;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && QUICK_CHOICES.includes(saved)) amount = saved;
  } catch {
    /* private mode */
  }
}

function subscribe(listener: () => void) {
  load();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setQuickAmount(next: string) {
  if (!QUICK_CHOICES.includes(next)) return;
  amount = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* private mode: it lasts for this page */
  }
  for (const l of listeners) l();
}

/** The amount in ETH, as text. The server and the first client render agree on the default. */
export function useQuickAmount(): string {
  return useSyncExternalStore(
    subscribe,
    () => {
      load();
      return amount;
    },
    () => DEFAULT,
  );
}
