import test from "node:test";
import assert from "node:assert/strict";
import { auditCandidateReconstruction } from "../h1-candidate-reconstruction-audit.js";

test("reconstruction audit semantics are read-only", () => {
  const request = { symbol: "NIFTY", tradeDate: "2026-09-02", fromTime: "09:15", toTime: "15:30", scope: "CORE" } as const;
  const out = auditCandidateReconstruction(request, { ok: false, mode: "READ_ONLY_H1_3M_REPLAY", productionImpact: "NONE", request, reason: "TEST" });
  assert.equal(out.mode, "READ_ONLY_H1_CANDIDATE_RECONSTRUCTION_AUDIT_V1");
  assert.equal(out.productionImpact, "NONE");
  assert.equal(out.fullSelectorReconstructionPossible, false);
  assert.equal(out.semantics, "AUDIT_ONLY_DO_NOT_INFER_EXECUTION_SELECTOR_QUALIFICATION");
});
