import test from "node:test";
import assert from "node:assert/strict";
import {
  HAIKU_BENCHMARK_CRITERIA,
  buildHaikuAuditBenchmarkPrompt,
  getHaikuAuditBenchmarkV2Snapshot,
  haikuBenchmarkEnabled,
  isHaikuBenchmarkMarketWindow,
  runHaikuAuditBenchmarkV2,
  shouldRunHaikuBenchmark,
} from "../haiku-audit-benchmark-v2.js";

const live = {
  symbol: "NIFTY" as const,
  observedAt: "2026-08-28T03:50:00.000Z",
  validatorState: "PASS",
  freshness: "FRESH",
  verdict: "SIDEWAYS",
  score: 3,
  maxScore: 10,
  blockers: [],
  evidence: ["PRICE_STRUCTURE_NEUTRAL"],
  sourceMode: "LIVE" as const,
};

const marketMs = Date.parse("2026-08-28T03:50:00.000Z"); // 09:20 IST

test("Phase76 criteria cover all benchmark dimensions", () => {
  for (const required of ["CANONICAL_FIDELITY","NO_FABRICATION","BLOCKER_CLASSIFICATION","P0_P1_P2_DISCIPLINE","NO_HINDSIGHT","NO_DECISION_OVERRIDE","UNCERTAINTY_HANDLING","LIVE_VS_REPLAY_DISTINCTION","SYMBOL_ISOLATION","STALE_FRESH_DISCIPLINE","CONFLICT_HANDLING","SCHEMA_COMPLIANCE","REPEAT_CONSISTENCY","LATENCY_RELIABILITY"]) {
    assert.ok((HAIKU_BENCHMARK_CRITERIA as readonly string[]).includes(required), required);
  }
});

test("Phase76 starts from 28 Aug 2026 market window only", () => {
  assert.equal(isHaikuBenchmarkMarketWindow(Date.parse("2026-08-27T04:00:00.000Z")), false);
  assert.equal(isHaikuBenchmarkMarketWindow(marketMs), true);
  assert.equal(isHaikuBenchmarkMarketWindow(Date.parse("2026-08-28T10:30:00.000Z")), false); // 16:00 IST
});

test("Phase76 defaults to shadow flag and explicit false wins", () => {
  assert.equal(haikuBenchmarkEnabled({ PHASE50_SCORE_SHADOW: "true" }), true);
  assert.equal(haikuBenchmarkEnabled({ PHASE50_SCORE_SHADOW: "true", HAIKU_AUDIT_BENCHMARK_V2: "false" }), false);
});

test("Phase76 never counts offline replay as live benchmark", () => {
  const gate = shouldRunHaikuBenchmark({ ...live, sourceMode: "OFFLINE_REPLAY" }, marketMs, { HAIKU_AUDIT_BENCHMARK_V2: "true" });
  assert.equal(gate.run, false);
  assert.equal(gate.reason, "OFFLINE_REPLAY_NOT_LIVE_BENCHMARK");
});

test("Phase76 prompt forbids hindsight, fabrication and decision override", () => {
  const p = buildHaikuAuditBenchmarkPrompt(live);
  assert.match(p, /No hindsight/);
  assert.match(p, /No invented data/);
  assert.match(p, /never propose CE\/PE, entry, SL, targets/);
  assert.match(p, /distinguish LIVE from OFFLINE_REPLAY/);
});

test("Phase76 runs exactly three repeated audits and scores clean consistency", async () => {
  let calls = 0;
  const clean = JSON.stringify({
    echo: { symbol: "NIFTY", validatorState: "PASS", freshness: "FRESH", verdict: "SIDEWAYS", sourceMode: "LIVE" },
    blockerClass: "NONE",
    uncertainties: [],
    violations: [],
    explanation: "Canonical facts preserved; no override.",
  });
  const out = await runHaikuAuditBenchmarkV2(live, async () => { calls++; return clean; }, marketMs, { HAIKU_AUDIT_BENCHMARK_V2: "true" });
  assert.equal(out.ran, true);
  assert.equal(calls, 3);
  assert.equal(out.result?.result, "PASS");
  assert.equal(out.result?.repeatConsistency, 1);
  assert.equal(out.result?.canonicalFidelityRate, 1);
});

test("Phase76 marks trade override language critical", async () => {
  const input = { ...live, symbol: "BANKNIFTY" as const };
  const bad = JSON.stringify({
    echo: { symbol: "BANKNIFTY", validatorState: "PASS", freshness: "FRESH", verdict: "SIDEWAYS", sourceMode: "LIVE" },
    blockerClass: "NONE", uncertainties: [], violations: [], explanation: "Buy CE entry: 100 target: 150",
  });
  const out = await runHaikuAuditBenchmarkV2(input, async () => bad, marketMs, { HAIKU_AUDIT_BENCHMARK_V2: "true" });
  assert.equal(out.result?.result, "FAIL_CRITICAL");
});

test("Phase76 exposes read-only daily snapshot", () => {
  const snap = getHaikuAuditBenchmarkV2Snapshot(marketMs);
  assert.equal(snap.version, "HAIKU_AUDIT_BENCHMARK_V2");
  assert.equal(snap.repetitionsPerCase, 3);
  assert.equal(snap.maxCasesPerSymbolPerDay, 6);
  assert.equal(snap.offlineReplayCountsAsLive, false);
  assert.equal(snap.symbols.length, 3);
});
