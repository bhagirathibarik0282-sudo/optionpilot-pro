import test from "node:test";
import assert from "node:assert/strict";
import {
  buildH1LivePpdSupport,
  clearH1LivePpdHistory,
  recordH1LivePpdQuote,
  type LivePpdQuoteIdentity,
} from "../h1-live-ppd-support-v1.js";
import {
  assembleLiveExecutionCandidateInput,
  type LiveGateEvidencePacket,
  type LiveGateName,
} from "../h1-live-gate-evidence-assembler.js";

function liveIdentity(side: "CE" | "PE", premiumLtp: number, observedAt: string): LivePpdQuoteIdentity {
  return {
    symbol: "NIFTY",
    side,
    strike: 24000,
    expiryDate: "2026-09-15",
    premiumLtp,
    observedAt,
    provenance: "LIVE_RUNTIME_EXACT",
  };
}

function recordPair(observedAt: string, ce: number, pe: number): void {
  recordH1LivePpdQuote(liveIdentity("CE", ce, observedAt));
  recordH1LivePpdQuote(liveIdentity("PE", pe, observedAt));
}

function gate(value: boolean, observedAt: string) {
  return { value, observedAt, source: "live-runtime-test", provenance: "LIVE_RUNTIME_EXACT" as const };
}

function selectorPacket(observedAt: string, premiumResponseConfirmed: boolean): LiveGateEvidencePacket {
  const gates: Partial<Record<LiveGateName, ReturnType<typeof gate>>> = {
    capitalFit: gate(true, observedAt),
    liquidityOk: gate(true, observedAt),
    spreadOk: gate(true, observedAt),
    premiumResponseConfirmed: gate(premiumResponseConfirmed, observedAt),
    deltaGammaResponseConfirmed: gate(true, observedAt),
    thetaIvBurdenAcceptable: gate(true, observedAt),
    multiExpiryConflictAbsent: gate(true, observedAt),
    currentOrNearExpiryUsable: gate(true, observedAt),
  };
  return {
    identity: {
      symbol: "NIFTY",
      side: "CE",
      strike: 24000,
      expiryDate: "2026-09-15",
      dte: 6,
      moneyness: "ATM",
      premiumLtp: 130,
      observedAt,
      source: "live-runtime-test",
      provenance: "LIVE_RUNTIME_EXACT",
    },
    gates: {
      ...gates,
      fallbackDteApproved: gate(true, observedAt),
    },
  };
}

test("3m/6m/15m controlled CE expansion produces bounded PPD support", () => {
  clearH1LivePpdHistory();
  recordPair("2026-09-09T09:00:00.000Z", 100, 100);
  recordPair("2026-09-09T09:09:00.000Z", 110, 90);
  recordPair("2026-09-09T09:12:00.000Z", 120, 80);
  recordPair("2026-09-09T09:15:00.000Z", 130, 70);

  const support = buildH1LivePpdSupport(liveIdentity("CE", 130, "2026-09-09T09:15:00.000Z"));
  assert.ok(support);
  assert.equal(support?.allRequiredWindowsReady, true);
  assert.equal(support?.candidateConfirmed, true);
  assert.deepEqual(support?.windows.map((window) => window.windowMinutes), [3, 6, 15]);
  assert.ok(support?.windows.every((window) => window.candidateControlledExpansion));
  assert.equal(support?.standaloneTrigger, false);
});

test("PPD does not confirm when one required window lacks candidate-controlled expansion", () => {
  clearH1LivePpdHistory();
  recordPair("2026-09-09T09:00:00.000Z", 100, 100);
  recordPair("2026-09-09T09:09:00.000Z", 140, 60);
  recordPair("2026-09-09T09:12:00.000Z", 140, 60);
  recordPair("2026-09-09T09:15:00.000Z", 130, 70);

  const support = buildH1LivePpdSupport(liveIdentity("CE", 130, "2026-09-09T09:15:00.000Z"));
  assert.ok(support);
  assert.equal(support?.allRequiredWindowsReady, true);
  assert.equal(support?.candidateConfirmed, false);
  assert.ok(support?.reasonCodes.some((reason) => reason.includes("CANDIDATE_CONTROL_NOT_CONFIRMED")));
});

test("confirmed PPD can rescue only the premium-response gate when companion gates are already ready", () => {
  clearH1LivePpdHistory();
  recordPair("2026-09-09T09:00:00.000Z", 100, 100);
  recordPair("2026-09-09T09:09:00.000Z", 110, 90);
  recordPair("2026-09-09T09:12:00.000Z", 120, 80);
  recordPair("2026-09-09T09:15:00.000Z", 130, 70);
  const support = buildH1LivePpdSupport(liveIdentity("CE", 130, "2026-09-09T09:15:00.000Z"));
  assert.ok(support?.candidateConfirmed);

  const packet = selectorPacket("2026-09-09T09:15:00.000Z", false);
  packet.ppdSupport = support!;
  const result = assembleLiveExecutionCandidateInput(packet, "2026-09-09T09:15:30.000Z", 90_000);
  assert.equal(result.ready, true);
  assert.equal(result.ppdAudit.usedAsPremiumRescue, true);
  assert.equal(result.candidate?.premiumResponseConfirmed, true);
  assert.equal(result.candidate?.deltaGammaResponseConfirmed, true);
});

test("PPD cannot rescue premium response when multi-expiry conflict is present", () => {
  clearH1LivePpdHistory();
  recordPair("2026-09-09T09:00:00.000Z", 100, 100);
  recordPair("2026-09-09T09:09:00.000Z", 110, 90);
  recordPair("2026-09-09T09:12:00.000Z", 120, 80);
  recordPair("2026-09-09T09:15:00.000Z", 130, 70);
  const support = buildH1LivePpdSupport(liveIdentity("CE", 130, "2026-09-09T09:15:00.000Z"));

  const packet = selectorPacket("2026-09-09T09:15:00.000Z", false);
  packet.gates.multiExpiryConflictAbsent = gate(false, "2026-09-09T09:15:00.000Z");
  packet.ppdSupport = support!;
  const result = assembleLiveExecutionCandidateInput(packet, "2026-09-09T09:15:30.000Z", 90_000);
  assert.equal(result.ready, true);
  assert.equal(result.ppdAudit.usedAsPremiumRescue, false);
  assert.equal(result.candidate?.premiumResponseConfirmed, false);
  assert.equal(result.candidate?.multiExpiryConflictAbsent, false);
});

test("stale PPD evidence is ignored rather than promoted", () => {
  clearH1LivePpdHistory();
  recordPair("2026-09-09T09:00:00.000Z", 100, 100);
  recordPair("2026-09-09T09:09:00.000Z", 110, 90);
  recordPair("2026-09-09T09:12:00.000Z", 120, 80);
  recordPair("2026-09-09T09:15:00.000Z", 130, 70);
  const support = buildH1LivePpdSupport(liveIdentity("CE", 130, "2026-09-09T09:15:00.000Z"));

  const packet = selectorPacket("2026-09-09T09:15:00.000Z", false);
  packet.ppdSupport = support!;
  const result = assembleLiveExecutionCandidateInput(packet, "2026-09-09T09:17:00.000Z", 90_000);
  assert.equal(result.ready, false);
  assert.equal(result.ppdAudit.fresh, false);
  assert.equal(result.ppdAudit.usedAsPremiumRescue, false);
});
