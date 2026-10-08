import assert from "node:assert/strict";
import test from "node:test";
import {
  clearH1LiveSelectorRegistry,
  collectH1LiveSelectorDecisions,
  getH1LiveSelectorRegistrySize,
  publishH1LiveGateEvidence,
  persistH1LiveGateEvidenceCalibrationOnly,
  getH1DiagnosticPersistenceStats,
  collectH1LiveGateEvidenceAudit,
} from "../h1-live-selector-registry.js";
import type { LiveGateEvidencePacket } from "../h1-live-gate-evidence-assembler.js";
import { H1DiagnosticLogCadence, H1_DIAGNOSTIC_LOG_MAX_KEYS, diagnosticSamplingMetadata } from "../h1-diagnostic-log-cadence.js";

function gate(value: boolean, observedAt: string) {
  return { value, observedAt, source: "LIVE_TEST", provenance: "LIVE_RUNTIME_EXACT" as const };
}

function packet(observedAt: string): LiveGateEvidencePacket {
  return {
    identity: {
      symbol: "NIFTY" as const,
      side: "CE" as const,
      strike: 24000,
      expiryDate: "2026-09-08",
      dte: 5,
      moneyness: "ATM" as const,
      premiumLtp: 100,
      observedAt,
      source: "LIVE_TEST",
      provenance: "LIVE_RUNTIME_EXACT" as const,
    },
    gates: {
      capitalFit: gate(true, observedAt),
      liquidityOk: gate(true, observedAt),
      spreadOk: gate(true, observedAt),
      premiumResponseConfirmed: gate(true, observedAt),
      deltaGammaResponseConfirmed: gate(true, observedAt),
      thetaIvBurdenAcceptable: gate(true, observedAt),
      multiExpiryConflictAbsent: gate(true, observedAt),
      currentOrNearExpiryUsable: gate(true, observedAt),
      fallbackDteApproved: gate(true, observedAt),
    },
  };
}

test("empty registry emits zero decisions", () => {
  clearH1LiveSelectorRegistry();
  const out = collectH1LiveSelectorDecisions("2026-09-03T09:30:00.000Z");
  assert.equal(out.decisions.length, 0);
  assert.equal(getH1LiveSelectorRegistrySize(), 0);
});

test("exact live packet is accepted and produces selector decision", () => {
  clearH1LiveSelectorRegistry();
  const ts = "2026-09-03T09:30:00.000Z";
  assert.equal(publishH1LiveGateEvidence(packet(ts)).accepted, true);
  const out = collectH1LiveSelectorDecisions(ts);
  assert.equal(out.eligibleForLiveH1Marking, true);
  assert.equal(out.decisions.length, 1);
  assert.equal(out.decisions[0].decision, "SELECT");
});

test("calibration-only persistence never enters the live selector registry", () => {
  clearH1LiveSelectorRegistry();
  const ts = "2026-09-03T09:30:00.000Z";
  const out = persistH1LiveGateEvidenceCalibrationOnly(packet(ts));
  assert.equal(out.accepted, true);
  assert.equal(out.reason, "LIVE_GATE_PACKET_PERSISTED_CALIBRATION_ONLY");
  assert.equal(getH1LiveSelectorRegistrySize(), 0);
  assert.equal(collectH1LiveSelectorDecisions(ts).decisions.length, 0);
});

test("stale packet is evicted and cannot mark candidate", () => {
  clearH1LiveSelectorRegistry();
  assert.equal(publishH1LiveGateEvidence(packet("2026-09-03T09:20:00.000Z")).accepted, true);
  const out = collectH1LiveSelectorDecisions("2026-09-03T09:30:00.000Z", 90_000);
  assert.equal(out.decisions.length, 0);
  assert.equal(getH1LiveSelectorRegistrySize(), 0);
});

test("future-dated packet is evicted", () => {
  clearH1LiveSelectorRegistry();
  assert.equal(publishH1LiveGateEvidence(packet("2026-09-03T09:31:00.000Z")).accepted, true);
  const out = collectH1LiveSelectorDecisions("2026-09-03T09:30:00.000Z", 90_000);
  assert.equal(out.decisions.length, 0);
  assert.equal(getH1LiveSelectorRegistrySize(), 0);
});

test("duplicate exact contract uses latest packet", () => {
  clearH1LiveSelectorRegistry();
  const older = packet("2026-09-03T09:29:30.000Z");
  const newer = packet("2026-09-03T09:29:50.000Z");
  newer.gates.spreadOk = gate(false, "2026-09-03T09:29:50.000Z");
  publishH1LiveGateEvidence(older);
  publishH1LiveGateEvidence(newer);
  assert.equal(getH1LiveSelectorRegistrySize(), 1);
  const out = collectH1LiveSelectorDecisions("2026-09-03T09:30:00.000Z");
  assert.equal(out.decisions.length, 1);
  assert.equal(out.decisions[0].decision, "BLOCK");
  assert.ok(out.decisions[0].reasonCodes.includes("SPREAD_GATE_FAILED"));
});


function pairPacket(
  side: "CE" | "PE",
  premiumLtp: number,
  observedAt: string,
): LiveGateEvidencePacket {
  const value = packet(observedAt);
  return {
    ...value,
    identity: { ...value.identity, side, premiumLtp },
  };
}

test("PPD enrichment stays bound to the original exact packet object", () => {
  clearH1LiveSelectorRegistry();
  const rows = [
    ["2026-09-09T09:00:00.000Z", 100, 100],
    ["2026-09-09T09:09:00.000Z", 110, 90],
    ["2026-09-09T09:12:00.000Z", 120, 80],
    ["2026-09-09T09:15:00.000Z", 130, 70],
  ] as const;

  let finalCe: LiveGateEvidencePacket | null = null;
  let finalPe: LiveGateEvidencePacket | null = null;
  for (const [observedAt, ce, pe] of rows) {
    const cePacket = pairPacket("CE", ce, observedAt);
    const pePacket = pairPacket("PE", pe, observedAt);
    publishH1LiveGateEvidence(cePacket);
    publishH1LiveGateEvidence(pePacket);
    finalCe = cePacket;
    finalPe = pePacket;
  }

  assert.equal(finalCe?.ppdSupport?.candidateConfirmed, true);
  assert.equal(finalPe?.ppdSupport?.candidateConfirmed, false);
  assert.deepEqual(finalCe?.ppdSupport?.windows.map((window) => window.windowMinutes), [3, 6, 15]);
  assert.equal(finalCe?.ppdSupport?.standaloneTrigger, false);
});

test("dense diagnostic ticks admit one sample per contract per write minute", () => {
  const cadence = new H1DiagnosticLogCadence();
  const results = Array.from({ length: 10_000 }, (_, i) => cadence.admit("NIFTY|CE", i));
  assert.equal(results.filter((row) => row.accepted).length, 1);
  assert.equal(cadence.admit("NIFTY|PE", 10_000).accepted, true);
  assert.equal(cadence.admit("SENSEX|CE", 10_000).accepted, true);
  assert.equal(cadence.admit("NIFTY|CE", 60_000).accepted, true);
  assert.deepEqual(diagnosticSamplingMetadata(60_000), {
    mode: "FIRST_PER_CONTRACT_WRITE_MINUTE", intervalMs: 60_000,
    windowBasis: "PROCESS_WRITE_TIME", windowStart: "1970-01-01T00:01:00.000Z",
    completeTickHistory: false,
  });
});

test("rollback and malformed clocks cannot reopen diagnostic windows", () => {
  const cadence = new H1DiagnosticLogCadence();
  assert.equal(cadence.admit("CE", 120_000).accepted, true);
  for (const now of [60_000, NaN, Infinity, -1]) assert.equal(cadence.admit("PE", now).accepted, false);
  assert.equal(cadence.admit("", 120_000).accepted, false);
  assert.equal(cadence.admit("CE", 120_001).accepted, false);
  assert.equal(cadence.admit("CE", 180_000).accepted, true);
});

test("diagnostic key memory stays bounded without evicting and rewriting a sampled key", () => {
  const cadence = new H1DiagnosticLogCadence();
  for (let i = 0; i < H1_DIAGNOSTIC_LOG_MAX_KEYS; i++) assert.equal(cadence.admit(String(i), 0).accepted, true);
  assert.equal(cadence.admit("overflow", 0).accepted, false);
  assert.equal(cadence.admit("0", 0).accepted, false);
  assert.equal(cadence.stats().trackedKeys, H1_DIAGNOSTIC_LOG_MAX_KEYS);
  assert.equal(cadence.admit("overflow", 60_000).accepted, true);
  assert.equal(cadence.stats().trackedKeys, 1);
});

test("calibration sampling never throttles latest live packet or selector-path evidence", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-09-03T09:30:00Z") });
  clearH1LiveSelectorRegistry();
  const first = packet("2026-09-03T09:30:00.000Z");
  const latest = packet("2026-09-03T09:30:01.000Z");
  latest.identity.premiumLtp = 123;
  latest.gates.spreadOk = gate(false, latest.identity.observedAt);
  assert.equal(persistH1LiveGateEvidenceCalibrationOnly(first).reason, "LIVE_GATE_PACKET_PERSISTED_CALIBRATION_ONLY");
  assert.equal(persistH1LiveGateEvidenceCalibrationOnly(latest).reason, "LIVE_GATE_PACKET_CALIBRATION_ONLY_DIAGNOSTIC_SAMPLE_SKIPPED");
  assert.equal(getH1LiveSelectorRegistrySize(), 0);
  assert.deepEqual([getH1DiagnosticPersistenceStats().admitted, getH1DiagnosticPersistenceStats().skipped], [1, 1]);
  assert.equal(publishH1LiveGateEvidence(first).accepted, true);
  assert.equal(publishH1LiveGateEvidence(latest).accepted, true);
  assert.equal(getH1DiagnosticPersistenceStats().skipped, 1);
  const audit = collectH1LiveGateEvidenceAudit(latest.identity.observedAt);
  assert.equal(audit[0].identity.premiumLtp, 123);
  assert.equal(collectH1LiveSelectorDecisions(latest.identity.observedAt).decisions[0].decision, "BLOCK");
  for (let i = 0; i < 100; i++) {
    assert.equal(collectH1LiveSelectorDecisions(latest.identity.observedAt).decisions[0].decision, "BLOCK");
  }
  assert.equal(getH1DiagnosticPersistenceStats().admitted, 2);
  assert.equal(getH1DiagnosticPersistenceStats().skipped, 101);
  t.mock.timers.tick(60_000);
  assert.equal(persistH1LiveGateEvidenceCalibrationOnly(latest).reason, "LIVE_GATE_PACKET_PERSISTED_CALIBRATION_ONLY");
  assert.equal(getH1DiagnosticPersistenceStats().admitted, 3);
});

test("selected decision audits bypass the blocked diagnostic sampler", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-09-03T09:30:00Z") });
  clearH1LiveSelectorRegistry();
  const ts = "2026-09-03T09:30:00.000Z";
  publishH1LiveGateEvidence(packet(ts));
  for (let i = 0; i < 100; i++) assert.equal(collectH1LiveSelectorDecisions(ts).decisions[0].decision, "SELECT");
  assert.equal(getH1DiagnosticPersistenceStats().admitted, 0);
  assert.equal(getH1DiagnosticPersistenceStats().skipped, 0);
});
