import test from "node:test";
import assert from "node:assert/strict";
import {
  appendForwardOutcome,
  createBusinessForwardJournal,
  type BusinessForwardJournalRecord,
} from "../business-forward-journal-v1.js";
import {
  H1_GOLD_EVIDENCE_ADAPTER_VERSION,
  type H1GoldEvidenceAdapterResult,
  type H1GoldEvidenceFamilyAudit,
} from "../h1-gold-evidence-adapter-v1.js";
import {
  evaluateH1GoldEligibility,
  type GoldEvidenceFamily,
  type GoldEvidenceState,
} from "../h1-gold-eligibility-v1.js";
import { buildH1GoldenDecisionCard } from "../h1-golden-decision-card-v1.js";

const T0 = "2026-09-16T05:45:00.000Z";
const T0_MS = Date.parse(T0);
const SNAPSHOT_ID = "NIFTY-20260916-054500";
const KEY = "NIFTY:CE:23250:2026-09-22:DTE6:ATM";

const FAMILY_LIST: readonly GoldEvidenceFamily[] = [
  "dataIntegrity", "premiumPair", "spotStructure", "targetFuturesPositioning", "leaderPositioning",
  "peerConflictAbsent", "chainRepositioning", "executionQuality", "chasePhase", "horizonComplete",
] as const;

function adapter(overrides: Partial<Record<GoldEvidenceFamily, GoldEvidenceState>> = {}): H1GoldEvidenceAdapterResult {
  const families: Record<GoldEvidenceFamily, GoldEvidenceState> = {
    dataIntegrity: "PASS",
    premiumPair: "PASS",
    spotStructure: "PASS",
    targetFuturesPositioning: "PASS",
    leaderPositioning: "PASS",
    peerConflictAbsent: "PASS",
    chainRepositioning: "PASS",
    executionQuality: "PASS",
    chasePhase: "PASS",
    horizonComplete: "PASS",
    ...overrides,
  };
  const familyAudit = Object.fromEntries(FAMILY_LIST.map((family) => [family, {
    family,
    requestedState: families[family],
    adaptedState: families[family],
    source: `TEST_EXACT_${family}`,
    snapshotId: SNAPSHOT_ID,
    observedAt: T0,
    provenance: "LIVE_RUNTIME_EXACT",
    canonicalBound: true,
    producerApproved: true,
    producerApprovalReason: "APPROVED_GOLD_PRODUCER",
    producerMatchedFamily: family,
    futureLeakageBlocked: false,
    reasonCodes: [],
  }])) as Record<GoldEvidenceFamily, H1GoldEvidenceFamilyAudit>;

  return {
    version: H1_GOLD_EVIDENCE_ADAPTER_VERSION,
    symbol: "NIFTY",
    side: "CE",
    observedAt: T0,
    canonicalSnapshotId: SNAPSHOT_ID,
    canonicalRootValid: true,
    canonicalRootReasonCodes: [],
    families,
    familyAudit,
    eligibility: evaluateH1GoldEligibility({
      symbol: "NIFTY", side: "CE", observedAt: T0, source: "DECISION_CARD_TEST", provenance: "RESEARCH_EXACT", families,
    }),
    productionImpact: "NONE",
    affectsSelector: false,
    affectsTelegram: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    calculatesThresholds: false,
    failClosed: true,
    semantics: "CANONICAL_EXACT_APPROVED_PRODUCER_MAPPING_ONLY_NO_MARKET_INFERENCE",
  };
}

function emptyJournal(): BusinessForwardJournalRecord {
  const made = createBusinessForwardJournal({
    decisionId: "GOLD-CARD-D1",
    snapshotId: SNAPSHOT_ID,
    observedAtMs: T0_MS,
    selectedCandidateKey: KEY,
    eligibleCandidates: [{
      candidateKey: KEY, symbol: "NIFTY", optionSide: "CE", strike: 23250,
      expiryDate: "2026-09-22", dte: 6, premiumLtp: 100,
    }],
  });
  assert.equal(made.ready, true);
  return made.record!;
}

function journalWithOutcome(): BusinessForwardJournalRecord {
  const appended = appendForwardOutcome(emptyJournal(), {
    window: "T_PLUS_3M",
    observedAtMs: T0_MS + 3 * 60_000,
    premiumByCandidateKey: { [KEY]: 112 },
  });
  assert.equal(appended.ready, true);
  return appended.record!;
}

test("mandatory card fail-closes invalid input instead of disappearing", () => {
  const card = buildH1GoldenDecisionCard(null);
  assert.equal(card.informationCardMandatory, true);
  assert.equal(card.identityValid, false);
  assert.equal(card.stage, "REJECTED");
  assert.equal(card.forwardStatus, "NOT_ELIGIBLE");
  assert.equal(card.grantsPromotionAuthority, false);
});

test("3-of-4 or 4-of-4 shadow with missing context is explicitly SHADOW_ONLY, not strict Gold", () => {
  const card = buildH1GoldenDecisionCard(adapter({
    peerConflictAbsent: "MISSING",
    chasePhase: "MISSING",
    horizonComplete: "MISSING",
  }));
  assert.equal(card.shadowState, "GOLDEN_SHADOW_CANDIDATE");
  assert.equal(card.stage, "SHADOW_ONLY");
  assert.equal(card.strictGoldState, "BLOCKED");
  assert.equal(card.forwardStatus, "NOT_ELIGIBLE");
  assert.match(card.statusMessage, /strict Gold\/forward gate is not cleared/i);
  assert.equal(card.grantsPromotionAuthority, false);
});

test("incomplete core convergence displays WATCH rather than manufacturing a candidate", () => {
  const card = buildH1GoldenDecisionCard(adapter({
    leaderPositioning: "MISSING",
    chainRepositioning: "MISSING",
  }));
  assert.equal(card.shadowState, "WATCH");
  assert.equal(card.stage, "WATCH");
  assert.equal(card.corePassed, 2);
  assert.equal(card.grantsPromotionAuthority, false);
});

test("explicit core contradiction displays REJECTED", () => {
  const card = buildH1GoldenDecisionCard(adapter({ leaderPositioning: "FAIL" }));
  assert.equal(card.shadowState, "REJECTED");
  assert.equal(card.stage, "REJECTED");
  assert.equal(card.grantsPromotionAuthority, false);
});

test("strict Gold cannot skip freezing a forward journal", () => {
  const card = buildH1GoldenDecisionCard(adapter());
  assert.equal(card.stage, "FORWARD_VALIDATION");
  assert.equal(card.strictGoldState, "FORWARD_VALIDATION_REQUIRED");
  assert.equal(card.forwardStatus, "JOURNAL_REQUIRED");
  assert.ok(card.forwardBlockers.includes("FROZEN_FORWARD_JOURNAL_REQUIRED"));
  assert.equal(card.grantsPromotionAuthority, false);
});

test("valid frozen T0 journal shows COLLECTING until post-T0 outcomes exist", () => {
  const card = buildH1GoldenDecisionCard(adapter(), emptyJournal());
  assert.equal(card.stage, "FORWARD_VALIDATION");
  assert.equal(card.forwardStatus, "COLLECTING");
  assert.equal(card.selectedCandidateKey, KEY);
  assert.equal(card.selectedTerminalReturnPct, null);
  assert.equal(card.grantsPromotionAuthority, false);
});

test("structural forward evidence is visible but still not a promotion verdict", () => {
  const card = buildH1GoldenDecisionCard(adapter(), journalWithOutcome());
  assert.equal(card.stage, "FORWARD_VALIDATION");
  assert.equal(card.forwardStatus, "STRUCTURAL_EVIDENCE");
  assert.deepEqual(card.completedForwardWindows, ["T_PLUS_3M"]);
  assert.equal(card.selectedTerminalReturnPct, 12);
  assert.equal(card.outcomeClassificationPolicyDefined, false);
  assert.equal(card.sampleSufficiencyPolicyDefined, false);
  assert.equal(card.performancePromotionThresholdDefined, false);
  assert.equal(card.executablePlanShown, false);
  assert.equal(card.affectsTelegram, false);
  assert.equal(card.affectsExecution, false);
  assert.equal(card.grantsPromotionAuthority, false);
});

test("forward identity mismatch is visible as BLOCKED instead of silently degrading", () => {
  const record = emptyJournal();
  const forged = { ...record, anchor: { ...record.anchor, snapshotId: "OTHER" } } as BusinessForwardJournalRecord;
  const card = buildH1GoldenDecisionCard(adapter(), forged);
  assert.equal(card.stage, "FORWARD_VALIDATION");
  assert.equal(card.forwardStatus, "BLOCKED");
  assert.ok(card.forwardBlockers.includes("FORWARD_SNAPSHOT_ID_MISMATCH"));
  assert.equal(card.grantsPromotionAuthority, false);
});
