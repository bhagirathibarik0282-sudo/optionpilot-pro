import test from "node:test";
import assert from "node:assert/strict";
import { validateShadowValidationRegimeEvidence } from "../psychology-regime-evidence.ts";

test("valid deterministic upstream regime evidence is accepted", () => {
  const result = validateShadowValidationRegimeEvidence([
    { regime: "TREND", source: "DETERMINISTIC_UPSTREAM", observedAt: "2026-08-20T09:20:00+05:30", ruleVersion: "REGIME_RULE_V1" },
    { regime: "EXPIRY", source: "DETERMINISTIC_UPSTREAM", observedAt: "2026-08-20T09:20:30+05:30", ruleVersion: "EXPIRY_RULE_V1" },
  ], "2026-08-20T09:21:00+05:30");
  assert.equal(result.valid, true);
  assert.deepEqual(result.regimes, ["TREND", "EXPIRY"]);
});

test("missing evidence cannot prove regime coverage", () => {
  const result = validateShadowValidationRegimeEvidence(undefined, "2026-08-20T09:21:00+05:30");
  assert.equal(result.valid, false);
  assert.deepEqual(result.blockers, ["REGIME_EVIDENCE_MISSING"]);
});

test("lookahead regime evidence is rejected", () => {
  const result = validateShadowValidationRegimeEvidence([
    { regime: "REVERSAL", source: "DETERMINISTIC_UPSTREAM", observedAt: "2026-08-20T09:22:00+05:30", ruleVersion: "REV_RULE_V1" },
  ], "2026-08-20T09:21:00+05:30");
  assert.equal(result.valid, false);
  assert.ok(result.blockers.includes("REGIME_EVIDENCE_LOOKAHEAD:REVERSAL"));
});

test("duplicate regime evidence is rejected", () => {
  const result = validateShadowValidationRegimeEvidence([
    { regime: "HIGH_IV", source: "DETERMINISTIC_UPSTREAM", observedAt: "2026-08-20T09:20:00+05:30", ruleVersion: "IV_RULE_V1" },
    { regime: "HIGH_IV", source: "DETERMINISTIC_UPSTREAM", observedAt: "2026-08-20T09:20:30+05:30", ruleVersion: "IV_RULE_V1" },
  ], "2026-08-20T09:21:00+05:30");
  assert.equal(result.valid, false);
  assert.ok(result.blockers.includes("REGIME_EVIDENCE_DUPLICATE:HIGH_IV"));
});

test("blank rule version is rejected", () => {
  const result = validateShadowValidationRegimeEvidence([
    { regime: "GAP", source: "DETERMINISTIC_UPSTREAM", observedAt: "2026-08-20T09:20:00+05:30", ruleVersion: " " },
  ], "2026-08-20T09:21:00+05:30");
  assert.equal(result.valid, false);
  assert.ok(result.blockers.includes("REGIME_EVIDENCE_RULE_VERSION_MISSING:GAP"));
});
