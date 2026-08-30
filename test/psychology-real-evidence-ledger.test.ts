import test from "node:test";
import assert from "node:assert/strict";
import { buildPsychologyRealEvidenceLedger } from "../psychology-real-evidence-ledger.ts";
import type { PsychologyReplayValidationInput } from "../psychology-shadow-replay-adapter.ts";
import type { ShadowValidationRegime } from "../psychology-shadow-validation.ts";

function input(
  tradeId: string,
  regimes: ShadowValidationRegime[],
  source: PsychologyReplayValidationInput["source"] = "REAL_REPLAY",
  withProvenance = true,
): PsychologyReplayValidationInput {
  return {
    source,
    replay: {
      logicalKey: tradeId,
      observedAt: "2026-08-20T09:20:00+05:30",
      decisionAt: "2026-08-20T09:21:00+05:30",
      blockEnd: "2026-08-20T09:20:00+05:30",
      blockClosed: true,
      quality: "TRUE",
      expiry: "2026-08-20",
      dte: 0,
      tradingDate: "2026-08-20",
      sessionEligible: true,
    },
    validation: {
      tradeId,
      regimes,
      ...(withProvenance ? {
        regimeEvidence: regimes.map((regime) => ({
          regime,
          source: "DETERMINISTIC_UPSTREAM" as const,
          observedAt: "2026-08-20T09:20:30+05:30",
          ruleVersion: "REGIME_RULE_V1",
        })),
      } : {}),
      completedTrade: true,
      chaseWarnings: 1,
      falseChaseWarnings: 0,
      lateExitEvents: 1,
      missedLateExitWarnings: 0,
      thesisFailures: 1,
      missedThesisFailures: 0,
      stateFlips: 1,
      eligibleMessages: 4,
      duplicateMessages: 0,
      spokenUpdates: 3,
      wrongSideFlips: 0,
      entries: 1,
      entriesAfterExtension: 0,
      stoppedTrades: 1,
      stopRespectViolations: 0,
      profitProtectionOpportunities: 1,
      usefulProfitProtectionEvents: 1,
    },
  };
}

test("ledger counts overlapping regimes only when deterministic provenance is valid", () => {
  const r = buildPsychologyRealEvidenceLedger([input("T1", ["EXPIRY", "HIGH_IV", "TREND"])]);
  assert.equal(r.acceptedInputs, 1);
  assert.equal(r.provenRegimeInputs, 1);
  assert.equal(r.regimeTradeCounts.EXPIRY, 1);
  assert.equal(r.regimeTradeCounts.HIGH_IV, 1);
  assert.equal(r.regimeTradeCounts.TREND, 1);
  assert.equal(r.acceptedRealReplay, 1);
  assert.equal(r.promotionEligible, false);
});

test("diagnostic regime labels without provenance never count mandatory coverage", () => {
  const r = buildPsychologyRealEvidenceLedger([input("T1", ["TREND", "HIGH_IV"], "REAL_REPLAY", false)]);
  assert.equal(r.acceptedInputs, 1);
  assert.equal(r.provenRegimeInputs, 0);
  assert.equal(r.regimeProvenanceRejectedInputs, 1);
  assert.equal(r.regimeTradeCounts.TREND, 0);
  assert.equal(r.regimeTradeCounts.HIGH_IV, 0);
  assert.ok(r.rejectionBlockers.includes("T1:REGIME_EVIDENCE_MISSING"));
});

test("ledger separates real replay and live-observation provenance", () => {
  const r = buildPsychologyRealEvidenceLedger([
    input("T1", ["TREND"], "REAL_REPLAY"),
    input("T2", ["RANGE"], "LIVE_OBSERVATION"),
  ]);
  assert.equal(r.acceptedRealReplay, 1);
  assert.equal(r.acceptedLiveObservation, 1);
  assert.ok(r.coveredRegimes.includes("TREND"));
  assert.ok(r.coveredRegimes.includes("RANGE"));
});

test("rejected evidence is counted and blockers are surfaced", () => {
  const bad = input("T1", ["TREND"], "SYNTHETIC");
  const r = buildPsychologyRealEvidenceLedger([bad]);
  assert.equal(r.acceptedInputs, 0);
  assert.equal(r.rejectedInputs, 1);
  assert.ok(r.rejectionBlockers.includes("SYNTHETIC_EVIDENCE_NOT_ACCEPTED"));
  assert.equal(r.metricValues, null);
  assert.equal(r.nullMetrics.length, 10);
});

test("ledger never invents thresholds or live authority", () => {
  const r = buildPsychologyRealEvidenceLedger([input("T1", ["TREND"])]);
  assert.equal(r.acceptanceThresholdsFrozen, false);
  assert.equal(r.promotionEligible, false);
  assert.equal(r.affectsTelegram, false);
  assert.equal(r.affectsVerdict, false);
  assert.equal(r.affectsExecution, false);
});
