import { useEffect, useMemo, useState } from "react";
import { IconBroadcast, IconCheck, IconChevronDown, IconCoinTip, IconCopy, IconExternal, IconEye } from "@/components/chimi/icons";
import { useChimi } from "@/components/chimi/provider";
import { LivePill } from "@/components/chimi/live-pill";
import { TipSheet, TipsBar, tipperName } from "@/components/chimi/tip";
import { toast } from "@/components/chimi/toast";
import { TipAlertCard } from "@/components/chimi/tip-alert";
import { Modal, Note, Seg } from "@/components/chimi/ui";
import { useProfiles } from "@/lib/chimi/rewards";
import { useTips } from "@/lib/chimi/tips";
import { compactCount, money } from "@/lib/chimi/format";
import { useEthUsd } from "@/lib/chimi/live";
import { describeLink, embedUrl, parseStreamLink, platformName, thumbnailUrl, watchUrl, type StreamLink, type StreamView } from "@/lib/chimi/stream-rules";
import { checkStreamLink, useStreamSend, type LinkCheck } from "@/lib/chimi/streams";

export { LivePill } from "@/components/chimi/live-pill";

const hiddenKey = (token: string) => `chimi.stream.hidden.${token.toLowerCase()}`;

function readHidden(token: string) {
  try {
    return sessionStorage.getItem(hiddenKey(token)) === "1";
  } catch {
    return false;
  }
}

/**
 * A coin's live stream at the top of its page: the stream's own player (YouTube's or SOOP's), or a card that opens it
 * there when it won't play on another site. It can be folded away for the rest of the visit.
 */
export function StreamStage({ view, symbol, creator }: { view: StreamView; symbol: string; creator: string }) {
  const [hidden, setHidden] = useState(() => (typeof window === "undefined" ? false : readHidden(view.token)));
  const { deployment, account } = useChimi();
  const tipsOn = !!deployment?.tips;
  const own = !!account && account.toLowerCase() === creator.toLowerCase();
  const { tips, refresh } = useTips(deployment, tipsOn ? view.token : undefined);
  const profiles = useProfiles([creator, ...(tips ?? []).map((t) => t.from)]);
  const [tipping, setTipping] = useState(false);
  // The streamer's channel name is who viewers know; the wallet's up.id name or address stands in without one.
  const creatorName = view.status.name ?? tipperName(profiles, creator.toLowerCase());
  const { link, status } = view;
  const src = embedUrl(link, status);
  const site = platformName(link.platform);
  const who = status.name ?? describeLink(link);
  const fold = () => {
    const next = !hidden;
    setHidden(next);
    try {
      sessionStorage.setItem(hiddenKey(view.token), next ? "1" : "0");
    } catch {
      /* private mode: it stays folded for this page */
    }
  };
  return (
    <section className="card stream-stage" aria-label={`${symbol} live stream`}>
      <div className="stream-bar">
        <LivePill />
        <div className="min-w-0 flex-1">
          {/* A 19+ stream's title can be anything, so it isn't repeated here. */}
          <p className="truncate text-[14.5px] leading-snug font-semibold">{status.adult ? `19+ stream on ${site}` : (status.title ?? `${who} is live`)}</p>
          <p className="truncate text-[12.5px] text-muted">
            {who} · on {site}
            {status.viewers !== undefined ? <span className="stream-viewers-inline"> · {compactCount(status.viewers)} watching</span> : null}
          </p>
        </div>
        {status.viewers !== undefined ? (
          <span className="chip num stream-viewers shrink-0 gap-1 text-[12.5px]" title={`${status.viewers.toLocaleString("en-US")} watching on ${site}`}>
            <IconEye size={13} />
            {compactCount(status.viewers)}
          </span>
        ) : null}
        {tipsOn && !own ? (
          <button type="button" onClick={() => setTipping(true)} className="btn btn-sm tip-btn shrink-0">
            <IconCoinTip size={15} />
            Tip
          </button>
        ) : null}
        <a href={watchUrl(link, status)} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-ghost stream-site shrink-0">
          {site}
          <IconExternal size={14} />
        </a>
        <button type="button" onClick={fold} aria-expanded={!hidden} aria-label={hidden ? "Show the stream" : "Hide the stream"} className="btn btn-icon btn-sm btn-ghost shrink-0">
          <IconChevronDown size={16} className={`transition-transform ${hidden ? "" : "rotate-180"}`} />
        </button>
      </div>
      {hidden ? null : (
        // On a wide card the player takes the left half and the tips (or the stream's details) the right; on a
        // narrow one they stack. Decided by the card's own width (a container query in styles.css).
        <div className="stream-body">
          <div className="stream-screen">
            {src ? (
              <div className="stream-frame">
                <iframe
                  key={src}
                  src={src}
                  title={`${who} live on ${site}`}
                  allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              </div>
            ) : (
              <Offsite view={view} />
            )}
          </div>
          <div className="stream-side">
            {tipsOn ? (
              tips ? (
                <TipsBar tips={tips} profiles={profiles} me={account} creatorName={creatorName} own={own} onTip={() => setTipping(true)} />
              ) : (
                <div className="stream-side-wait" aria-hidden>
                  <span className="skeleton h-8 w-full rounded-xl" />
                  <span className="skeleton h-8 w-4/5 rounded-xl" />
                  <span className="skeleton h-8 w-3/5 rounded-xl" />
                </div>
              )
            ) : (
              <div className="stream-info">
                <p className="eyebrow">{site}</p>
                <p className="stream-info-title">{status.adult ? `19+ stream on ${site}` : (status.title ?? `${who} is live`)}</p>
                <p className="text-[13px] text-muted">
                  {who}
                  {status.viewers !== undefined ? ` · ${compactCount(status.viewers)} watching` : ""}
                </p>
                <a href={watchUrl(link, status)} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-secondary mt-auto self-start">
                  Watch on {site}
                  <IconExternal size={13} />
                </a>
              </div>
            )}
          </div>
        </div>
      )}
      {tipping ? (
        <TipSheet
          to={{ name: creatorName, wallet: creator, symbol, token: view.token, live: status.live }}
          onClose={() => setTipping(false)}
          onSent={() => void refresh()}
        />
      ) : null}
    </section>
  );
}

/** A stream that won't play on another site: its still, why, and a way to watch it there. */
function Offsite({ view }: { view: StreamView }) {
  const { link, status } = view;
  const site = platformName(link.platform);
  const still = thumbnailUrl(link, status);
  const why = status.adult
    ? `This stream is 19+ on ${site}, so it only plays there.`
    : status.locked
      ? `This stream needs a password or a subscription on ${site}.`
      : `This stream can't play on other sites, so it opens on ${site}.`;
  return (
    <a href={watchUrl(link, status)} target="_blank" rel="noopener noreferrer" className={`stream-frame stream-offsite ${still ? "" : "stream-offsite-short"}`}>
      {still ? <img src={still} alt="" referrerPolicy="no-referrer" className="stream-still" /> : null}
      <span className="stream-offsite-body">
        <span className="max-w-[30ch] text-[15px] leading-snug font-semibold text-balance">{why}</span>
        <span className="btn btn-sm btn-light">
          Watch on {site}
          <IconExternal size={14} />
        </span>
      </span>
    </a>
  );
}

/** For the creator only: the channel is linked but not live, so they know it will show up. */
export function StreamIdle({ view, symbol, onManage }: { view: StreamView; symbol: string; onManage: () => void }) {
  const site = platformName(view.link.platform);
  return (
    <section className="card stream-idle">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-raise text-muted">
        <IconBroadcast size={18} />
      </span>
      <p className="min-w-0 flex-1 text-[13.5px] leading-snug text-muted">
        <span className="font-semibold text-fg">{view.status.name ?? describeLink(view.link)}</span> on {site} is linked. When you go live there, the stream plays here and ${symbol} shows LIVE on the board.
      </p>
      <button type="button" onClick={onManage} className="btn btn-sm btn-secondary shrink-0">
        Manage
      </button>
    </section>
  );
}

const sameLink = (a: StreamLink | undefined, b: StreamLink | undefined) => !!a && !!b && a.platform === b.platform && a.kind === b.kind && a.ref === b.ref;

/** The creator's form: link a YouTube or SOOP channel to the coin, or remove it. Each is one signature, no gas. */
export function StreamSheet({ token, symbol, current, onClose }: { token: string; symbol: string; current: StreamView | null | undefined; onClose: () => void }) {
  const send = useStreamSend();
  const [input, setInput] = useState(current?.url ?? "");
  const [check, setCheck] = useState<LinkCheck | "checking" | null>(null);
  const [busy, setBusy] = useState<"link" | "remove" | null>(null);
  const [note, setNote] = useState<{ bad: boolean; text: string } | null>(null);
  const parsed = useMemo(() => (input.trim() ? parseStreamLink(input) : null), [input]);
  const link = parsed && !("error" in parsed) ? parsed : undefined;
  const linkKey = link ? `${link.platform}:${link.kind}:${link.ref}` : "";

  // Asks what the link points at once typing pauses, so the creator sees the channel before signing for it.
  useEffect(() => {
    if (!linkKey) {
      setCheck(null);
      return;
    }
    const ctl = new AbortController();
    setCheck("checking");
    const timer = setTimeout(() => {
      checkStreamLink(input, ctl.signal).then(setCheck, () => undefined);
    }, 450);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
    // Only a change in what the link points at is worth asking again, not every keystroke.
  }, [linkKey]);

  const found = check && check !== "checking" && check.ok ? check : undefined;
  // What gets signed is what the server found: a pasted YouTube video comes back as its channel.
  const already = sameLink(found?.link, current?.link ?? undefined);
  const canLink = !!found && !already && !busy;

  async function run(kind: "link" | "remove") {
    setBusy(kind);
    setNote({ bad: false, text: "Sign the message in your wallet. It costs no gas." });
    const out = await send(token, kind === "link" && found ? { type: "set", link: found.link } : { type: "remove" });
    setBusy(null);
    if (!out.ok) {
      setNote(out.cancelled ? null : { bad: true, text: out.error });
      return;
    }
    toast(
      kind === "link"
        ? { kind: "good", title: "Stream linked", body: out.stream?.status.live ? `You're live. The stream now plays on ${symbol}'s page.` : `When you go live, the stream plays on ${symbol}'s page.` }
        : { kind: "good", title: "Stream removed", body: `${symbol}'s page no longer shows a stream.` },
    );
    onClose();
  }

  return (
    <Modal kicker={`$${symbol}`} title="Live stream" onClose={onClose} width={560}>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Link your YouTube or SOOP channel. Whenever you&rsquo;re live there, the stream plays at the top of this page and ${symbol} shows LIVE on the board.
      </p>
      <label className="mt-5 block">
        <span className="label">Channel link</span>
        <input
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setNote(null);
          }}
          placeholder="youtube.com/@you or sooplive.co.kr/station/you"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          className="field"
        />
      </label>
      <div className="mt-2.5 min-h-[3.25rem]" aria-live="polite">
        {parsed && "error" in parsed ? (
          <p className="text-sm text-down">{parsed.error}</p>
        ) : check === "checking" ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <span className="spinner" aria-hidden />
            Checking the channel…
          </p>
        ) : check && !check.ok ? (
          <p className="text-sm text-down">{check.error}</p>
        ) : found ? (
          <div className="stream-found">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-raise text-muted">
              <IconBroadcast size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-[14px] font-semibold">{found.status.name ?? describeLink(found.link)}</span>
                <span className="shrink-0 text-[12.5px] text-faint">{platformName(found.link.platform)}</span>
                {found.status.live ? <LivePill small /> : null}
              </span>
              <span className="block truncate text-[12.5px] text-muted">
                {found.status.live
                  ? found.status.adult
                    ? "Live now, marked 19+: viewers will get a button to watch it on SOOP."
                    : (found.status.title ?? "Live now")
                  : found.link.kind === "video"
                    ? "This video isn't live. Link your channel instead to show every stream."
                    : link?.kind === "video"
                      ? "That video's channel. It shows here whenever it goes live."
                      : "Not live right now. It shows here whenever you go live."}
              </span>
            </span>
            {already ? <span className="chip shrink-0 text-[12px]">Linked</span> : null}
          </div>
        ) : null}
      </div>
      <AlertsLink token={token} />
      <ul className="mt-3 space-y-1.5 text-[12.5px] leading-relaxed text-faint">
        <li>The stream plays in YouTube&rsquo;s or SOOP&rsquo;s own player. Chimi doesn&rsquo;t record or host it.</li>
        <li>19+ and password streams show a button to watch them on SOOP instead.</li>
        <li>Chimi can take down a link that breaks the rules.</li>
      </ul>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <Note kind={note?.bad ? "bad" : ""} className="min-w-0 flex-1">
          {note?.text}
        </Note>
        <div className="ml-auto flex gap-2">
          {current ? (
            <button type="button" disabled={!!busy} onClick={() => void run("remove")} className="btn btn-ghost text-down">
              {busy === "remove" ? "Removing…" : "Remove"}
            </button>
          ) : null}
          <button type="button" disabled={!canLink} onClick={() => void run("link")} className="btn btn-primary">
            {busy === "link" ? "Linking…" : "Sign and link"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** A small on/off switch for the alert options. */
function Switch({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="alerts-switch">
      <span className={`switch-track ${on ? "switch-on" : ""}`} aria-hidden>
        <span className="switch-knob" />
      </span>
      {label}
    </button>
  );
}

const MIN_OPTIONS = [
  ["", "Any"],
  ["0.001", "0.001+"],
  ["0.01", "0.01+"],
  ["0.05", "0.05+"],
] as const;

/**
 * The creator's tip alerts: a page to add to OBS as a Browser source, so tips pop up on their broadcast. The options
 * (sound, messages, a minimum) are written into the link, and the preview shows what an alert looks like.
 */
function AlertsLink({ token }: { token: string }) {
  const { deployment } = useChimi();
  const ethUsd = useEthUsd();
  const [sound, setSound] = useState(true);
  const [messages, setMessages] = useState(true);
  const [min, setMin] = useState<(typeof MIN_OPTIONS)[number][0]>("");
  const [copied, setCopied] = useState(false);
  if (!deployment?.tips) return null;
  const base = `${typeof window === "undefined" ? "https://www.chimi.club" : window.location.origin}/alerts/${token.toLowerCase()}`;
  const params = new URLSearchParams();
  if (!sound) params.set("sound", "0");
  if (!messages) params.set("messages", "0");
  if (min) params.set("min", min);
  const url = params.size ? `${base}?${params}` : base;
  const test = new URLSearchParams(params);
  test.set("test", "1");
  const copy = () => {
    void navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1_600);
    });
  };
  return (
    <section className="alerts-box" aria-label="Tip alerts on your stream">
      <p className="text-[14px] font-semibold">Tip alerts on your stream</p>
      <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">Add the link to OBS as a Browser source, 800 × 400. Every tip pops up on your broadcast, like this:</p>
      <div className="alerts-preview">
        <TipAlertCard preview usd={ethUsd ? money(0.01 * ethUsd) : undefined} alert={{ key: "preview", name: "chimi fan", amount: "0.01", eth: 0.01, message: messages ? "화이팅!" : "", big: false }} />
      </div>
      <div className="alerts-options">
        <Switch label="Sound" on={sound} onChange={setSound} />
        <Switch label="Messages" on={messages} onChange={setMessages} />
        <Seg label="Smallest tip shown" value={min} onChange={setMin} options={MIN_OPTIONS} className="ml-auto" />
      </div>
      <div className="mt-3 flex items-center gap-1.5">
        <code className="num min-w-0 flex-1 truncate rounded-lg bg-raise px-2.5 py-2 text-[12px] text-muted">{url}</code>
        <button type="button" onClick={copy} className="btn btn-sm btn-secondary shrink-0" aria-live="polite">
          {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
          {copied ? "Copied" : "Copy"}
        </button>
        <a href={`${base}?${test}`} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-ghost shrink-0">
          Test
          <IconExternal size={13} />
        </a>
      </div>
    </section>
  );
}
