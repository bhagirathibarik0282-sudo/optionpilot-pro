import test from "node:test";
import assert from "node:assert/strict";
import { buildShadowEvidencePersistenceEnvelope } from "../shadow-evidence-persistence.js";
import { createShadowTradeEvidence, recordShadowTradeEvent } from "../shadow-trade-evidence-recorder.js";

function sample() {
  const s = createShadowTradeEvidence({
    tradeId: "PERSIST-1",
    ts: "2026-09-01T09:30:00+05:30",
    index: "NIFTY",
    entryPremium: 120,
    entryQty: 130,
    initialTrailingSl: 112,
  });
  assert.ok(s);
  return s!;
}

test("builds versioned broker-safe persistence envelope", () => {
  const e = buildShadowEvidencePersistenceEnvelope(sample(), "2026-09-01T10:00:00+05:30");
  assert.ok(e);
  assert.equal(e?.version, "SHADOW_EVIDENCE_PERSISTENCE_V1");
  assert.equal(e?.brokerOrderAllowed, false);
  assert.equal(e?.tradeId, "PERSIST-1");
});

test("persists a closed lifecycle snapshot shape", () => {
  let s = sample();
  s = recordShadowTradeEvent(s, { ts: "2026-09-01T09:45:00+05:30", event: "PARTIAL_EXIT", premium: 140, quantity: 65, trailingSl: 125 })!;
  s = recordShadowTradeEvent(s, { ts: "2026-09-01T10:05:00+05:30", event: "RUNNER_EXIT", premium: 150, quantity: 65, trailingSl: 138 })!;
  const e = buildShadowEvidencePersistenceEnvelope(s, "2026-09-01T10:05:01+05:30");
  assert.ok(e);
  assert.equal(e?.closed, true);
  assert.equal(e?.evidence.remainingQty, 0);
  assert.equal(e?.evidence.hypotheticalPnl, 3250);
});

test("invalid persistence timestamp fails closed", () => {
  assert.equal(buildShadowEvidencePersistenceEnvelope(sample(), "bad-time"), null);
});

test("tampered broker-order permission fails closed", () => {
  const s = sample() as any;
  s.brokerOrderAllowed = true;
  assert.equal(buildShadowEvidencePersistenceEnvelope(s, "2026-09-01T10:00:00+05:30"), null);
});

test("tampered event identity fails closed", () => {
  const s = sample();
  const bad = { ...s, events: s.events.map((e, i) => i === 0 ? { ...e, tradeId: "OTHER" } : e) };
  assert.equal(buildShadowEvidencePersistenceEnvelope(bad, "2026-09-01T10:00:00+05:30"), null);
});
