import test from "node:test";
import assert from "node:assert/strict";
import type { H1FixedContractJourneyResult } from "../h1-fixed-contract-journey-http.js";
import { comparePremiumSpread, parsePremiumSpreadRequest } from "../premium-spread-comparison.js";

const req = { symbol: "NIFTY", date: "2026-10-19", expiry: "2026-10-19", ce: 22900, pe: 23150 } as const;
function row(timeIst: string, side: "CE" | "PE", ltp: number, truth: string | null,
  validation = "TIMESTAMP_PRESENT", snapshotId?: string) {
  const bucket = new Date("2026-10-19T" + timeIst + ":00+05:30").toISOString();
  return {
    symbol: "NIFTY", minute_bucket: bucket, expiry: "2026-10-19T00:00:00.000Z",
    strike: side === "CE" ? 22900 : 23150, option_type: side,
    snapshot_id: snapshotId ?? "snapshot-" + timeIst,
    truth_verdict: truth, validation_status: validation, ltp,
    quote_timestamp: new Date(Date.parse(bucket) + 8_000).toISOString(),
    quote_age_seconds: 0,
  };
}
function journey(rows: ReturnType<typeof row>[]): H1FixedContractJourneyResult {
  return { ok: true, available: true, rows } as H1FixedContractJourneyResult;
}
function at(result: ReturnType<typeof comparePremiumSpread>, timeIst: string) {
  return result.rows.find(r => r.timeIst === timeIst)!;
}

test("reproduces 19 Oct sample; 09:15 is UNMARKED, 09:32 TRUE, and no fabricated minute", () => {
  const ce = journey([
    row("09:15", "CE", 216.05, null), row("09:16", "CE", 220, null),
    row("09:29", "CE", 115.25, null),
    row("09:32", "CE", 158.30, "TRUE", "RESEARCH_ELIGIBLE"),
    row("09:33", "CE", 201, "TRUE"),
    row("09:34", "CE", 210.65, "TRUE"),
  ]);
  const pe = journey([
    row("09:15", "PE", 107.75, null), row("09:16", "PE", 96.40, null),
    row("09:29", "PE", 210.35, null),
    row("09:32", "PE", 156.35, "TRUE", "RESEARCH_ELIGIBLE"),
    row("09:33", "PE", 127.85, "TRUE"),
    row("09:34", "PE", 115, "TRUE"),
  ]);
  const result = comparePremiumSpread(req, ce, pe);
  assert.equal(result.rows.length, 376);
  assert.equal(at(result, "09:15").status, "UNMARKED");
  assert.equal(at(result, "09:15").gap, 108.30);
  assert.equal(at(result, "09:16").change1m, 15.30);
  assert.equal(at(result, "09:18").status, "MISSING");
  assert.equal(at(result, "09:18").gap, null);
  assert.equal(at(result, "09:29").gap, -95.10);
  assert.equal(at(result, "09:32").status, "TRUE_ELIGIBLE_BOTH");
  assert.equal(at(result, "09:32").gap, 1.95);
  assert.equal(at(result, "09:32").change1m, null);
  assert.equal(at(result, "09:33").status, "TRUE_DIAGNOSTIC");
  assert.equal(at(result, "09:33").gap, 73.15);
  assert.equal(at(result, "09:33").change1m, 71.20);
  assert.equal(at(result, "09:34").change1m, 22.50);
  assert.equal(result.counts.UNMARKED, 3);
  assert.equal(result.counts.TRUE_ELIGIBLE_BOTH, 1);
  assert.equal(result.counts.TRUE_DIAGNOSTIC, 2);
  assert.equal(result.counts.MISSING, 370);
  assert.equal(result.safety.brokerRequests, false);
  assert.equal(result.safety.affectsExecution, false);
});

test("rejects cross-snapshot pairing and duplicate same-minute rows", () => {
  const bad = comparePremiumSpread(req,
    journey([row("09:32", "CE", 100, "TRUE", "RESEARCH_ELIGIBLE", "snapshot-A")]),
    journey([row("09:32", "PE", 20, "TRUE", "RESEARCH_ELIGIBLE", "snapshot-B")]));
  assert.equal(at(bad, "09:32").status, "IDENTITY_MISMATCH");
  assert.equal(at(bad, "09:32").gap, null);
  const dup = comparePremiumSpread(req,
    journey([row("09:32", "CE", 100, "TRUE"), row("09:32", "CE", 101, "TRUE")]),
    journey([row("09:32", "PE", 20, "TRUE")]));
  assert.equal(at(dup, "09:32").status, "AMBIGUOUS");
  assert.equal(at(dup, "09:32").change1m, null);
});

test("fails closed on invalid quote age, one-leg missing, or mixed marker truth", () => {
  const stale = row("09:32", "CE", 100, "TRUE"); stale.quote_age_seconds = 31;
  const out = comparePremiumSpread(req, journey([stale, row("09:33", "CE", 100, "TRUE")]),
    journey([row("09:32", "PE", 20, "TRUE"), row("09:33", "PE", 20, null)]));
  assert.equal(at(out, "09:32").status, "INVALID_QUOTE");
  assert.equal(at(out, "09:33").status, "TRUTH_BLOCKED");
  assert.equal(at(out, "09:33").gap, null);
  const missingLeg = comparePremiumSpread(req, journey([row("09:32", "CE", 100, "TRUE")]), journey([]));
  assert.equal(at(missingLeg, "09:32").status, "MISSING");
});

test("requires exact date, expiry and both strikes; ignores expiry-date mismatch", () => {
  assert.equal(parsePremiumSpreadRequest({symbol:"NIFTY",date:"2026-10-19",expiry:"2026-10-19",ce:"22900",pe:"23150"}).ok,true);
  assert.equal(parsePremiumSpreadRequest({symbol:"NIFTY",date:"2026-10-20",expiry:"2026-10-19",ce:"22900",pe:"23150"}).ok,false);
  assert.equal(parsePremiumSpreadRequest({symbol:"NIFTY",date:"2026-10-19",expiry:"2026-10-19",ce:"foo",pe:"23150"}).ok,false);
  const out=comparePremiumSpread(req,journey([row("09:32","CE",100,"TRUE")]),
    journey([{...row("09:32","PE",20,"TRUE"), expiry:"2026-10-27T00:00:00.000Z"}]));
  assert.equal(at(out,"09:32").status,"MISSING");
});
