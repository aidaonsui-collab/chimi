/**
 * Where inboxes live: one small document per wallet (rules in lib/chimi/inbox-rules.ts). Adding to an inbox is a
 * courtesy on top of the action that caused it, so it never fails that action: a write that can't be made is logged
 * and dropped.
 */
import { addToInbox, emptyInbox, type InboxDoc, type InboxItem } from "@/lib/chimi/inbox-rules";
import { docStore } from "@/server/store";

const store = (wallet: string) => docStore<InboxDoc>(`chimi:inbox:v1:${wallet.toLowerCase()}`);

/** A wallet's inbox, oldest first, and whether there is anywhere to keep one. */
export async function readInbox(wallet: string): Promise<{ items: InboxItem[]; writable: boolean }> {
  const s = store(wallet);
  const { doc } = await s.load();
  return { items: doc?.items ?? [], writable: s.writable };
}

/** Adds items to the inboxes they are for. Never throws. */
export async function tell(notes: readonly { wallet: string; item: InboxItem }[]): Promise<void> {
  const byWallet = new Map<string, InboxItem[]>();
  for (const { wallet, item } of notes) {
    const key = wallet.toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(key)) continue;
    byWallet.set(key, [...(byWallet.get(key) ?? []), item]);
  }
  await Promise.all(
    [...byWallet].map(async ([wallet, items]) => {
      try {
        const s = store(wallet);
        if (!s.writable) return;
        // Reads, adds and writes back, again if another item landed in between.
        for (let attempt = 0; attempt < 4; attempt++) {
          const { doc, rev } = await s.load();
          const next = addToInbox(doc ?? emptyInbox(wallet), items);
          if (!next || (await s.save(next, rev))) return;
        }
        console.error("[inbox]", `gave up on ${wallet}: busy`);
      } catch (e) {
        console.error("[inbox]", e instanceof Error ? e.message : e);
      }
    }),
  );
}
