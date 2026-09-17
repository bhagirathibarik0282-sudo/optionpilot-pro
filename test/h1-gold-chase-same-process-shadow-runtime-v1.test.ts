import assert from "node:assert/strict";
import test from "node:test";
import type { H1GoldChaseRuntimeAttachmentGateResult } from "../h1-gold-chase-runtime-attachment-gate-v1.js";
import type { H1GoldChaseResearchBootstrapResult } from "../h1-gold-chase-research-bootstrap-v1.js";
import {
  H1GoldChaseSameProcessShadowRuntime,
  H1_GOLD_CHASE_SAME_PROCESS_SHADOW_RUNTIME_V1,
} from "../h1-gold-chase-same-process-shadow-runtime-v1.js";

function gate(ready: boolean): H1GoldChaseRuntimeAttachmentGateResult {
  return {
    version: "H1_GOLD_CHASE_RUNTIME_ATTACHMENT_GATE_V1",
    state: ready ? "READY_FOR_SAME_PROCESS_SHADOW_ATTACHMENT" : "BLOCKED",
    ready,
    candidateKey: ready ? "NIFTY|2026-09-22|24000|CE" : null,
    decisionId: ready ? "decision-1" : null,
    blockers: ready ? [] : ["APPROVED_GOLD_LIVE_BRIDGE_NOT_READY"],
    requiresSameProcessRegistry: true,
    startsRuntime: false,
    schedulesSampling: false,
    persistsSamples: false,
    productionImpact: "NONE",
    affectsGoldEligibility: false,
    affectsSelector: false,
    affectsTelegram: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    createsOrders: false,
    failClosed: true,
    semantics: "PROVES_APPROVED_SAME_PROCESS_BOOTSTRAP_SOURCE_BEFORE_SHADOW_RUNTIME_ATTACHMENT",
  };
}

function bootstrap(): H1GoldChaseResearchBootstrapResult {
  return {
    version: "H1_GOLD_CHASE_RESEARCH_BOOTSTRAP_V1",
    state: "READY_FOR_FORWARD_COLLECTION",
    ready: true,
    candidateKey: "NIFTY|2026-09-22|24000|CE",
    decisionId: "decision-1",
  } as H1GoldChaseResearchBootstrapResult;
}

test("attaches only after the same-process gate is ready", () => {
  let registered = 0;
  let seenRegistry = "";
  let seenCollector = "";
  const runtime = new H1GoldChaseSameProcessShadowRuntime("h1-exact-shadow-live-service", {
    audit: (input) => {
      seenRegistry = input.registryProcessIdentity;
      seenCollector = input.collectorProcessIdentity;
      return gate(true);
    },
    collector: {
      register: () => {
        registered += 1;
        return {
          version: "H1_GOLD_CHASE_SHADOW_RUNTIME_COLLECTOR_V1",
          state: "REGISTERED",
          sessionKey: "decision-1|NIFTY|2026-09-22|24000|CE",
          candidateKey: "NIFTY|2026-09-22|24000|CE",
          decisionId: "decision-1",
          window: null,
          blockers: [],
          persistenceState: null,
          productionImpact: "NONE",
          affectsGoldEligibility: false,
          affectsSelector: false,
          affectsTelegram: false,
          affectsExecution: false,
          grantsPromotionAuthority: false,
          createsOrders: false,
          failClosed: true,
          semantics: "BOUNDED_SHADOW_FORWARD_SAMPLING_FIXED_WINDOWS_NO_THRESHOLD_NO_PRODUCTION_AUTHORITY",
        };
      },
      tick: async (nowIso) => ({
        version: "H1_GOLD_CHASE_SHADOW_RUNTIME_COLLECTOR_V1",
        observedAt: nowIso,
        activeSessionCount: 1,
        events: [],
        productionImpact: "NONE",
        affectsGoldEligibility: false,
        affectsSelector: false,
        affectsTelegram: false,
        affectsExecution: false,
        grantsPromotionAuthority: false,
        createsOrders: false,
        schedulesSampling: true,
        fixedWindowSequence: ["T_PLUS_3M", "T_PLUS_6M", "T_PLUS_15M", "T_PLUS_30M"],
        failClosed: true,
        semantics: "BOUNDED_SHADOW_FORWARD_SAMPLING_FIXED_WINDOWS_NO_THRESHOLD_NO_PRODUCTION_AUTHORITY",
      }),
      activeSessionCount: () => registered,
    },
  });

  const out = runtime.attach({
    packet: {} as never,
    canonicalRuntime: {} as never,
    goldBridge: {} as never,
    bootstrap: bootstrap(),
  });

  assert.equal(out.version, H1_GOLD_CHASE_SAME_PROCESS_SHADOW_RUNTIME_V1);
  assert.equal(out.state, "ATTACHED");
  assert.equal(out.ready, true);
  assert.equal(registered, 1);
  assert.equal(seenRegistry, "h1-exact-shadow-live-service");
  assert.equal(seenCollector, "h1-exact-shadow-live-service");
  assert.equal(out.affectsSelector, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
});

test("fail-closes without registering when attachment gate is blocked", () => {
  let registered = 0;
  const runtime = new H1GoldChaseSameProcessShadowRuntime("h1-exact-shadow-live-service", {
    audit: () => gate(false),
    collector: {
      register: () => {
        registered += 1;
        throw new Error("must not register");
      },
      tick: async (nowIso) => ({
        version: "H1_GOLD_CHASE_SHADOW_RUNTIME_COLLECTOR_V1",
        observedAt: nowIso,
        activeSessionCount: 0,
        events: [],
        productionImpact: "NONE",
        affectsGoldEligibility: false,
        affectsSelector: false,
        affectsTelegram: false,
        affectsExecution: false,
        grantsPromotionAuthority: false,
        createsOrders: false,
        schedulesSampling: true,
        fixedWindowSequence: ["T_PLUS_3M", "T_PLUS_6M", "T_PLUS_15M", "T_PLUS_30M"],
        failClosed: true,
        semantics: "BOUNDED_SHADOW_FORWARD_SAMPLING_FIXED_WINDOWS_NO_THRESHOLD_NO_PRODUCTION_AUTHORITY",
      }),
      activeSessionCount: () => registered,
    },
  });

  const out = runtime.attach({
    packet: null,
    canonicalRuntime: null,
    goldBridge: null,
    bootstrap: bootstrap(),
  });

  assert.equal(out.state, "BLOCKED");
  assert.equal(out.ready, false);
  assert.equal(registered, 0);
  assert.ok(out.blockers.includes("APPROVED_GOLD_LIVE_BRIDGE_NOT_READY"));
});

test("blank process identity is always blocked even if an injected audit says ready", () => {
  let registered = 0;
  const runtime = new H1GoldChaseSameProcessShadowRuntime("   ", {
    audit: () => gate(true),
    collector: {
      register: () => {
        registered += 1;
        throw new Error("must not register");
      },
      tick: async (nowIso) => ({
        version: "H1_GOLD_CHASE_SHADOW_RUNTIME_COLLECTOR_V1",
        observedAt: nowIso,
        activeSessionCount: 0,
        events: [],
        productionImpact: "NONE",
        affectsGoldEligibility: false,
        affectsSelector: false,
        affectsTelegram: false,
        affectsExecution: false,
        grantsPromotionAuthority: false,
        createsOrders: false,
        schedulesSampling: true,
        fixedWindowSequence: ["T_PLUS_3M", "T_PLUS_6M", "T_PLUS_15M", "T_PLUS_30M"],
        failClosed: true,
        semantics: "BOUNDED_SHADOW_FORWARD_SAMPLING_FIXED_WINDOWS_NO_THRESHOLD_NO_PRODUCTION_AUTHORITY",
      }),
      activeSessionCount: () => registered,
    },
  });

  const out = runtime.attach({
    packet: {} as never,
    canonicalRuntime: {} as never,
    goldBridge: {} as never,
    bootstrap: bootstrap(),
  });

  assert.equal(out.state, "BLOCKED");
  assert.equal(out.ready, false);
  assert.equal(registered, 0);
  assert.ok(out.blockers.includes("RUNTIME_PROCESS_IDENTITY_REQUIRED"));
});
