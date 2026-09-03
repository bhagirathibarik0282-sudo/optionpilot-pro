import test from "node:test";
import assert from "node:assert/strict";
import { buildHaikuAuditRequest, validateHaikuAuditResult } from "../haiku-audit-contract.js";

const envelope: any = {
  version: "CANONICAL_EVIDENCE_ENVELOPE_V1",
  semantics: "RESEARCH_SHADOW_ONLY",
  symbol: "NIFTY",
  generatedAt: new Date().toISOString(),
  institutionalContext: null,
  temporal: {},
  combinations: null,
  blockers: [],
  affectsVerdict: false,
  affectsTelegram: false,
  affectsExecution: false,
};

test("Haiku request is audit-only with zero authority", () => {
  const req = buildHaikuAuditRequest(envelope);
  assert.equal(req.mayChangeVerdict, false);
  assert.equal(req.mayChangeExecution, false);
  assert.equal(req.mayChangeTelegramEligibility, false);
  assert.match(req.instructions.join(" "), /do not invent market data/i);
  assert.match(req.instructions.join(" "), /do not create, alter, upgrade, downgrade, or override any trading verdict/i);
});

test("validator rejects any attempted Haiku authority", () => {
  const problems = validateHaikuAuditResult({
    version: "HAIKU_AUDIT_RESULT_V1",
    semantics: "EXPLANATION_AND_AUDIT_ONLY",
    summary: "test",
    findings: [],
    contradictionDetected: false,
    missingEvidenceDetected: false,
    escalationSuggested: false,
    mayChangeVerdict: true as false,
    mayChangeExecution: false,
    mayChangeTelegramEligibility: false,
  });
  assert.deepEqual(problems, ["HAIKU_VERDICT_AUTHORITY_FORBIDDEN"]);
});
