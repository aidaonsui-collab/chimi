import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { DOJANG_URL } from "@/lib/chimi/identity";
import { INKS, SEALS, checkMotto, checkName, checkTag, suggestTag, type House, type Ink, type Seal } from "@/lib/chimi/house-rules";
import { useHouseAction, useMyProfile } from "@/lib/chimi/rewards";
import { useChimi } from "@/components/chimi/provider";
import { HouseSeal } from "@/components/chimi/house-seal";
import { Modal } from "@/components/chimi/ui";

function SealPicker({ seal, ink, onSeal, onInk }: { seal: Seal; ink: Ink; onSeal: (s: Seal) => void; onInk: (i: Ink) => void }) {
  return (
    <>
      <p className="label mt-5" id="seal-label">
        Seal
      </p>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6" role="radiogroup" aria-labelledby="seal-label">
        {(Object.keys(SEALS) as Seal[]).map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={s === seal}
            title={SEALS[s]}
            onClick={() => onSeal(s)}
            className={`grid place-items-center rounded-xl border p-1.5 transition-colors ${s === seal ? "border-gold/70 bg-gold/10" : "border-line hover:border-edge"}`}
          >
            <HouseSeal seal={s} ink={ink} size={40} />
            <span className="mt-1 text-[10px] text-muted">{SEALS[s].split(" · ")[1]}</span>
          </button>
        ))}
      </div>
      <p className="label mt-4" id="ink-label">
        Ink
      </p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby="ink-label">
        {(Object.keys(INKS) as Ink[]).map((i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={i === ink}
            aria-label={i}
            title={i}
            onClick={() => onInk(i)}
            className={`size-8 rounded-full border-2 transition-transform hover:scale-110 ${i === ink ? "border-fg" : "border-transparent"}`}
            style={{ background: INKS[i], boxShadow: "inset 0 0 0 2px rgba(243,234,216,.35)" }}
          />
        ))}
      </div>
    </>
  );
}

const field = "field";

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
    <Modal kicker="New house · 가문" title="Found a house" onClose={onClose} width={640}>
      <div className="mt-5 flex items-center gap-4 rounded-xl border border-line bg-bg p-4">
        <HouseSeal seal={seal} ink={ink} size={72} />
        <div className="min-w-0">
          <p className="flex min-w-0 items-center gap-2">
            <span className="truncate text-xl font-semibold tracking-[-0.02em]">{name.trim() || "Your house"}</span>
            <span className="shrink-0 rounded-md border border-edge bg-raise px-1.5 py-px text-xs font-semibold tracking-[0.08em] text-muted">{shownTag || "TAG"}</span>
          </p>
          <p className="mt-1 truncate font-serif text-[15px] text-muted">{motto.trim() || SEALS[seal]}</p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
        <div>
          <label className="label" htmlFor="house-name">
            Name
          </label>
          <input id="house-name" ref={nameRef} maxLength={20} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ridge Line" className={field} />
          {tried && problems.name ? <p className="mt-1 text-xs text-down">{problems.name}</p> : null}
        </div>
        <div>
          <label className="label" htmlFor="house-tag">
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
          {tried && problems.tag ? <p className="mt-1 text-xs text-down">{problems.tag}</p> : <p className="mt-1 text-xs text-faint">Yours for good.</p>}
        </div>
      </div>

      <SealPicker seal={seal} ink={ink} onSeal={setSeal} onInk={setInk} />

      <label className="label mt-4" htmlFor="house-motto">
        Motto <span className="font-normal text-faint">· optional</span>
      </label>
      <input id="house-motto" maxLength={80} value={motto} onChange={(e) => setMotto(e.target.value)} placeholder="Tiles before towers." className={field} />
      {tried && problems.motto ? <p className="mt-1 text-xs text-down">{problems.motto}</p> : null}

      {noDojang ? (
        <p className="mt-4 rounded-xl border border-gold/30 bg-gold/8 px-3.5 py-2.5 text-sm text-muted">
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
        <button type="button" onClick={onClose} className="btn btn-ghost">
          Cancel
        </button>
        <button type="button" disabled={!!pending || noDojang} onClick={() => void submit()} className="btn btn-primary">
          {pending ? "Sign in your wallet…" : account ? "Sign and found" : "Connect and found"}
        </button>
      </div>
      {error ? <p role="alert" className="mt-3 text-right text-sm text-down">{error}</p> : null}
    </Modal>
  );
}

/** The head changes the house's seal and ink. */
export function EditSealDialog({ house, onClose }: { house: House; onClose: () => void }) {
  const { run, pending, error } = useHouseAction();
  const [seal, setSeal] = useState<Seal>(house.seal);
  const [ink, setInk] = useState<Ink>(house.ink);
  return (
    <Modal kicker={`[${house.tag}] ${house.name}`} title="Change the seal" onClose={onClose} width={640}>
      <div className="mt-5 flex justify-center rounded-xl border border-line bg-bg p-5">
        <HouseSeal seal={seal} ink={ink} size={96} />
      </div>
      <SealPicker seal={seal} ink={ink} onSeal={setSeal} onInk={setInk} />
      <div className="mt-6 flex items-center justify-end gap-2">
        <button type="button" onClick={onClose} className="btn btn-ghost">
          Cancel
        </button>
        <button type="button" disabled={!!pending || (seal === house.seal && ink === house.ink)} onClick={() => void run({ type: "seal", seal, ink }).then((done) => done && onClose())} className="btn btn-primary">
          {pending ? "Sign in your wallet…" : "Sign and stamp"}
        </button>
      </div>
      {error ? <p role="alert" className="mt-3 text-right text-sm text-down">{error}</p> : null}
    </Modal>
  );
}
