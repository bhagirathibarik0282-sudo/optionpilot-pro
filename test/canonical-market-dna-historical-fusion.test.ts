import test from "node:test";
import assert from "node:assert/strict";
import { fuseMarketDnaWithHistoricalMemory } from "../canonical-market-dna-historical-fusion.ts";
import type { MarketDnaContext } from "../canonical-market-dna-context.ts";
import type { MarketDnaHistoricalMemory } from "../canonical-market-dna-historical-memory.ts";

function live(): MarketDnaContext {
  return {
    version: "CANONICAL_MARKET_DNA_CONTEXT_V1",
    ready: true,
    regime: "BROAD_RISK_ON",
    rotationState: "BROAD_SYNCHRONY",
    divergenceState: "NONE",
    participationBreadthPct: 100,
    largeCapReturnPct: 0.5,
    broadMarketReturnPct: 0.45,
    midSmallReturnPct: 0.4,
    largeCapConcentrationSpreadPct: 0.05,
    sizeRotationSpreadPct: -0.1,
    advancingIndexCount: 7,
    decliningIndexCount: 0,
    flatIndexCount: 0,
    weightedConstituentBreadthReady: false,
    weightedConstituentBreadthPct: null,
    contextOnly: true,
    duplicateVoteForbidden: true,
    mayConfirmContext: true,
    mayDowngradeConfidence: true,
    mayFlagDivergence: true,
    grantsDirectionalSupport: false,
    affectsVerdictDirectly: false,
    affectsCandidateDirectly: false,
    affectsTelegramDirectly: false,
    affectsExecution: false,
    repairsMissingEvidence: false,
    failClosed: true,
    blockers: [],
  };
}

function historical(): MarketDnaHistoricalMemory {
  return {
    version: "CANONICAL_MARKET_DNA_HISTORICAL_MEMORY_V1",
    ready: true,
    exactSevenCoverage: true,
    latestTradeDate: "2026-08-21",
    alignedLatestDate: true,
    minimumObservations: 2636,
    archiveBeyond320Ready: true,
    tenYearWindowReady: true,
    rows: [],
    contextOnly: true,
    readOnly: true,
    duplicateVoteForbidden: true,
    affectsDirection: false,
    affectsVerdict: false,
    affectsCandidate: false,
    affectsTelegram: false,
    affectsExecution: false,
    mutatesData: false,
    failClosed: true,
    blockers: [],
  };
}

test("fuses live Market DNA with full historical memory without creating a vote", () => {
  const result = fuseMarketDnaWithHistoricalMemory(live(), historical());
  assert.equal(result.ready, true);
  assert.equal(result.historicalObservationFloor, 2636);
  assert.deepEqual(result.historicalWindowReady, { d20: true, d60: true, d120: true, d252: true, d756: true, d1260: true, d2520: true });
  assert.equal(result.grantsDirectionalSupport, false);
  assert.equal(result.affectsVerdictDirectly, false);
  assert.equal(result.affectsCandidateDirectly, false);
  assert.equal(result.affectsTelegramDirectly, false);
  assert.equal(result.affectsExecution, false);
  assert.equal(result.repairsMissingEvidence, false);
});

test("fails closed when historical memory is not ready", () => {
  const memory = historical();
  memory.ready = false;
  memory.blockers = ["STALE"];
  const result = fuseMarketDnaWithHistoricalMemory(live(), memory);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("MARKET_DNA_HISTORICAL_NOT_READY"));
});

test("fails closed on authority tampering", () => {
  const memory = historical();
  memory.affectsVerdict = true;
  const result = fuseMarketDnaWithHistoricalMemory(live(), memory);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("MARKET_DNA_HISTORICAL_AUTHORITY_TAMPERED"));
});
