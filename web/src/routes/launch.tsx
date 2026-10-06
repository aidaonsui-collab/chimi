import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { formatEther, parseEther } from "viem";
import { factoryAbi } from "@/lib/chimi/chain";
import { publicClient } from "@/lib/chimi/client";
import { fmt, short } from "@/lib/chimi/market";
import { saveTokenMeta, shrinkImage } from "@/lib/chimi/meta";
import { publishTokenProfile, refreshTokenProfiles } from "@/lib/chimi/token-image";
import { useChimi } from "@/components/chimi/provider";
import { TokenLogo } from "@/components/chimi/token-logo";

export const Route = createFileRoute("/launch")({ component: LaunchPage });

const field = "mt-1 w-full rounded-xl border border-line bg-bg px-3 py-2.5 outline-none";
const VIRTUAL_TOKEN = 1_066_666_666_666_666_666_666_666_666n;
const SUPPLY = 1_000_000_000n * 10n ** 18n;

function tokensOut(ethIn: bigint, virtualQuote: bigint): bigint {
  if (ethIn === 0n || virtualQuote === 0n) return 0n;
  return (ethIn * 99n * VIRTUAL_TOKEN) / (100n * virtualQuote);
}

function compactTokens(raw: bigint): string {
  const whole = Number(raw / 10n ** 18n);
  if (!Number.isFinite(whole)) return "0";
  return whole.toLocaleString("en-US", { maximumFractionDigits: whole >= 1000 ? 0 : 2 });
}

function LaunchPage() {
  const { account, connect, deployment, live, createCoin, signMessage } = useChimi();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState<string>();
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  const [website, setWebsite] = useState("");
  const [devBuy, setDevBuy] = useState("0");
  const [balance, setBalance] = useState<bigint>();
  const [fee, setFee] = useState<bigint>();
  const [virtualQuote, setVirtualQuote] = useState<bigint>();
  const [ethUsd, setEthUsd] = useState<number>();
  const [advanced, setAdvanced] = useState(false);
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<"" | "bad" | "good">("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!account) {
      setBalance(undefined);
      return;
    }
    let cancel = false;
    void publicClient.getBalance({ address: account }).then((wei) => {
      if (!cancel) setBalance(wei);
    });
    return () => {
      cancel = true;
    };
  }, [account]);

  useEffect(() => {
    if (!deployment || !live || !account) {
      setFee(undefined);
      return;
    }
    let cancel = false;
    void publicClient
      .readContract({
        address: deployment.factory,
        abi: factoryAbi,
        functionName: "creationFeeDue",
        args: [account],
      })
      .then((due) => {
        if (!cancel) setFee(due);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [account, deployment, live]);

  useEffect(() => {
    if (!deployment || !live) return;
    let cancel = false;
    void publicClient
      .readContract({ address: deployment.factory, abi: factoryAbi, functionName: "launchVirtualQuote" })
      .then((q) => {
        if (!cancel) setVirtualQuote(q);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [deployment, live]);

  useEffect(() => {
    let cancel = false;
    void fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot")
      .then((r) => r.json())
      .then((body: { data?: { amount?: string } }) => {
        const n = Number(body.data?.amount);
        if (!cancel && Number.isFinite(n) && n > 0) setEthUsd(n);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, []);

  async function onImage(file: File | undefined) {
    if (!file) return;
    try {
      setImage(await shrinkImage(file));
    } catch (err) {
      setKind("bad");
      setNote(short(err));
    }
  }

  async function submit() {
    if (!name.trim() || !symbol.trim()) {
      setKind("bad");
      setNote("Name and symbol are required.");
      return;
    }
    if (!account) {
      try {
        await connect();
      } catch (err) {
        setKind("bad");
        setNote(short(err));
      }
      return;
    }
    try {
      setBusy(true);
      setKind("");
      setNote("Confirm the launch in your wallet.");
      const token = await createCoin(name.trim(), symbol.trim(), devBuy.trim() || "0");
      const profile = {
        description: description.trim(),
        image,
        twitter: twitter.trim(),
        telegram: telegram.trim(),
        website: website.trim(),
      };
      saveTokenMeta(token, profile);
      refreshTokenProfiles();
      if (image || profile.description || profile.twitter || profile.telegram || profile.website) {
        // Share the picture with every visitor, not just this browser. A failure here never
        // blocks the launch; the creator can publish later from the coin page.
        setKind("");
        setNote(`${symbol.trim()} is in its pool. Sign once (no gas) to share its picture with everyone.`);
        try {
          await publishTokenProfile(token, profile, signMessage);
        } catch {
          /* kept locally; coin page offers "Set picture" to retry */
        }
      }
      setKind("good");
      setNote(`${symbol.trim()} is in its pool.`);
      await navigate({ to: "/coin/$address", params: { address: token } });
    } catch (err) {
      setKind("bad");
      setNote(short(err));
    } finally {
      setBusy(false);
    }
  }

  const due = fee ?? 0n;
  let buy = 0n;
  let buyOk = true;
  try {
    buy = parseEther(devBuy.trim() || "0");
  } catch {
    buy = 0n;
    buyOk = devBuy.trim() === "";
  }
  const total = due + buy;
  const mark = symbol.trim() || "TICKER";
  const quote = virtualQuote ?? 0n;
  const received = buyOk ? tokensOut(buy, quote) : 0n;
  const shareBps = received === 0n || SUPPLY === 0n ? 0 : Number((received * 10_000n) / SUPPLY) / 100;
  const fdvEth = quote === 0n ? 0 : Number((quote * SUPPLY) / VIRTUAL_TOKEN) / 1e18;
  const fdvUsd = ethUsd && fdvEth ? fdvEth * ethUsd : undefined;

  return (
    <main className="mx-auto grid max-w-5xl items-start gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[1fr_300px] lg:py-12">
      <section className="rounded-3xl border border-line bg-chip">
        <header className="border-b border-line px-5 py-5">
          <p className="text-xs font-semibold tracking-[0.22em] text-gold">GIWA SEPOLIA</p>
          <h1 className="mt-1 font-display text-4xl leading-none sm:text-5xl">Launch token</h1>
        </header>
        <div className="grid gap-4 px-5 py-5">
          <label className="block text-sm text-muted">
            Name
            <input value={name} maxLength={32} onChange={(e) => setName(e.target.value)} placeholder="Ridge Coin" className={field} />
          </label>
          <label className="block text-sm text-muted">
            Symbol
            <input
              value={symbol}
              maxLength={8}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="RIDGE"
              className={`${field} tracking-[0.14em]`}
            />
          </label>
          <label className="block text-sm text-muted">
            Description
            <textarea
              value={description}
              maxLength={280}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A short description of the token"
              rows={3}
              className={field}
            />
          </label>
          <div>
            <p className="text-sm text-muted">Token image</p>
            <label className="mt-1 flex cursor-pointer items-center gap-4 rounded-xl border border-dashed border-line bg-bg px-3 py-3">
              {image ? (
                <img src={image} alt="" className="size-16 rounded-full object-cover" />
              ) : (
                <span className="grid size-16 place-items-center rounded-full border border-line text-xs text-muted">IMG</span>
              )}
              <span className="text-sm">Choose image</span>
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => void onImage(e.target.files?.[0])}
              />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-sm text-muted">
              X
              <span className="mt-1 flex items-center rounded-xl border border-line bg-bg px-3">
                <span className="text-xs text-muted">x.com/</span>
                <input value={twitter} onChange={(e) => setTwitter(e.target.value.replace(/^@/, ""))} className="w-full bg-transparent py-2.5 pl-1 outline-none" />
              </span>
            </label>
            <label className="block text-sm text-muted">
              Telegram
              <span className="mt-1 flex items-center rounded-xl border border-line bg-bg px-3">
                <span className="text-xs text-muted">t.me/</span>
                <input value={telegram} onChange={(e) => setTelegram(e.target.value)} className="w-full bg-transparent py-2.5 pl-1 outline-none" />
              </span>
            </label>
            <label className="block text-sm text-muted">
              Website
              <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" className={field} />
            </label>
          </div>

          <div className="rounded-2xl border border-line bg-bg px-4 py-3">
            <p className="text-xs tracking-[0.16em] text-muted uppercase">Paired asset</p>
            <p className="mt-1 font-display text-2xl">ETH</p>
            <p className="mt-1 text-sm text-muted">
              The full supply opens in a locked pool. No bonding curve. The pool fee is 1%, and the position stays locked for 100 years.
            </p>
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <p className="text-sm text-muted">Developer buy</p>
              <p className="text-xs text-muted">
                {balance === undefined ? "Balance unavailable" : `${fmt(balance, 4)} ETH`}
              </p>
            </div>
            <div className="mt-1 flex items-center gap-2 rounded-xl border border-line bg-bg px-3">
              <input
                inputMode="decimal"
                value={devBuy}
                onChange={(e) => setDevBuy(e.target.value)}
                className="w-full bg-transparent py-3 text-lg outline-none"
              />
              <span className="text-sm">ETH</span>
              <button
                type="button"
                disabled={balance === undefined}
                onClick={() => balance !== undefined && setDevBuy(formatEther(balance > due ? balance - due : 0n))}
                className="rounded-full border border-line px-2 py-1 text-xs text-muted"
              >
                Max
              </button>
            </div>
            <p className="mt-2 text-sm tabular-nums">
              {buyOk && buy > 0n && quote > 0n
                ? `≈ ${compactTokens(received)} ${mark} · ${shareBps.toFixed(2)}% of supply`
                : "Enter ETH to see the token estimate"}
            </p>
            <p className="text-xs text-muted">
              {fdvUsd
                ? `Opens at about $${Math.round(fdvUsd).toLocaleString("en-US")} market cap. Estimate is the spot price after the 1% pool fee.`
                : "Opens at a $3,000 market cap. Estimate is the spot price after the 1% pool fee."}
            </p>
          </div>

          <button type="button" onClick={() => setAdvanced((v) => !v)} className="text-left text-sm text-gold">
            {advanced ? "Hide advanced" : "Advanced"}
          </button>
          {advanced ? (
            <dl className="divide-y divide-line rounded-2xl border border-line">
              {[
                ["Supply", "1,000,000,000"],
                ["Quote", "Wrapped ETH"],
                ["Pool fee", "1%"],
                ["Lock", "100 years, then the beneficiary"],
                ["Creator share", "70% of the wrapped-ETH trading fees"],
                ["Token-side fees", "Burned"],
                ["Buy tax", "None"],
              ].map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-4 px-4 py-2.5 text-sm">
                  <dt className="text-muted">{label}</dt>
                  <dd className="text-right">{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <p className="text-xs text-muted">
            Name and symbol are written on-chain. After launch you sign once (no gas) to share the image, description, and links with everyone.
          </p>
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4">
          <p className="text-sm text-muted">
            ETH pair · {due === 0n ? "no creation fee" : `${fmt(due, 4)} ETH fee`} · {fmt(total, 4)} ETH due
          </p>
          <button
            type="button"
            disabled={!live || busy}
            onClick={() => void submit()}
            className="rounded-full bg-seal px-5 py-2.5 text-sm font-semibold text-onseal disabled:opacity-40"
          >
            {busy ? "Launching…" : account ? "Launch token" : "Connect wallet"}
          </button>
        </footer>
        {note ? (
          <p className={`px-5 pb-4 text-sm ${kind === "bad" ? "text-seal" : kind === "good" ? "text-ok" : "text-muted"}`}>
            {note}
          </p>
        ) : null}
      </section>

      <aside className="rounded-3xl border border-line bg-chip p-5 lg:sticky lg:top-24">
        <h2 className="font-display text-2xl">Your token</h2>
        <div className="mt-4 flex items-center gap-3">
          <TokenLogo symbol={mark} image={image} size={56} />
          <div>
            <p className="font-display text-xl leading-none">{name.trim() || "Untitled"}</p>
            <p className="mt-1 text-sm text-muted">${mark}</p>
          </div>
        </div>
        {description.trim() ? <p className="mt-4 text-sm text-muted">{description.trim()}</p> : null}
        <dl className="mt-4 divide-y divide-line text-sm">
          {[
            ["Pair", "ETH"],
            ["Supply", "1B"],
            ["Developer buy", buy > 0n && quote > 0n ? `${compactTokens(received)} ${mark}` : `${devBuy || "0"} ETH`],
            ["You pay", `${fmt(total, 4)} ETH`],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3 py-2">
              <dt className="text-muted">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </aside>
    </main>
  );
}
