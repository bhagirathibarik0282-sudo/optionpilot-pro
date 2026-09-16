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
import { validateH1GoldForwardEvidence } from "../h1-gold-forward-validation-v1.js";

const T0 = "2026-09-16T05:45:00.000Z";
const T0_MS = Date.parse(T0);
const SNAPSHOT_ID = "NIFTY-20260916-054500";
const KEY = "NIFTY:CE:23250:2026-09-22:DTE6:ATM";

const FAMILY_LIST: readonly GoldEvidenceFamily[] = [
  "dataIntegrity",
  "premiumPair",
  "spotStructure",
  "targetFuturesPositioning",
  "leaderPositioning",
  "peerConflictAbsent",
  "chainRepositioning",
  "executionQuality",
  "chasePhase",
  "horizonComplete",
] as const;

function families(overrides: Partial<Record<GoldEvidenceFamily, GoldEvidenceState>> = {}): Record<GoldEvidenceFamily, GoldEvidenceState> {
  return {
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
}

function adapter(overrides: Partial<Record<GoldEvidenceFamily, GoldEvidenceState>> = {}): H1GoldEvidenceAdapterResult {
  const fs = families(overrides);
  const familyAudit = Object.fromEntries(FAMILY_LIST.map((family) => [family, {
    family,
    requestedState: fs[family],
    adaptedState: fs[family],
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
    families: fs,
    familyAudit,
    eligibility: evaluateH1GoldEligibility({
      symbol: "NIFTY",
      side: "CE",
      observedAt: T0,
      source: "GOLD_FORWARD_TEST",
      provenance: "RESEARCH_EXACT",
      families: fs,
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
    decisionId: "GOLD-D1",
    snapshotId: SNAPSHOT_ID,
    observedAtMs: T0_MS,
    selectedCandidateKey: KEY,
    eligibleCandidates: [{
      candidateKey: KEY,
      symbol: "NIFTY",
      optionSide: "CE",
      strike: 23250,
      expiryDate: "2026-09-22",
      dte: 6,
      premiumLtp: 100,
    }],
  });
  assert.equal(made.ready, true);
  return made.record!;
}

function withOutcome(premium = 110, window: "T_PLUS_3M" | "T_PLUS_6M" | "T_PLUS_15M" | "T_PLUS_30M" = "T_PLUS_3M"): BusinessForwardJournalRecord {
  const record = emptyJournal();
  const minutes = { T_PLUS_3M: 3, T_PLUS_6M: 6, T_PLUS_15M: 15, T_PLUS_30M: 30 }[window];
  const appended = appendForwardOutcome(record, {
    window,
    observedAtMs: T0_MS + minutes * 60_000,
    premiumByCandidateKey: { [KEY]: premium },
  });
  assert.equal(appended.ready, true);
  return appended.record!;
}

test("strict Gold with linked frozen T0 but no later outcome requires evidence collection", () => {
  const out = validateH1GoldForwardEvidence(adapter(), emptyJournal());
  assert.equal(out.state, "EVIDENCE_COLLECTION_REQUIRED");
  assert.equal(out.classificationPolicyDefined, false);
  assert.equal(out.sampleSufficiencyPolicyDefined, false);
  assert.equal(out.performancePromotionThresholdDefined, false);
  assert.equal(out.grantsPromotionAuthority, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
});

test("one exact post-T0 premium outcome is structural evidence only, never production proof", () => {
  const out = validateH1GoldForwardEvidence(adapter(), withOutcome(112));
  assert.equal(out.state, "STRUCTURALLY_VALID_EVIDENCE");
  assert.deepEqual(out.completedWindows, ["T_PLUS_3M"]);
  assert.equal(out.selectedTerminalReturnPct, 12);
  assert.equal(out.selectedMfePct, 12);
  assert.equal(out.selectedMaePct, 12);
  assert.equal(out.grantsPromotionAuthority, false);
  assert.ok(out.reasonCodes.includes("OUTCOME_CLASSIFICATION_POLICY_NOT_DEFINED"));
});

test("negative forward return is not automatically labelled false Gold", () => {
  const out = validateH1GoldForwardEvidence(adapter(), withOutcome(85));
  assert.equal(out.state, "STRUCTURALLY_VALID_EVIDENCE");
  assert.equal(out.selectedTerminalReturnPct, -15);
  assert.equal(out.classificationPolicyDefined, false);
  assert.equal(out.performancePromotionThresholdDefined, false);
  assert.equal(out.grantsPromotionAuthority, false);
});

test("blocked strict Gold cannot enter forward validation even with a later outcome", () => {
  const out = validateH1GoldForwardEvidence(adapter({ peerConflictAbsent: "MISSING" }), withOutcome(120));
  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockerCodes.includes("GOLD_PROMOTION_FIREWALL_NOT_CLEARED"));
  assert.equal(out.grantsPromotionAuthority, false);
});

test("snapshot mismatch blocks evidence attachment", () => {
  const record = emptyJournal();
  const forged = {
    ...record,
    anchor: { ...record.anchor, snapshotId: "OTHER-SNAPSHOT" },
  } as BusinessForwardJournalRecord;
  const out = validateH1GoldForwardEvidence(adapter(), forged);
  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockerCodes.includes("FORWARD_SNAPSHOT_ID_MISMATCH"));
});

test("T0 timestamp mismatch blocks evidence attachment", () => {
  const record = emptyJournal();
  const forged = {
    ...record,
    anchor: { ...record.anchor, observedAtMs: T0_MS + 1 },
  } as BusinessForwardJournalRecord;
  const out = validateH1GoldForwardEvidence(adapter(), forged);
  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockerCodes.includes("FORWARD_T0_TIMESTAMP_MISMATCH"));
});

test("candidate symbol or side mismatch blocks cross-candidate leakage", () => {
  const record = emptyJournal();
  const forged = {
    ...record,
    anchor: {
      ...record.anchor,
      eligibleCandidates: [{ ...record.anchor.eligibleCandidates[0], optionSide: "PE" as const }],
    },
  } as BusinessForwardJournalRecord;
  const out = validateH1GoldForwardEvidence(adapter(), forged);
  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockerCodes.some((code) => code.startsWith("FROZEN_SIDE_MISMATCH:")));
});

test("partial later observation is blocked to prevent survivorship evidence", () => {
  const made = createBusinessForwardJournal({
    decisionId: "GOLD-D2",
    snapshotId: SNAPSHOT_ID,
    observedAtMs: T0_MS,
    selectedCandidateKey: KEY,
    eligibleCandidates: [
      { candidateKey: KEY, symbol: "NIFTY", optionSide: "CE", strike: 23250, expiryDate: "2026-09-22", dte: 6, premiumLtp: 100 },
      { candidateKey: "NIFTY:CE:23300:2026-09-22:DTE6:OTM", symbol: "NIFTY", optionSide: "CE", strike: 23300, expiryDate: "2026-09-22", dte: 6, premiumLtp: 80 },
    ],
  });
  assert.equal(made.ready, true);
  const appended = appendForwardOutcome(made.record!, {
    window: "T_PLUS_3M",
    observedAtMs: T0_MS + 3 * 60_000,
    premiumByCandidateKey: { [KEY]: 110 },
  });
  assert.equal(appended.ready, true);
  const out = validateH1GoldForwardEvidence(adapter(), appended.record!);
  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockerCodes.includes("SURVIVORSHIP_PARTIAL_OUTCOME:T_PLUS_3M"));
});

test("forged outcome before its named target window is blocked", () => {
  const record = emptyJournal();
  const forged = {
    ...record,
    outcomes: [{
      window: "T_PLUS_15M" as const,
      observedAtMs: T0_MS + 3 * 60_000,
      premiumByCandidateKey: { [KEY]: 105 },
    }],
  } as BusinessForwardJournalRecord;
  const out = validateH1GoldForwardEvidence(adapter(), forged);
  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockerCodes.includes("FORWARD_WINDOW_OBSERVED_BEFORE_TARGET:T_PLUS_15M"));
});

test("forged duplicate forward window is blocked", () => {
  const record = withOutcome(110);
  const first = record.outcomes[0];
  const forged = { ...record, outcomes: [first, { ...first, observedAtMs: first.observedAtMs + 1 }] } as BusinessForwardJournalRecord;
  const out = validateH1GoldForwardEvidence(adapter(), forged);
  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockerCodes.includes("DUPLICATE_FORWARD_WINDOW:T_PLUS_3M"));
});
