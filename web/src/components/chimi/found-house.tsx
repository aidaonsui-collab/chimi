import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { DOJANG_URL } from "@/lib/chimi/identity";
import { INKS, SEALS, checkMotto, checkName, checkTag, suggestTag, type House, type Ink, type Seal } from "@/lib/chimi/house-rules";
import { useHouseAction, useMyProfile } from "@/lib/chimi/rewards";
import { useChimi } from "@/components/chimi/provider";
import { HouseSeal } from "@/components/chimi/house-seal";

function Modal({ title, kicker, onClose, children }: { title: string; kicker: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="presentation">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-[#0d0907]/60 backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="house-dialog-title"
        className="relative max-h-[92vh] w-full max-w-[640px] overflow-y-auto rounded-t-3xl border border-line bg-chip p-5 shadow-2xl sm:m-4 sm:rounded-3xl sm:p-7"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs tracking-[0.22em] text-seal uppercase">{kicker}</p>
            <h2 id="house-dialog-title" className="mt-1 font-display text-4xl leading-none sm:text-5xl">
              {title}
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-9 place-items-center rounded-full text-muted hover:bg-fg/6 hover:text-fg">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
              <path d="M2 2l10 10M12 2 2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SealPicker({ seal, ink, onSeal, onInk }: { seal: Seal; ink: Ink; onSeal: (s: Seal) => void; onInk: (i: Ink) => void }) {
  return (
    <>
      <p className="mt-5 text-sm text-muted" id="seal-label">
        Seal
      </p>
      <div className="mt-2 grid grid-cols-6 gap-2" role="radiogroup" aria-labelledby="seal-label">
        {(Object.keys(SEALS) as Seal[]).map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={s === seal}
            title={SEALS[s]}
            onClick={() => onSeal(s)}
            className={`grid place-items-center rounded-xl border p-1.5 transition ${s === seal ? "border-gold bg-gold/10" : "border-line hover:border-muted/60"}`}
          >
            <HouseSeal seal={s} ink={ink} size={40} />
            <span className="mt-1 text-[10px] text-muted">{SEALS[s].split(" · ")[1]}</span>
          </button>
        ))}
      </div>
      <p className="mt-4 text-sm text-muted" id="ink-label">
        Ink
      </p>
      <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-labelledby="ink-label">
        {(Object.keys(INKS) as Ink[]).map((i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={i === ink}
            aria-label={i}
            title={i}
            onClick={() => onInk(i)}
            className={`size-8 rounded-full border-2 ${i === ink ? "border-fg" : "border-transparent"}`}
            style={{ background: INKS[i], boxShadow: "inset 0 0 0 2px rgba(243,234,216,.35)" }}
          />
        ))}
      </div>
    </>
  );
}

const field = "mt-1 w-full rounded-xl border border-line bg-bg px-3 py-2.5 outline-none focus:border-muted";

/** Found a house: name, tag, seal, ink and motto, with a live preview. */
export function FoundHouseDialog({ onClose, current }: { onClose: () => void; current?: House }) {
  const { account } = useChimi();
  const { profile } = useMyProfile();
  const { run, pending, error } = useHouseAction();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [tagTouched, setTagTouched] = useState(false);
  const [seal, setSeal] = useState<Seal>("龍");
  const [ink, setInk] = useState<Ink>("seal");
  const [motto, setMotto] = useState("");
  const [tried, setTried] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => nameRef.current?.focus(), []);

  const shownTag = tagTouched ? tag : suggestTag(name);
  const problems = { name: checkName(name), tag: checkTag(shownTag), motto: checkMotto(motto.trim()) };
  const ok = !problems.name && !problems.tag && !problems.motto;
  const noDojang = profile?.verified === false;

  async function submit() {
    setTried(true);
    if (!ok) return;
    const done = await run({ type: "found", tag: shownTag, name: name.trim(), seal, ink, motto: motto.trim() });
    if (done) {
      onClose();
      void navigate({ to: "/houses/$tag", params: { tag: shownTag } });
    }
  }

  return (
    <Modal kicker="New house · 가문" title="Found" onClose={onClose}>
      <div className="mt-5 flex items-center gap-4 rounded-2xl border border-line/80 bg-bg/40 p-4">
        <HouseSeal seal={seal} ink={ink} size={72} />
        <div className="min-w-0">
          <p className="flex min-w-0 items-center gap-2">
            <span className="truncate text-xl font-semibold tracking-[-0.02em]">{name.trim() || "Your house"}</span>
            <span className="shrink-0 rounded-md border border-line px-1.5 py-px text-xs font-semibold tracking-[0.08em] text-muted">{shownTag || "TAG"}</span>
          </p>
          <p className="mt-1 truncate font-serif text-[15px] text-muted">{motto.trim() || SEALS[seal]}</p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
        <div>
          <label className="block text-sm text-muted" htmlFor="house-name">
            Name
          </label>
          <input id="house-name" ref={nameRef} maxLength={20} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ridge Line" className={field} />
          {tried && problems.name ? <p className="mt-1 text-xs text-seal">{problems.name}</p> : null}
        </div>
        <div>
          <label className="block text-sm text-muted" htmlFor="house-tag">
            Tag
          </label>
          <input
            id="house-tag"
            maxLength={5}
            value={shownTag}
            onChange={(e) => {
              setTagTouched(true);
              setTag(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""));
            }}
            placeholder="RIDGE"
            className={`${field} font-semibold tracking-[0.14em]`}
          />
          {tried && problems.tag ? <p className="mt-1 text-xs text-seal">{problems.tag}</p> : <p className="mt-1 text-xs text-muted">Yours for good.</p>}
        </div>
      </div>

      <SealPicker seal={seal} ink={ink} onSeal={setSeal} onInk={setInk} />

      <label className="mt-4 block text-sm text-muted" htmlFor="house-motto">
        Motto <span className="text-muted/70">(optional)</span>
      </label>
      <input id="house-motto" maxLength={80} value={motto} onChange={(e) => setMotto(e.target.value)} placeholder="Tiles before towers." className={field} />
      {tried && problems.motto ? <p className="mt-1 text-xs text-seal">{problems.motto}</p> : null}

      {noDojang ? (
        <p className="mt-4 rounded-xl border border-seal/40 bg-seal/10 px-3.5 py-2.5 text-sm text-muted">
          This wallet has no Dojang, and houses are for wallets with one.{" "}
          <a href={DOJANG_URL} target="_blank" rel="noreferrer" className="font-medium text-fg underline underline-offset-2">
            Get a Dojang ↗
          </a>
        </p>
      ) : current ? (
        <p className="mt-4 text-sm text-muted">
          You’ll leave [{current.tag}] {current.name} and head the new house. You’ll stay in it for at least 7 days.
        </p>
      ) : (
        <p className="mt-4 text-sm text-muted">You’ll head the house, and stay in it for at least 7 days. Founding is a signature, not a transaction.</p>
      )}

      <div className="mt-5 flex items-center justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-full px-4 py-2 text-sm text-muted hover:text-fg">
          Cancel
        </button>
        <button
          type="button"
          disabled={!!pending || noDojang}
          onClick={() => void submit()}
          className="rounded-full bg-seal px-5 py-2.5 text-sm font-semibold text-onseal shadow-[inset_0_1px_0_rgba(255,255,255,.22),0_6px_20px_rgba(210,74,46,.35)] disabled:opacity-40 disabled:shadow-none"
        >
          {pending ? "Sign in your wallet…" : account ? "Sign and found" : "Connect and found"}
        </button>
      </div>
      {error ? <p className="mt-3 text-right text-sm text-seal">{error}</p> : null}
    </Modal>
  );
}

/** The head changes the house's seal and ink. */
export function EditSealDialog({ house, onClose }: { house: House; onClose: () => void }) {
  const { run, pending, error } = useHouseAction();
  const [seal, setSeal] = useState<Seal>(house.seal);
  const [ink, setInk] = useState<Ink>(house.ink);
  return (
    <Modal kicker={`[${house.tag}] ${house.name}`} title="Seal" onClose={onClose}>
      <div className="mt-5 flex justify-center rounded-2xl border border-line/80 bg-bg/40 p-5">
        <HouseSeal seal={seal} ink={ink} size={96} />
      </div>
      <SealPicker seal={seal} ink={ink} onSeal={setSeal} onInk={setInk} />
      <div className="mt-6 flex items-center justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-full px-4 py-2 text-sm text-muted hover:text-fg">
          Cancel
        </button>
        <button
          type="button"
          disabled={!!pending || (seal === house.seal && ink === house.ink)}
          onClick={() => void run({ type: "seal", seal, ink }).then((done) => done && onClose())}
          className="rounded-full bg-seal px-5 py-2.5 text-sm font-semibold text-onseal disabled:opacity-40"
        >
          {pending ? "Sign in your wallet…" : "Sign and stamp"}
        </button>
      </div>
      {error ? <p className="mt-3 text-right text-sm text-seal">{error}</p> : null}
    </Modal>
  );
}
