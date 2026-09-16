import test from "node:test";
import assert from "node:assert/strict";
import {
  GOLDEN_SHADOW_CONTEXT,
  GOLDEN_SHADOW_CORE_CONFIRMATIONS,
  GOLDEN_SHADOW_HARD_GATES,
  H1_GOLDEN_SHADOW_CANDIDATE_V1,
  type H1GoldenShadowCandidateResult,
} from "../h1-golden-shadow-candidate-v1.js";
import { projectH1GoldenShadowCard } from "../h1-golden-shadow-card-v1.js";
import { buildH1GoldenShadowTelegramPreview } from "../h1-golden-shadow-telegram-preview-v1.js";

const T = "2026-09-16T05:45:00.000Z";

function candidate(overrides: Partial<H1GoldenShadowCandidateResult> = {}): H1GoldenShadowCandidateResult {
  return {
    version: H1_GOLDEN_SHADOW_CANDIDATE_V1,
    state: "GOLDEN_SHADOW_CANDIDATE",
    symbol: "NIFTY",
    side: "CE",
    observedAt: T,
    hardGateFamilies: GOLDEN_SHADOW_HARD_GATES,
    coreConfirmationFamilies: GOLDEN_SHADOW_CORE_CONFIRMATIONS,
    contextFamilies: GOLDEN_SHADOW_CONTEXT,
    passedCoreConfirmations: ["spotStructure", "targetFuturesPositioning", "leaderPositioning"],
    missingCoreConfirmations: ["chainRepositioning"],
    failedFamilies: [],
    missingContextFamilies: ["peerConflictAbsent", "chasePhase", "horizonComplete"],
    reasonCodes: [
      "HARD_GATES_PASS",
      "CORE_CONFIRMATION_PASS_3_OF_4",
      "NO_EXPLICIT_CONTRADICTION",
      "SHADOW_ONLY_NO_PRODUCTION_AUTHORITY",
    ],
    productionImpact: "NONE",
    affectsSelector: false,
    affectsTelegram: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    createsOrders: false,
    failClosed: true,
    semantics: "SHADOW_GOLDEN_CANDIDATE_HARD_GATES_PLUS_CORE_CONVERGENCE_NO_THRESHOLD_INVENTION",
    ...overrides,
  };
}

test("approved Golden candidate projects to a read-only evidence card only", () => {
  const card = projectH1GoldenShadowCard(candidate());
  assert.ok(card);
  assert.equal(card.state, "GOLDEN_SHADOW_CANDIDATE");
  assert.equal(card.presentationKey, `GOLDEN_SHADOW:NIFTY:CE:${T}`);
  assert.equal(card.corePassed, 3);
  assert.equal(card.coreTotal, 4);
  assert.equal(card.executablePlanShown, false);
  assert.equal(card.readOnly, true);
  assert.equal(card.affectsSelector, false);
  assert.equal(card.affectsTelegram, false);
  assert.equal(card.affectsExecution, false);
  assert.equal(card.grantsPromotionAuthority, false);
  assert.equal(card.createsOrders, false);
});

test("WATCH and REJECTED candidates cannot be upgraded by the presentation layer", () => {
  assert.equal(projectH1GoldenShadowCard(candidate({ state: "WATCH" })), null);
  assert.equal(projectH1GoldenShadowCard(candidate({ state: "REJECTED" })), null);
});

test("forged Golden state with insufficient core convergence fails closed", () => {
  const forged = candidate({
    passedCoreConfirmations: ["spotStructure", "targetFuturesPositioning"],
    missingCoreConfirmations: ["leaderPositioning", "chainRepositioning"],
    reasonCodes: [
      "HARD_GATES_PASS",
      "CORE_CONFIRMATION_PASS_2_OF_4",
      "NO_EXPLICIT_CONTRADICTION",
      "SHADOW_ONLY_NO_PRODUCTION_AUTHORITY",
    ],
  });
  assert.equal(projectH1GoldenShadowCard(forged), null);
});

test("presentation rejects any candidate contract that claims new authority", () => {
  const forged = candidate() as H1GoldenShadowCandidateResult & { affectsExecution: boolean };
  forged.affectsExecution = true;
  assert.equal(projectH1GoldenShadowCard(forged), null);
});

test("card copies candidate arrays so later caller mutation cannot rewrite presentation evidence", () => {
  const source = candidate();
  const card = projectH1GoldenShadowCard(source);
  assert.ok(card);
  source.passedCoreConfirmations.length = 0;
  source.reasonCodes.push("CALLER_MUTATION");
  assert.equal(card.corePassed, 3);
  assert.equal(card.passedCoreConfirmations.length, 3);
  assert.equal(card.reasonCodes.includes("CALLER_MUTATION"), false);
});

test("Telegram preview consumes the same Golden candidate identity and stays non-executable", () => {
  const source = candidate();
  const card = projectH1GoldenShadowCard(source);
  const preview = buildH1GoldenShadowTelegramPreview(source);
  assert.ok(card);
  assert.equal(preview.presentationKey, card.presentationKey);
  assert.equal(preview.destination, "SPECIAL_OPTION_SELECTION");
  assert.equal(preview.candidateState, "GOLDEN_SHADOW_CANDIDATE");
  assert.match(preview.text, /GOLDEN SHADOW/);
  assert.match(preview.text, /Core confirmation: 3\/4/);
  assert.doesNotMatch(preview.text, /Entry:/);
  assert.doesNotMatch(preview.text, /SL:/);
  assert.doesNotMatch(preview.text, /T1:/);
  assert.equal(preview.executablePlanShown, false);
  assert.equal(preview.sendable, false);
  assert.equal(preview.sendsTelegram, false);
  assert.equal(preview.affectsTelegram, false);
  assert.equal(preview.affectsSelector, false);
  assert.equal(preview.affectsExecution, false);
  assert.equal(preview.grantsPromotionAuthority, false);
  assert.equal(preview.createsOrders, false);
});

test("invalid or non-Golden input produces a blocked preview with no candidate identity", () => {
  const preview = buildH1GoldenShadowTelegramPreview(candidate({ state: "WATCH" }));
  assert.equal(preview.candidateState, "NOT_PRESENTABLE");
  assert.equal(preview.presentationKey, null);
  assert.match(preview.text, /No approved Golden shadow candidate/);
  assert.equal(preview.sendable, false);
  assert.equal(preview.executablePlanShown, false);
});
