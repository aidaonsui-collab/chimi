import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconClose, IconLock, IconPlus, IconSwap } from "@/components/chimi/icons";
import { Modal } from "@/components/chimi/ui";

const STEPS = [
  {
    icon: IconPlus,
    title: "Press a coin",
    text: "Name it, give it a picture, and sign once. A billion tokens are minted in the same transaction.",
  },
  {
    icon: IconLock,
    title: "The pool locks",
    text: "The whole supply opens in a Uniswap v3 pool against ETH. The launch liquidity is locked for 100 years.",
  },
  {
    icon: IconSwap,
    title: "Trade from block one",
    text: "There is no bonding curve and nothing to graduate. The price you see is the pool, from the first block.",
  },
];

/**
 * A link that opens "How Chimi works" as a popup in the middle of the page. The caller decides how the link looks.
 * The popup is drawn at the end of the page, so it sits over everything wherever the link is.
 */
export function HowItWorks({ className, children }: { className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <button type="button" className={className} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {children}
      </button>
      {open
        ? createPortal(
            <Modal bare center label="How Chimi works" onClose={close} width={520}>
              <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4 sm:px-7 sm:py-5">
                <h2 className="text-[22px] leading-tight font-semibold tracking-[-0.02em]">How Chimi works</h2>
                <button type="button" onClick={close} aria-label="Close" className="btn btn-icon btn-sm btn-ghost -mr-1.5">
                  <IconClose size={17} />
                </button>
              </div>
              <ol className="grid gap-5 px-5 pt-5 sm:gap-6 sm:px-7 sm:pt-6">
                {STEPS.map(({ icon: Icon, title, text }) => (
                  <li key={title} className="flex gap-4">
                    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-raise2 text-gold">
                      <Icon size={20} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[17px] font-semibold tracking-[-0.01em]">{title}</p>
                      <p className="mt-1 text-[15px] leading-relaxed text-muted">{text}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="p-5 sm:p-7">
                <Link to="/launch" onClick={close} className="btn btn-xl btn-primary w-full">
                  Launch a coin
                </Link>
              </div>
            </Modal>,
            document.body,
          )
        : null}
    </>
  );
}
