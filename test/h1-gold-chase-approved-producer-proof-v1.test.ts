import assert from "node:assert/strict";
import test from "node:test";
import { buildH1GoldChaseApprovedProducerProof } from "../h1-gold-chase-approved-producer-proof-v1.js";

test("records durable-ready proof only for a published candidate lineage", () => {
  const out = buildH1GoldChaseApprovedProducerProof({
    state: "PUBLISHED", ready: true, blockers: [],
    publication: { bootstrap: { candidateKey: "NIFTY|2026-09-22|24000|CE" } },
  } as any, "2026-09-17T09:30:00.000Z");
  assert.equal(out.state, "PUBLISHED");
  assert.equal(out.candidateKey, "NIFTY|2026-09-22|24000|CE");
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.createsOrders, false);
});

test("blocked adapter remains blocked evidence, never a synthetic pass", () => {
  const out = buildH1GoldChaseApprovedProducerProof({
    state: "BLOCKED", ready: false, blockers: ["APPROVED_LINEAGE_PRODUCER_NOT_READY"], publication: null,
  } as any, "2026-09-17T09:30:00.000Z");
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("APPROVED_LINEAGE_PRODUCER_NOT_READY"));
  assert.ok(out.blockers.includes("PUBLISHED_CANDIDATE_KEY_REQUIRED"));
});

test("invalid proof timestamp fails closed", () => {
  const out = buildH1GoldChaseApprovedProducerProof({
    state: "PUBLISHED", ready: true, blockers: [], publication: { bootstrap: { candidateKey: "k" } },
  } as any, "bad-time");
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("VALID_PROOF_TIMESTAMP_REQUIRED"));
});
