import assert from "node:assert/strict";
import test from "node:test";
import { buildH1ReadOnlyShadowDecisionInputBoundary } from "../h1-readonly-shadow-decision-input-boundary.js";

test("passes only an exact ready 5-token verified-direction input without granting authority", () => {
  const result = buildH1ReadOnlyShadowDecisionInputBoundary([
    { symbol: "NIFTY", ready: true, direction: "DOWN", evidenceTokenCount: 5, blockers: [] },
    { symbol: "SENSEX", ready: false, direction: null, evidenceTokenCount: 5, blockers: ["SPOT_MOVE_BELOW_DIRECTION_THRESHOLD"] },
    { symbol: "BANKNIFTY", ready: false, direction: null, evidenceTokenCount: 3, blockers: ["NEAREST_PEER_NOT_READY"] },
  ]);

  assert.equal(result.readySymbolCount, 1);
  assert.deepEqual(result.rows[0], { symbol: "NIFTY", ready: true, direction: "DOWN", evidenceTokenCount: 5, blockers: [] });
  assert.equal(result.rows[1].ready, false);
  assert.equal(result.rows[1].direction, null);
  assert.ok(result.rows[1].blockers.includes("SHADOW_INPUT_NOT_READY"));
  assert.ok(result.rows[1].blockers.includes("VERIFIED_DIRECTION_UNAVAILABLE"));
  assert.equal(result.rows[2].ready, false);
  assert.ok(result.rows[2].blockers.includes("EXACT_EVIDENCE_BUNDLE_INVALID:3/5"));
  assert.equal(result.semantics, "VERIFIED_DIRECTION_CONTEXT_ONLY_NO_SELECTOR_DECISION");
  assert.equal(result.forwardsDownstream, false);
  assert.equal(result.affectsVerdict, false);
  assert.equal(result.affectsExecution, false);
  assert.equal(result.affectsTelegram, false);
  assert.equal(result.grantsPromotionAuthority, false);
  assert.equal(result.failClosed, true);
});

test("fails closed when a symbol input is missing or direction is unavailable", () => {
  const result = buildH1ReadOnlyShadowDecisionInputBoundary([
    { symbol: "NIFTY", ready: true, direction: null, evidenceTokenCount: 5, blockers: [] },
  ]);

  assert.equal(result.readySymbolCount, 0);
  assert.ok(result.rows.find((row) => row.symbol === "NIFTY")?.blockers.includes("VERIFIED_DIRECTION_UNAVAILABLE"));
  assert.ok(result.rows.find((row) => row.symbol === "SENSEX")?.blockers.includes("SHADOW_INPUT_MISSING"));
  assert.ok(result.rows.find((row) => row.symbol === "BANKNIFTY")?.blockers.includes("SHADOW_INPUT_MISSING"));
});
