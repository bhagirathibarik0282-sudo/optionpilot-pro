import assert from "node:assert/strict";
import test from "node:test";
import {
  CANONICAL_BUSINESS_REQUIRED_FAMILIES,
  CanonicalLiveFamilySignalRegistry,
} from "../canonical-live-family-signal-registry.js";
import type { CanonicalDeterministicFamilySignal } from "../canonical-normalized-family-support-producer.js";

const now = Date.now();
const hash = "manifest-live-v1";

function signal(
  family: (typeof CANONICAL_BUSINESS_REQUIRED_FAMILIES)[number],
  sourceManifestHash = hash,
): CanonicalDeterministicFamilySignal {
  return {
    family,
    stance: "BUYER_SUPPORT",
    strength: 70,
    deterministic: true,
    evidenceReady: true,
    sourceId: `verified-engine-${family}`,
    sourceManifestHash,
    sourceSemantics: "EXPLICIT_DIRECTIONAL_SUPPORT",
    grantsDirectionalSupport: true,
    devilFlags: [],
  };
}

function publishAll(registry: CanonicalLiveFamilySignalRegistry, symbol: "NIFTY" | "SENSEX" | "BANKNIFTY" = "NIFTY") {
  for (const family of CANONICAL_BUSINESS_REQUIRED_FAMILIES) {
    const out = registry.publish({
      provenance: "LIVE_DETERMINISTIC_FAMILY_SIGNAL_V1",
      symbol,
      observedAtMs: now - 1_000,
      signal: signal(family),
    });
    assert.equal(out.accepted, true);
  }
}

test("collects exactly ten fresh manifest-bound deterministic family signals", () => {
  const registry = new CanonicalLiveFamilySignalRegistry();
  publishAll(registry);
  const out = registry.collect("NIFTY", hash, now);
  assert.equal(out.ready, true);
  assert.equal(out.requiredFamilyCount, 10);
  assert.equal(out.verifiedFamilyCount, 10);
  assert.equal(out.signals.length, 10);
  assert.equal(out.grantsCandidateAuthority, false);
  assert.equal(out.sendsTelegram, false);
  assert.equal(out.createsOrders, false);
});

test("missing family remains an explicit blocker", () => {
  const registry = new CanonicalLiveFamilySignalRegistry();
  for (const family of CANONICAL_BUSINESS_REQUIRED_FAMILIES.slice(0, 9)) {
    registry.publish({
      provenance: "LIVE_DETERMINISTIC_FAMILY_SIGNAL_V1",
      symbol: "NIFTY",
      observedAtMs: now - 1_000,
      signal: signal(family),
    });
  }
  const out = registry.collect("NIFTY", hash, now);
  assert.equal(out.ready, false);
  assert.equal(out.verifiedFamilyCount, 9);
  assert.ok(out.blockers.some((blocker) => blocker.endsWith("LIVE_SIGNAL_MISSING")));
  assert.deepEqual(out.signals, []);
});

test("stale or future family evidence fails closed", () => {
  const stale = new CanonicalLiveFamilySignalRegistry();
  publishAll(stale);
  const staleOut = stale.collect("NIFTY", hash, now + 91_001);
  assert.equal(staleOut.ready, false);
  assert.ok(staleOut.blockers.every((blocker) => blocker.endsWith("LIVE_SIGNAL_STALE_OR_FUTURE")));

  const future = new CanonicalLiveFamilySignalRegistry();
  publishAll(future);
  const futureOut = future.collect("NIFTY", hash, now - 2_000);
  assert.equal(futureOut.ready, false);
  assert.ok(futureOut.blockers.every((blocker) => blocker.endsWith("LIVE_SIGNAL_STALE_OR_FUTURE")));
});

test("manifest mismatch cannot cross-contaminate a canonical snapshot", () => {
  const registry = new CanonicalLiveFamilySignalRegistry();
  publishAll(registry);
  const out = registry.collect("NIFTY", "different-manifest", now);
  assert.equal(out.ready, false);
  assert.ok(out.blockers.every((blocker) => blocker.endsWith("SOURCE_MANIFEST_MISMATCH")));
});

test("context-only or devil-flagged input cannot be published as directional support", () => {
  const registry = new CanonicalLiveFamilySignalRegistry();
  const contextOnly = {
    ...signal("VOLATILITY"),
    grantsDirectionalSupport: false,
  } as unknown as CanonicalDeterministicFamilySignal;
  assert.equal(registry.publish({
    provenance: "LIVE_DETERMINISTIC_FAMILY_SIGNAL_V1",
    symbol: "NIFTY",
    observedAtMs: now,
    signal: contextOnly,
  }).reason, "INVALID_SIGNAL");

  const devil = { ...signal("OI_POSITIONING"), devilFlags: ["CONFLICT"] };
  assert.equal(registry.publish({
    provenance: "LIVE_DETERMINISTIC_FAMILY_SIGNAL_V1",
    symbol: "NIFTY",
    observedAtMs: now,
    signal: devil,
  }).reason, "INVALID_SIGNAL");
});

test("symbols are isolated and non-forward replacement is rejected", () => {
  const registry = new CanonicalLiveFamilySignalRegistry();
  publishAll(registry, "NIFTY");
  assert.equal(registry.collect("SENSEX", hash, now).ready, false);

  const duplicate = registry.publish({
    provenance: "LIVE_DETERMINISTIC_FAMILY_SIGNAL_V1",
    symbol: "NIFTY",
    observedAtMs: now - 1_000,
    signal: signal("MARKET_STRUCTURE"),
  });
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.reason, "NON_FORWARD_SIGNAL_TIMESTAMP");
});
