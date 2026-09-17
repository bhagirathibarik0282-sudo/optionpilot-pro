import test from "node:test";
import assert from "node:assert/strict";
import {
  appendForwardOutcome,
  createBusinessForwardJournal,
  type BusinessForwardJournalRecord,
} from "../business-forward-journal-v1.js";
import type {
  BusinessForwardLiveOutcomeCollectorInput,
  BusinessForwardLiveOutcomeCollectorResult,
  LiveForwardWindow,
} from "../business-forward-live-outcome-collector-v1.js";
import type { H1GoldChaseLiveOutcomeBridgeResult } from "../h1-gold-chase-live-outcome-bridge-v1.js";
import type { H1GoldChasePersistenceResult } from "../h1-gold-chase-calibration-persistence-v1.js";
import type { H1GoldChaseResearchBootstrapResult } from "../h1-gold-chase-research-bootstrap-v1.js";
import {
  H1GoldChaseShadowRuntimeCollector,
  H1_GOLD_CHASE_SHADOW_RUNTIME_COLLECTOR_V1,
} from "../h1-gold-chase-shadow-runtime-collector-v1.js";

const T0 = Date.parse("2026-09-16T06:30:00.000Z");
const CANDIDATE = "NIFTY|2026-09-22|24000|CE";
const DECISION = "research-bootstrap|snapshot-1|candidate-1";

function journal(): BusinessForwardJournalRecord {
  const made = createBusinessForwardJournal({
    decisionId: DECISION,
    snapshotId: "snapshot-1",
    observedAtMs: T0,
    selectedCandidateKey: CANDIDATE,
    eligibleCandidates: [{
      candidateKey: CANDIDATE,
      symbol: "NIFTY",
      optionSide: "CE",
      strike: 24000,
      expiryDate: "2026-09-22",
      dte: 6,
      premiumLtp: 100,
    }],
    opportunityStage: "GOLDEN_SHADOW_CANDIDATE_RESEARCH_ONLY",
  });
  assert.equal(made.ready, true);
  return made.record!;
}

function bootstrap(): H1GoldChaseResearchBootstrapResult {
  return {
    version: "H1_GOLD_CHASE_RESEARCH_BOOTSTRAP_V1",
    state: "READY_FOR_FORWARD_COLLECTION",
    ready: true,
    candidateKey: CANDIDATE,
    decisionId: DECISION,
    observationInput: {} as H1GoldChaseResearchBootstrapResult["observationInput"],
    journal: journal(),
    strictGoldRequired: false,
    chasePolicyDefined: false,
    outcomeClassificationPolicyDefined: false,
    sampleSufficiencyPolicyDefined: false,
    productionImpact: "NONE",
    affectsGoldEligibility: false,
    affectsSelector: false,
    affectsTelegram: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    createsOrders: false,
    failClosed: true,
    businessUse: "GOLDEN_SHADOW_CANDIDATE_TO_EMPIRICAL_CHASE_CALIBRATION_ONLY",
    semantics: "EXISTING_GOLDEN_SHADOW_TRIGGER_TO_FROZEN_T0_FORWARD_JOURNAL_NO_NEW_THRESHOLD_NO_GOLD_AUTHORITY",
  } as H1GoldChaseResearchBootstrapResult;
}

function liveResult(input: BusinessForwardLiveOutcomeCollectorInput): BusinessForwardLiveOutcomeCollectorResult {
  const premiums: Record<LiveForwardWindow, number> = {
    T_PLUS_3M: 105,
    T_PLUS_6M: 110,
    T_PLUS_15M: 115,
    T_PLUS_30M: 120,
  };
  const nowMs = Date.parse(input.nowIso);
  const appended = appendForwardOutcome(input.journal, {
    window: input.window,
    observedAtMs: nowMs,
    premiumByCandidateKey: { [CANDIDATE]: premiums[input.window] },
  });
  assert.equal(appended.ready, true);
  return {
    version: "BUSINESS_FORWARD_LIVE_OUTCOME_COLLECTOR_V1",
    ready: true,
    window: input.window,
    expectedAtMs: nowMs,
    observedAtMs: nowMs,
    matchedCandidateCount: 1,
    record: appended.record,
    blockers: [],
    semantics: "READ_ONLY_EXACT_LIVE_FORWARD_OUTCOME_CAPTURE",
    affectsVerdict: false,
    affectsStars: false,
    affectsCandidateAuthority: false,
    affectsTelegram: false,
    affectsExecution: false,
    createsOrders: false,
    failClosed: true,
  };
}

function bridge(input: { liveOutcome: BusinessForwardLiveOutcomeCollectorResult }): H1GoldChaseLiveOutcomeBridgeResult {
  const record = input.liveOutcome.record!;
  const complete = record.outcomes.length === 4;
  return {
    version: "H1_GOLD_CHASE_LIVE_OUTCOME_BRIDGE_V1",
    state: complete ? "COMPLETE_SAMPLE" : "COLLECTING",
    journal: record,
    sample: null,
    blockers: [],
    completeSampleReady: complete,
    persistsData: false,
    schedulesSampling: false,
    infersWindowFromClock: false,
    thresholdPolicy: null,
    chaseLabel: null,
    productionImpact: "NONE",
    affectsGoldEligibility: false,
    affectsSelector: false,
    affectsTelegram: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    createsOrders: false,
    registersGoldFamily: false,
    failClosed: true,
    semantics: "VALIDATED_EXACT_LIVE_OUTCOME_TO_SHADOW_CHASE_SAMPLE_ONLY_NO_PERSISTENCE_NO_AUTHORITY",
  };
}

function persisted(state: H1GoldChasePersistenceResult["state"] = "PERSISTED"): H1GoldChasePersistenceResult {
  return {
    version: "H1_GOLD_CHASE_CALIBRATION_PERSISTENCE_V1",
    state,
    durable: state === "PERSISTED" || state === "EXACT_DUPLICATE",
    sampleKey: state === "PERSISTED" || state === "EXACT_DUPLICATE" ? "a".repeat(64) : null,
    payloadDigest: state === "PERSISTED" || state === "EXACT_DUPLICATE" ? "b".repeat(64) : null,
    sample: null,
    blockers: state === "DB_UNAVAILABLE" ? ["DURABLE_POSTGRES_REQUIRED"] : [],
    productionImpact: "NONE",
    affectsGoldEligibility: false,
    affectsSelector: false,
    affectsTelegram: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    createsOrders: false,
    thresholdPolicyDefined: false,
    classificationPolicyDefined: false,
    failClosed: true,
    semantics: "DURABLE_IMMUTABLE_COMPLETE_CHASE_CALIBRATION_SAMPLE_ONLY_EXACT_DUPLICATE_IDEMPOTENT_DIVERGENT_DUPLICATE_CONFLICT",
  };
}

function iso(ms: number): string { return new Date(ms).toISOString(); }

test("fixed 3m/6m/15m/30m shadow schedule reaches durable sample without production authority", async () => {
  const captured: LiveForwardWindow[] = [];
  const runtime = new H1GoldChaseShadowRuntimeCollector({
    collectOutcome: (input) => { captured.push(input.window); return liveResult(input); },
    bridge: bridge as any,
    persist: async () => persisted("PERSISTED"),
  });

  const registered = runtime.register(bootstrap());
  assert.equal(registered.state, "REGISTERED");
  assert.equal(runtime.activeSessionCount(), 1);

  const early = await runtime.tick(iso(T0 + 60_000));
  assert.equal(early.events[0]?.state, "WAITING_WINDOW");

  for (const minutes of [3, 6, 15]) {
    const tick = await runtime.tick(iso(T0 + minutes * 60_000));
    assert.equal(tick.events[0]?.state, "WINDOW_CAPTURED");
  }
  const finalTick = await runtime.tick(iso(T0 + 30 * 60_000));
  assert.equal(finalTick.events[0]?.state, "DURABLE_SAMPLE");
  assert.equal(finalTick.events[0]?.persistenceState, "PERSISTED");
  assert.equal(runtime.activeSessionCount(), 0);
  assert.deepEqual(captured, ["T_PLUS_3M", "T_PLUS_6M", "T_PLUS_15M", "T_PLUS_30M"]);
  assert.equal(finalTick.affectsGoldEligibility, false);
  assert.equal(finalTick.affectsSelector, false);
  assert.equal(finalTick.affectsTelegram, false);
  assert.equal(finalTick.affectsExecution, false);
  assert.equal(finalTick.grantsPromotionAuthority, false);
  assert.equal(finalTick.createsOrders, false);
});

test("temporary exact-live evidence gap retries inside bounded late window", async () => {
  let attempts = 0;
  const runtime = new H1GoldChaseShadowRuntimeCollector({
    collectOutcome: (input) => {
      attempts += 1;
      if (attempts === 1) {
        return {
          version: "BUSINESS_FORWARD_LIVE_OUTCOME_COLLECTOR_V1",
          ready: false,
          window: input.window,
          expectedAtMs: T0 + 3 * 60_000,
          observedAtMs: Date.parse(input.nowIso),
          matchedCandidateCount: 0,
          record: null,
          blockers: ["H1_LIVE_SELECTOR_REGISTRY_NOT_READY"],
          semantics: "READ_ONLY_EXACT_LIVE_FORWARD_OUTCOME_CAPTURE",
          affectsVerdict: false,
          affectsStars: false,
          affectsCandidateAuthority: false,
          affectsTelegram: false,
          affectsExecution: false,
          createsOrders: false,
          failClosed: true,
        };
      }
      return liveResult(input);
    },
    bridge: bridge as any,
    persist: async () => persisted(),
  });
  runtime.register(bootstrap());
  const first = await runtime.tick(iso(T0 + 3 * 60_000));
  assert.equal(first.events[0]?.state, "WAITING_EVIDENCE");
  assert.equal(runtime.activeSessionCount(), 1);
  const retry = await runtime.tick(iso(T0 + 3 * 60_000 + 30_000));
  assert.equal(retry.events[0]?.state, "WINDOW_CAPTURED");
  assert.equal(runtime.activeSessionCount(), 1);
});

test("missed bounded window drops the research session fail closed", async () => {
  const runtime = new H1GoldChaseShadowRuntimeCollector({
    collectOutcome: () => { throw new Error("collector must not run after window is already beyond bounded lateness"); },
    bridge: bridge as any,
    persist: async () => persisted(),
  });
  runtime.register(bootstrap());
  const tick = await runtime.tick(iso(T0 + 6 * 60_000));
  assert.equal(tick.events[0]?.state, "DROPPED_FAIL_CLOSED");
  assert.ok(tick.events[0]?.blockers.includes("FORWARD_WINDOW_MISSED"));
  assert.equal(runtime.activeSessionCount(), 0);
});

test("durable Postgres outage keeps a completed immutable sample pending for idempotent retry", async () => {
  let persistenceAttempt = 0;
  const runtime = new H1GoldChaseShadowRuntimeCollector({
    collectOutcome: liveResult,
    bridge: bridge as any,
    persist: async () => {
      persistenceAttempt += 1;
      return persistenceAttempt === 1 ? persisted("DB_UNAVAILABLE") : persisted("EXACT_DUPLICATE");
    },
  });
  runtime.register(bootstrap());
  for (const minutes of [3, 6, 15]) await runtime.tick(iso(T0 + minutes * 60_000));
  const pending = await runtime.tick(iso(T0 + 30 * 60_000));
  assert.equal(pending.events[0]?.state, "PERSIST_PENDING");
  assert.equal(runtime.activeSessionCount(), 1);
  const retried = await runtime.tick(iso(T0 + 31 * 60_000));
  assert.equal(retried.events[0]?.state, "DURABLE_SAMPLE");
  assert.equal(retried.events[0]?.persistenceState, "EXACT_DUPLICATE");
  assert.equal(runtime.activeSessionCount(), 0);
});

test("unsafe or incomplete bootstrap is rejected and never scheduled", () => {
  const input = bootstrap();
  input.affectsTelegram = true as false;
  const runtime = new H1GoldChaseShadowRuntimeCollector();
  const out = runtime.register(input);
  assert.equal(out.version, H1_GOLD_CHASE_SHADOW_RUNTIME_COLLECTOR_V1);
  assert.equal(out.state, "REJECTED");
  assert.ok(out.blockers.includes("UNSAFE_BOOTSTRAP_AUTHORITY"));
  assert.equal(runtime.activeSessionCount(), 0);
});
