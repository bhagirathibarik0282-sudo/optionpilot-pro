import assert from "node:assert/strict";
import test from "node:test";
import type { KiteH1ExactDualPathResult } from "../kite-h1-exact-dual-path-core.js";
import type { LiveGateEvidencePacket } from "../h1-live-gate-evidence-assembler.js";
import type { H1GoldChaseSameProcessAttachInput } from "../h1-gold-chase-same-process-shadow-runtime-v1.js";
import {
  H1GoldChaseExactServiceShadowHook,
  H1_GOLD_CHASE_EXACT_SERVICE_SHADOW_HOOK_V1,
} from "../h1-gold-chase-exact-service-shadow-hook-v1.js";

const T = "2026-09-17T06:15:00.000Z";

function packet(): LiveGateEvidencePacket {
  return {
    identity: {
      symbol: "NIFTY", side: "CE", strike: 24000, expiryDate: "2026-09-22", dte: 5,
      moneyness: "ATM", premiumLtp: 110, observedAt: T,
      source: "H1_LIVE_EXACT_SNAPSHOT_AGGREGATOR_V1", provenance: "LIVE_RUNTIME_EXACT",
    },
    gates: {},
  };
}

function dualPath(value = packet()): KiteH1ExactDualPathResult {
  return {
    version: "KITE_H1_EXACT_DUAL_PATH_CORE_V1",
    instrumentToken: 1,
    processed: true,
    exactReady: true,
    immediate: null,
    exact: {
      version: "H1_KITE_EXACT_RUNTIME_COORDINATOR_V1",
      ready: true,
      instrumentToken: 1,
      action: "OPTION_EVALUATED",
      bridge: {
        version: "H1_KITE_EXACT_SELECTOR_PUBLISHER_BRIDGE_V1",
        ready: true,
        snapshot: {} as never,
        publisher: {
          version: "H1_LIVE_SNAPSHOT_PUBLISHER_BINDING_V1",
          ready: true,
          producer: {
            version: "H1_LIVE_PUBLISHER_PACKET_PRODUCER_V1",
            ready: true,
            packet: value,
            blockers: [],
            failClosed: true,
            semantics: "RAW_LIVE_EXACT_INPUTS_BOUND_TO_ONE_CONTRACT_NO_RESULT_REUSE",
          },
          blockers: [],
          failClosed: true,
          semantics: "READY_EXACT_BUNDLES_ONLY_NO_INFERENCE",
        },
        publication: { accepted: true, reason: "LIVE_EVIDENCE_ACCEPTED" },
        blockers: [],
        failClosed: true,
        semantics: "FORWARD_SAME_CONTRACT_EXACT_SNAPSHOTS_TO_SELECTOR_REGISTRY",
      },
      blocker: null,
      productionImpact: "NONE",
      failClosed: true,
    },
    blockers: [],
    productionImpact: "NONE",
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
    failClosed: true,
  };
}

function attachInput(value: LiveGateEvidencePacket): H1GoldChaseSameProcessAttachInput {
  return { packet: value, canonicalRuntime: {} as never, goldBridge: {} as never, bootstrap: {} as never };
}

function runtime() {
  let attached = 0;
  let ticked = 0;
  return {
    counts: () => ({ attached, ticked }),
    value: {
      attach: () => {
        attached += 1;
        return {
          version: "H1_GOLD_CHASE_SAME_PROCESS_SHADOW_RUNTIME_V1",
          state: "ATTACHED", ready: true, gate: {} as never, registration: {} as never, blockers: [],
          productionImpact: "NONE", affectsGoldEligibility: false, affectsSelector: false,
          affectsTelegram: false, affectsExecution: false, grantsPromotionAuthority: false,
          createsOrders: false, failClosed: true,
          semantics: "SAME_PROCESS_GOLD_CHASE_SHADOW_ATTACHMENT_ONLY_NO_PRODUCTION_AUTHORITY",
        } as const;
      },
      tick: async (observedAt: string) => {
        ticked += 1;
        return {
          version: "H1_GOLD_CHASE_SHADOW_RUNTIME_COLLECTOR_V1",
          observedAt, activeSessionCount: 1, events: [],
          productionImpact: "NONE", affectsGoldEligibility: false, affectsSelector: false,
          affectsTelegram: false, affectsExecution: false, grantsPromotionAuthority: false,
          createsOrders: false, schedulesSampling: true,
          fixedWindowSequence: ["T_PLUS_3M", "T_PLUS_6M", "T_PLUS_15M", "T_PLUS_30M"],
          failClosed: true,
          semantics: "BOUNDED_SHADOW_FORWARD_SAMPLING_FIXED_WINDOWS_NO_THRESHOLD_NO_PRODUCTION_AUTHORITY",
        } as const;
      },
      activeSessionCount: () => 1,
    },
  };
}

test("default-off hook is inert and cannot invoke a resolver or runtime", async () => {
  const fake = runtime();
  let resolved = 0;
  const hook = new H1GoldChaseExactServiceShadowHook({
    enabled: false,
    runtime: fake.value,
    resolver: () => { resolved += 1; return null; },
  });
  const out = await hook.observe(dualPath(), T);
  assert.equal(out.version, H1_GOLD_CHASE_EXACT_SERVICE_SHADOW_HOOK_V1);
  assert.equal(out.state, "DISABLED");
  assert.equal(resolved, 0);
  assert.deepEqual(fake.counts(), { attached: 0, ticked: 0 });
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
});

test("enabled hook fails closed without a verified Gold lineage resolver", async () => {
  const fake = runtime();
  const hook = new H1GoldChaseExactServiceShadowHook({ enabled: true, runtime: fake.value });
  const out = await hook.observe(dualPath(), T);
  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockers.includes("VERIFIED_GOLD_LINEAGE_RESOLVER_REQUIRED"));
  assert.deepEqual(fake.counts(), { attached: 0, ticked: 0 });
});

test("enabled hook rejects anything except the exact packet object from the same ingest", async () => {
  const fake = runtime();
  const hook = new H1GoldChaseExactServiceShadowHook({
    enabled: true,
    runtime: fake.value,
    resolver: ({ packet: exact }) => attachInput({ ...exact }),
  });
  const out = await hook.observe(dualPath(), T);
  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockers.includes("RESOLVER_PACKET_NOT_SAME_INGEST_OBJECT"));
  assert.deepEqual(fake.counts(), { attached: 0, ticked: 0 });
});

test("verified same-ingest lineage is the only path that can attach and tick", async () => {
  const fake = runtime();
  let seen: LiveGateEvidencePacket | null = null;
  const hook = new H1GoldChaseExactServiceShadowHook({
    enabled: true,
    runtime: fake.value,
    resolver: ({ packet: exact }) => { seen = exact; return attachInput(exact); },
  });
  const source = packet();
  const out = await hook.observe(dualPath(source), T);
  assert.equal(seen, source);
  assert.equal(out.state, "ATTACHED_AND_TICKED");
  assert.equal(out.candidateKey, "NIFTY|2026-09-22|24000|CE");
  assert.equal(out.activeSessionCount, 1);
  assert.deepEqual(fake.counts(), { attached: 1, ticked: 1 });
  assert.equal(out.ownsTimer, false);
  assert.equal(out.productionImpact, "NONE");
  assert.equal(out.affectsSelector, false);
  assert.equal(out.grantsPromotionAuthority, false);
});
