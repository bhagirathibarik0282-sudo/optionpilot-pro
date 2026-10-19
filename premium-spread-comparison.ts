import type { Hono } from "hono";
import { parseH1FixedContractJourneyRequest, runH1FixedContractJourneyHttp, type H1FixedContractJourneyResult } from "./h1-fixed-contract-journey-http.js";
import { renderPremiumSpreadView } from "./premium-spread-view.js";

/** Read-only two-strike 1m comparison. Reuses recorded rows; no writes or trading authority. */
export type PremiumSpreadRequest = { symbol: "NIFTY" | "SENSEX" | "BANKNIFTY"; date: string; expiry: string; ce: number; pe: number };
export type PremiumSpreadStatus = "TRUE_ELIGIBLE_BOTH" | "TRUE_DIAGNOSTIC" | "UNMARKED" | "TRUTH_BLOCKED" | "MISSING" | "AMBIGUOUS" | "IDENTITY_MISMATCH" | "INVALID_QUOTE";
export type PremiumSpreadRow = {
  minute: string; timeIst: string; status: PremiumSpreadStatus;
  ceLtp: number | null; peLtp: number | null; gap: number | null; change1m: number | null;
  ceValidation: string | null; peValidation: string | null;
  ceQuoteTime: string | null; peQuoteTime: string | null;
};
const SAFETY = { readOnly: true, writesPerformed: false, brokerRequests: false, affectsSelector: false,
  affectsVerdict: false, affectsTelegram: false, affectsExecution: false, createsOrders: false } as const;

export function parsePremiumSpreadRequest(q: Record<string, string | undefined>):
  { ok: true; value: PremiumSpreadRequest } | { ok: false; reason: string } {
  const ce = parseH1FixedContractJourneyRequest({ symbol: q.symbol, expiry: q.expiry,
    strike: q.ce, optionType: "CE", fromDate: q.date, toDate: q.date });
  if (!ce.ok) return { ok: false, reason: ce.reason };
  const pe = parseH1FixedContractJourneyRequest({ symbol: q.symbol, expiry: q.expiry,
    strike: q.pe, optionType: "PE", fromDate: q.date, toDate: q.date });
  if (!pe.ok) return { ok: false, reason: pe.reason };
  return { ok: true, value: { symbol: ce.value.symbol, date: ce.value.fromDate,
    expiry: ce.value.expiry, ce: ce.value.strike, pe: pe.value.strike } };
}
type Snapshot = Record<string, unknown>;
function iso(v: unknown): string | null {
  const ms = Date.parse(String(v ?? ""));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
function positive(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) || Number(v) <= 0) return null;
  return Number(v);
}
function minuteGroups(result: H1FixedContractJourneyResult, req: PremiumSpreadRequest, side: "CE" | "PE") {
  const out = new Map<string, Snapshot[]>();
  for (const r of result.rows ?? []) {
    if (r.symbol !== req.symbol || r.option_type !== side ||
      Number(r.strike) !== (side === "CE" ? req.ce : req.pe) ||
      iso(r.expiry)?.slice(0, 10) !== req.expiry) continue;
    const bucket = iso(r.minute_bucket);
    if (!bucket) continue;
    const values = out.get(bucket) ?? []; values.push(r); out.set(bucket, values);
  }
  return out;
}
function validQuote(row: Snapshot, bucket: string): boolean {
  const q = iso(row.quote_timestamp), t = Date.parse(bucket), age = row.quote_age_seconds;
  return positive(row.ltp) !== null && q !== null &&
    Date.parse(q) >= t && Date.parse(q) < t + 60_000 &&
    age !== null && age !== undefined && Number.isFinite(Number(age)) &&
    Number(age) >= 0 && Number(age) <= 30;
}

export function comparePremiumSpread(req: PremiumSpreadRequest, ce: H1FixedContractJourneyResult, pe: H1FixedContractJourneyResult) {
  const first = Date.parse(req.date + "T09:15:00+05:30");
  const last = Date.parse(req.date + "T15:30:00+05:30");
  const ces = minuteGroups(ce, req, "CE"), pes = minuteGroups(pe, req, "PE");
  const rows: PremiumSpreadRow[] = [];
  const counts: Record<PremiumSpreadStatus, number> = {
    TRUE_ELIGIBLE_BOTH: 0, TRUE_DIAGNOSTIC: 0, UNMARKED: 0, TRUTH_BLOCKED: 0,
    MISSING: 0, AMBIGUOUS: 0, IDENTITY_MISMATCH: 0, INVALID_QUOTE: 0,
  };
  for (let t = first; t <= last; t += 60_000) {
    const minute = new Date(t).toISOString();
    const c = ces.get(minute) ?? [], p = pes.get(minute) ?? [];
    const a = c.length === 1 ? c[0] : null, b = p.length === 1 ? p[0] : null;
    let status: PremiumSpreadStatus;
    if (!c.length || !p.length) status = "MISSING";
    else if (c.length !== 1 || p.length !== 1) status = "AMBIGUOUS";
    else if (!a!.snapshot_id || a!.snapshot_id !== b!.snapshot_id) status = "IDENTITY_MISMATCH";
    else if (!validQuote(a!, minute) || !validQuote(b!, minute)) status = "INVALID_QUOTE";
    else if (a!.truth_verdict === "TRUE" && b!.truth_verdict === "TRUE")
      status = a!.validation_status === "RESEARCH_ELIGIBLE" && b!.validation_status === "RESEARCH_ELIGIBLE"
        ? "TRUE_ELIGIBLE_BOTH" : "TRUE_DIAGNOSTIC";
    else if (a!.truth_verdict == null && b!.truth_verdict == null) status = "UNMARKED";
    else status = "TRUTH_BLOCKED";
    const comparable = status === "TRUE_ELIGIBLE_BOTH" || status === "TRUE_DIAGNOSTIC" || status === "UNMARKED";
    const gap = comparable ? Number((positive(a?.ltp)! - positive(b?.ltp)!).toFixed(2)) : null;
    const prev = rows.at(-1);
    const markedNow = status === "TRUE_ELIGIBLE_BOTH" || status === "TRUE_DIAGNOSTIC";
    const markedPrev = prev?.status === "TRUE_ELIGIBLE_BOTH" || prev?.status === "TRUE_DIAGNOSTIC";
    // Only consecutive minute buckets in the same marker tier: never bridge gaps or promote raw data.
    const change1m = gap !== null && prev !== undefined && prev.gap !== null &&
      ((markedNow && markedPrev) || (status === "UNMARKED" && prev.status === "UNMARKED"))
      ? Number((gap - prev.gap).toFixed(2)) : null;
    rows.push({
      minute, timeIst: new Date(t + 19800000).toISOString().slice(11, 16), status,
      ceLtp: comparable ? positive(a?.ltp) : null, peLtp: comparable ? positive(b?.ltp) : null,
      gap, change1m,
      ceValidation: a ? String(a.validation_status ?? "UNAVAILABLE") : null,
      peValidation: b ? String(b.validation_status ?? "UNAVAILABLE") : null,
      ceQuoteTime: a ? iso(a.quote_timestamp) : null,
      peQuoteTime: b ? iso(b.quote_timestamp) : null,
    });
    counts[status] += 1;
  }
  return { ok: true, mode: "READ_ONLY_PREMIUM_SPREAD_COMPARISON_V1", request: req,
    formula: "CE_LTP_MINUS_PE_LTP", cadence: "EXACT_1M_NO_INTERPOLATION",
    safety: SAFETY, source: "EXISTING_H1_FIXED_CONTRACT_JOURNEY",
    coverage: { ce: ce.coverage, pe: pe.coverage }, counts, rows };
}

export async function readPremiumSpread(q: Record<string, string | undefined>) {
  const parsed = parsePremiumSpreadRequest(q);
  if (!parsed.ok) return { ok: false, reason: parsed.reason, status: 400 as const, safety: SAFETY };
  const v = parsed.value, scope = { symbol: v.symbol, expiry: v.expiry, fromDate: v.date, toDate: v.date,
    fromTime: "09:15", toTime: "15:30" };
  const [ce, pe] = await Promise.all([
    runH1FixedContractJourneyHttp({ ...scope, strike: v.ce, optionType: "CE" }),
    runH1FixedContractJourneyHttp({ ...scope, strike: v.pe, optionType: "PE" }),
  ]);
  if (!ce.ok || !pe.ok) return { ok: false, status: 503 as const,
    reason: !ce.ok ? "CE_READ_FAILED: " + (ce.reason ?? "UNAVAILABLE") : "PE_READ_FAILED: " + (pe.reason ?? "UNAVAILABLE"),
    safety: SAFETY };
  return { ...comparePremiumSpread(v, ce, pe), status: 200 as const };
}

export function mountPremiumSpreadRoutes(router: Hono): void {
  router.get("/premium-spread/view", c => {
    c.header("Cache-Control", "no-store");
    return c.html(renderPremiumSpreadView());
  });
  router.get("/premium-spread", async c => {
    c.header("Cache-Control", "no-store");
    const q = { symbol: c.req.query("symbol"), date: c.req.query("date"), expiry: c.req.query("expiry"),
      ce: c.req.query("ce"), pe: c.req.query("pe") };
    try {
      const { status, ...result } = await readPremiumSpread(q);
      return c.json(result, status);
    } catch {
      return c.json({ ok: false, reason: "RECORDED_SPREAD_READ_FAILED", safety: SAFETY }, 503);
    }
  });
}
