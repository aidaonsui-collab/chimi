import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { lockTokens, unlockedAt } from "@/lib/chimi/creator-lock-rules";
import { useAllLocks } from "@/lib/chimi/creator-lock";
import { useTokenImages } from "@/lib/chimi/token-image";
import { LockRow } from "@/components/chimi/creator-lock";
import { IconLock, IconPlus } from "@/components/chimi/icons";
import { useChimi } from "@/components/chimi/provider";
import { TokenLogo } from "@/components/chimi/token-logo";
import { Empty, PageHead, Seg } from "@/components/chimi/ui";

/*
 * Every creator first-buy lock, newest first. Creators lock their first buy at launch in the public ChimiCreatorLock;
 * this page reads it straight from the chain. Each lock links to its coin, and its creator sees Claim here too.
 */

export const Route = createFileRoute("/locks")({
  head: () => ({ meta: [{ title: "Creator locks · Chimi" }, { name: "description", content: "Every creator first buy locked at launch on Chimi, with its schedule." }] }),
  component: LocksPage,
});

function LocksPage() {
  const { coins } = useChimi();
  const { locks, refresh, available } = useAllLocks();
  const [show, setShow] = useState<"locked" | "all">("locked");
  const now = Math.floor(Date.now() / 1000);
  const byToken = useMemo(() => new Map(coins.map((c) => [c.token.toLowerCase(), c])), [coins]);
  const images = useTokenImages(useMemo(() => [...new Set((locks ?? []).map((l) => l.token))], [locks]));
  const list = useMemo(() => {
    const all = [...(locks ?? [])].reverse();
    return show === "locked" ? all.filter((l) => unlockedAt(l, now) < l.amount) : all;
    // `now` moves every render; the filter only needs it at render time.
  }, [locks, show]); // eslint-disable-line react-hooks/exhaustive-deps
  const stillLocked = (locks ?? []).filter((l) => unlockedAt(l, now) < l.amount).length;

  return (
    <main className="page pt-4 pb-16">
      <PageHead eyebrow="Creator locks" title="Locks">
        Creators can lock their first buy when they launch. It goes straight into a public lock: nothing unlocks before the cliff, then it releases evenly. Nobody can
        release it early, the creator included.
      </PageHead>

      {!available ? (
        <p className="mt-6 rounded-xl border border-gold/25 bg-gold/8 px-4 py-3 text-sm">Creator locks aren’t switched on on this deployment yet.</p>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <Seg
              label="Show"
              value={show}
              onChange={setShow}
              options={[
                ["locked", `Still locked${locks ? ` · ${stillLocked}` : ""}`],
                ["all", `All${locks ? ` · ${locks.length}` : ""}`],
              ]}
            />
            <Link to="/launch" className="btn btn-sm btn-light">
              <IconPlus size={15} />
              Launch with a lock
            </Link>
          </div>

          {locks === null ? (
            <div className="mt-5 grid gap-4 md:grid-cols-2" aria-hidden>
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="card h-44 p-5">
                  <span className="skeleton block h-4 w-1/3" />
                  <span className="skeleton mt-4 block h-6 w-1/2" />
                  <span className="skeleton mt-3 block h-3 w-3/4" />
                </div>
              ))}
            </div>
          ) : list.length === 0 ? (
            <div className="card mt-5">
              <Empty
                mark="잠금"
                title={show === "locked" && locks.length > 0 ? "Every lock has opened" : "No locks yet"}
                action={
                  <Link to="/launch" className="btn btn-primary">
                    <IconLock size={15} />
                    Launch and lock your first buy
                  </Link>
                }
              >
                A creator who locks their first buy shows up here, with the date it opens.
              </Empty>
            </div>
          ) : (
            <ul className="mt-5 grid gap-4 md:grid-cols-2">
              {list.map((l) => {
                const coin = byToken.get(l.token);
                return (
                  <li key={l.id.toString()} className="card flex gap-4 p-5">
                    <Link to="/coin/$address" params={{ address: l.token }} className="shrink-0" aria-label={coin?.name ?? l.token}>
                      <TokenLogo symbol={coin?.symbol ?? "?"} image={images[l.token]} size={44} />
                    </Link>
                    <div className="min-w-0 flex-1">
                      <LockRow lock={l} symbol={coin?.symbol ?? "tokens"} onClaimed={refresh} coin={{ name: coin?.name ?? `${l.token.slice(0, 8)}…` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {locks && locks.length > 0 ? (
            <p className="num mt-4 text-xs text-faint">
              {lockTokens(locks.reduce((sum, l) => sum + (l.amount - unlockedAt(l, now)), 0n))} tokens still locked across {stillLocked} {stillLocked === 1 ? "coin" : "coins"}.
            </p>
          ) : null}
        </>
      )}
    </main>
  );
}
