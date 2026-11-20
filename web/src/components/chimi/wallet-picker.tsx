import { lastRdns, type FoundWallet } from "@/lib/chimi/wallets";
import { IconChevronRight, IconWallet } from "@/components/chimi/icons";
import { Modal } from "@/components/chimi/ui";

/**
 * Connect, when more than one wallet is installed: pick which one. The wallet then shows its own account chooser.
 * Closing it cancels the connection.
 */
export function WalletPicker({ wallets, onPick }: { wallets: FoundWallet[]; onPick: (wallet: FoundWallet | undefined) => void }) {
  const last = lastRdns();
  // The one used last first, the rest in the order they announced themselves.
  const list = [...wallets].sort((a, b) => Number(b.info.rdns === last) - Number(a.info.rdns === last));
  return (
    <Modal kicker="Connect" title="Choose a wallet" onClose={() => onPick(undefined)} width={420}>
      <ul className="mt-5 grid gap-2">
        {list.map((wallet) => (
          <li key={wallet.info.rdns}>
            <button
              type="button"
              onClick={() => onPick(wallet)}
              className="group flex w-full items-center gap-3 rounded-xl border border-line bg-bg px-3.5 py-3 text-left transition-colors hover:border-edge hover:bg-raise"
            >
              {wallet.info.icon ? (
                <img src={wallet.info.icon} alt="" width={36} height={36} className="size-9 shrink-0 rounded-xl" />
              ) : (
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-raise2 text-muted">
                  <IconWallet size={18} />
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{wallet.info.name}</span>
              {wallet.info.rdns === last ? <span className="chip h-6 shrink-0 px-2 text-[11px]">Last used</span> : null}
              <IconChevronRight size={16} className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-fg" />
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs leading-relaxed text-faint">Your wallet then asks which account to share with Chimi. Chimi never sees your keys.</p>
    </Modal>
  );
}
