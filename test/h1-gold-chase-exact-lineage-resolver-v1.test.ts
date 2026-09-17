import assert from "node:assert/strict";
import test from "node:test";
import type { LiveGateEvidencePacket } from "../h1-live-gate-evidence-assembler.js";
import type { H1GoldChaseRuntimeAttachmentGateResult } from "../h1-gold-chase-runtime-attachment-gate-v1.js";
import {
  H1GoldChaseExactLineageResolver,
  H1_GOLD_CHASE_EXACT_LINEAGE_RESOLVER_V1,
  type H1GoldChaseExactLineagePublication,
} from "../h1-gold-chase-exact-lineage-resolver-v1.js";

const T = "2026-09-17T07:00:00.000Z";

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

function gate(ready: boolean): H1GoldChaseRuntimeAttachmentGateResult {
  return {
    version: "H1_GOLD_CHASE_RUNTIME_ATTACHMENT_GATE_V1",
    state: ready ? "READY_FOR_SAME_PROCESS_SHADOW_ATTACHMENT" : "BLOCKED",
    ready,
    candidateKey: ready ? "NIFTY|2026-09-22|24000|CE" : null,
    decisionId: ready ? "decision-1" : null,
    blockers: ready ? [] : ["CANONICAL_LIVE_RUNTIME_NOT_READY"],
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

function publication(value = packet()): H1GoldChaseExactLineagePublication {
  return {
    packet: value,
    canonicalRuntime: {} as never,
    goldBridge: {} as never,
    bootstrap: {} as never,
  };
}

test("publishes only gate-approved lineage and resolves the exact packet object once", () => {
  const source = packet();
  const store = new H1GoldChaseExactLineageResolver("same-process", () => gate(true));
  const published = store.publish(publication(source));
  assert.equal(published.version, H1_GOLD_CHASE_EXACT_LINEAGE_RESOLVER_V1);
  assert.equal(published.state, "PUBLISHED");
  assert.equal(published.productionImpact, "NONE");

  assert.equal(store.resolve({ packet: { ...source }, dualPath: {} as never, observedAt: T }), null);
  const resolved = store.resolve({ packet: source, dualPath: {} as never, observedAt: T });
  assert.equal(resolved?.packet, source);
  assert.equal(store.resolve({ packet: source, dualPath: {} as never, observedAt: T }), null);
});

test("blocked lineage is never made resolvable", () => {
  const source = packet();
  const store = new H1GoldChaseExactLineageResolver("same-process", () => gate(false));
  const published = store.publish(publication(source));
  assert.equal(published.state, "BLOCKED");
  assert.ok(published.blockers.includes("CANONICAL_LIVE_RUNTIME_NOT_READY"));
  assert.equal(store.resolve({ packet: source, dualPath: {} as never, observedAt: T }), null);
  assert.equal(published.affectsTelegram, false);
  assert.equal(published.affectsExecution, false);
  assert.equal(published.createsOrders, false);
});

test("blank process identity and duplicate publication fail closed", () => {
  const source = packet();
  const blank = new H1GoldChaseExactLineageResolver("   ", () => gate(true));
  const missingIdentity = blank.publish(publication(source));
  assert.equal(missingIdentity.state, "BLOCKED");
  assert.ok(missingIdentity.blockers.includes("RUNTIME_PROCESS_IDENTITY_REQUIRED"));

  const store = new H1GoldChaseExactLineageResolver("same-process", () => gate(true));
  assert.equal(store.publish(publication(source)).state, "PUBLISHED");
  const duplicate = store.publish(publication(source));
  assert.equal(duplicate.state, "BLOCKED");
  assert.ok(duplicate.blockers.includes("LINEAGE_ALREADY_PUBLISHED_FOR_PACKET"));
});

test("audit exceptions are contained", () => {
  const source = packet();
  const store = new H1GoldChaseExactLineageResolver("same-process", () => { throw new Error("audit failed"); });
  const out = store.publish(publication(source));
  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockers.includes("LINEAGE_ATTACHMENT_AUDIT_EXCEPTION"));
  assert.equal(store.resolve({ packet: source, dualPath: {} as never, observedAt: T }), null);
});
