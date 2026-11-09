import { useSyncExternalStore } from "react";
import { IconCheck, IconClose, IconExternal, IconInfo } from "@/components/chimi/icons";

export type Toast = {
  id: number;
  kind: "good" | "bad" | "info";
  title: string;
  body?: string;
  /** A link to open, usually the transaction on the explorer. */
  href?: string;
  linkLabel?: string;
};

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const EMPTY: Toast[] = [];

function emit() {
  for (const l of listeners) l();
}

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/** Shows a short message in the corner of the screen. Bad news stays a little longer. */
export function toast(t: Omit<Toast, "id">) {
  const id = nextId++;
  toasts = [...toasts.slice(-3), { ...t, id }];
  emit();
  setTimeout(() => dismiss(id), t.kind === "bad" ? 8000 : 5500);
  return id;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function Toaster() {
  const list = useSyncExternalStore(
    subscribe,
    () => toasts,
    () => EMPTY,
  );
  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-[84px] z-[80] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-5 sm:items-end lg:bottom-14" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} role={t.kind === "bad" ? "alert" : "status"} className="glass pointer-events-auto flex w-full max-w-[380px] animate-pop items-start gap-3 rounded-2xl p-3.5 pr-2.5 shadow-pop">
          <span
            className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full ${
              t.kind === "good" ? "bg-ok/15 text-ok" : t.kind === "bad" ? "bg-down/15 text-down" : "bg-fg/10 text-fg"
            }`}
          >
            {t.kind === "good" ? <IconCheck size={15} /> : t.kind === "bad" ? <IconClose size={14} /> : <IconInfo size={15} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{t.title}</p>
            {t.body ? <p className="mt-0.5 text-[13px] leading-snug break-words text-muted">{t.body}</p> : null}
            {t.href ? (
              <a href={t.href} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-[13px] font-medium text-gold hover:underline">
                {t.linkLabel ?? "View transaction"}
                <IconExternal size={13} />
              </a>
            ) : null}
          </div>
          <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="btn btn-icon btn-sm btn-ghost">
            <IconClose size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
