import test from "node:test";
import assert from "node:assert/strict";
import { buildH1ExactOptionPremiumMoveEvidence } from "../h1-exact-option-premium-move-evidence.js";
import type { H1LiveExactRawEvidenceRow } from "../h1-live-exact-raw-evidence-store.js";

function row(overrides: Partial<H1LiveExactRawEvidenceRow> = {}): H1LiveExactRawEvidenceRow {
  return {
    instrumentToken: 12345,
    symbol: "NIFTY",
    role: "OPTION",
    instrumentLabel: "NIFTY26SEP24000CE",
    expiry: "2026-09-08",
    strike: 24000,
    optionSide: "CE",
    observedAt: "2026-09-04T09:45:00.000Z",
    receivedAt: "2026-09-04T09:45:00.100Z",
    ltp: 100,
    bid: 99.5,
    ask: 100.5,
    bidQty: 100,
    askQty: 100,
    ...overrides,
  };
}

const policy = { maxObservationGapMs: 180_000 };

test("computes premium move from same exact option token without direction mapping", () => {
  const previous = row();
  const current = row({ observedAt: "2026-09-04T09:48:00.000Z", ltp: 106 });
  const result = buildH1ExactOptionPremiumMoveEvidence(previous, current, policy);
  assert.equal(result.ready, true);
  assert.equal(result.side, "CE");
  assert.equal(result.instrumentToken, 12345);
  assert.ok(Math.abs((result.premiumMovePct ?? 0) - 6) < 1e-9);
  assert.equal(result.semantics, "EXACT_SAME_TOKEN_PREMIUM_MOVE_ONLY_NO_DIRECTION_MAPPING");
  assert.equal(result.forwardsDownstream, false);
  assert.equal(result.affectsTelegram, false);
  assert.equal(result.affectsVerdict, false);
  assert.equal(result.affectsExecution, false);
});

test("preserves PE identity directly from exact token metadata", () => {
  const previous = row({ instrumentToken: 54321, optionSide: "PE", instrumentLabel: "NIFTY26SEP24000PE" });
  const current = row({ instrumentToken: 54321, optionSide: "PE", instrumentLabel: "NIFTY26SEP24000PE", observedAt: "2026-09-04T09:46:00.000Z", ltp: 95 });
  const result = buildH1ExactOptionPremiumMoveEvidence(previous, current, policy);
  assert.equal(result.ready, true);
  assert.equal(result.side, "PE");
  assert.ok((result.premiumMovePct ?? 0) < 0);
});

test("fails closed on token or option identity mismatch", () => {
  const result = buildH1ExactOptionPremiumMoveEvidence(
    row(),
    row({ instrumentToken: 99999, observedAt: "2026-09-04T09:46:00.000Z" }),
    policy,
  );
  assert.equal(result.ready, false);
  assert.equal(result.premiumMovePct, null);
  assert.ok(result.blockers.includes("EXACT_OPTION_IDENTITY_MISMATCH"));
});

test("fails closed on non-forward or over-window observations", () => {
  const nonForward = buildH1ExactOptionPremiumMoveEvidence(row(), row(), policy);
  assert.equal(nonForward.ready, false);
  assert.ok(nonForward.blockers.includes("NON_FORWARD_CHRONOLOGY"));

  const overWindow = buildH1ExactOptionPremiumMoveEvidence(
    row(),
    row({ observedAt: "2026-09-04T09:48:00.001Z" }),
    policy,
  );
  assert.equal(overWindow.ready, false);
  assert.ok(overWindow.blockers.includes("OBSERVATION_GAP_TOO_LARGE"));
});

test("rejects spot rows and invalid policy", () => {
  const badRow = row({ role: "SPOT", optionSide: null, expiry: null, strike: null });
  const result = buildH1ExactOptionPremiumMoveEvidence(badRow, row({ observedAt: "2026-09-04T09:46:00.000Z" }), { maxObservationGapMs: 0 });
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("INVALID_PREVIOUS_EXACT_OPTION_EVIDENCE"));
  assert.ok(result.blockers.includes("INVALID_PREMIUM_MOVE_POLICY"));
});
