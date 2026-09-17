import assert from "node:assert/strict";
import test from "node:test";
import type { LiveGateEvidencePacket } from "../h1-live-gate-evidence-assembler.js";
import { H1GoldCanonicalApprovedProducer } from "../h1-gold-canonical-approved-producer-v1.js";

const observedAt = "2026-09-18T03:50:00.000Z";
const packet = {
  identity: { symbol: "NIFTY", side: "CE", strike: 25000, expiryDate: "2026-09-22", dte: 4, moneyness: "ATM", premiumLtp: 100, observedAt, provenance: "LIVE_RUNTIME_EXACT", source: "exact" },
} as LiveGateEvidencePacket;
const dualPath = { version: "KITE_H1_EXACT_DUAL_PATH_CORE_V1" } as any;

function facts() {
  const snapshot = { symbol: "NIFTY", asOfMs: Date.parse(observedAt), snapshotId: "snap" } as any;
  return {
    canonicalSnapshot: snapshot,
    coreFamilySignals: [], directionSource: {}, peerDirectionSources: [], sevenFamilyFacts: {}, sevenFamilyPolicy: {},
    sourceManifestHash: "manifest", missionInput: { source: { snapshot }, nowMs: snapshot.asOfMs }, premiumPoints: [],
  } as any;
}

function deps(overrides: Record<string, unknown> = {}) {
  return {
    runtimeBuilder: () => ({ ready: true, blockers: [], producer: {}, missionChain: { mission: { candidateKey: "NIFTY:CE:25000" } } }),
    goldBuilder: () => ({ ready: true, blockers: [] }),
    peerBuilder: () => ({ ready: true, blockers: [] }),
    horizonBuilder: async () => ({ ready: true, blockers: [] }),
    ...overrides,
  } as any;
}

test("missing live canonical facts stay blocked", async () => {
  const producer = new H1GoldCanonicalApprovedProducer(() => null, deps());
  assert.equal(await producer.produce({ packet, dualPath, observedAt }), null);
  assert.deepEqual(producer.latestStatus().blockers, ["LIVE_CANONICAL_FACTS_NOT_READY"]);
});

test("canonical snapshot must be the exact packet timestamp and mission source object", async () => {
  const value = facts();
  value.canonicalSnapshot.asOfMs += 1;
  const producer = new H1GoldCanonicalApprovedProducer(() => value, deps());
  assert.equal(await producer.produce({ packet, dualPath, observedAt }), null);
  assert.ok(producer.latestStatus().blockers.includes("CANONICAL_FACTS_PACKET_IDENTITY_OR_TIMESTAMP_MISMATCH"));
});

test("runs only approved builders and returns the original packet object", async () => {
  const producer = new H1GoldCanonicalApprovedProducer(() => facts(), deps());
  const out = await producer.produce({ packet, dualPath, observedAt });
  assert.ok(out);
  assert.equal(out?.packet, packet);
  assert.equal(producer.latestStatus().state, "READY");
  assert.equal(producer.latestStatus().candidateKey, "NIFTY:CE:25000");
  assert.equal(producer.latestStatus().affectsTelegram, false);
  assert.equal(producer.latestStatus().affectsExecution, false);
  assert.equal(producer.latestStatus().createsOrders, false);
});

test("any blocked approved builder prevents producer output", async () => {
  const producer = new H1GoldCanonicalApprovedProducer(() => facts(), deps({
    peerBuilder: () => ({ ready: false, blockers: ["BANKNIFTY:PEER_DIRECTION_MISSING"] }),
  }));
  assert.equal(await producer.produce({ packet, dualPath, observedAt }), null);
  assert.ok(producer.latestStatus().blockers.includes("PEER_CONFLICT_PRODUCER_NOT_READY"));
  assert.ok(producer.latestStatus().blockers.includes("BANKNIFTY:PEER_DIRECTION_MISSING"));
});

test("builder exceptions are contained without fabricating output", async () => {
  const producer = new H1GoldCanonicalApprovedProducer(() => facts(), deps({ runtimeBuilder: () => { throw new Error("boom"); } }));
  assert.equal(await producer.produce({ packet, dualPath, observedAt }), null);
  assert.deepEqual(producer.latestStatus().blockers, ["APPROVED_CANONICAL_BUILDER_EXCEPTION"]);
});
