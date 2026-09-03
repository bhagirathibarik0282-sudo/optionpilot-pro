import assert from "node:assert/strict";
import test from "node:test";
import { H1ShadowMeaningfulChangePreviewEngine } from "../h1-shadow-meaningful-change-preview.js";
import type { H1ShadowEvidenceReadinessResult } from "../h1-shadow-evidence-readiness-gate.js";
import type { H1LiveSelectorPipelineResult } from "../h1-live-selector-pipeline.js";

function readiness(overrides: Partial<H1ShadowEvidenceReadinessResult> = {}): H1ShadowEvidenceReadinessResult {
  return {
    version: "H1_SHADOW_EVIDENCE_READINESS_GATE_V1",
    readyForNextShadowStage: true,
    blockers: [],
    processedPackets: 120,
    exactReadyPackets: 30,
    rejectedPackets: 2,
    runtimeExceptions: 0,
    newestExactReadyTimestamp: "2026-09-03T15:30:00.000Z",
    productionImpact: "NONE",
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    failClosed: true,
    ...overrides,
  };
}

function pipeline(decision: "SELECT" | "BLOCK" = "SELECT", reasons = ["ALL_GATES_PASS"]): H1LiveSelectorPipelineResult {
  return {
    version: "H1_LIVE_SELECTOR_PIPELINE_V1",
    eligibleForLiveH1Marking: true,
    decisions: [{
      symbol: "NIFTY", expiry: "2026-09-08", strike: 24000, side: "CE", decision,
      reasonCodes: reasons, gates: { premium: true, liquidity: true }, selectorVersion: "H1_TEST_V1",
    }],
    assembledCount: 1,
    blockedCount: 0,
    rejected: [],
    producerRejected: [],
    failClosed: true,
    semantics: "LIVE_EXACT_ASSEMBLY_THEN_DETERMINISTIC_SELECTOR_ONLY",
  };
}

test("first clean state creates preview but grants zero Telegram/execution authority", () => {
  const engine = new H1ShadowMeaningfulChangePreviewEngine();
  const out = engine.evaluate(readiness(), pipeline(), "2026-09-03T15:30:10.000Z");
  assert.equal(out.ready, true);
  assert.equal(out.meaningfulChange, true);
  assert.equal(out.kind, "INITIAL_STATE");
  assert.deepEqual(out.added, ["NIFTY|2026-09-08|24000|CE"]);
  assert.equal(out.telegramSendAllowed, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsVerdict, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.productionImpact, "NONE");
});

test("identical periodic state is suppressed instead of producing repeated meaningful preview", () => {
  const engine = new H1ShadowMeaningfulChangePreviewEngine();
  engine.evaluate(readiness(), pipeline(), "2026-09-03T15:30:10.000Z");
  const out = engine.evaluate(readiness(), pipeline(), "2026-09-03T15:30:20.000Z");
  assert.equal(out.ready, true);
  assert.equal(out.meaningfulChange, false);
  assert.equal(out.kind, null);
  assert.deepEqual(out.added, []);
  assert.deepEqual(out.removed, []);
  assert.deepEqual(out.changed, []);
});

test("decision or evidence reason change is material", () => {
  const engine = new H1ShadowMeaningfulChangePreviewEngine();
  engine.evaluate(readiness(), pipeline(), "2026-09-03T15:30:10.000Z");
  const changed = engine.evaluate(readiness(), pipeline("BLOCK", ["LIQUIDITY_FAILED"]), "2026-09-03T15:30:20.000Z");
  assert.equal(changed.meaningfulChange, true);
  assert.equal(changed.kind, "MATERIAL_CHANGE");
  assert.deepEqual(changed.changed, ["NIFTY|2026-09-08|24000|CE"]);
});

test("fails closed when readiness is not passed and does not mutate baseline", () => {
  const engine = new H1ShadowMeaningfulChangePreviewEngine();
  const blocked = engine.evaluate(readiness({ readyForNextShadowStage: false, blockers: ["STALE_SHADOW_EVIDENCE"] }), pipeline(), "2026-09-03T15:30:10.000Z");
  assert.equal(blocked.ready, false);
  assert.ok(blocked.blockers.includes("SHADOW_READINESS_NOT_PASSED"));
  const firstGood = engine.evaluate(readiness(), pipeline(), "2026-09-03T15:30:20.000Z");
  assert.equal(firstGood.kind, "INITIAL_STATE");
});

test("fails closed on selector rejection or authority-contract violation", () => {
  const engine = new H1ShadowMeaningfulChangePreviewEngine();
  const rejectedPipeline = { ...pipeline(), blockedCount: 1, rejected: [{ index: 0, blockers: ["STALE_LIVE_EVIDENCE"] }] };
  const rejected = engine.evaluate(readiness(), rejectedPipeline, "2026-09-03T15:30:10.000Z");
  assert.equal(rejected.ready, false);
  assert.ok(rejected.blockers.includes("SELECTOR_PIPELINE_HAS_REJECTIONS"));

  const unsafe = engine.evaluate(readiness({ affectsTelegram: true as false }), pipeline(), "2026-09-03T15:30:10.000Z");
  assert.equal(unsafe.ready, false);
  assert.ok(unsafe.blockers.includes("READINESS_AUTHORITY_CONTRACT_VIOLATION"));
});

test("future exact-ready timestamp is rejected", () => {
  const engine = new H1ShadowMeaningfulChangePreviewEngine();
  const out = engine.evaluate(readiness({ newestExactReadyTimestamp: "2026-09-03T15:31:00.000Z" }), pipeline(), "2026-09-03T15:30:10.000Z");
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("FUTURE_EXACT_READY_TIMESTAMP"));
});
