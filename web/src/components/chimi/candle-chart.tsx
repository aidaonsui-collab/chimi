import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type { IChartApi, ISeriesApi, LogicalRange, MouseEventParams, Time, UTCTimestamp } from "lightweight-charts";
import { stackBubbles, type Bubble, type Candle } from "@/lib/chimi/chart-rules";
import { ago, compactCount, ethText, money } from "@/lib/chimi/format";
import { IconChevronLeft, IconChevronRight, IconMinus, IconPlus, IconReset } from "@/components/chimi/icons";
import { Blockie, walletGradient } from "@/components/chimi/ui";

/** A trade marked on the chart: who, which way, and where it sits. */
export type ChartBubble = Bubble & {
  /** The candle it belongs to (that candle's start time). */
  candle: number;
  /** The value the trade left the coin at, in the unit being charted. */
  value: number;
  tokens: number;
  name?: string | null;
};

const UP = "#45c796";
const DOWN = "#f0616d";
const GOLD = "#e3b866";
const KIND_Z: Record<Bubble["kind"], number> = { other: 1, following: 2, dev: 3, you: 4 };
const KIND_LABEL: Record<Bubble["kind"], string | null> = { you: "You", dev: "Creator", following: "Following", other: null };

/** The chart shows local time: the library draws whatever it is given as UTC, so times are shifted on the way in. */
const zoneShift = () => -new Date().getTimezoneOffset() * 60;

type Tip = { bubble: ChartBubble; x: number; y: number; below: boolean };

/**
 * A coin's candle chart: candles or a line, volume underneath, the open/high/low/close of whichever candle the
 * pointer is on, and the traders marked where they traded. It is drawn with TradingView's Lightweight Charts,
 * loaded only when a chart is on the page. Drag to move through time, scroll or pinch to zoom.
 */
export function CandleChart({
  candles,
  bubbles,
  kind,
  view,
  label,
  symbol,
  format,
  axis,
  volumeText,
  ethUsd,
  now,
  className = "",
}: {
  candles: Candle[];
  bubbles: ChartBubble[];
  kind: "candles" | "line";
  /** Changes when the chart should forget where it was scrolled to: another coin, interval or unit. */
  view: string;
  /** "CHIMI · 15m" */
  label: string;
  symbol: string;
  /** A charted value in full, for the legend and the label that follows the pointer. */
  format: (v: number) => string;
  /** The same value, shorter, for the marks along the price scale. */
  axis: (v: number) => string;
  /** A candle's volume, for the legend. */
  volumeText: (v: number) => string;
  ethUsd?: number;
  now: number;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const legend = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<string, HTMLElement>());
  const api = useRef<{
    chart: IChartApi;
    candle: ISeriesApi<"Candlestick">;
    line: ISeriesApi<"Line">;
    volume: ISeriesApi<"Histogram">;
  } | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [tip, setTip] = useState<Tip | null>(null);

  // What the handlers below need, kept current without re-subscribing them.
  const live = useRef({ candles, bubbles, kind, format, axis, volumeText, byTime: new Map<number, Candle>(), shift: 0, shownView: "" });
  live.current.candles = candles;
  live.current.bubbles = bubbles;
  live.current.kind = kind;
  live.current.format = format;
  live.current.axis = axis;
  live.current.volumeText = volumeText;

  /** Writes one candle's numbers into the legend. With no candle, the latest one. */
  const describe = useCallback((candle?: Candle) => {
    const el = legend.current;
    if (!el) return;
    const all = live.current.candles;
    const c = candle ?? all[all.length - 1];
    if (!c) {
      el.dataset.tone = "flat";
      for (const key of ["o", "h", "l", "c", "d", "v"]) el.querySelector<HTMLElement>(`[data-k="${key}"]`)!.textContent = "—";
      return;
    }
    const f = live.current.format;
    const change = c.open > 0 ? ((c.close - c.open) / c.open) * 100 : 0;
    el.dataset.tone = Math.abs(change) < 0.005 ? "flat" : change > 0 ? "up" : "down";
    const put = (key: string, text: string) => (el.querySelector<HTMLElement>(`[data-k="${key}"]`)!.textContent = text);
    put("o", f(c.open));
    put("h", f(c.high));
    put("l", f(c.low));
    put("c", f(c.close));
    put("d", `${change > 0 ? "+" : ""}${change.toFixed(2)}%`);
    put("v", live.current.volumeText(c.volume));
  }, []);

  /** Puts every bubble where its trade is, stacking the ones that share a candle. */
  const place = useCallback(() => {
    const now = api.current;
    const box = layer.current;
    if (!now || !box) return;
    const scale = now.chart.timeScale();
    const series = live.current.kind === "candles" ? now.candle : now.line;
    const width = scale.width();
    box.style.width = `${width}px`;
    box.style.height = `${Math.max(0, (holder.current?.clientHeight ?? 0) - scale.height())}px`;
    const size = box.clientWidth < 480 ? 18 : 22;
    box.style.setProperty("--bubble", `${size}px`);
    const shown: { el: HTMLElement; x: number; y: number }[] = [];
    for (const b of live.current.bubbles) {
      const el = nodes.current.get(b.key);
      if (!el) continue;
      const x = scale.timeToCoordinate((b.candle + live.current.shift) as UTCTimestamp);
      const y = series.priceToCoordinate(b.value);
      if (x === null || y === null || x < -size || x > width + size) {
        el.style.display = "none";
        continue;
      }
      shown.push({ el, x, y });
    }
    const ys = stackBubbles(shown, size * 0.82, size, size / 2 + 3);
    shown.forEach(({ el, x }, i) => {
      el.style.display = "";
      el.style.transform = `translate3d(${Math.round(x - size / 2)}px, ${Math.round(ys[i]! - size / 2)}px, 0)`;
    });
  }, []);

  /** The price scale settles a frame after the time scale moves, so bubbles are placed now and again shortly. */
  const settle = useCallback(() => {
    place();
    requestAnimationFrame(place);
    setTimeout(place, 90);
  }, [place]);

  const frame = useCallback((count: number): LogicalRange => {
    // The latest ~140 candles, with room on the right. A young coin keeps normal-width candles instead of a few fat ones.
    const bars = Math.max(70, Math.min(count, 140));
    return { from: count - bars - 0.5, to: count + 5 } as unknown as LogicalRange;
  }, []);

  // The chart itself, made once.
  useEffect(() => {
    let off = false;
    let cleanup = () => {};
    void import("lightweight-charts")
      .then((lib) => {
        const el = holder.current;
        if (off || !el) return;
        const chart = lib.createChart(el, {
          autoSize: true,
          layout: {
            background: { type: lib.ColorType.Solid, color: "transparent" },
            textColor: "#9fa3b1",
            fontSize: 12,
            fontFamily: getComputedStyle(document.body).fontFamily,
            attributionLogo: true,
          },
          grid: { vertLines: { color: "rgba(255,255,255,0.035)" }, horzLines: { color: "rgba(255,255,255,0.05)" } },
          rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.14, bottom: 0.24 } },
          timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 5, barSpacing: 8, minBarSpacing: 0.6 },
          crosshair: {
            mode: lib.CrosshairMode.Normal,
            vertLine: { color: "rgba(244,242,236,0.28)", style: lib.LineStyle.Dashed, labelBackgroundColor: "#1f232d" },
            horzLine: { color: "rgba(244,242,236,0.28)", style: lib.LineStyle.Dashed, labelBackgroundColor: "#1f232d" },
          },
          localization: {
            priceFormatter: (v: number) => (v < 0 ? "" : live.current.format(v)),
            tickmarksPriceFormatter: (values: number[]) => values.map((v) => (v < 0 ? "" : live.current.axis(v))),
          },
        });
        // A stretch with no trades is perfectly flat. Left alone the scale would zoom in on nothing and label every
        // line with the same number, so the view always spans at least a few percent around the price.
        const roomy = (original: () => { priceRange: { minValue: number; maxValue: number } | null } | null) => {
          const found = original();
          if (!found?.priceRange) return found;
          const { minValue, maxValue } = found.priceRange;
          const middle = (minValue + maxValue) / 2;
          const half = Math.max((maxValue - minValue) / 2, Math.abs(middle) * 0.03);
          return { ...found, priceRange: { minValue: middle - half, maxValue: middle + half } };
        };
        const candle = chart.addSeries(lib.CandlestickSeries, {
          upColor: UP,
          downColor: DOWN,
          wickUpColor: UP,
          wickDownColor: DOWN,
          borderVisible: false,
          priceLineStyle: lib.LineStyle.Dotted,
          autoscaleInfoProvider: roomy,
        });
        const line = chart.addSeries(lib.LineSeries, {
          color: GOLD,
          lineWidth: 2,
          priceLineStyle: lib.LineStyle.Dotted,
          priceLineColor: GOLD,
          visible: false,
          autoscaleInfoProvider: roomy,
        });
        const volume = chart.addSeries(lib.HistogramSeries, { priceScaleId: "volume", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
        chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
        api.current = { chart, candle, line, volume };

        const onMove = (param: MouseEventParams<Time>) => {
          const at = typeof param.time === "number" ? live.current.byTime.get(param.time) : undefined;
          describe(param.point ? at : undefined);
          place();
        };
        chart.subscribeCrosshairMove(onMove);
        chart.timeScale().subscribeVisibleLogicalRangeChange(settle);
        chart.timeScale().subscribeSizeChange(settle);
        // Dragging the price scale moves the candles without telling anyone, so the pointer is watched too.
        const follow = () => settle();
        el.addEventListener("pointerup", follow);
        el.addEventListener("wheel", follow, { passive: true });
        el.addEventListener("touchmove", follow, { passive: true });
        cleanup = () => {
          el.removeEventListener("pointerup", follow);
          el.removeEventListener("wheel", follow);
          el.removeEventListener("touchmove", follow);
          api.current = null;
          chart.remove();
        };
        setReady(true);
      })
      .catch(() => !off && setFailed(true));
    return () => {
      off = true;
      cleanup();
    };
  }, [describe, place, settle]);

  // Candles in, whenever they change.
  useEffect(() => {
    const now = api.current;
    if (!ready || !now) return;
    const shift = zoneShift();
    live.current.shift = shift;
    live.current.byTime = new Map(candles.map((c) => [c.time + shift, c]));
    const smallest = candles.reduce((min, c) => (c.low > 0 && c.low < min ? c.low : min), Infinity);
    // Fine enough steps for a coin worth a fraction of a cent, coarse enough for one worth millions.
    const minMove = Number.isFinite(smallest) ? 10 ** (Math.floor(Math.log10(smallest)) - 4) : 0.01;
    // The room left under the candles for volume can reach below zero on the scale. Nothing is worth less than
    // nothing, so those marks are left blank.
    const priceFormat = {
      type: "custom" as const,
      formatter: (v: number) => (v < 0 ? "" : live.current.format(v)),
      tickmarksFormatter: (values: number[]) => values.map((v) => (v < 0 ? "" : live.current.axis(v))),
      minMove,
    };
    now.candle.applyOptions({ priceFormat });
    now.line.applyOptions({ priceFormat });
    now.candle.setData(candles.map((c) => ({ time: (c.time + shift) as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })));
    now.line.setData(candles.map((c) => ({ time: (c.time + shift) as UTCTimestamp, value: c.close })));
    now.volume.setData(
      candles.map((c) => ({ time: (c.time + shift) as UTCTimestamp, value: c.volume, color: c.close >= c.open ? "rgba(69,199,150,0.34)" : "rgba(240,97,109,0.34)" })),
    );
    if (live.current.shownView !== view && candles.length > 0) {
      live.current.shownView = view;
      now.chart.timeScale().setVisibleLogicalRange(frame(candles.length));
    }
    describe();
    settle();
  }, [ready, candles, view, describe, settle, frame]);

  useEffect(() => {
    const now = api.current;
    if (!ready || !now) return;
    now.candle.applyOptions({ visible: kind === "candles" });
    now.line.applyOptions({ visible: kind === "line" });
    settle();
  }, [ready, kind, settle]);

  // Bubbles are placed after React has made (or removed) their elements.
  useEffect(() => {
    if (ready) settle();
  }, [ready, bubbles, settle]);

  const span = (factor: number) => {
    const scale = api.current?.chart.timeScale();
    const range = scale?.getVisibleLogicalRange();
    if (!scale || !range) return;
    const width = Math.max(8, (range.to - range.from) * factor);
    scale.setVisibleLogicalRange({ from: range.to - width, to: range.to });
  };
  const slide = (part: number) => {
    const scale = api.current?.chart.timeScale();
    const range = scale?.getVisibleLogicalRange();
    if (!scale || !range) return;
    const by = (range.to - range.from) * part;
    scale.setVisibleLogicalRange({ from: range.from + by, to: range.to + by });
  };
  const reset = () => {
    const now = api.current;
    if (!now) return;
    now.chart.priceScale("right").applyOptions({ autoScale: true });
    now.chart.timeScale().setVisibleLogicalRange(frame(live.current.candles.length));
  };

  const byTouch = useRef(false);
  /** The bubble a finger has tapped once. */
  const armed = useRef<string | null>(null);
  const show = (bubble: ChartBubble, el: HTMLElement) => {
    const frameBox = root.current?.getBoundingClientRect();
    if (!frameBox) return;
    const box = el.getBoundingClientRect();
    const x = Math.min(Math.max(box.left + box.width / 2 - frameBox.left, 124), Math.max(124, frameBox.width - 124));
    const top = box.top - frameBox.top;
    setTip({ bubble, x, y: top < 132 ? top + box.height + 10 : top - 10, below: top < 132 });
  };

  const control = "grid size-8 place-items-center rounded-lg border border-line bg-raise/90 text-muted backdrop-blur transition-colors hover:border-edge hover:text-fg";
  const empty = ready && candles.length === 0;
  const tipEth = tip ? tip.bubble.eth : 0;

  return (
    <div
      ref={root}
      className={`chart-frame group/chart relative ${className}`}
      onPointerDown={(e) => {
        if (e.target instanceof Element && e.target.closest(".chart-bubble")) return;
        armed.current = null;
        setTip(null);
      }}
    >
      <div ref={holder} className="absolute inset-0" />

      <div ref={legend} data-tone="flat" className="chart-legend pointer-events-none absolute top-1 left-1 z-10 max-w-[calc(100%-5rem)]">
        <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-[12px] leading-5 sm:text-[13px]">
          <span className="font-semibold text-fg">{label}</span>
          <span className="text-faint">Chimi</span>
          {(["o", "h", "l", "c"] as const).map((key) => (
            <span key={key} className="num whitespace-nowrap text-muted">
              {key.toUpperCase()} <span data-k={key} className="chart-legend-value" />
            </span>
          ))}
          <span data-k="d" className="chart-legend-value num whitespace-nowrap" />
        </p>
        <p className="num mt-0.5 text-[12px] leading-5 text-muted">
          Volume <span data-k="v" className="chart-legend-value" />
        </p>
      </div>

      <div ref={layer} className="pointer-events-none absolute top-0 left-0 z-[5] overflow-hidden">
        {bubbles.map((b) => (
          <Link
            key={b.key}
            to="/u/$address"
            params={{ address: b.wallet }}
            ref={(el: HTMLAnchorElement | null) => {
              if (el) nodes.current.set(b.key, el);
              else nodes.current.delete(b.key);
            }}
            data-kind={b.kind}
            data-side={b.buy ? "buy" : "sell"}
            aria-label={`${KIND_LABEL[b.kind] ?? "Trader"} ${b.buy ? "bought" : "sold"} ${ethText(b.eth)} ETH`}
            className="chart-bubble"
            style={{ display: "none", zIndex: KIND_Z[b.kind], background: b.kind === "dev" ? undefined : walletGradient(b.wallet) }}
            onPointerEnter={(e) => show(b, e.currentTarget)}
            onPointerLeave={(e) => e.pointerType === "mouse" && setTip(null)}
            onPointerDown={(e) => (byTouch.current = e.pointerType !== "mouse")}
            onClick={(e) => {
              // With a finger there is no hover: the first tap says whose trade it is, the second opens their page.
              if (!byTouch.current || armed.current === b.key) return;
              e.preventDefault();
              armed.current = b.key;
              show(b, e.currentTarget);
            }}
            onFocus={(e) => show(b, e.currentTarget)}
            onBlur={() => setTip(null)}
          >
            {b.kind === "dev" ? "D" : null}
            {b.kind === "following" ? <span className="chart-bubble-star">★</span> : null}
          </Link>
        ))}
      </div>

      {tip ? (
        <div
          role="tooltip"
          className="glass pointer-events-none absolute z-20 w-[232px] rounded-xl px-3 py-2.5 text-[13px] shadow-pop"
          style={{ left: tip.x, top: tip.y, transform: `translate(-50%, ${tip.below ? "0" : "-100%"})` }}
        >
          <div className="flex items-center gap-2">
            <Blockie address={tip.bubble.wallet} size={22} />
            <span className="num min-w-0 flex-1 truncate font-semibold">
              {tip.bubble.name ? tip.bubble.name.replace(/\.up\.id$/, "") : `${tip.bubble.wallet.slice(0, 6)}…${tip.bubble.wallet.slice(-4)}`}
            </span>
            {KIND_LABEL[tip.bubble.kind] ? <span className="chip h-5 px-1.5 text-[11px] text-gold">{KIND_LABEL[tip.bubble.kind]}</span> : null}
          </div>
          <p className="num mt-1.5 leading-snug text-muted">
            <span className={`font-semibold ${tip.bubble.buy ? "text-ok" : "text-down"}`}>{tip.bubble.buy ? "Bought" : "Sold"}</span> {compactCount(tip.bubble.tokens)} {symbol} for{" "}
            <span className="text-fg">{ethText(tipEth)} ETH</span>
            {ethUsd ? ` (${money(tipEth * ethUsd)})` : ""}
          </p>
          <p className="num mt-0.5 text-xs text-faint">
            {ago(now - tip.bubble.time)} ago · at {format(tip.bubble.value)}
          </p>
        </div>
      ) : null}

      {empty ? (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center text-center">
          <div>
            <p className="font-serif text-xl text-gold">첫 거래</p>
            <p className="mt-2 text-sm text-muted">No trades yet. The first one draws the first candle.</p>
          </div>
        </div>
      ) : null}
      {failed ? <p className="absolute inset-0 z-10 grid place-items-center text-sm text-muted">The chart couldn’t be loaded. Reloading usually fixes it.</p> : null}
      {!ready && !failed ? <span className="skeleton absolute inset-0 rounded-xl" /> : null}

      {ready && !empty ? (
        <div className="chart-controls absolute bottom-9 left-1/2 z-10 flex -translate-x-1/2 gap-1.5">
          <button type="button" className={control} aria-label="Zoom out" title="Zoom out" onClick={() => span(1.5)}>
            <IconMinus size={16} />
          </button>
          <button type="button" className={control} aria-label="Zoom in" title="Zoom in" onClick={() => span(1 / 1.5)}>
            <IconPlus size={16} />
          </button>
          <button type="button" className={control} aria-label="Earlier" title="Earlier" onClick={() => slide(-0.3)}>
            <IconChevronLeft size={16} />
          </button>
          <button type="button" className={control} aria-label="Later" title="Later" onClick={() => slide(0.3)}>
            <IconChevronRight size={16} />
          </button>
          <button type="button" className={control} aria-label="Back to now" title="Back to now" onClick={reset}>
            <IconReset size={15} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
