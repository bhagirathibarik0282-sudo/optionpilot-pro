import test from "node:test";
import assert from "node:assert/strict";
import { buildResearchIndexReadinessAudit } from "../research-index-readiness.js";
import { RESEARCH_INDEX_CODES } from "../research-index-health.js";
import type { ResearchIndexCode, ResearchIndexDailyRecord, ResearchIndexMetrics } from "../research-index-types.js";

function history(code: ResearchIndexCode, count = 253, lastDate = "2026-08-21"): ResearchIndexDailyRecord[] {
  const end = Date.parse(`${lastDate}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => {
    const daysBack = count - 1 - i;
    const tradeDate = new Date(end - daysBack * 86_400_000).toISOString().slice(0, 10);
    const close = 100 + i;
    return {
      tradeDate,
      indexCode: code,
      indexName: code,
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      triClose: null,
      source: "TEST",
      sourceTimestamp: `${tradeDate}T12:00:00.000Z`,
      freshnessStatus: "FRESH",
      validationStatus: "VALID",
    };
  });
}

function metrics(code: ResearchIndexCode, tradeDate = "2026-08-21"): ResearchIndexMetrics[] {
  return [{
    tradeDate,
    indexCode: code,
    return1d: 0,
    return5d: 0,
    return20d: 0,
    return60d: 0,
    return120d: 0,
    return252d: 0,
    rsVsNifty50_5d: 0,
    rsVsNifty50_20d: 0,
    rsVsNifty50_60d: 0,
  }];
}

function fullSet(count = 253, lastDate = "2026-08-21") {
  const histories = {} as Record<ResearchIndexCode, ResearchIndexDailyRecord[]>;
  const metricRows = {} as Record<ResearchIndexCode, ResearchIndexMetrics[]>;
  for (const code of RESEARCH_INDEX_CODES) {
    histories[code] = history(code, count, lastDate);
    metricRows[code] = metrics(code, lastDate);
  }
  return { histories, metricRows };
}

test("readiness passes only when all seven indices have 253 observations, metrics and aligned latest date", () => {
  const { histories, metricRows } = fullSet();
  const audit = buildResearchIndexReadinessAudit(histories, metricRows);
  assert.equal(audit.ready, true);
  assert.equal(audit.coverage, "7/7");
  assert.equal(audit.metricsCoverage, "7/7");
  assert.equal(audit.minimumHistoryObservations, 253);
  assert.equal(audit.alignedLatestDate, true);
  assert.deepEqual(audit.blockers, []);
});

test("readiness blocks when any index has fewer than 253 observations", () => {
  const { histories, metricRows } = fullSet();
  histories.SMALLCAP250 = history("SMALLCAP250", 252);
  const audit = buildResearchIndexReadinessAudit(histories, metricRows);
  assert.equal(audit.ready, false);
  assert.ok(audit.blockers.includes("INSUFFICIENT_252D_LOOKBACK_FOR_FULL_LAB"));
  assert.ok(audit.warnings.includes("SMALLCAP250:LESS_THAN_253_OBSERVATIONS"));
});

test("readiness blocks when latest trade dates are not aligned", () => {
  const { histories, metricRows } = fullSet();
  histories.NIFTY500 = history("NIFTY500", 253, "2026-08-20");
  metricRows.NIFTY500 = metrics("NIFTY500", "2026-08-20");
  const audit = buildResearchIndexReadinessAudit(histories, metricRows);
  assert.equal(audit.ready, false);
  assert.equal(audit.alignedLatestDate, false);
  assert.ok(audit.blockers.includes("LATEST_TRADE_DATE_NOT_ALIGNED"));
});
