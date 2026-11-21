import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ago } from "@/lib/chimi/format";
import { shortAddr } from "@/lib/chimi/market";
import { useProfiles } from "@/lib/chimi/rewards";
import type { WaitlistRow } from "@/lib/chimi/waitlist-rules";
import { IconLock, IconReset, IconSearch } from "@/components/chimi/icons";
import { DojangMark } from "@/components/chimi/rewards-bits";
import { Blockie, Note, Seg } from "@/components/chimi/ui";

/*
 * Who has joined the mainnet waitlist, for the site's operator. Not linked from anywhere and not indexed. It asks for
 * the admin token (CHIMI_ADMIN_TOKEN) once and keeps it in this browser only; the list itself comes from
 * GET /api/waitlist?export=json with that token, so without it this page shows nothing. Newest first by default, a
 * page of rows at a time; whether each wallet on the page has a Dojang is read from the chain as the page shows it.
 */

export const Route = createFileRoute("/mainnet_/admin")({
  head: () => ({ meta: [{ title: "Waitlist admin · Chimi" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: WaitlistAdmin,
});

const TOKEN_KEY = "chimi.admin.token";
const PAGE = 50;
const DAY_MS = 86_400_000;

function savedToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

async function fetchList(token: string): Promise<WaitlistRow[]> {
  const res = await fetch("/api/waitlist?export=json", { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  if (res.status === 403) throw new Error("That token isn’t right.");
  if (res.status === 429) throw new Error("Too many tries. Wait a minute.");
  if (!res.ok) throw new Error("Couldn’t load the waitlist. Try again.");
  return ((await res.json()) as { entries: WaitlistRow[] }).entries;
}

function WaitlistAdmin() {
  const [token, setToken] = useState("");
  const [draft, setDraft] = useState("");
  const [rows, setRows] = useState<WaitlistRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<"newest" | "oldest">("newest");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);

  const load = useCallback(async (t: string) => {
    if (!t) return;
    setBusy(true);
    setError(null);
    try {
      setRows(await fetchList(t));
      setLoadedAt(Date.now());
      setToken(t);
      try {
        localStorage.setItem(TOKEN_KEY, t);
      } catch {
        /* private mode: asked again next time */
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (!rows) setToken("");
    } finally {
      setBusy(false);
    }
  }, [rows]);

  // A token saved in this browser opens the list straight away.
  useEffect(() => {
    const t = savedToken();
    if (t) void load(t);
    // Once, on opening.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const forget = () => {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* nothing saved */
    }
    setToken("");
    setDraft("");
    setRows(null);
  };

  const download = async () => {
    const res = await fetch("/api/waitlist?export=csv", { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!res.ok) return setError("Couldn’t download the list. Try again.");
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: `chimi-mainnet-waitlist-${new Date().toISOString().slice(0, 10)}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  };

  const shown = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    const list = q ? rows.filter((r) => r.wallet.includes(q)) : rows;
    return order === "newest" ? [...list].reverse() : list;
  }, [rows, order, query]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const at = Math.min(page, pages - 1);
  const slice = shown.slice(at * PAGE, at * PAGE + PAGE);
  const profiles = useProfiles(useMemo(() => slice.map((r) => r.wallet), [slice]));
  const now = loadedAt ?? 0;
  const lastDay = rows ? rows.filter((r) => now - r.at < DAY_MS).length : 0;

  if (!token || !rows) {
    return (
      <main className="page pt-10 pb-16">
        <form
          className="card mx-auto max-w-[440px] p-6"
          onSubmit={(e) => {
            e.preventDefault();
            void load(draft.trim());
          }}
        >
          <span className="grid size-11 place-items-center rounded-xl bg-raise2 text-gold">
            <IconLock size={20} />
          </span>
          <h1 className="mt-4 text-[22px] font-semibold tracking-[-0.02em]">Waitlist admin</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">Paste the admin token (CHIMI_ADMIN_TOKEN in Vercel). It stays in this browser only.</p>
          <label className="label mt-5" htmlFor="admin-token">
            Admin token
          </label>
          <input id="admin-token" type="password" autoComplete="off" value={draft} onChange={(e) => setDraft(e.target.value)} className="field" placeholder="••••••••" />
          <button type="submit" disabled={busy || !draft.trim()} className="btn btn-primary mt-4 w-full">
            {busy ? "Opening…" : "Show the waitlist"}
          </button>
          {error ? (
            <Note kind="bad" className="mt-3">
              {error}
            </Note>
          ) : null}
        </form>
      </main>
    );
  }

  return (
    <main className="page pt-6 pb-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Admin</p>
          <h1 className="mt-1 text-[28px] leading-tight font-semibold tracking-[-0.03em]">Mainnet waitlist</h1>
          <p className="mt-1 text-sm text-muted">
            <span className="num font-semibold text-fg">{rows.length.toLocaleString("en-US")}</span> joined ·{" "}
            <span className="num font-semibold text-fg">{lastDay.toLocaleString("en-US")}</span> in the last 24 hours
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void load(token)} disabled={busy} className="btn btn-sm btn-ghost">
            <IconReset size={14} />
            {busy ? "Refreshing…" : "Refresh"}
          </button>
          <button type="button" onClick={() => void download()} className="btn btn-sm btn-light">
            Download CSV
          </button>
          <button type="button" onClick={forget} className="btn btn-sm btn-ghost text-muted">
            Forget token
          </button>
        </div>
      </div>
      {error ? (
        <Note kind="bad" className="mt-3">
          {error}
        </Note>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <Seg
          label="Order"
          value={order}
          onChange={(v) => {
            setOrder(v);
            setPage(0);
          }}
          options={[
            ["newest", "Newest first"],
            ["oldest", "First in line"],
          ]}
        />
        <label className="relative w-full max-w-[320px]">
          <IconSearch size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder="Find a wallet (0x…)"
            className="field pl-9"
            aria-label="Find a wallet"
          />
        </label>
      </div>

      <div className="card mt-4 overflow-hidden">
        <div className="th grid grid-cols-[4.5rem_minmax(0,1fr)_5.5rem_9rem] gap-3 border-b border-line/70 px-4 py-3 max-sm:grid-cols-[3.5rem_minmax(0,1fr)_6.5rem] sm:px-5">
          <span>Place</span>
          <span>Wallet</span>
          <span className="max-sm:hidden">Dojang</span>
          <span className="text-right">Joined</span>
        </div>
        {slice.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">{rows.length === 0 ? "Nobody has joined yet." : "No wallet matches that."}</p>
        ) : (
          <ul>
            {slice.map((r) => {
              const p = profiles[r.wallet];
              return (
                <li key={r.wallet} className="grid grid-cols-[4.5rem_minmax(0,1fr)_5.5rem_9rem] items-center gap-3 border-b border-line/60 px-4 py-2.5 last:border-0 max-sm:grid-cols-[3.5rem_minmax(0,1fr)_6.5rem] sm:px-5">
                  <span className="num text-[14px] font-semibold">#{r.position.toLocaleString("en-US")}</span>
                  <Link to="/u/$address" params={{ address: r.wallet }} className="flex min-w-0 items-center gap-2.5 hover:text-gold">
                    <Blockie address={r.wallet} size={26} />
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-medium">{p?.name ?? shortAddr(r.wallet)}</span>
                      <span className="num block truncate text-[12px] text-faint">{r.wallet}</span>
                    </span>
                  </Link>
                  <span className="max-sm:hidden">{p ? p.verified ? <DojangMark verified /> : <span className="text-sm text-faint">No</span> : <span className="skeleton h-3.5 w-8" />}</span>
                  <span className="text-right">
                    <span className="num block text-[13px]">{new Date(r.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                    <span className="block text-[12px] text-faint">{ago(Math.max(0, Math.floor((now - r.at) / 1000)))} ago</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {pages > 1 ? (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <button type="button" disabled={at === 0} onClick={() => setPage(at - 1)} className="btn btn-sm btn-ghost">
            Previous
          </button>
          <span className="num text-muted">
            {at + 1} / {pages}
          </span>
          <button type="button" disabled={at >= pages - 1} onClick={() => setPage(at + 1)} className="btn btn-sm btn-ghost">
            Next
          </button>
        </div>
      ) : null}
    </main>
  );
}
