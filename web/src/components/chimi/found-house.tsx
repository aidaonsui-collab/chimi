import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { DOJANG_URL } from "@/lib/chimi/identity";
import { INKS, SEALS, checkMotto, checkName, checkTag, suggestTag, type House, type Ink, type Seal } from "@/lib/chimi/house-rules";
import { shrinkImage } from "@/lib/chimi/meta";
import { useHouseAction, useMyProfile } from "@/lib/chimi/rewards";
import { dataUrlToFile, uploadImage } from "@/lib/chimi/token-image";
import { useChimi } from "@/components/chimi/provider";
import { HouseSeal } from "@/components/chimi/house-seal";
import { IconImage } from "@/components/chimi/icons";
import { Modal, Seg } from "@/components/chimi/ui";

type SealMode = "stamp" | "picture";

/** A seal picture: a data: URL picked here (uploaded when the change is signed), or one already on Chimi. */
type Picture = string | null;

function InkPicker({ ink, onInk, label }: { ink: Ink; onInk: (i: Ink) => void; label: string }) {
  return (
    <>
      <p className="label mt-4" id="ink-label">
        {label}
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

/** Choose a stamped character, or a picture of your own, for the seal; and its ink. */
function SealChooser({
  mode,
  onMode,
  seal,
  ink,
  picture,
  onSeal,
  onInk,
  onPicture,
}: {
  mode: SealMode;
  onMode: (m: SealMode) => void;
  seal: Seal;
  ink: Ink;
  picture: Picture;
  onSeal: (s: Seal) => void;
  onInk: (i: Ink) => void;
  onPicture: (p: Picture) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setProblem(null);
    if (!file.type.startsWith("image/")) return setProblem("That isn't a picture.");
    try {
      onPicture(await shrinkImage(file));
    } catch {
      setProblem("Couldn't read that picture. Try a JPG or PNG.");
    }
  }

  return (
    <>
      <p className="label mt-5">Seal</p>
      <Seg
        label="Seal"
        value={mode}
        onChange={onMode}
        options={[
          ["stamp", "Stamp"],
          ["picture", "Your picture"],
        ]}
      />
      {mode === "stamp" ? (
        <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6" role="radiogroup" aria-label="Seal character">
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
      ) : (
        <div
          className="mt-3 flex items-center gap-4 rounded-xl border border-dashed border-edge p-3.5"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void pick(e.dataTransfer.files[0]);
          }}
        >
          <button type="button" onClick={() => fileRef.current?.click()} className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-line bg-bg text-muted hover:border-edge hover:text-fg" aria-label={picture ? "Change the picture" : "Choose a picture"}>
            {picture ? <HouseSeal seal={seal} ink={ink} image={picture} size={64} /> : <IconImage size={22} />}
          </button>
          <div className="min-w-0 text-sm">
            <p className="font-medium text-fg">{picture ? "Your picture" : "Add a picture"}</p>
            <p className="mt-0.5 text-muted">Drop it here or click. Square works best; it shows on paper, framed in your ink.</p>
            {picture ? (
              <button type="button" onClick={() => onPicture(null)} className="mt-1 text-xs text-muted underline underline-offset-2 hover:text-fg">
                Remove
              </button>
            ) : null}
            {problem ? <p className="mt-1 text-xs text-down">{problem}</p> : null}
          </div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
        </div>
      )}
      <InkPicker ink={ink} onInk={onInk} label={mode === "picture" ? "Frame ink" : "Ink"} />
    </>
  );
}

/** "Anyone can join" or "You approve", with what each means. */
function NewMembers({ approve, onApprove, later = true }: { approve: boolean; onApprove: (a: boolean) => void; later?: boolean }) {
  return (
    <>
      {/* In its own dialog the title already says "New members". */}
      {later ? <p className="label mt-5">New members</p> : <div className="mt-5" />}
      <Seg
        label="New members"
        value={approve ? "approve" : "anyone"}
        onChange={(v) => onApprove(v === "approve")}
        options={[
          ["anyone", "Anyone can join"],
          ["approve", "You approve"],
        ]}
      />
      <p className="mt-2 text-[13px] text-muted">
        {approve ? "Wallets ask to join, and you accept or turn down each one." : "Anyone with a Dojang can join right away."}
        {later ? " You can change this on the house’s page later." : ""}
      </p>
    </>
  );
}

/** Uploads a picked picture; an https one is already on Chimi. */
async function uploaded(picture: Picture, name: string): Promise<string | null> {
  if (!picture) return null;
  if (!picture.startsWith("data:")) return picture;
  return uploadImage(await dataUrlToFile(picture, `house-${name.toLowerCase()}`));
}

const field = "field";

/** Found a house: name, tag, seal (a stamp or a picture), motto and who can join, with a live preview. */
export function FoundHouseDialog({ onClose, current }: { onClose: () => void; current?: House }) {
  const { account } = useChimi();
  const { profile } = useMyProfile();
  const { run, pending, error } = useHouseAction();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [tagTouched, setTagTouched] = useState(false);
  const [mode, setMode] = useState<SealMode>("stamp");
  const [seal, setSeal] = useState<Seal>("龍");
  const [ink, setInk] = useState<Ink>("seal");
  const [picture, setPicture] = useState<Picture>(null);
  const [motto, setMotto] = useState("");
  const [approve, setApprove] = useState(false);
  const [tried, setTried] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => nameRef.current?.focus(), []);

  const shownTag = tagTouched ? tag : suggestTag(name);
  const needsPicture = mode === "picture" && !picture;
  const problems = { name: checkName(name), tag: checkTag(shownTag), motto: checkMotto(motto.trim()) };
  const ok = !problems.name && !problems.tag && !problems.motto && !needsPicture;
  const noDojang = profile?.verified === false;
  const shownPicture = mode === "picture" ? picture : null;

  async function submit() {
    setTried(true);
    setUploadError(null);
    if (!ok) return;
    let image: string | null = null;
    if (shownPicture) {
      setUploading(true);
      try {
        image = await uploaded(shownPicture, shownTag);
      } catch (e) {
        setUploadError(e instanceof Error ? e.message : "Couldn't upload the picture.");
        return;
      } finally {
        setUploading(false);
      }
    }
    const done = await run({ type: "found", tag: shownTag, name: name.trim(), seal, ink, motto: motto.trim(), approve, image });
    if (done) {
      onClose();
      void navigate({ to: "/houses/$tag", params: { tag: shownTag } });
    }
  }

  return (
    <Modal kicker="New house · 가문" title="Found a house" onClose={onClose} width={640}>
      <div className="mt-5 flex items-center gap-4 rounded-xl border border-line bg-bg p-4">
        <HouseSeal seal={seal} ink={ink} image={shownPicture ?? undefined} size={72} />
        <div className="min-w-0">
          <p className="flex min-w-0 items-center gap-2">
            <span className="truncate text-xl font-semibold tracking-[-0.02em]">{name.trim() || "Your house"}</span>
            <span className="shrink-0 rounded-md border border-edge bg-raise px-1.5 py-px text-xs font-semibold tracking-[0.08em] text-muted">{shownTag || "TAG"}</span>
          </p>
          <p className="mt-1 truncate font-serif text-[15px] text-muted">{motto.trim() || (shownPicture ? "Your own seal" : SEALS[seal])}</p>
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

      <SealChooser mode={mode} onMode={setMode} seal={seal} ink={ink} picture={picture} onSeal={setSeal} onInk={setInk} onPicture={setPicture} />
      {tried && needsPicture ? <p className="mt-2 text-xs text-down">Add a picture, or use a stamp.</p> : null}

      <label className="label mt-4" htmlFor="house-motto">
        Motto <span className="font-normal text-faint">· optional</span>
      </label>
      <input id="house-motto" maxLength={80} value={motto} onChange={(e) => setMotto(e.target.value)} placeholder="Tiles before towers." className={field} />
      {tried && problems.motto ? <p className="mt-1 text-xs text-down">{problems.motto}</p> : null}

      <NewMembers approve={approve} onApprove={setApprove} />

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
        <button type="button" disabled={!!pending || uploading || noDojang} onClick={() => void submit()} className="btn btn-primary">
          {uploading ? "Uploading the picture…" : pending ? "Sign in your wallet…" : account ? "Sign and found" : "Connect and found"}
        </button>
      </div>
      {uploadError || error ? (
        <p role="alert" className="mt-3 text-right text-sm text-down">
          {uploadError ?? error}
        </p>
      ) : null}
    </Modal>
  );
}

/** The head changes the house's seal: a stamped character, or a picture of their own; and its ink. */
export function EditSealDialog({ house, onClose }: { house: House; onClose: () => void }) {
  const { run, pending, error } = useHouseAction();
  const [mode, setMode] = useState<SealMode>(house.image ? "picture" : "stamp");
  const [seal, setSeal] = useState<Seal>(house.seal);
  const [ink, setInk] = useState<Ink>(house.ink);
  const [picture, setPicture] = useState<Picture>(house.image ?? null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const shownPicture = mode === "picture" ? picture : null;
  const unchanged = seal === house.seal && ink === house.ink && (shownPicture ?? null) === (house.image ?? null);
  const needsPicture = mode === "picture" && !picture;

  async function save() {
    setUploadError(null);
    let image: string | null = null;
    if (shownPicture) {
      setUploading(true);
      try {
        image = await uploaded(shownPicture, house.tag);
      } catch (e) {
        setUploadError(e instanceof Error ? e.message : "Couldn't upload the picture.");
        return;
      } finally {
        setUploading(false);
      }
    }
    if (await run({ type: "seal", seal, ink, image })) onClose();
  }

  return (
    <Modal kicker={`[${house.tag}] ${house.name}`} title="Change the seal" onClose={onClose} width={640}>
      <div className="mt-5 flex justify-center rounded-xl border border-line bg-bg p-5">
        <HouseSeal seal={seal} ink={ink} image={shownPicture ?? undefined} size={96} />
      </div>
      <SealChooser mode={mode} onMode={setMode} seal={seal} ink={ink} picture={picture} onSeal={setSeal} onInk={setInk} onPicture={setPicture} />
      <div className="mt-6 flex items-center justify-end gap-2">
        <button type="button" onClick={onClose} className="btn btn-ghost">
          Cancel
        </button>
        <button type="button" disabled={!!pending || uploading || unchanged || needsPicture} onClick={() => void save()} className="btn btn-primary">
          {uploading ? "Uploading the picture…" : pending ? "Sign in your wallet…" : "Sign and stamp"}
        </button>
      </div>
      {uploadError || error ? (
        <p role="alert" className="mt-3 text-right text-sm text-down">
          {uploadError ?? error}
        </p>
      ) : null}
    </Modal>
  );
}

/** The head chooses how new members come in. */
export function NewMembersDialog({ house, onClose }: { house: House; onClose: () => void }) {
  const { run, pending, error } = useHouseAction();
  const [approve, setApprove] = useState(!!house.approve);
  return (
    <Modal kicker={`[${house.tag}] ${house.name}`} title="New members" onClose={onClose} width={520}>
      <NewMembers approve={approve} onApprove={setApprove} later={false} />
      <div className="mt-6 flex items-center justify-end gap-2">
        <button type="button" onClick={onClose} className="btn btn-ghost">
          Cancel
        </button>
        <button type="button" disabled={!!pending || approve === !!house.approve} onClick={() => void run({ type: "approve", approve }).then((done) => done && onClose())} className="btn btn-primary">
          {pending ? "Sign in your wallet…" : "Sign and save"}
        </button>
      </div>
      {error ? <p role="alert" className="mt-3 text-right text-sm text-down">{error}</p> : null}
    </Modal>
  );
}
