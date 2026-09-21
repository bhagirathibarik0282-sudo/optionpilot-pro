import test from "node:test";
import assert from "node:assert/strict";
import {
  buildJevDecisionShadowPlan,
  callJevDecisionShadow,
  JEV_DECISIONS_ENDPOINT,
  JEV_PINNED_MODEL,
} from "../jev-decision-shadow-v1.js";

function envelope(symbol: "NIFTY" | "SENSEX" | "BANKNIFTY" = "NIFTY"): any {
  return {
    symbol,
    generatedAt: "2026-09-21T10:00:00.000Z",
    institutionalContext: { contextOnly: true },
    temporal: {
      clue3m: { symbol, timeframe: "3M", state: "CONFIRMED" },
      confirm6m: { symbol, timeframe: "6M", state: "CONFIRMED" },
      validate15m: { symbol, timeframe: "15M", state: "CONFIRMED" },
      sustain30m: { symbol, timeframe: "30M", state: "CONFIRMED" },
    },
    combinations: { symbol },
    evidenceFresh: true,
    blockers: [],
    ruleVersion: "CANONICAL_EVIDENCE_ENVELOPE_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
    aiMayOverride: false,
  };
}

function candidate(): any {
  return {
    symbol: "NIFTY",
    side: "CE",
    strike: 23400,
    expiryDate: "2026-09-22",
    dte: 1,
    moneyness: "ATM",
    premiumLtp: 120,
    capitalFit: true,
    liquidityOk: true,
    spreadOk: true,
    premiumResponseConfirmed: true,
    deltaGammaResponseConfirmed: true,
    thetaIvBurdenAcceptable: true,
    multiExpiryConflictAbsent: true,
    currentOrNearExpiryUsable: true,
    higherDteUsable: false,
  };
}

function selector(): any {
  return {
    version: "EXECUTION_CANDIDATE_SELECTOR_V2",
    decision: "SELECT",
    reasonCodes: ["EXECUTION_CANDIDATE_SELECTED"],
    candidateKey: "NIFTY:CE:23400:2026-09-22:DTE1:ATM",
    dteBucket: "EXPIRY_0_1",
    premiumLtp: 120,
    failClosed: true,
  };
}

test("builds a pinned Jev research-shadow request without leaking selector decision into Jev state", () => {
  const plan = buildJevDecisionShadowPlan([
    { sampleId: "nifty-001", candidate: candidate(), envelope: envelope(), baselineSelector: selector() },
  ]);

  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.request.model, JEV_PINNED_MODEL);
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
  assert.equal(record.constraints.futureOutcomeHidden, true);
  assert.equal("baselineSelector" in record, false);
  assert.equal(JSON.stringify(record).includes("EXECUTION_CANDIDATE_SELECTED"), false);
  assert.equal(plan.baseline[0].selectorDecision, "SELECT");
});

test("fails closed on duplicate ids, symbol mismatch, or authority-boundary tampering", () => {
  const badEnvelope = envelope("SENSEX");
  badEnvelope.affectsVerdict = true;
  const plan = buildJevDecisionShadowPlan([
    { sampleId: "same", candidate: candidate(), envelope: badEnvelope, baselineSelector: selector() },
    { sampleId: "same", candidate: candidate(), envelope: envelope(), baselineSelector: selector() },
  ]);

  assert.ok(plan.blockers.some((x) => x.startsWith("JEV_DUPLICATE_SAMPLE_ID")));
  assert.ok(plan.blockers.some((x) => x.startsWith("JEV_SYMBOL_MISMATCH")));
  assert.ok(plan.blockers.some((x) => x.startsWith("JEV_ENVELOPE_AUTHORITY_BOUNDARY_INVALID")));
  assert.equal(plan.request.state.records.length, 0);
});

test("caps Jev batch at 20 decision-time samples", () => {
  const samples = Array.from({ length: 21 }, (_, i) => ({
    sampleId: `s-${i}`,
    candidate: candidate(),
    envelope: envelope(),
    baselineSelector: selector(),
  }));
  const plan = buildJevDecisionShadowPlan(samples);
  assert.ok(plan.blockers.includes("JEV_BATCH_EXCEEDS_20"));
  assert.equal(plan.request.state.records.length, 0);
});

test("posts only to OpenRouter Decisions API with bearer auth", async () => {
  const plan = buildJevDecisionShadowPlan([
    { sampleId: "nifty-001", candidate: candidate(), envelope: envelope(), baselineSelector: selector() },
  ]);
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

  const ready = buildJevDecisionShadowPlan([
    { sampleId: "nifty-001", candidate: candidate(), envelope: envelope(), baselineSelector: selector() },
  ]);
  await assert.rejects(() => callJevDecisionShadow(ready, ""), /OPENROUTER_API_KEY_REQUIRED/);
});
