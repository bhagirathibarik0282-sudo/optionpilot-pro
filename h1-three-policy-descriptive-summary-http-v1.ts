import type { Context } from "hono";
import { dbLoadRecent } from "./db.js";
import { H1_LIVE_GATE_EVIDENCE_PERSIST_KIND } from "./h1-live-selector-registry.js";
import {
  buildH1ThreePolicyDescriptiveSummary,
  type H1ThreePolicyDescriptiveRow,
} from "./h1-three-policy-descriptive-summary-v1.js";

export const H1_THREE_POLICY_DESCRIPTIVE_SUMMARY_HTTP_V1 =
  "READ_ONLY_H1_THREE_POLICY_DESCRIPTIVE_SUMMARY_V1" as const;

export async function runH1ThreePolicyDescriptiveSummaryHttp(c: Context) {
  c.header("Cache-Control", "no-store");
  const requested = Number(c.req.query("limit") ?? 500);
  const limit = Number.isInteger(requested) ? Math.min(5000, Math.max(1, requested)) : 500;
  const rows = await dbLoadRecent<H1ThreePolicyDescriptiveRow>(
    H1_LIVE_GATE_EVIDENCE_PERSIST_KIND,
    limit,
  );
  const summary = buildH1ThreePolicyDescriptiveSummary(rows);

  return c.json({
    ok: true,
    mode: H1_THREE_POLICY_DESCRIPTIVE_SUMMARY_HTTP_V1,
    persistKind: H1_LIVE_GATE_EVIDENCE_PERSIST_KIND,
    requestedLimit: limit,
    ...summary,
    safety: {
      readOnly: true,
      rawRecordsReturned: false,
      thresholdsInvented: false,
      acceptanceCriteriaApplied: false,
      validationDecisionMade: false,
      affectsSelector: false,
      affectsBusinessCard: false,
      affectsTelegram: false,
      affectsExecution: false,
      createsOrders: false,
      failClosed: true,
    },
  });
}
