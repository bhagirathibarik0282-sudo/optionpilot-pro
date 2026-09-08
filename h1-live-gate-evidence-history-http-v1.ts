import type { Context } from "hono";
import { dbLoadRecent } from "./db.js";
import { H1_LIVE_GATE_EVIDENCE_PERSIST_KIND } from "./h1-live-selector-registry.js";

export const H1_LIVE_GATE_EVIDENCE_HISTORY_VERSION = "READ_ONLY_H1_LIVE_GATE_EVIDENCE_HISTORY_V1" as const;

export async function runH1LiveGateEvidenceHistoryHttp(c: Context) {
  c.header("Cache-Control", "no-store");
  const requested = Number(c.req.query("limit") ?? 20);
  const limit = Number.isInteger(requested) ? Math.min(100, Math.max(1, requested)) : 20;
  const records = await dbLoadRecent<Record<string, unknown>>(H1_LIVE_GATE_EVIDENCE_PERSIST_KIND, limit);

  return c.json({
    ok: true,
    mode: H1_LIVE_GATE_EVIDENCE_HISTORY_VERSION,
    productionImpact: "NONE",
    persistKind: H1_LIVE_GATE_EVIDENCE_PERSIST_KIND,
    requestedLimit: limit,
    count: records.length,
    records,
    safety: {
      readOnly: true,
      affectsSelector: false,
      affectsTelegram: false,
      affectsVerdict: false,
      affectsExecution: false,
      createsCandidate: false,
      createsOrders: false,
      failClosed: true,
    },
  });
}
