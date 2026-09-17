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
import { buildH1GoldenDecisionTelegramPreview } from "../h1-golden-decision-telegram-preview-v1.js";

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
    dataIntegrity: "PASS", premiumPair: "PASS", spotStructure: "PASS", targetFuturesPositioning: "PASS",
    leaderPositioning: "PASS", peerConflictAbsent: "PASS", chainRepositioning: "PASS", executionQuality: "PASS",
    chasePhase: "PASS", horizonComplete: "PASS", ...overrides,
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
      symbol: "NIFTY", side: "CE", observedAt: T0, source: "TELEGRAM_PREVIEW_TEST", provenance: "RESEARCH_EXACT", families,
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
    decisionId: "GOLD-TG-D1",
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

function outcomeJournal(): BusinessForwardJournalRecord {
  const appended = appendForwardOutcome(emptyJournal(), {
    window: "T_PLUS_3M",
    observedAtMs: T0_MS + 3 * 60_000,
    premiumByCandidateKey: { [KEY]: 112 },
  });
  assert.equal(appended.ready, true);
  return appended.record!;
}

function assertPreviewOnly(text: string, preview: ReturnType<typeof buildH1GoldenDecisionTelegramPreview>) {
  assert.equal(preview.previewOnly, true);
  assert.equal(preview.sendable, false);
  assert.equal(preview.sendsTelegram, false);
  assert.equal(preview.affectsTelegram, false);
  assert.equal(preview.affectsSelector, false);
  assert.equal(preview.affectsExecution, false);
  assert.equal(preview.grantsPromotionAuthority, false);
  assert.equal(preview.createsOrders, false);
  assert.equal(preview.executablePlanShown, false);
  assert.doesNotMatch(text, /Entry:/i);
  assert.doesNotMatch(text, /SL:/i);
  assert.doesNotMatch(text, /Target:/i);
}

test("shadow-only preview explicitly says strict Gold is blocked", () => {
  const preview = buildH1GoldenDecisionTelegramPreview(adapter({
    peerConflictAbsent: "MISSING", chasePhase: "MISSING", horizonComplete: "MISSING",
  }));
  assert.equal(preview.cardStage, "SHADOW_ONLY");
  assert.equal(preview.forwardStatus, "NOT_ELIGIBLE");
  assert.match(preview.text, /Stage: SHADOW ONLY/);
  assert.match(preview.text, /Strict Gold: BLOCKED/);
  assert.match(preview.text, /Forward: NOT ELIGIBLE/);
  assertPreviewOnly(preview.text, preview);
});

test("strict Gold preview cannot skip frozen forward journal", () => {
  const preview = buildH1GoldenDecisionTelegramPreview(adapter());
  assert.equal(preview.cardStage, "FORWARD_VALIDATION");
  assert.equal(preview.forwardStatus, "JOURNAL_REQUIRED");
  assert.match(preview.text, /Forward: JOURNAL REQUIRED/);
  assert.match(preview.text, /FROZEN_FORWARD_JOURNAL_REQUIRED/);
  assertPreviewOnly(preview.text, preview);
});

test("structural evidence preview shows descriptive return but no success classification", () => {
  const preview = buildH1GoldenDecisionTelegramPreview(adapter(), outcomeJournal());
  assert.equal(preview.cardStage, "FORWARD_VALIDATION");
  assert.equal(preview.forwardStatus, "STRUCTURAL_EVIDENCE");
  assert.match(preview.text, /Forward: STRUCTURAL EVIDENCE/);
  assert.match(preview.text, /Selected return: \+12%/);
  assert.match(preview.text, /Outcome classification: NOT DEFINED/);
  assert.match(preview.text, /Promotion threshold: NOT DEFINED/);
  assertPreviewOnly(preview.text, preview);
});

test("invalid Gold identity still produces a blocked information preview", () => {
  const preview = buildH1GoldenDecisionTelegramPreview(null);
  assert.equal(preview.identityValid, false);
  assert.equal(preview.cardStage, "REJECTED");
  assert.equal(preview.forwardStatus, "NOT_ELIGIBLE");
  assert.match(preview.text, /INVALID GOLD IDENTITY/);
  assertPreviewOnly(preview.text, preview);
});
