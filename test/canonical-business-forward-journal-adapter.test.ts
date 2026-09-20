import test from "node:test";
import assert from "node:assert/strict";
import { buildCanonicalBusinessForwardJournal } from "../canonical-business-forward-journal-adapter.js";

const decisionId = "decision-forward-1";
const snapshotId = "snapshot-forward-1";
const candidateKey = "NIFTY:CE:23800:2026-09-22:DTE2:ATM";
const observedAtMs = Date.parse("2026-09-21T09:30:00+05:30");

const candidate:any = {
  decisionId,
  candidateKey,
  role: "OPTION_BUYER",
  symbol: "NIFTY",
  optionSide: "CE",
  strike: 23800,
  expiryDate: "2026-09-22",
  dte: 2,
  moneyness: "ATM",
  premiumLtp: 100,
  dteBucket: "NEAR_2_4",
  sourceAuthority: "EXECUTION_CANDIDATE_SELECTOR_V2",
};

const consumer:any = {
  version: "CANONICAL_BUSINESS_CONSUMER_V1",
  buyerCandidate: candidate,
  horizons: [],
  telegram: { allowed: true, reason: "BUYER_READY" },
  decisionId,
  candidateKey,
  sameCanonicalCandidateForDashboardAndTelegram: true,
  affectsExecution: false,
  createsOrders: false,
  aiMayOverride: false,
};

const missionInput:any = {
  provenance: "LIVE_CANONICAL_BUSINESS_MISSION_V1",
  snapshotId,
  decisionId,
  snapshotAsOfMs: observedAtMs,
};

const missionResult:any = {
  version: "CANONICAL_BUSINESS_CANDIDATE_MISSION_V1",
  ready: true,
  state: "BUSINESS_CANDIDATE_READY",
  snapshotId,
  decisionId,
  candidateKey,
  meaningfulContractKey: candidateKey,
  blockers: [],
  soleSelectorAuthority: "EXECUTION_CANDIDATE_SELECTOR_V2",
  telegramTransportReady: true,
  niftySensexMutualExclusion: true,
  bankNiftyObservationOnly: true,
  createsOrders: false,
  affectsExecution: false,
  aiMayOverride: false,
  failClosed: true,
};

test("freezes the exact canonical buyer candidate into the existing forward journal", () => {
  const out = buildCanonicalBusinessForwardJournal({ missionInput, missionResult, consumer });
  assert.equal(out.ready, true);
  assert.equal(out.decisionId, decisionId);
  assert.equal(out.candidateKey, candidateKey);
  assert.equal(out.journal?.anchor.decisionId, decisionId);
  assert.equal(out.journal?.anchor.snapshotId, snapshotId);
  assert.equal(out.journal?.anchor.observedAtMs, observedAtMs);
  assert.equal(out.journal?.anchor.selectedCandidateKey, candidateKey);
  assert.equal(out.journal?.anchor.eligibleCandidates.length, 1);
  assert.equal(out.journal?.anchor.eligibleCandidates[0].candidateKey, candidateKey);
  assert.equal(out.journal?.anchor.eligibleCandidates[0].premiumLtp, 100);
  assert.equal(out.affectsCandidateAuthority, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.createsOrders, false);
});

test("fails closed when mission and consumer decision identities differ", () => {
  const out = buildCanonicalBusinessForwardJournal({
    missionInput,
    missionResult,
    consumer: { ...consumer, decisionId: "drifted-decision" },
  });
  assert.equal(out.ready, false);
  assert.equal(out.journal, null);
  assert.ok(out.blockers.includes("CANONICAL_CONSUMER_IDENTITY_MISMATCH"));
});

test("fails closed when mission candidate differs from canonical consumer", () => {
  const out = buildCanonicalBusinessForwardJournal({
    missionInput,
    missionResult: { ...missionResult, candidateKey: "different-candidate" },
    consumer,
  });
  assert.equal(out.ready, false);
  assert.equal(out.journal, null);
  assert.ok(out.blockers.includes("MISSION_CONSUMER_CANDIDATE_IDENTITY_MISMATCH"));
});

test("fails closed on snapshot or T0 timestamp drift", () => {
  const badSnapshot = buildCanonicalBusinessForwardJournal({
    missionInput,
    missionResult: { ...missionResult, snapshotId: "other-snapshot" },
    consumer,
  });
  assert.equal(badSnapshot.ready, false);
  assert.ok(badSnapshot.blockers.includes("MISSION_SNAPSHOT_ID_MISMATCH"));

  const badTime = buildCanonicalBusinessForwardJournal({
    missionInput: { ...missionInput, snapshotAsOfMs: Number.NaN },
    missionResult,
    consumer,
  });
  assert.equal(badTime.ready, false);
  assert.ok(badTime.blockers.includes("VALID_CANONICAL_T0_TIMESTAMP_REQUIRED"));
});

test("rejects any non-authoritative candidate source", () => {
  const out = buildCanonicalBusinessForwardJournal({
    missionInput,
    missionResult,
    consumer: { ...consumer, buyerCandidate: { ...candidate, sourceAuthority: "LEGACY_SELECTOR" } },
  });
  assert.equal(out.ready, false);
  assert.equal(out.journal, null);
  assert.ok(out.blockers.includes("AUTHORITATIVE_BUYER_CANDIDATE_REQUIRED"));
});


test("rejects unsafe canonical consumer authority flags", () => {
  const out = buildCanonicalBusinessForwardJournal({
    missionInput,
    missionResult,
    consumer: { ...consumer, affectsExecution: true },
  });
  assert.equal(out.ready, false);
  assert.equal(out.journal, null);
  assert.ok(out.blockers.includes("CANONICAL_CONSUMER_AUTHORITY_BOUNDARY_INVALID"));
});
