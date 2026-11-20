import type { CSSProperties } from "react";
import { ChimiMark } from "@/components/chimi/icons";

/** A tip at least this big gets the big alert: gold edge, sparks, a third note. */
export const BIG_TIP_ETH = 0.05;

export type TipAlert = { key: string; name: string; amount: string; message: string; big: boolean; /** The amount in ETH, for its dollar value. */ eth: number };

/** How long an alert stays up: longer for a longer message, a little longer for a big tip. */
export const alertStayMs = (a: Pick<TipAlert, "message" | "big">) => Math.min(13_000, 5_000 + [...a.message].length * 60 + (a.big ? 2_000 : 0));

/**
 * One tip alert as it shows on a creator's broadcast (routes/alerts.$address.tsx) and in the preview on their stream
 * settings. `stay` drives the little timer along the bottom.
 */
export function TipAlertCard({
  alert,
  usd,
  leaving,
  stay,
  more,
  preview,
}: {
  alert: TipAlert;
  /** The dollar value, as the page last priced ETH. */
  usd?: string;
  leaving?: boolean;
  stay?: number;
  more?: number;
  preview?: boolean;
}) {
  return (
    <div
      className={`alert-card ${alert.big ? "alert-big" : ""} ${preview ? "alert-preview" : leaving ? "alert-out" : "alert-in"}`}
      role={preview ? undefined : "status"}
      style={stay ? ({ "--alert-stay": `${stay}ms` } as CSSProperties) : undefined}
    >
      {alert.big ? <span className="alert-sparks" aria-hidden /> : null}
      <span className="alert-seal">
        <ChimiMark size={preview ? 40 : 58} />
      </span>
      <span className="alert-body">
        <span className="alert-who">
          <b>{alert.name}</b> tipped
        </span>
        <span className="alert-amount">
          <span className="num">{alert.amount}</span> ETH{usd ? <span className="alert-usd num">≈ {usd}</span> : null}
        </span>
        {alert.message ? <span className="alert-msg">{alert.message}</span> : null}
      </span>
      {more ? <span className="alert-more num">+{more}</span> : null}
      {stay && !preview ? <span className="alert-timer" aria-hidden /> : null}
    </div>
  );
}
