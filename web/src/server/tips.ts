/**
 * POST /api/tips { tx }: puts a tip in the creator's inbox. The page sends it after the tip confirms; the server reads
 * the transaction's receipt and trusts only the `Tipped` events the tips contract wrote there, so nobody can announce
 * a tip that didn't happen. Sending the same transaction again changes nothing (each tip has one inbox key).
 */
import { isHash, parseEventLogs, type Address } from "viem";
import deployment from "../../public/deployments.json";
import { tipsAbi, type Deployment } from "@/lib/chimi/chain";
import { snippet } from "@/lib/chimi/inbox-rules";
import { shownMessage } from "@/lib/chimi/tip-rules";
import { tell } from "@/server/inbox";
import { giwa } from "@/server/points";
import { json, rateLimited } from "@/server/store";

export async function postTip(request: Request) {
  if (await rateLimited(request, "tips", 20, 60)) return json({ error: "Too many requests. Try again in a minute." }, 429, { "retry-after": "60" });
  const tips = (deployment as Deployment).tips?.address;
  if (!tips) return json({ error: "Tips aren't switched on yet." }, 503);
  const body = (await request.json().catch(() => null)) as { tx?: unknown } | null;
  if (!body || typeof body.tx !== "string" || !isHash(body.tx)) return json({ error: "invalid request" }, 400);

  let receipt;
  try {
    receipt = await giwa().getTransactionReceipt({ hash: body.tx });
  } catch {
    return json({ error: "That transaction isn't on GIWA yet." }, 404);
  }
  if (receipt.status !== "success") return json({ error: "That transaction didn't go through." }, 400);
  const tipped = parseEventLogs({ abi: tipsAbi, eventName: "Tipped", logs: receipt.logs }).filter(
    (log) => log.address.toLowerCase() === (tips as Address).toLowerCase(),
  );
  if (tipped.length === 0) return json({ error: "That transaction has no tip in it." }, 400);

  const now = Date.now();
  await tell(
    tipped.map((log) => ({
      wallet: log.args.creator,
      item: {
        kind: "tip" as const,
        key: `tip:${body.tx}:${log.logIndex}`,
        time: now,
        from: log.args.from.toLowerCase(),
        token: log.args.token.toLowerCase(),
        eth: Number(log.args.amount) / 1e18,
        text: snippet(shownMessage(log.args.message)),
      },
    })),
  );
  return json({ ok: true, tips: tipped.length });
}
