import test from "node:test";
import assert from "node:assert/strict";
import { auditCandidateReconstruction } from "../h1-candidate-reconstruction-audit.js";

const request = { symbol: "NIFTY", tradeDate: "2026-09-02", fromTime: "09:15", toTime: "15:30", scope: "CORE" } as const;

test("candidate reconstruction audit remains fail-closed and does not infer selector qualification", () => {
  const out = auditCandidateReconstruction(request, {
    ok: true,
    mode: "READ_ONLY_H1_3M_REPLAY",
    productionImpact: "NONE",
    request,
    options: [{ expiry: "2026-09-08", strike: 24000, option_type: "CE", dte: 6, atm_offset: 0, ltp: 100, spread: 1, bid: 99, ask: 100, liquidity_status: "TIGHT", delta: 0.5, gamma: 0.01, theta: -10, iv: 15, extrinsic: 100, expiry_bucket: "WEEKLY" }],
  });
  assert.equal(out.fullSelectorReconstructionPossible, false);
  assert.ok(out.blockers.includes("FULL_EXECUTION_SELECTOR_RECONSTRUCTION_NOT_POSSIBLE_FROM_H1_REPLAY_FIELDS"));
  assert.ok(out.notRecordedGateCount > 0);
  assert.equal(out.affectsVerdict, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.createsOrders, false);
  assert.equal(out.aiMayOverride, false);
});
