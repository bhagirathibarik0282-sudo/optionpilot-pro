import test from "node:test";
import assert from "node:assert/strict";
import { applyPhase59ShadowDiagnosticPatch } from "../scripts/phase59-shadow-diagnostic-patch-core.mjs";
import { phase59TraceRuleBoundary, phase59TraceRuleResult, phase59TracePersistAttempt, phase59TracePersistResult, getPhase59ShadowDiagnosticTrace } from "../phase59-shadow-diagnostic-trace.js";

test("Phase59 patch wires read-only diagnostic endpoint and persistence outcome tracing", () => {
  const fixture = `import { persistKnownThenScoreObservation, replayPersistedScoresWithoutMaxPain } from "./score-observation-known-then.js"; // PHASE50_KNOWN_THEN_SCORE_WIRING_V1
// PHASE58_SERVER_SHADOW_SCORE_PERSISTENCE_V1
function runRuleEngineServer(symbol: string, m: any, validation: any, sectorBreadth: number | null) {
  const result = runRuleEngineServerCore(symbol, m, validation, sectorBreadth);
  const shadow = result as any;
  const snapshotObservedAt = m?.timestamp && Number.isFinite(Date.parse(m.timestamp))
    ? m.timestamp
    : null;
  if (snapshotObservedAt && typeof shadow.score === "number" && Number.isFinite(shadow.score) && shadow.verdict !== "DATA UNAVAILABLE") {
    void persistKnownThenScoreObservation({
      symbol,
      observedAt: snapshotObservedAt,
      legacyScore: shadow.score,
      maxScore: null,
      legacyVerdict: shadow.verdict,
      contributions: {}, overrides: [], legacyCandidate: null,
      sourcePath: "server:runRuleEngineServer",
    }).catch((err) => console.error("[Phase58] server shadow score persistence failed:", err instanceof Error ? err.message : err));
  }
  return result;
}
app.route("/api/offline-research", offlineResearchRouter);`;
  const first = applyPhase59ShadowDiagnosticPatch(fixture);
  assert.equal(first.changed, true);
  assert.match(first.source, /PHASE59_SHADOW_DIAGNOSTIC_TRACE_WIRING_V1/);
  assert.match(first.source, /shadow-diagnostic-trace/);
  assert.match(first.source, /phase59TracePersistAttempt\(symbol\)/);
  assert.match(first.source, /phase59TracePersistResult\(symbol, observationId\)/);
  assert.match(first.source, /\/api\/research\/shadow-diagnostic-trace/);
  assert.match(first.source, /phase59ObservedAt === snapshotObservedAt/);
  const second = applyPhase59ShadowDiagnosticPatch(first.source);
  assert.equal(second.changed, false);
});

test("Phase59 counters distinguish validation, score and persistence stages", () => {
  const ts = "2026-08-27T06:00:00.000Z";
  assert.equal(phase59TraceRuleBoundary("NIFTY", { timestamp: ts }, { overallValid: true }), ts);
  phase59TraceRuleResult("NIFTY", { score: 3.5, verdict: "WATCH" });
  phase59TracePersistAttempt("NIFTY");
  phase59TracePersistResult("NIFTY", "abcdef0123456789");
  phase59TraceRuleBoundary("BANKNIFTY", { timestamp: "bad" }, { overallValid: false, blockers: ["STALE_QUOTE"] });
  const trace = getPhase59ShadowDiagnosticTrace();
  assert.ok(trace.counters.ruleEngineInvoked >= 2);
  assert.ok(trace.counters.snapshotReceived >= 1);
  assert.ok(trace.counters.snapshotMissingOrInvalidTimestamp >= 1);
  assert.ok(trace.counters.validationPassed >= 1);
  assert.ok(trace.counters.validationFailed >= 1);
  assert.ok(trace.counters.finiteScoreProduced >= 1);
  assert.ok(trace.counters.persistAttempted >= 1);
  assert.ok(trace.counters.persistSucceeded >= 1);
  assert.ok((trace.validationFailureReasons["STALE_QUOTE"] ?? 0) >= 1);
  assert.equal(trace.affectsProductionScore, false);
  assert.equal(trace.affectsExecution, false);
});
