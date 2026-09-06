import test from "node:test";
import assert from "node:assert/strict";
import { createBusinessForwardJournal } from "../business-forward-journal-v1.ts";
import { clearH1LiveSelectorRegistry, publishH1LiveGateEvidence } from "../h1-live-selector-registry.ts";
import { collectBusinessForwardOutcomeFromH1Registry } from "../business-forward-live-outcome-collector-v1.ts";

function journal() {
  const made = createBusinessForwardJournal({
    decisionId: "D1",
    snapshotId: "S1",
    observedAtMs: Date.parse("2026-09-07T09:30:00.000+05:30"),
    selectedCandidateKey: "NIFTY:CE:24100:2026-09-08:DTE1:ATM",
    eligibleCandidates: [{
      candidateKey: "NIFTY:CE:24100:2026-09-08:DTE1:ATM",
      symbol: "NIFTY",
      optionSide: "CE",
      strike: 24100,
      expiryDate: "2026-09-08",
      dte: 1,
      premiumLtp: 100,
    }],
  });
  assert.equal(made.ready, true);
  return made.record!;
}

function publish(nowIso: string, premiumLtp = 110) {
  const gate = (value: boolean) => ({ value, observedAt: nowIso, source: "test", provenance: "LIVE_RUNTIME_EXACT" as const });
  return publishH1LiveGateEvidence({
    identity: {
      symbol: "NIFTY", side: "CE", strike: 24100, expiryDate: "2026-09-08", dte: 1, moneyness: "ATM",
      premiumLtp, observedAt: nowIso, source: "test", provenance: "LIVE_RUNTIME_EXACT",
    },
    gates: {
      capitalFit: gate(true), liquidityOk: gate(true), spreadOk: gate(true),
      premiumResponseConfirmed: gate(true), deltaGammaResponseConfirmed: gate(true),
      thetaIvBurdenAcceptable: gate(true), multiExpiryConflictAbsent: gate(true),
      currentOrNearExpiryUsable: gate(true),
    },
  });
}

test("captures exact-live T+3m outcome into immutable journal", () => {
  clearH1LiveSelectorRegistry();
  const nowIso = "2026-09-07T09:33:00.000+05:30";
  assert.equal(publish(nowIso, 112).accepted, true);
  const out = collectBusinessForwardOutcomeFromH1Registry({
    journal: journal(),
    nowIso,
    window: "T_PLUS_3M",
  });
  assert.equal(out.ready, true);
  assert.equal(out.matchedCandidateCount, 1);
  assert.equal(out.record!.outcomes.length, 1);
  assert.equal(out.record!.outcomes[0].premiumByCandidateKey["NIFTY:CE:24100:2026-09-08:DTE1:ATM"], 112);
  assert.equal(out.affectsCandidateAuthority, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  clearH1LiveSelectorRegistry();
});

test("rejects capture before target time", () => {
  clearH1LiveSelectorRegistry();
  const out = collectBusinessForwardOutcomeFromH1Registry({
    journal: journal(),
    nowIso: "2026-09-07T09:32:59.000+05:30",
    window: "T_PLUS_3M",
  });
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("FORWARD_WINDOW_NOT_REACHED"));
});

test("rejects missing frozen candidate instead of partial capture", () => {
  clearH1LiveSelectorRegistry();
  const nowIso = "2026-09-07T09:33:00.000+05:30";
  const out = collectBusinessForwardOutcomeFromH1Registry({
    journal: journal(),
    nowIso,
    window: "T_PLUS_3M",
  });
  assert.equal(out.ready, false);
  assert.ok(out.blockers.some((x) => x.includes("FROZEN_CANDIDATE_NOT_IN_EXACT_LIVE_REGISTRY") || x === "H1_LIVE_SELECTOR_REGISTRY_NOT_READY"));
});
