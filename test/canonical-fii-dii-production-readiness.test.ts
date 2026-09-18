import test from "node:test";
import assert from "node:assert/strict";
import {
  assertFiiDiiSessionNotBehindMarketSession,
  evaluateFiiDiiProductionReadiness,
} from "../canonical-fii-dii-production-readiness.ts";

function row(date: string, fiiNet = -25, diiNet = 30) {
  return {
    trade_date: date,
    source: "NSE_FII_DII",
    source_url: "https://www.nseindia.com/api/fiidiiTradeReact",
    fetched_at: `${date}T13:35:00.000Z`,
    fii_buy: 100,
    fii_sell: 125,
    fii_net: fiiNet,
    dii_buy: 150,
    dii_sell: 120,
    dii_net: diiNet,
  };
}

test("weekend-safe readiness compares against latest recorded market session, not wall clock", () => {
  const out = evaluateFiiDiiProductionReadiness({
    expectedMarketSessionDate: "2026-09-04",
    storedRows: [row("2026-09-04")],
  });
  assert.equal(out.ready, true);
  assert.equal(out.expectedMarketSessionDate, "2026-09-04");
  assert.equal(out.latestStoredSessionDate, "2026-09-04");
  assert.equal(out.freshAgainstLatestRecordedMarketSession, true);
  assert.equal(out.windows[0].window, "1D");
  assert.equal(out.windows[0].ready, true);
  assert.equal(out.windows[1].ready, false);
  assert.equal(out.readOnly, true);
  assert.equal(out.affectsVerdict, false);
  assert.equal(out.affectsCandidate, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
});

test("fails closed when stored institutional session is behind latest recorded market session", () => {
  const out = evaluateFiiDiiProductionReadiness({
    expectedMarketSessionDate: "2026-09-04",
    storedRows: [row("2026-09-03")],
  });
  assert.equal(out.ready, false);
  assert.equal(out.freshAgainstLatestRecordedMarketSession, false);
  assert.ok(out.blockers.some((x) => x.includes("FII_DII_OFFICIAL_SESSION_BEHIND_MARKET")));
});

test("allows official institutional row newer than lagging market recorder but never older", () => {
  assert.doesNotThrow(() => assertFiiDiiSessionNotBehindMarketSession("2026-09-04", "2026-09-03"));
  assert.doesNotThrow(() => assertFiiDiiSessionNotBehindMarketSession("2026-09-04", "2026-09-04"));
  assert.throws(
    () => assertFiiDiiSessionNotBehindMarketSession("2026-09-03", "2026-09-04"),
    /FII_DII_OFFICIAL_SESSION_BEHIND_MARKET/,
  );
});

test("fails closed on missing history or non-official stored provenance", () => {
  const empty = evaluateFiiDiiProductionReadiness({ expectedMarketSessionDate: "2026-09-04", storedRows: [] });
  assert.equal(empty.ready, false);
  assert.ok(empty.blockers.includes("FII_DII_DB_HISTORY_EMPTY"));

  const invalid = evaluateFiiDiiProductionReadiness({
    expectedMarketSessionDate: "2026-09-04",
    storedRows: [{ ...row("2026-09-04"), source: "UNKNOWN" }],
  });
  assert.equal(invalid.ready, false);
  assert.ok(invalid.blockers.includes("FII_DII_DB_SOURCE_INVALID:2026-09-04"));
});


test("participant DB readback is exposed as context-only without changing cash readiness", () => {
  const out = evaluateFiiDiiProductionReadiness({
    expectedMarketSessionDate: "2026-09-04",
    storedRows: [row("2026-09-04")],
    participantSnapshot: {
      latestObservedTradeDate: "2026-09-04",
      latestObservedRowCount: 8,
      latestVerifiedTradeDate: "2026-09-04",
    },
  });
  assert.equal(out.ready, true);
  assert.equal(out.participantDbReadback.latestObservedTradeDate, "2026-09-04");
  assert.equal(out.participantDbReadback.latestObservedRowCount, 8);
  assert.equal(out.participantDbReadback.expectedRowsPerCompleteSession, 8);
  assert.equal(out.participantDbReadback.latestObservedComplete, true);
  assert.equal(out.participantDbReadback.latestVerifiedTradeDate, "2026-09-04");
  assert.equal(out.participantDbReadback.verifiedCompleteSnapshotAvailable, true);
  assert.equal(out.participantDbReadback.readOnly, true);
  assert.equal(out.participantDbReadback.contextOnly, true);
  assert.equal(out.participantDbReadback.affectsCandidate, false);
  assert.equal(out.participantDbReadback.affectsTelegram, false);
  assert.equal(out.participantDbReadback.affectsExecution, false);
});

test("partial participant DB state is visible but does not fabricate a verified snapshot", () => {
  const out = evaluateFiiDiiProductionReadiness({
    expectedMarketSessionDate: "2026-09-04",
    storedRows: [row("2026-09-04")],
    participantSnapshot: {
      latestObservedTradeDate: "2026-09-04",
      latestObservedRowCount: 4,
      latestVerifiedTradeDate: null,
    },
  });
  assert.equal(out.ready, true);
  assert.equal(out.participantDbReadback.latestObservedRowCount, 4);
  assert.equal(out.participantDbReadback.latestObservedComplete, false);
  assert.equal(out.participantDbReadback.latestVerifiedTradeDate, null);
  assert.equal(out.participantDbReadback.verifiedCompleteSnapshotAvailable, false);
});
