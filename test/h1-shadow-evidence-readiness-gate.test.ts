import assert from "node:assert/strict";
import test from "node:test";
import { evaluateH1ShadowEvidenceReadiness } from "../h1-shadow-evidence-readiness-gate.js";
import type { KiteH1ExactShadowPacketBridgeStatus } from "../kite-h1-exact-shadow-packet-bridge.js";
import type { KiteH1ExactShadowSupervisorStatus } from "../kite-h1-exact-shadow-supervisor.js";

const policy = {
  minProcessedPackets: 100,
  minExactReadyPackets: 20,
  maxRejectRatio: 0.1,
  maxRuntimeExceptions: 0,
  maxEvidenceAgeMs: 60_000,
};

function bridge(overrides: Partial<KiteH1ExactShadowPacketBridgeStatus> = {}): KiteH1ExactShadowPacketBridgeStatus {
  return {
    version: "KITE_H1_EXACT_SHADOW_PACKET_BRIDGE_V1",
    packetCount: 120,
    exactReadyCount: 30,
    rejectedCount: 5,
    lastPacketTimestamp: "2026-09-03T15:30:00.000Z",
    lastExactReadyTimestamp: "2026-09-03T15:30:00.000Z",
    productionImpact: "NONE",
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
    opensTransport: false,
    failClosed: true,
    ...overrides,
  };
}

function supervisor(overrides: Partial<KiteH1ExactShadowSupervisorStatus> = {}): KiteH1ExactShadowSupervisorStatus {
  return {
    version: "KITE_H1_EXACT_SHADOW_SUPERVISOR_V1",
    enabled: true,
    connected: true,
    state: "OPEN",
    subscribedTokenCount: 10,
    lastPacketTimestamp: "2026-09-03T15:30:00.000Z",
    lastExactReadyTimestamp: "2026-09-03T15:30:00.000Z",
    processedPacketCount: 120,
    dualPathBlockedCount: 5,
    runtimeExceptionCount: 0,
    reconnectCount: 0,
    productionImpact: "NONE",
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
    ...overrides,
  };
}

test("passes only sufficient fresh shadow evidence while granting no authority", () => {
  const out = evaluateH1ShadowEvidenceReadiness(bridge(), supervisor(), "2026-09-03T15:30:30.000Z", policy);
  assert.equal(out.readyForNextShadowStage, true);
  assert.deepEqual(out.blockers, []);
  assert.equal(out.grantsPromotionAuthority, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsVerdict, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.productionImpact, "NONE");
});

test("fails closed when exact-ready evidence count is insufficient", () => {
  const out = evaluateH1ShadowEvidenceReadiness(bridge({ exactReadyCount: 19 }), supervisor(), "2026-09-03T15:30:30.000Z", policy);
  assert.equal(out.readyForNextShadowStage, false);
  assert.ok(out.blockers.includes("INSUFFICIENT_EXACT_READY_SHADOW_PACKETS"));
});

test("fails closed on stale or future exact evidence", () => {
  const stale = evaluateH1ShadowEvidenceReadiness(
    bridge({ lastExactReadyTimestamp: "2026-09-03T15:28:00.000Z" }),
    supervisor({ lastExactReadyTimestamp: "2026-09-03T15:28:00.000Z" }),
    "2026-09-03T15:30:30.000Z",
    policy,
  );
  assert.ok(stale.blockers.includes("STALE_SHADOW_EVIDENCE"));

  const future = evaluateH1ShadowEvidenceReadiness(
    bridge({ lastExactReadyTimestamp: "2026-09-03T15:31:00.000Z" }),
    supervisor({ lastExactReadyTimestamp: null }),
    "2026-09-03T15:30:30.000Z",
    policy,
  );
  assert.ok(future.blockers.includes("FUTURE_SHADOW_EVIDENCE"));
});

test("fails closed on reject ratio or runtime exceptions", () => {
  const rejected = evaluateH1ShadowEvidenceReadiness(bridge({ rejectedCount: 20 }), supervisor({ dualPathBlockedCount: 20 }), "2026-09-03T15:30:30.000Z", policy);
  assert.ok(rejected.blockers.includes("SHADOW_REJECT_RATIO_TOO_HIGH"));

  const runtime = evaluateH1ShadowEvidenceReadiness(bridge(), supervisor({ runtimeExceptionCount: 1 }), "2026-09-03T15:30:30.000Z", policy);
  assert.ok(runtime.blockers.includes("SHADOW_RUNTIME_EXCEPTIONS_TOO_HIGH"));
});

test("fails closed on missing status or authority contract violation", () => {
  const missing = evaluateH1ShadowEvidenceReadiness(null, null, "2026-09-03T15:30:30.000Z", policy);
  assert.equal(missing.readyForNextShadowStage, false);
  assert.ok(missing.blockers.includes("MISSING_SHADOW_EVIDENCE_STATUS"));

  const unsafeBridge = bridge({ affectsTelegram: true as false });
  const unsafe = evaluateH1ShadowEvidenceReadiness(unsafeBridge, supervisor(), "2026-09-03T15:30:30.000Z", policy);
  assert.ok(unsafe.blockers.includes("BRIDGE_AUTHORITY_CONTRACT_VIOLATION"));
});
