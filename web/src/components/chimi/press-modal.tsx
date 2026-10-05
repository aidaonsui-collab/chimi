import { useEffect, useState } from "react";
import { factoryAbi, giwaSepolia } from "@/lib/chimi/chain";
import { publicClient } from "@/lib/chimi/client";
import { fmt, short } from "@/lib/chimi/market";
import { useChimi } from "@/components/chimi/provider";

export function PressModal({ onClose }: { onClose: () => void }) {
  const { account, deployment, live, createCoin } = useChimi();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [firstBuy, setFirstBuy] = useState("0");
  const [feeNote, setFeeNote] = useState(live ? "Connect to see the creation fee" : "Not deployed yet");
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<"" | "bad" | "good">("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!deployment || !live || !account) return;
    let cancel = false;
    void publicClient
      .readContract({
        address: deployment.factory,
        abi: factoryAbi,
        functionName: "creationFeeDue",
        args: [account],
      })
      .then((due) => {
        if (!cancel) setFeeNote(due === 0n ? "No creation fee" : `Creation fee ${fmt(due, 4)} ETH`);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [account, deployment, live]);

  async function submit() {
    if (!name.trim() || !symbol.trim()) {
      setKind("bad");
      setNote("Name and symbol are required.");
      return;
    }
    try {
      setBusy(true);
      setKind("");
      setNote("Confirm the launch in your wallet.");
      await createCoin(name.trim(), symbol.trim(), firstBuy);
      setKind("good");
      setNote(`${symbol.trim()} is in its pool.`);
      setName("");
      setSymbol("");
    } catch (err) {
      setKind("bad");
      setNote(short(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="presentation">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-[#1c140f]/45" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="press-title"
        className="relative m-3 w-full max-w-md rounded-3xl border border-line bg-chip p-6 shadow-2xl sm:m-0"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs tracking-[0.22em] text-seal uppercase">New coin</p>
            <h2 id="press-title" className="mt-1 font-display text-5xl leading-none">
              Launch
            </h2>
          </div>
          <img
            src="/brands/chimi-seal.jpg"
            alt=""
            className="size-16 -rotate-12 rounded-full border border-seal object-cover"
          />
        </div>
        <p className="mt-3 text-sm text-muted">
          One transaction. A billion tokens, a locked pool, quoted in wrapped ETH on {giwaSepolia.name}.
        </p>
        <label className="mt-5 block text-sm text-muted" htmlFor="press-name">
          Name
        </label>
        <input
          id="press-name"
          maxLength={32}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ridge Coin"
          className="mt-1 w-full rounded-xl border border-line bg-bg px-3 py-2.5"
        />
        <label className="mt-3 block text-sm text-muted" htmlFor="press-symbol">
          Symbol
        </label>
        <input
          id="press-symbol"
          maxLength={8}
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          placeholder="RIDGE"
          className="mt-1 w-full rounded-xl border border-line bg-bg px-3 py-2.5 tracking-[0.14em]"
        />
        <label className="mt-3 block text-sm text-muted" htmlFor="press-buy">
          First buy, ETH
        </label>
        <input
          id="press-buy"
          inputMode="decimal"
          value={firstBuy}
          onChange={(e) => setFirstBuy(e.target.value)}
          className="mt-1 w-full rounded-xl border border-line bg-bg px-3 py-2.5"
        />
        <div className="mt-5 flex items-center justify-between gap-3">
          <p className="text-sm text-muted">{feeNote}</p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-full px-3 py-2 text-sm text-muted">
              Close
            </button>
            <button
              type="button"
              disabled={!live || busy}
              onClick={() => void submit()}
              className="rounded-full bg-seal px-5 py-2 text-sm font-semibold text-onseal disabled:opacity-40"
            >
              {busy ? "Launching…" : "Launch"}
            </button>
          </div>
        </div>
        {note ? (
          <p className={`mt-3 text-sm ${kind === "bad" ? "text-seal" : kind === "good" ? "text-ok" : "text-muted"}`}>
            {note}
          </p>
        ) : null}
      </div>
    </div>
  );
}
