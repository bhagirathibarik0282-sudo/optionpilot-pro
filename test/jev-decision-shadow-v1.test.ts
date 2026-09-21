import test from "node:test";
import assert from "node:assert/strict";
import {
  buildJevDecisionShadowPlan,
  buildJevDecisionShadowSampleFromLivePacket,
  callJevDecisionShadow,
  JEV_DECISIONS_ENDPOINT,
  JEV_PINNED_MODEL,
} from "../jev-decision-shadow-v1.js";
import type { LiveGateEvidencePacket, LiveGateName } from "../h1-live-gate-evidence-assembler.js";

const ts = "2026-09-21T10:00:00.000Z";

function packet(overrides: Partial<LiveGateEvidencePacket> = {}): LiveGateEvidencePacket {
  const gate = (value: boolean, source: string) => ({
    value,
    observedAt: ts,
    source,
    provenance: "LIVE_RUNTIME_EXACT" as const,
  });
  const gates: Record<LiveGateName, ReturnType<typeof gate>> = {
    capitalFit: gate(true, "capital"),
    liquidityOk: gate(true, "liquidity"),
    spreadOk: gate(true, "spread"),
    premiumResponseConfirmed: gate(true, "premium-response"),
    deltaGammaResponseConfirmed: gate(true, "delta-gamma"),
    thetaIvBurdenAcceptable: gate(true, "theta-iv"),
    multiExpiryConflictAbsent: gate(true, "multi-expiry"),
    currentOrNearExpiryUsable: gate(true, "near-expiry"),
    higherDteUsable: gate(false, "higher-dte"),
    fallbackDteApproved: gate(false, "fallback"),
  };

  return {
    identity: {
      symbol: "NIFTY",
      side: "CE",
      strike: 23400,
      expiryDate: "2026-09-22",
      dte: 1,
      moneyness: "ATM",
      premiumLtp: 120,
      observedAt: ts,
      source: "KITE_H1_EXACT",
      provenance: "LIVE_RUNTIME_EXACT",
    },
    gates,
    responseMetrics: {
      premiumMovePct: 3.2,
      absoluteDeltaChange: 0.03,
      currentGamma: 0.0012,
      observedAt: ts,
      source: "KITE_H1_EXACT",
      provenance: "LIVE_RUNTIME_EXACT",
    },
    capitalLiquidityEvidence: {
      dte: 1,
      premiumLtp: 120,
      lotQuantity: 65,
      bid: 119.5,
      ask: 120.5,
      bidQty: 130,
      askQty: 130,
      capitalRequired: 7832.5,
      relativeSpreadPct: 0.83,
      bidDepthCoverageMultiple: 2,
      askDepthCoverageMultiple: 2,
      occurredAt: ts,
      receivedAt: ts,
      provenance: "LIVE_RUNTIME_EXACT",
      thresholdAuthority: "NONE",
      observationalOnly: true,
    },
    policyDiagnostics: {
      premiumDeltaGamma: {
        minPremiumMovePct: 2,
        premiumMovePct: 3.2,
        premiumPass: true,
        minAbsoluteDeltaChange: 0.02,
        absoluteDeltaChange: 0.03,
        deltaPass: true,
        minCurrentGamma: 0.001,
        currentGamma: 0.0012,
        gammaPass: true,
        deltaGammaPass: true,
        reasonCodes: [],
      },
      thetaIv: {
        theta: -5,
        iv: 14,
        premiumLtp: 120,
        thetaPctOfPremium: -4.17,
        maxAbsThetaPctOfPremium: 8,
        thetaPass: true,
        minIv: 8,
        maxIv: 35,
        ivPass: true,
        thetaIvPass: true,
        reasonCodes: [],
      },
      observedAt: ts,
      provenance: "LIVE_RUNTIME_EXACT",
    },
    ...overrides,
  };
}

function readySample(sampleId = "nifty-001") {
  const made = buildJevDecisionShadowSampleFromLivePacket(sampleId, packet());
  assert.deepEqual(made.blockers, []);
  assert.ok(made.sample);
  return made.sample!;
}

test("rebuilds Jev sample from exact live gate packet at its own decision timestamp", () => {
  const made = buildJevDecisionShadowSampleFromLivePacket("nifty-001", packet());
  assert.deepEqual(made.blockers, []);
  assert.ok(made.sample);
  assert.equal(made.sample!.candidate.side, "CE");
  assert.equal(made.sample!.candidate.premiumResponseConfirmed, true);
  assert.equal(made.sample!.baselineSelector.version, "EXECUTION_CANDIDATE_SELECTOR_V2");
  assert.equal(made.sample!.baselineSelector.decision, "SELECT");
  assert.equal(made.sample!.baselineSelector.candidateKey, "NIFTY:CE:23400:2026-09-22:DTE1:ATM");
});

test("builds pinned Jev request without leaking baseline selector decision into Jev state", () => {
  const plan = buildJevDecisionShadowPlan([readySample()]);

  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.request.model, JEV_PINNED_MODEL);
  assert.equal(plan.sourcePolicy, "PERSISTED_OR_LIVE_H1_EXACT_GATE_PACKET_ONLY");
  assert.equal(plan.semantics, "RESEARCH_SHADOW_ONLY");
  assert.equal(plan.affectsVerdict, false);
  assert.equal(plan.affectsCandidate, false);
  assert.equal(plan.affectsTelegram, false);
  assert.equal(plan.affectsExecution, false);
  assert.equal(plan.createsOrders, false);
  assert.equal(plan.aiMayOverride, false);
  assert.equal(plan.futureOutcomeIncluded, false);

  const record = JSON.parse(plan.request.state.records[0].record);
  assert.equal(record.candidate.side, "CE");
  assert.equal(record.evidencePacket.identity.provenance, "LIVE_RUNTIME_EXACT");
  assert.equal(record.constraints.futureOutcomeHidden, true);
  assert.equal(record.constraints.baselineSelectorHiddenFromJev, true);
  assert.equal("baselineSelector" in record, false);
  assert.equal(JSON.stringify(record).includes("EXECUTION_CANDIDATE_SELECTED"), false);
  assert.equal(plan.baseline[0].selectorDecision, "SELECT");
});

test("fails closed when a gate timestamp is from the future relative to the decision anchor", () => {
  const p = packet();
  p.gates.liquidityOk = {
    ...p.gates.liquidityOk!,
    observedAt: "2026-09-21T10:00:01.000Z",
  };
  const made = buildJevDecisionShadowSampleFromLivePacket("nifty-future", p);
  assert.equal(made.sample, null);
  assert.ok(made.blockers.some((x) => x.includes("STALE_OR_INVALID_TIMESTAMP_liquidityOk")));
});

test("fails closed on invalid sample ids before question-key collisions are possible", () => {
  const bad = buildJevDecisionShadowSampleFromLivePacket("nifty 001", packet());
  assert.equal(bad.sample, null);
  assert.ok(bad.blockers.includes("JEV_SAMPLE_ID_INVALID"));
});

test("fails closed on duplicate ids or tampered baseline selector", () => {
  const one = readySample("same");
  const two = readySample("same");
  two.baselineSelector = { ...two.baselineSelector, decision: "BLOCK", candidateKey: null, reasonCodes: ["TAMPERED"] };
  const plan = buildJevDecisionShadowPlan([one, two]);
  assert.ok(plan.blockers.some((x) => x.startsWith("JEV_DUPLICATE_SAMPLE_ID")));
  assert.ok(plan.blockers.some((x) => x.startsWith("JEV_BASELINE_SELECTOR_NOT_EXACT_REEVALUATION")));
  assert.equal(plan.request.state.records.length, 0);
});

test("caps Jev batch at 20 exact decision-time samples", () => {
  const samples = Array.from({ length: 21 }, (_, i) => readySample(`s-${i}`));
  const plan = buildJevDecisionShadowPlan(samples);
  assert.ok(plan.blockers.includes("JEV_BATCH_EXCEEDS_20"));
  assert.equal(plan.request.state.records.length, 0);
});

test("posts only to OpenRouter Decisions API with bearer auth", async () => {
  const plan = buildJevDecisionShadowPlan([readySample()]);
  let seenUrl = "";
  let seenInit: RequestInit | undefined;

  const fakeFetch: typeof fetch = async (input, init) => {
    seenUrl = String(input);
    seenInit = init;
    return new Response(JSON.stringify({
      answers: {
        "nifty-001__action": { choice: { TAKE_CANDIDATE: 0.8, NO_TRADE: 0.2 } },
      },
      model: "typesafe/jev-1.13",
      usage: { input_tokens: 100, output_tokens: 0, cost: 0.0000042 },
      id: "decision-test",
      provider: "typesafe",
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const out = await callJevDecisionShadow(plan, "secret-key", fakeFetch);
  assert.equal(seenUrl, JEV_DECISIONS_ENDPOINT);
  assert.equal((seenInit?.headers as Record<string, string>).authorization, "Bearer secret-key");
  const body = JSON.parse(String(seenInit?.body));
  assert.equal(body.model, "typesafe/jev-1.13");
  assert.equal(body.state.records.length, 1);
  assert.ok(body.questions["nifty-001__action"]);
  assert.equal(out.model, "typesafe/jev-1.13");
});

test("does not call Jev when plan is blocked or API key is absent", async () => {
  const blocked = buildJevDecisionShadowPlan([]);
  await assert.rejects(() => callJevDecisionShadow(blocked, "key"), /JEV_SHADOW_PLAN_BLOCKED/);

  const ready = buildJevDecisionShadowPlan([readySample()]);
  await assert.rejects(() => callJevDecisionShadow(ready, ""), /OPENROUTER_API_KEY_REQUIRED/);
});
