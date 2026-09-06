import test from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_SEVEN_INDEX_SCOPE,
  freezeSevenIndexIntelligence,
  type SevenIndexEvidenceRow,
} from "../canonical-seven-index-intelligence-freeze.ts";

const hash = "a".repeat(64);
const sourceUrl = "https://www.niftyindices.com/market-data/index-moversData";

function rows(): SevenIndexEvidenceRow[] {
  return CANONICAL_SEVEN_INDEX_SCOPE.map((indexId, i) => ({
    indexId,
    sourceUrl,
    sourceDate: "2026-09-05",
    sourceHash: hash,
    ltp: 10000 + i,
    previousClose: 9950 + i,
    returnPct: 0.5,
    weightedBreadthPct: 20 - i,
    sectorBreadthPct: 10 - i,
  }));
}

test("freezes the exact seven-index scope in the previously agreed order", () => {
  assert.deepEqual(CANONICAL_SEVEN_INDEX_SCOPE, [
    "NIFTY_50",
    "NIFTY_NEXT_50",
    "NIFTY_100",
    "NIFTY_200",
    "NIFTY_500",
    "NIFTY_MIDCAP_150",
    "NIFTY_SMALLCAP_250",
  ]);
  const result = freezeSevenIndexIntelligence({ rows: rows(), asOfDate: "2026-09-06", maxStaleCalendarDays: 3 });
  assert.equal(result.ready, true);
  assert.deepEqual(result.rows.map((row) => row.indexId), CANONICAL_SEVEN_INDEX_SCOPE);
});

test("requires official NSE Indices source identity and exact seven-member coverage", () => {
  const badSource = rows();
  badSource[0] = { ...badSource[0], sourceUrl: "https://example.com/nifty" };
  assert.equal(freezeSevenIndexIntelligence({ rows: badSource, asOfDate: "2026-09-06", maxStaleCalendarDays: 3 }).ready, false);

  const missing = rows().slice(0, 6);
  const missingResult = freezeSevenIndexIntelligence({ rows: missing, asOfDate: "2026-09-06", maxStaleCalendarDays: 3 });
  assert.equal(missingResult.ready, false);
  assert.ok(missingResult.blockers.includes("SEVEN_INDEX_EXACT_SCOPE_COUNT_REQUIRED"));
});

test("fails closed on duplicate, stale, future, invalid hash or invalid numeric evidence", () => {
  const duplicate = rows();
  duplicate[6] = { ...duplicate[6], indexId: "NIFTY_50" };
  assert.equal(freezeSevenIndexIntelligence({ rows: duplicate, asOfDate: "2026-09-06", maxStaleCalendarDays: 3 }).ready, false);

  const stale = rows();
  stale[0] = { ...stale[0], sourceDate: "2026-08-01" };
  assert.equal(freezeSevenIndexIntelligence({ rows: stale, asOfDate: "2026-09-06", maxStaleCalendarDays: 3 }).ready, false);

  const future = rows();
  future[0] = { ...future[0], sourceDate: "2026-09-07" };
  assert.equal(freezeSevenIndexIntelligence({ rows: future, asOfDate: "2026-09-06", maxStaleCalendarDays: 3 }).ready, false);

  const badHash = rows();
  badHash[0] = { ...badHash[0], sourceHash: "not-a-hash" };
  assert.equal(freezeSevenIndexIntelligence({ rows: badHash, asOfDate: "2026-09-06", maxStaleCalendarDays: 3 }).ready, false);

  const badValue = rows();
  badValue[0] = { ...badValue[0], weightedBreadthPct: 101 };
  assert.equal(freezeSevenIndexIntelligence({ rows: badValue, asOfDate: "2026-09-06", maxStaleCalendarDays: 3 }).ready, false);
});

test("remains context-only and cannot grant direction, candidate, Telegram or execution authority", () => {
  const result = freezeSevenIndexIntelligence({ rows: rows(), asOfDate: "2026-09-06", maxStaleCalendarDays: 3 });
  assert.equal(result.readOnly, true);
  assert.equal(result.contextOnly, true);
  assert.equal(result.weightedConstituentContributionRequired, true);
  assert.equal(result.equalCountBreadthForbidden, true);
  assert.equal(result.aiExplanationOnly, true);
  assert.equal(result.grantsDirectionalSupport, false);
  assert.equal(result.affectsVerdict, false);
  assert.equal(result.affectsCandidate, false);
  assert.equal(result.affectsTelegram, false);
  assert.equal(result.affectsExecution, false);
  assert.equal(result.failClosed, true);
});
