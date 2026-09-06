import test from "node:test";
import assert from "node:assert/strict";
import { buildMarketDnaContext } from "../canonical-market-dna-context.ts";
import {
  CANONICAL_SEVEN_INDEX_MARKET_VALUE_PARSER_V1,
  type SevenIndexMarketValueResult,
  type SevenIndexMarketValueRow,
} from "../canonical-seven-index-market-value-parser.ts";
import { CANONICAL_SEVEN_INDEX_SCOPE } from "../canonical-seven-index-intelligence-freeze.ts";

function makeResult(values: number[]): SevenIndexMarketValueResult {
  const rows: SevenIndexMarketValueRow[] = CANONICAL_SEVEN_INDEX_SCOPE.map((indexId, i) => {
    const previousClose = 10000 + i * 100;
    const changePct = values[i];
    const change = (previousClose * changePct) / 100;
    const ltp = previousClose + change;
    return {
      indexId,
      officialName: indexId,
      nseApiName: indexId,
      sourceUrl: "https://www.nseindia.com/api/allIndices",
      ltp,
      change,
      changePct,
      previousClose,
      advances: 1,
      declines: 0,
      unchanged: 0,
      fetchedAt: "2026-09-06T03:00:00.000Z",
    };
  });
  return {
    version: CANONICAL_SEVEN_INDEX_MARKET_VALUE_PARSER_V1,
    ready: true,
    rows,
    blockers: [],
    readOnly: true,
    contextOnly: true,
    parsesMarketValues: true,
    calculatesWeightedBreadth: false,
    grantsDirectionalSupport: false,
    affectsVerdict: false,
    affectsCandidate: false,
    affectsTelegram: false,
    affectsExecution: false,
    failClosed: true,
  };
}

test("classifies broad risk-on without granting a duplicate directional vote", () => {
  const result = buildMarketDnaContext(makeResult([0.6, 0.58, 0.59, 0.61, 0.62, 0.63, 0.64]));
  assert.equal(result.ready, true);
  assert.equal(result.regime, "BROAD_RISK_ON");
  assert.equal(result.rotationState, "BROAD_SYNCHRONY");
  assert.equal(result.divergenceState, "NONE");
  assert.equal(result.advancingIndexCount, 7);
  assert.equal(result.grantsDirectionalSupport, false);
  assert.equal(result.affectsVerdictDirectly, false);
  assert.equal(result.affectsCandidateDirectly, false);
  assert.equal(result.affectsTelegramDirectly, false);
  assert.equal(result.affectsExecution, false);
  assert.equal(result.repairsMissingEvidence, false);
  assert.equal(result.duplicateVoteForbidden, true);
});

test("detects narrow large-cap leadership and market-DNA divergence", () => {
  const result = buildMarketDnaContext(makeResult([0.8, 0.55, 0.65, 0.1, -0.05, -0.25, -0.35]));
  assert.equal(result.ready, true);
  assert.equal(result.regime, "NARROW_LARGECAP");
  assert.equal(result.rotationState, "LARGE_CAP_LEAD");
  assert.ok(["LARGECAP_VS_BROAD", "INTERNAL_MIXED"].includes(result.divergenceState!));
  assert.ok((result.largeCapConcentrationSpreadPct ?? 0) > 0.2);
});

test("detects mid/small-cap rotation instead of treating it as an independent trade signal", () => {
  const result = buildMarketDnaContext(makeResult([0.05, 0.1, 0.08, 0.2, 0.3, 0.75, 0.85]));
  assert.equal(result.ready, true);
  assert.equal(result.regime, "MID_SMALL_ROTATION");
  assert.equal(result.rotationState, "MID_SMALL_LEAD");
  assert.ok((result.sizeRotationSpreadPct ?? 0) > 0.2);
  assert.equal(result.mayConfirmContext, true);
  assert.equal(result.mayDowngradeConfidence, true);
  assert.equal(result.mayFlagDivergence, true);
  assert.equal(result.grantsDirectionalSupport, false);
});

test("does not pretend index-count participation is weighted constituent breadth", () => {
  const result = buildMarketDnaContext(makeResult([0.2, 0.1, 0.15, 0.12, 0.08, -0.05, -0.1]));
  assert.equal(result.ready, true);
  assert.equal(result.weightedConstituentBreadthReady, false);
  assert.equal(result.weightedConstituentBreadthPct, null);
  assert.equal(typeof result.participationBreadthPct, "number");
});

test("fails closed on unready, incomplete or authority-tampered upstream evidence", () => {
  const unready = makeResult([0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1]);
  unready.ready = false;
  assert.equal(buildMarketDnaContext(unready).ready, false);

  const incomplete = makeResult([0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1]);
  incomplete.rows = incomplete.rows.slice(0, 6);
  assert.equal(buildMarketDnaContext(incomplete).ready, false);

  const tampered = makeResult([0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1]);
  tampered.grantsDirectionalSupport = true;
  const result = buildMarketDnaContext(tampered);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("MARKET_DNA_SOURCE_AUTHORITY_TAMPERED"));
});
