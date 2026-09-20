import test from "node:test";
import assert from "node:assert/strict";
import {
  clearH1ShadowExecutionEvidenceRegistry,
  getH1ShadowExecutionEvidence,
  publishH1ShadowExecutionEvidence,
} from "../h1-shadow-execution-evidence-registry.js";

const decisionId = "decision-evidence-1";
const candidateKey = "SENSEX:CE:75100:2026-09-10:DTE1:ATM";
const evidence = {
  orderBuildDecision: "BUILD" as const,
  executionRiskDecision: "ALLOW" as const,
  killSwitchDecision: "ALLOW" as const,
  idempotencyDecision: "ALLOW" as const,
  exactContractBound: true,
  evidencePersistenceConfirmed: true,
  brokerSessionReady: true,
};

test("returns only fresh evidence for the exact candidate", () => {
  clearH1ShadowExecutionEvidenceRegistry();
  const accepted = publishH1ShadowExecutionEvidence({ decisionId, candidateKey, observedAt: "2026-09-09T07:30:00.000Z", evidence });
  assert.equal(accepted.accepted, true);
  assert.deepEqual(getH1ShadowExecutionEvidence(decisionId, candidateKey, "2026-09-09T07:30:30.000Z"), evidence);
  assert.equal(getH1ShadowExecutionEvidence(decisionId, "SENSEX:CE:75200:2026-09-10:DTE1:ATM", "2026-09-09T07:30:30.000Z"), null);
  assert.equal(getH1ShadowExecutionEvidence("decision-other", candidateKey, "2026-09-09T07:30:30.000Z"), null);
});

test("stale or future evidence fails closed", () => {
  clearH1ShadowExecutionEvidenceRegistry();
  publishH1ShadowExecutionEvidence({ decisionId, candidateKey, observedAt: "2026-09-09T07:20:00.000Z", evidence });
  assert.equal(getH1ShadowExecutionEvidence(decisionId, candidateKey, "2026-09-09T07:30:00.000Z", 90_000), null);

  publishH1ShadowExecutionEvidence({ decisionId, candidateKey, observedAt: "2026-09-09T07:31:00.000Z", evidence });
  assert.equal(getH1ShadowExecutionEvidence(decisionId, candidateKey, "2026-09-09T07:30:00.000Z", 90_000), null);
});

test("invalid candidate or malformed evidence is rejected", () => {
  clearH1ShadowExecutionEvidenceRegistry();
  assert.equal(publishH1ShadowExecutionEvidence({ decisionId, candidateKey: "BAD", observedAt: "2026-09-09T07:30:00.000Z", evidence }).accepted, false);
  assert.equal(publishH1ShadowExecutionEvidence({ decisionId: "", candidateKey, observedAt: "2026-09-09T07:30:00.000Z", evidence }).accepted, false);
  assert.equal(publishH1ShadowExecutionEvidence({
    decisionId,
    candidateKey,
    observedAt: "2026-09-09T07:30:00.000Z",
    evidence: { ...evidence, brokerSessionReady: undefined as unknown as boolean },
  }).accepted, false);
});
