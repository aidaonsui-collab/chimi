import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { isAddress, type Address } from "viem";
import bundledDeployment from "../../public/deployments.json";
import { useChimi } from "@/components/chimi/provider";
import { BIG_TIP_ETH, TipAlertCard, alertStayMs, type TipAlert } from "@/components/chimi/tip-alert";
import type { Deployment } from "@/lib/chimi/chain";
import { publicClient } from "@/lib/chimi/client";
import { money } from "@/lib/chimi/format";
import { readProfiles } from "@/lib/chimi/identity";
import { useEthUsd } from "@/lib/chimi/live";
import { shortWallet } from "@/lib/chimi/rewards";
import { ethAmount, shownMessage, tipAmount } from "@/lib/chimi/tip-rules";
import { watchTips } from "@/lib/chimi/tips";

/*
 * Tip alerts for a creator's broadcast: a transparent page they add to OBS as a Browser source. Each new tip to the
 * coin pops up with the tipper's name, the amount (and its dollar value) and the message, with a chime; a tip of
 * BIG_TIP_ETH or more gets the big alert. It reads the chain from the browser, so it costs the site nothing while
 * it runs.
 *
 * Options in the link: ?test=1 shows a sample of each alert; ?sound=0 mutes; ?messages=0 hides messages; ?min=0.01
 * only shows tips of at least that much ETH. Defaults stay out of the link.
 */

type Search = { test?: true; sound?: false; messages?: false; min?: string };

const on = (v: unknown) => v === 1 || v === "1" || v === true || v === "true";
const off = (v: unknown) => v === 0 || v === "0" || v === false || v === "false";

export const Route = createFileRoute("/alerts/$address")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    test: on(search.test) ? true : undefined,
    sound: off(search.sound) ? false : undefined,
    messages: off(search.messages) ? false : undefined,
    min: (typeof search.min === "string" || typeof search.min === "number") && Number(search.min) > 0 ? String(search.min) : undefined,
  }),
  head: () => ({ meta: [{ title: "Chimi tip alerts" }, { name: "robots", content: "noindex" }] }),
  component: Alerts,
});

/** Soft rising notes made in the page, so there's no sound file to load; a big tip gets a third. */
function chime(big: boolean) {
  try {
    const ctx = new AudioContext();
    const t = ctx.currentTime;
    (big ? [784, 1046.5, 1568] : [880, 1318.5]).forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const at = t + i * 0.13;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.2, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.8);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.85);
    });
    setTimeout(() => void ctx.close(), 2_000);
  } catch {
    // No sound in this browser; the alert still shows.
  }
}

const SAMPLES: Omit<TipAlert, "key">[] = [
  { name: "chimi fan", amount: "0.01", eth: 0.01, message: "화이팅! This is a test alert.", big: false },
  { name: "whale.up", amount: "0.1", eth: 0.1, message: "A big tip looks like this.", big: true },
];

function Alerts() {
  const { address } = Route.useParams();
  const search = Route.useSearch();
  const deployment = (useChimi().deployment ?? bundledDeployment) as Deployment;
  const contract = deployment.tips?.address;
  const ethUsd = useEthUsd();
  const tested = useRef(false);
  const sound = search.sound !== false;
  const messages = search.messages !== false;
  const [queue, setQueue] = useState<TipAlert[]>([]);
  const [showing, setShowing] = useState<TipAlert | null>(null);
  const [leaving, setLeaving] = useState(false);

  // New tips join the queue, with the tipper's up.id name where they have one.
  useEffect(() => {
    if (!contract || !isAddress(address)) return;
    const min = search.min ? tipAmount(search.min) : undefined;
    const minWei = min && "wei" in min ? min.wei : 0n;
    return watchTips(contract, address as Address, (tips) => {
      const shown = tips.filter((t) => t.amount >= minWei);
      if (shown.length === 0) return;
      void readProfiles(publicClient, [...new Set(shown.map((t) => t.from))])
        .catch(() => ({}) as Record<string, { name: string | null }>)
        .then((profiles) =>
          setQueue((q) => [
            ...q,
            ...shown.map((t) => {
              const eth = Number(t.amount) / 1e18;
              return {
                key: t.key,
                name: profiles[t.from]?.name?.replace(/\.up\.id$/, "") ?? shortWallet(t.from),
                amount: ethAmount(t.amount),
                eth,
                message: messages ? shownMessage(t.message, 140) : "",
                big: eth >= BIG_TIP_ETH,
              };
            }),
          ]),
        );
    });
  }, [contract, address, search.min, messages]);

  // The test link shows one of each alert, so a streamer can place the source in OBS and hear both.
  useEffect(() => {
    if (!search.test || tested.current) return;
    tested.current = true;
    const t = Date.now();
    setQueue((q) => [...q, ...SAMPLES.map((s, i) => ({ ...s, key: `test-${t}-${i}`, message: messages ? s.message : "" }))]);
  }, [search.test, messages]);

  // One alert at a time: the next waits until this one has gone.
  useEffect(() => {
    if (showing || queue.length === 0) return;
    setShowing(queue[0]!);
    setQueue((q) => q.slice(1));
  }, [queue, showing]);

  useEffect(() => {
    if (!showing) return;
    setLeaving(false);
    if (sound) chime(showing.big);
    const stay = alertStayMs(showing);
    const out = setTimeout(() => setLeaving(true), stay);
    const gone = setTimeout(() => setShowing(null), stay + 500);
    return () => {
      clearTimeout(out);
      clearTimeout(gone);
    };
  }, [showing, sound]);

  return (
    <main className="alerts-stage">
      <style>{"html,body{background:transparent!important}"}</style>
      {showing ? (
        <TipAlertCard
          key={showing.key}
          alert={showing}
          usd={ethUsd ? money(showing.eth * ethUsd) : undefined}
          leaving={leaving}
          stay={alertStayMs(showing)}
          more={queue.length}
        />
      ) : search.test && !contract ? (
        <p className="alert-note">Tips aren&rsquo;t switched on yet, so only the test alerts show.</p>
      ) : null}
    </main>
  );
}
