import assert from "node:assert/strict";
import test from "node:test";
import { adaptH1ExactCoreFamilySignals, type H1ExactCoreFamilySignalInput } from "../h1-exact-core-family-signal-adapter.js";
import type { LiveGateEvidencePacket, LiveGateName } from "../h1-live-gate-evidence-assembler.js";
import { CanonicalLiveFamilySignalRegistry } from "../canonical-live-family-signal-registry.js";

const now = Date.parse("2026-09-14T10:00:00.000Z");
const observedAt = "2026-09-14T09:59:30.000Z";
const manifest = "manifest-exact-1";

function packet(): LiveGateEvidencePacket {
  const names: LiveGateName[] = [
    "capitalFit", "liquidityOk", "spreadOk", "premiumResponseConfirmed",
    "deltaGammaResponseConfirmed", "thetaIvBurdenAcceptable",
    "multiExpiryConflictAbsent", "currentOrNearExpiryUsable",
  ];
  return {
    identity: {
      symbol: "NIFTY", side: "CE", strike: 23400, expiryDate: "2026-09-15",
      dte: 1, moneyness: "ATM", premiumLtp: 125, observedAt,
      source: "H1_EXACT_IDENTITY", provenance: "LIVE_RUNTIME_EXACT",
    },
    gates: Object.fromEntries(names.map((name) => [name, {
      value: true, observedAt, source: `exact-${name}`, provenance: "LIVE_RUNTIME_EXACT",
    }])) as LiveGateEvidencePacket["gates"],
  };
}

function signals(): H1ExactCoreFamilySignalInput[] {
  return ([
    ["OPTION_PREMIUMS", 63],
    ["MULTI_DTE", 47],
    ["LIQUIDITY_EXECUTABILITY", 81],
  ] as const).map(([family, strength]) => ({
    family,
    stance: "BUYER_SUPPORT",
    strength,
    deterministic: true,
    evidenceReady: true,
    sourceId: `deterministic-${family}`,
    sourceManifestHash: manifest,
    sourceSemantics: "EXPLICIT_DIRECTIONAL_SUPPORT",
    grantsDirectionalSupport: true,
    devilFlags: [],
  }));
}

test("attests three exact H1 core families without inventing strength", () => {
  const out = adaptH1ExactCoreFamilySignals({
    packet: packet(), familySignals: signals(), sourceManifestHash: manifest, nowMs: now,
  });
  assert.equal(out.ready, true);
  assert.equal(out.inferredStrengthsUsed, false);
  assert.deepEqual(out.envelopes.map((row) => row.signal.strength), [63, 47, 81]);
  assert.ok(out.envelopes.every((row) => row.symbol === "NIFTY"));
  const registry = new CanonicalLiveFamilySignalRegistry();
  assert.ok(out.envelopes.every((row) => registry.publish(row).accepted));
});

test("one false exact gate blocks the whole attestation", () => {
  const exact = packet();
  exact.gates.spreadOk!.value = false;
  const out = adaptH1ExactCoreFamilySignals({
    packet: exact, familySignals: signals(), sourceManifestHash: manifest, nowMs: now,
  });
  assert.equal(out.ready, false);
  assert.deepEqual(out.envelopes, []);
  assert.ok(out.blockers.includes("LIQUIDITY_EXECUTABILITY:spreadOk:EXACT_GATE_NOT_ATTESTABLE"));
});

test("stale evidence, manifest mismatch and seller relabelling fail closed", () => {
  const stale = adaptH1ExactCoreFamilySignals({
    packet: packet(), familySignals: signals(), sourceManifestHash: manifest,
    nowMs: now + 120_000,
  });
  assert.equal(stale.ready, false);
  assert.deepEqual(stale.envelopes, []);

  const mismatched = signals();
  mismatched[0] = { ...mismatched[0], sourceManifestHash: "wrong" };
  assert.equal(adaptH1ExactCoreFamilySignals({
    packet: packet(), familySignals: mismatched, sourceManifestHash: manifest, nowMs: now,
  }).ready, false);

  const seller = signals();
  seller[1] = { ...seller[1], stance: "SELLER_SUPPORT" };
  assert.equal(adaptH1ExactCoreFamilySignals({
    packet: packet(), familySignals: seller, sourceManifestHash: manifest, nowMs: now,
  }).ready, false);
});

test("near-expiry NIFTY and higher-DTE BANKNIFTY use the correct DTE gate", () => {
  const bank = packet();
  bank.identity.symbol = "BANKNIFTY";
  bank.identity.dte = 12;
  delete bank.gates.currentOrNearExpiryUsable;
  bank.gates.higherDteUsable = {
    value: true, observedAt, source: "exact-higher-dte", provenance: "LIVE_RUNTIME_EXACT",
  };
  const out = adaptH1ExactCoreFamilySignals({
    packet: bank, familySignals: signals(), sourceManifestHash: manifest, nowMs: now,
  });
  assert.equal(out.ready, true);
  assert.ok(out.envelopes.every((row) => row.symbol === "BANKNIFTY"));

  delete bank.gates.higherDteUsable;
  assert.equal(adaptH1ExactCoreFamilySignals({
    packet: bank, familySignals: signals(), sourceManifestHash: manifest, nowMs: now,
  }).ready, false);
});
