import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalIntelligenceDashboardModel } from "../canonical-intelligence-dashboard-model.ts";
import { renderCanonicalIntelligenceDashboardHtml } from "../canonical-intelligence-dashboard-view.ts";
import { fuseMarketDnaWithHistoricalMemory } from "../canonical-market-dna-historical-fusion.ts";
import { buildMarketDnaContext } from "../canonical-market-dna-context.ts";
import { buildMarketDnaHistoricalMemory } from "../canonical-market-dna-historical-memory.ts";
import { RESEARCH_INDEX_CODES } from "../research-index-health.ts";

function daily(code: string, i: number) {
  const d = new Date(Date.UTC(2016, 0, 1 + i));
  return { indexCode: code, indexName: code, tradeDate: d.toISOString().slice(0,10), open: 100+i, high: 101+i, low: 99+i, close: 100+i, volume: null, source: "TEST", sourceUrl: "https://www.niftyindices.com", fetchedAt: new Date().toISOString(), freshnessStatus: "FRESH", validationStatus: "VALID", validationNotes: [] } as any;
}

test("dashboard consumes only canonical live plus historical fusion", () => {
  const values = [0.10,0.08,0.09,0.07,0.06,0.05,0.04].map((p, i) => ({ indexCode: RESEARCH_INDEX_CODES[i], indexName: RESEARCH_INDEX_CODES[i], ltp: 100+p, previousClose: 100, variation: p, returnPct: p, advances: null, declines: null, unchanged: null }));
  const live = buildMarketDnaContext({ version: "CANONICAL_SEVEN_INDEX_MARKET_VALUE_V1", ready: true, rows: values, sourceUrl: "https://www.nseindia.com/api/allIndices", fetchedAt: new Date().toISOString(), contextOnly: true, readOnly: true, grantsDirectionalSupport: false, affectsVerdict: false, affectsCandidate: false, affectsTelegram: false, affectsExecution: false, blockers: [] } as any);
  const histories: any = {};
  for (const code of RESEARCH_INDEX_CODES) histories[code] = Array.from({ length: 2636 }, (_, i) => daily(code, i));
  const historical = buildMarketDnaHistoricalMemory(histories);
  const fusion = fuseMarketDnaWithHistoricalMemory(live, historical);
  const model = buildCanonicalIntelligenceDashboardModel(fusion);
  assert.equal(model.ready, true);
  assert.equal(model.source, "MARKET_DNA_CONTEXT");
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
});

test("dashboard fails closed on unready fusion", () => {
  const model = buildCanonicalIntelligenceDashboardModel({ version: "CANONICAL_MARKET_DNA_HISTORICAL_FUSION_V1", ready: false, live: null, historical: null, latestHistoricalTradeDate: null, historicalObservationFloor: 0, historicalWindowReady: { d20:false,d60:false,d120:false,d252:false,d756:false,d1260:false,d2520:false }, contextOnly:true, readOnly:true, duplicateVoteForbidden:true, grantsDirectionalSupport:false, affectsVerdictDirectly:false, affectsCandidateDirectly:false, affectsTelegramDirectly:false, affectsExecution:false, repairsMissingEvidence:false, failClosed:true, blockers:["X"] });
  assert.equal(model.ready, false);
  assert.equal(model.regime, null);
  assert.deepEqual(model.blockers.sort(), ["CANONICAL_MARKET_DNA_CONTEXT_NOT_READY","X"].sort());
});
