/*
 * A coin's page shows what was said and what was traded as one list, newest first. Comments are the point of the
 * list, so trades never crowd them: every stretch of trades between two comment threads is one line, opened on
 * request. This file only sorts and groups. It imports nothing, so the rules can be tested on their own.
 */

/** A pause this long between two trades starts a new line, so the list keeps the day's rhythm. */
export const RUN_GAP_S = 60 * 60;

/** One buy or sale. Times are unix seconds. */
export type ActivityTrade = { key: string; time: number; wallet: string; buy: boolean; eth: number; tokens: number; tx: string };

/** A stretch of trades with no comment thread in between. `trades` is newest first; `wallets` biggest spender first. */
export type TradeRun = { key: string; time: number; since: number; trades: ActivityTrade[]; wallets: string[]; buys: number; sells: number; eth: number };

export type Activity<T> = { kind: "thread"; time: number; thread: T } | ({ kind: "trades" } & TradeRun);

/**
 * Threads and trades as one list, newest first. `threads` carry the time (unix seconds) that places them: when the
 * thread was started. A thread and a trade in the same second read thread first.
 */
export function timelineOf<T>(threads: readonly { time: number; thread: T }[], trades: readonly ActivityTrade[], gapS = RUN_GAP_S): Activity<T>[] {
  type Mark = { time: number; thread?: T; trade?: ActivityTrade; order: number };
  const marks: Mark[] = [
    ...threads.map((t, i): Mark => ({ time: t.time, thread: t.thread, order: i })),
    ...trades.map((t, i): Mark => ({ time: t.time, trade: t, order: threads.length + i })),
  ];
  marks.sort((a, b) => b.time - a.time || Number(!!a.trade) - Number(!!b.trade) || a.order - b.order);

  const out: Activity<T>[] = [];
  let run: ActivityTrade[] = [];
  const close = () => {
    if (run.length === 0) return;
    const spent = new Map<string, number>();
    for (const t of run) spent.set(t.wallet.toLowerCase(), (spent.get(t.wallet.toLowerCase()) ?? 0) + t.eth);
    const oldest = run[run.length - 1]!;
    out.push({
      kind: "trades",
      // Named for its oldest trade, so the line stays the same line as newer trades join it.
      key: `trades:${oldest.key}`,
      time: run[0]!.time,
      since: oldest.time,
      trades: run,
      wallets: [...spent.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([wallet]) => wallet),
      buys: run.filter((t) => t.buy).length,
      sells: run.filter((t) => !t.buy).length,
      eth: run.reduce((sum, t) => sum + t.eth, 0),
    });
    run = [];
  };
  for (const mark of marks) {
    if (mark.trade) {
      const last = run[run.length - 1];
      if (last && last.time - mark.trade.time > gapS) close();
      run.push(mark.trade);
      continue;
    }
    close();
    out.push({ kind: "thread", time: mark.time, thread: mark.thread as T });
  }
  close();
  return out;
}
