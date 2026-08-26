import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  auditMaxPainAuthority,
  MAX_PAIN_CONTEXT_GUARD,
  PHASE48_MAX_PAIN_SAFETY,
} from "../max-pain-authority.js";

test("current server exposes every legacy Max Pain directional vote as a promotion blocker", () => {
  const source = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  const audit = auditMaxPainAuthority(source);
  assert.ok(audit.directionalVoteCount >= 2, `expected at least two current legacy votes, saw ${audit.directionalVoteCount}`);
  assert.equal(audit.promotionState, "BLOCKED");
  assert.equal(audit.productionDirectionalAuthorityAllowed, false);
  assert.ok(audit.reasons.includes("LEGACY_MAX_PAIN_DIRECTIONAL_VOTE_PRESENT"));
});

test("current server also has contextual/dashboard/Telegram Max Pain display paths", () => {
  const source = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  const audit = auditMaxPainAuthority(source);
  assert.ok(audit.contextDisplayCount >= 1);
  assert.ok(audit.rawAvailabilityCount >= 1);
});

test("directional vote removal would only make Max Pain eligible for shadow review, never production directional authority", () => {
  const source = `
    const maxPainText = f.maxPain > 0 ? String(f.maxPain) : "-";
    html += rowLine('Max Pain', m.maxPain ? m.maxPain.toFixed(0) : 'DATA UNAVAILABLE');
    const rawValues = { max_pain: m.maxPain > 0 ? m.maxPain : null };
  `;
  const audit = auditMaxPainAuthority(source);
  assert.equal(audit.directionalVoteCount, 0);
  assert.equal(audit.promotionState, "ELIGIBLE_FOR_SHADOW_REVIEW");
  assert.equal(audit.productionDirectionalAuthorityAllowed, false);
});

test("interpretation contract forbids target/forecast/trigger semantics", () => {
  assert.match(MAX_PAIN_CONTEXT_GUARD, /not a seller target/i);
  assert.match(MAX_PAIN_CONTEXT_GUARD, /not a .*directional forecast/i);
  assert.match(MAX_PAIN_CONTEXT_GUARD, /trade trigger/i);
});

test("Phase48 safety contract cannot alter verdict, Telegram trade decision or execution", () => {
  assert.deepEqual(PHASE48_MAX_PAIN_SAFETY, {
    shadowOnly: true,
    readOnlyForTrading: true,
    affectsVerdict: false,
    affectsTelegramTradeDecision: false,
    affectsExecution: false,
    productionDirectionalAuthorityAllowed: false,
    promotionRequiresNoLegacyDirectionalVotes: true,
    contextRole: "EXPIRY_EQUILIBRIUM_REFERENCE_ONLY",
  });
});
