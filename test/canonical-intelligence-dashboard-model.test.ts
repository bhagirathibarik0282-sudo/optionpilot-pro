import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalIntelligenceDashboardModel } from "../canonical-intelligence-dashboard-model.ts";
import { renderCanonicalIntelligenceDashboardHtml } from "../canonical-intelligence-dashboard-view.ts";

function readyFusion(): any {
  return {
    version: "CANONICAL_MARKET_DNA_HISTORICAL_FUSION_V1",
    ready: true,
    live: {
      version: "CANONICAL_MARKET_DNA_CONTEXT_V1",
      ready: true,
      regime: "BROAD_RISK_ON",
      rotationState: "BROAD_SYNCHRONY",
      divergenceState: "NONE",
      participationBreadthPct: 71.43,
      largeCapConcentrationSpreadPct: 0.08,
      sizeRotationSpreadPct: 0.04,
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
    },
    historical: {
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
    },
    latestHistoricalTradeDate: "2026-08-21",
    historicalObservationFloor: 2636,
    historicalWindowReady: { d20:true,d60:true,d120:true,d252:true,d756:true,d1260:true,d2520:true },
    contextOnly: true,
    readOnly: true,
    duplicateVoteForbidden: true,
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

test("dashboard consumes only canonical live plus historical fusion", () => {
  const model = buildCanonicalIntelligenceDashboardModel(readyFusion());
  assert.equal(model.ready, true);
  assert.equal(model.source, "MARKET_DNA_CONTEXT");
  assert.equal(model.regime, "BROAD_RISK_ON");
  assert.equal(model.historicalObservationFloor, 2636);
  assert.equal(model.tenYearWindowReady, true);
  assert.equal(model.weightedConstituentBreadthReady, false);
  assert.equal(model.weightedConstituentBreadthPct, null);
  assert.equal(model.grantsDirectionalSupport, false);
  assert.equal(model.affectsVerdictDirectly, false);
  assert.equal(model.affectsCandidateDirectly, false);
  assert.equal(model.affectsTelegramDirectly, false);
  assert.equal(model.affectsExecution, false);
  const html = renderCanonicalIntelligenceDashboardHtml(model);
  assert.match(html, /Same canonical live \+ recovered historical context/);
  assert.match(html, /TRUE WEIGHTED BREADTH/);
  assert.match(html, /NOT READY/);
  assert.match(html, /DISPLAY ONLY/);
});

test("dashboard fails closed on unready fusion", () => {
  const model = buildCanonicalIntelligenceDashboardModel({ ...readyFusion(), ready: false, live: null, historical: null, blockers: ["X"] });
  assert.equal(model.ready, false);
  assert.equal(model.regime, null);
  assert.deepEqual(model.blockers.sort(), ["CANONICAL_MARKET_DNA_CONTEXT_NOT_READY","X"].sort());
});
