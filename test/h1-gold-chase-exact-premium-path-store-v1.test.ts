import assert from "node:assert/strict";
import test from "node:test";
import type { LiveGateEvidencePacket } from "../h1-live-gate-evidence-assembler.js";
import {
  H1GoldChaseExactPremiumPathStore,
  H1_GOLD_CHASE_EXACT_PREMIUM_PATH_STORE_V1,
} from "../h1-gold-chase-exact-premium-path-store-v1.js";

function packet(observedAt: string, premiumLtp: number, symbol: "NIFTY" | "SENSEX" | "BANKNIFTY" = "NIFTY"): LiveGateEvidencePacket {
  return {
    identity: {
      symbol, side: "CE", strike: 24000, expiryDate: "2026-09-22", dte: 5,
      moneyness: "ATM", premiumLtp, observedAt,
      source: "H1_LIVE_EXACT_SNAPSHOT_AGGREGATOR_V1", provenance: "LIVE_RUNTIME_EXACT",
    },
    gates: {},
  };
}

test("records an exact same-session path ending at candidate T0", () => {
  const store = new H1GoldChaseExactPremiumPathStore();
  const first = packet("2026-09-17T06:55:00.000Z", 100);
  const t0 = packet("2026-09-17T07:00:00.000Z", 110);
  assert.equal(store.record(first, "2026-09-17T06:55:00.100Z").state, "RECORDED");
  const recorded = store.record(t0, "2026-09-17T07:00:00.100Z");
  assert.equal(recorded.version, H1_GOLD_CHASE_EXACT_PREMIUM_PATH_STORE_V1);
  assert.equal(recorded.pointCount, 2);
  const path = store.pathFor(t0);
  assert.equal(path.ready, true);
  assert.deepEqual(path.points.map((point) => point.ltp), [100, 110]);
  assert.equal(path.points.at(-1)?.observedAt, t0.identity.observedAt);
});

test("identical retry is idempotent while divergent duplicate poisons the contract path", () => {
  const store = new H1GoldChaseExactPremiumPathStore();
  const source = packet("2026-09-17T07:00:00.000Z", 110);
  assert.equal(store.record(source, "2026-09-17T07:00:00.100Z").state, "RECORDED");
  assert.equal(store.record(source, "2026-09-17T07:00:00.100Z").state, "IGNORED_DUPLICATE");
  const conflict = packet(source.identity.observedAt, 111);
  const out = store.record(conflict, "2026-09-17T07:00:00.200Z");
  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockers.includes("DIVERGENT_DUPLICATE_PREMIUM_TIMESTAMP"));
  assert.equal(store.pathFor(source).ready, false);
});

test("non-target symbols, reversed receipt time and non-forward chronology fail closed", () => {
  const store = new H1GoldChaseExactPremiumPathStore();
  assert.equal(store.record(packet("2026-09-17T07:00:00.000Z", 100, "BANKNIFTY"), "2026-09-17T07:00:00.100Z").state, "BLOCKED");
  assert.equal(store.record(packet("2026-09-17T07:00:00.000Z", 100), "2026-09-17T06:59:59.000Z").state, "BLOCKED");
  store.record(packet("2026-09-17T07:00:00.000Z", 100), "2026-09-17T07:00:00.100Z");
  const stale = store.record(packet("2026-09-17T06:59:00.000Z", 99), "2026-09-17T07:00:00.200Z");
  assert.equal(stale.state, "BLOCKED");
  assert.ok(stale.blockers.includes("NON_FORWARD_PREMIUM_CHRONOLOGY"));
});

test("a new forward IST session clears prior-session paths", () => {
  const store = new H1GoldChaseExactPremiumPathStore();
  const old = packet("2026-09-17T07:00:00.000Z", 100);
  const next = packet("2026-09-18T04:00:00.000Z", 120);
  store.record(old, "2026-09-17T07:00:00.100Z");
  assert.equal(store.record(next, "2026-09-18T04:00:00.100Z").state, "RECORDED");
  assert.equal(store.pathFor(next).points.length, 1);
  assert.equal(store.pathFor(old).ready, false);
});

test("invalid lookup is contained instead of throwing", () => {
  const store = new H1GoldChaseExactPremiumPathStore();
  const out = store.pathFor({} as LiveGateEvidencePacket);
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("EXACT_GOLD_TARGET_PACKET_REQUIRED"));
});
