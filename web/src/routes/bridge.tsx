import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { L1, noteBridge, useBridgeBalances, useBridgeHistory, useDepositGas } from "@/lib/chimi/bridge";
import { PRESETS, STAGE_LABEL, bridgeProblem, ethOf, maxBridge, parseAmount, stageOf, type BridgeItem } from "@/lib/chimi/bridge-rules";
import { giwaChain } from "@/lib/chimi/chain";
import { ago, compactUsd } from "@/lib/chimi/format";
import { useEthUsd } from "@/lib/chimi/live";
import { short } from "@/lib/chimi/market";
import { NETWORK } from "@/lib/chimi/network";
import { IconArrowDown, IconCheck, IconExternal } from "@/components/chimi/icons";
import { useChimi } from "@/components/chimi/provider";
import { toast } from "@/components/chimi/toast";
import { EthLogo } from "@/components/chimi/token-logo";
import { Note, PageHead } from "@/components/chimi/ui";
import { useNow } from "@/components/chimi/rewards-bits";

/*
 * Bridge: ETH from Ethereum to the same address on GIWA, in one transaction through GIWA's own bridge (the
 * L1StandardBridge in GIWA's contract list). Chimi adds no fee and holds nothing; the page only builds the deposit and
 * follows it until GIWA has paid it out. The way back takes about 7 days on any native bridge, so it points to GIWA's.
 * On a network without `l1` in network-rules.ts the page says bridging isn't set up there.
 */

export const Route = createFileRoute("/bridge")({
  head: () => ({ meta: [{ title: "Bridge · Chimi" }, { name: "description", content: "Move ETH from Ethereum to GIWA in one transaction, through GIWA's own bridge." }] }),
  component: BridgePage,
});

const GIWA_NAME = NETWORK.name;

function BridgePage() {
  if (!L1) {
    return (
      <main className="page pt-4 pb-16">
        <PageHead eyebrow="ETH to GIWA" title="Bridge">
          Bridging isn’t set up on this network yet.
        </PageHead>
      </main>
    );
  }
  return <Bridge />;
}

function Bridge() {
  const l1 = L1!;
  const { account, connect, bridgeToGiwa } = useChimi();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"" | "wallet">("");
  const [note, setNote] = useState<{ kind: "" | "bad" | "good"; text: string }>({ kind: "", text: "" });
  const balances = useBridgeBalances(account);
  const gas = useDepositGas();
  const ethUsd = useEthUsd();
  const history = useBridgeHistory(account);
  const nowMs = useNow(15_000);
  const now = Math.floor((nowMs ?? Date.now()) / 1000);

  const amount = parseAmount(text);
  const problem = account ? bridgeProblem({ text, balance: balances.l1, gas: gas ?? 0n, l1Name: l1.name }) : null;
  const usd = (wei: bigint) => (ethUsd && !NETWORK.testnet ? ` (${compactUsd((Number(wei) / 1e18) * ethUsd)})` : "");

  async function send() {
    setNote({ kind: "", text: "" });
    if (!account) {
      try {
        await connect();
      } catch (err) {
        setNote({ kind: "bad", text: short(err) });
      }
      return;
    }
    if (problem || amount === null) return;
    setBusy("wallet");
    try {
      const hash = await bridgeToGiwa(amount);
      noteBridge({ l1Hash: hash, from: account.toLowerCase(), amount: amount.toString(), time: Math.floor(Date.now() / 1000) });
      toast({ kind: "good", title: `Bridging ${ethOf(amount)} ETH to GIWA`, body: "It usually lands in a few minutes.", href: `${l1.explorer.url}/tx/${hash}` });
      setNote({ kind: "good", text: "Sent. Follow it under Your bridges." });
      setText("");
      balances.refresh();
    } catch (err) {
      const said = short(err);
      setNote({ kind: "bad", text: /reject|denied|cancel/i.test(said) ? "You cancelled the bridge." : said });
    } finally {
      setBusy("");
    }
  }

  const max = balances.l1 !== undefined && gas !== undefined ? maxBridge(balances.l1, gas) : undefined;
  const label = !account ? "Connect wallet" : busy ? "Confirm in your wallet" : (problem ?? `Bridge ${ethOf(amount ?? 0n)} ETH to GIWA`);

  return (
    <main className="page pt-4 pb-16">
      <PageHead eyebrow={`ETH to GIWA${NETWORK.testnet ? " · testnet" : ""}`} title="Bridge">
        Move ETH from {l1.name} to {GIWA_NAME} in one transaction, to the same address. It goes through GIWA’s own bridge: Chimi adds no fee and never holds
        your ETH.
      </PageHead>

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <section className="card relative p-2.5" aria-label="Bridge ETH to GIWA">
          <div className="flex items-center justify-between gap-3 px-2.5 pt-1.5 pb-3">
            <h2 className="text-[17px] font-semibold">Bridge</h2>
            <span className="bridge-live">
              <span className="live-dot" />
              Live{NETWORK.testnet ? " on testnet" : ""}
            </span>
          </div>

          <div className="relative flex flex-col gap-1">
            <div className={`rounded-xl border bg-bg px-4 py-4 transition-colors sm:px-5 ${problem?.startsWith("Not enough") ? "border-down/60" : "border-transparent focus-within:border-edge"}`}>
              <div className="flex items-center justify-between gap-3 text-[13px] text-muted">
                <span>From</span>
                {account && balances.l1 !== undefined ? (
                  <button type="button" disabled={!max} onClick={() => max && setText(ethOf(max, 6).replace(/,/g, ""))} className="num hover:text-fg disabled:hover:text-muted">
                    Balance {ethOf(balances.l1, 4)} ETH{max ? <> · <span className="font-semibold text-gold">Max</span></> : null}
                  </button>
                ) : null}
              </div>
              <div className="mt-2 flex items-center gap-3">
                <input
                  inputMode="decimal"
                  value={text}
                  placeholder="0"
                  aria-label={`ETH to bridge from ${l1.name}`}
                  autoComplete="off"
                  onChange={(e) => setText(e.target.value.replace(",", "."))}
                  className="num w-0 min-w-0 flex-1 bg-transparent text-[36px] leading-[1.1] font-medium tracking-[-0.03em] outline-none placeholder:text-faint"
                />
                <ChainChip chain="l1" name={l1.name} />
              </div>
              <div className="mt-3 grid grid-cols-4 gap-1.5">
                {PRESETS.map((p) => (
                  <button key={p} type="button" aria-pressed={text === p} onClick={() => setText(p)} className={`num h-8 rounded-lg border text-[13px] font-medium transition-colors ${text === p ? "border-fg bg-fg text-bg" : "border-line text-muted hover:border-edge hover:text-fg"}`}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <span aria-hidden className="absolute top-[57%] left-1/2 z-10 grid size-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-xl border-[3px] border-chip bg-raise2 text-fg">
              <IconArrowDown size={16} />
            </span>
            <div className="rounded-xl bg-bg/60 px-4 py-4 sm:px-5">
              <div className="flex items-center justify-between gap-3 text-[13px] text-muted">
                <span>To your address on</span>
                {account && balances.l2 !== undefined ? <span className="num">Balance {ethOf(balances.l2, 4)} ETH</span> : null}
              </div>
              <div className="mt-2 flex items-center gap-3">
                <span className={`num min-w-0 flex-1 truncate text-[36px] leading-[1.1] font-medium tracking-[-0.03em] ${amount ? "" : "text-faint"}`}>{amount ? ethOf(amount) : "0"}</span>
                <ChainChip chain="l2" name={GIWA_NAME} />
              </div>
            </div>
          </div>

          <dl className="space-y-2.5 px-3 pt-4 pb-3 text-[13px]">
            <Row label="Route" value={`${l1.name} → ${GIWA_NAME}`} />
            <Row label="You receive" value={amount ? `${ethOf(amount)} ETH${usd(amount)}` : "—"} />
            <Row label="Chimi fee" value="None" />
            <Row label="Gas on Ethereum" value={gas === undefined ? "…" : gas < 10n ** 12n ? "< 0.000001 ETH" : `≈ ${ethOf(gas, 6)} ETH`} />
            <Row label="Arrives" value="Usually within a few minutes" />
          </dl>

          <button type="button" disabled={!!busy || (!!account && !!problem)} onClick={() => void send()} className="btn btn-xl btn-primary w-full">
            {busy ? <span className="spinner" aria-hidden /> : null}
            {label}
          </button>
          <Note kind={note.kind} className="mt-2.5 mb-1 text-center">
            {note.text}
          </Note>
        </section>

        <div className="grid gap-5">
          <section className="card p-5" aria-label="Routes">
            <h2 className="text-[15px] font-semibold">Routes</h2>
            <ul className="mt-3 divide-y divide-line/70 text-[13px]">
              <li className="flex items-start justify-between gap-3 pb-3">
                <span>
                  <span className="block font-medium text-fg">
                    {l1.name} → {GIWA_NAME}
                  </span>
                  <span className="block text-muted">GIWA’s native bridge. A few minutes.</span>
                </span>
                <span className="bridge-state bridge-state-on">Live</span>
              </li>
              <li className="flex items-start justify-between gap-3 py-3">
                <span>
                  <span className="block font-medium text-fg">
                    {GIWA_NAME} → {l1.name}
                  </span>
                  <span className="block text-muted">
                    About 7 days on any native bridge.{" "}
                    <a href={l1.officialBridgeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-gold hover:underline">
                      Use GIWA’s bridge
                      <IconExternal size={11} />
                    </a>
                  </span>
                </span>
                <span className="bridge-state">GIWA app</span>
              </li>
              <li className="pt-3 text-muted">From Base, Arbitrum or Optimism: move the ETH to {l1.name} first, then bridge it here.</li>
            </ul>
            <a href={`${l1.explorer.url}/address/${l1.standardBridge}`} target="_blank" rel="noopener noreferrer" className="num mt-4 inline-flex items-center gap-1 text-xs text-faint hover:text-fg">
              GIWA bridge contract {l1.standardBridge.slice(0, 6)}…{l1.standardBridge.slice(-4)}
              <IconExternal size={11} />
            </a>
          </section>

          <section className="card p-5" aria-label="Your bridges">
            <h2 className="text-[15px] font-semibold">Your bridges</h2>
            {!account ? (
              <p className="mt-2 text-[13px] text-muted">Connect a wallet to see its bridges.</p>
            ) : history.items.length === 0 ? (
              history.ready ? (
                <p className="mt-2 text-[13px] text-muted">No bridges from this wallet in the last day.</p>
              ) : (
                <div className="mt-3 space-y-2.5" aria-hidden>
                  <span className="skeleton block h-4 w-2/3" />
                  <span className="skeleton block h-4 w-1/2" />
                </div>
              )
            ) : (
              <ul className="mt-2 divide-y divide-line/70">
                {history.items.map((item) => (
                  <HistoryRow key={item.l1Hash} item={item} now={now} l1Explorer={l1.explorer.url} />
                ))}
              </ul>
            )}
          </section>

          {NETWORK.testnet ? (
            <p className="px-1 text-[13px] leading-relaxed text-muted">
              Need test ETH? GIWA lists faucets for {l1.name} and {GIWA_NAME} in{" "}
              <a href="https://docs.giwa.io/get-started/faucets" target="_blank" rel="noopener noreferrer" className="font-medium text-gold hover:underline">
                its docs
              </a>
              . Once it’s on GIWA, <Link to="/" className="font-medium text-fg hover:text-gold">pick a coin on the board</Link>.
            </p>
          ) : null}
        </div>
      </div>
    </main>
  );
}

function HistoryRow({ item, now, l1Explorer }: { item: BridgeItem; now: number; l1Explorer: string }) {
  const stage = stageOf(item);
  return (
    <li className="flex items-center gap-3 py-3">
      <span className={`bridge-dot bridge-dot-${stage}`} aria-hidden>
        {stage === "arrived" ? <IconCheck size={11} /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="num block text-[14px] font-semibold">{ethOf(BigInt(item.amount))} ETH</span>
        <span className="block text-[12px] text-muted">
          {STAGE_LABEL[stage]} · {ago(Math.max(0, now - item.time))} ago
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5 text-[12px]">
        <a href={`${l1Explorer}/tx/${item.l1Hash}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-muted hover:text-fg">
          Ethereum <IconExternal size={10} />
        </a>
        {item.arrived && item.l2Hash ? (
          <a href={`${giwaChain.blockExplorers.default.url}/tx/${item.l2Hash}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-muted hover:text-fg">
            GIWA <IconExternal size={10} />
          </a>
        ) : null}
      </span>
    </li>
  );
}

function ChainChip({ chain, name }: { chain: "l1" | "l2"; name: string }) {
  return (
    <span className="flex shrink-0 items-center gap-2 rounded-full bg-raise2 py-1.5 pr-3 pl-1.5 text-[14px] font-semibold">
      {chain === "l1" ? (
        <EthLogo size={26} />
      ) : (
        <span aria-hidden className="grid size-[26px] place-items-center rounded-full bg-[#0d2a4d] text-[12px] font-bold text-[#7cc4ff] shadow-[inset_0_0_0_1px_rgba(255,255,255,.12)]">
          G
        </span>
      )}
      <span className="max-w-[9rem] truncate">{name}</span>
    </span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="num text-right">{value}</dd>
    </div>
  );
}
