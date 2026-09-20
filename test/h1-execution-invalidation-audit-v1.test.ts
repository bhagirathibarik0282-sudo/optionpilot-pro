import test from "node:test";
import assert from "node:assert/strict";
import { buildH1ExecutionInvalidationAuditV1 } from "../h1-execution-invalidation-audit-v1.js";

const request:any = {
  symbol: "NIFTY",
  tradeDate: "2026-09-18",
  fromTime: "09:15",
  toTime: "15:30",
  scope: "FULL",
};

function replay(options:any[]) {
  return {
    ok: true,
    mode: "READ_ONLY_H1_3M_REPLAY",
    productionImpact: "NONE",
    request,
    options,
  } as any;
}

const candidate = {
  symbol: "NIFTY",
  minute_bucket: "2026-09-18T04:00:00.000Z",
  truth_verdict: "TRUE",
  expiry: "2026-09-22",
  strike: 23350,
  option_type: "CE",
  is_candidate: true,
  ask: 100,
  bid: 99,
  pdl: 90,
  day_low: 95,
};

test("describes PDL and observed-day-low without selecting either as stop authority", () => {
  const out = buildH1ExecutionInvalidationAuditV1(request, replay([
    candidate,
    {
      ...candidate,
      minute_bucket: "2026-09-18T04:15:00.000Z",
      is_candidate: false,
      bid: 94,
      ask: 95,
    },
    {
      ...candidate,
      minute_bucket: "2026-09-18T04:30:00.000Z",
      is_candidate: false,
      bid: 88,
      ask: 89,
    },
  ]));

  assert.equal(out.candidateObservationCount, 1);
  assert.equal(out.uniqueCandidateContractCount, 1);
  assert.equal(out.sourceSelectionDecision, "NOT_SELECTED");
  assert.equal(out.thresholdPromoted, false);
  assert.equal(out.affectsSelector, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.createsOrders, false);

  const pdl15 = out.summaries.find((x) => x.source === "OPTION_PDL" && x.horizonMinutes === 15)!;
  const pdl30 = out.summaries.find((x) => x.source === "OPTION_PDL" && x.horizonMinutes === 30)!;
  const low15 = out.summaries.find((x) => x.source === "OBSERVED_DAY_LOW" && x.horizonMinutes === 15)!;

  assert.equal(pdl15.levelAvailableCount, 1);
  assert.equal(pdl15.forwardCoveredCount, 1);
  assert.equal(pdl15.stopObservedCount, 0);
  assert.equal(pdl30.stopObservedCount, 1);
  assert.equal(low15.stopObservedCount, 1);
  assert.equal(pdl15.medianStopDistancePct, 10);
  assert.equal(low15.medianStopDistancePct, 5);
});

test("future path is same-contract, later-only, TRUE and positive-bid only", () => {
  const out = buildH1ExecutionInvalidationAuditV1(request, replay([
    {
      ...candidate,
      minute_bucket: "2026-09-18T03:57:00.000Z",
      is_candidate: false,
      bid: 80,
    },
    candidate,
    {
      ...candidate,
      minute_bucket: "2026-09-18T04:03:00.000Z",
      is_candidate: false,
      truth_verdict: "PARTIAL",
      bid: 80,
    },
    {
      ...candidate,
      minute_bucket: "2026-09-18T04:06:00.000Z",
      is_candidate: false,
      bid: 0,
    },
    {
      ...candidate,
      minute_bucket: "2026-09-18T04:09:00.000Z",
      is_candidate: false,
      strike: 23400,
      bid: 80,
    },
    {
      ...candidate,
      minute_bucket: "2026-09-18T04:12:00.000Z",
      is_candidate: false,
      bid: 94,
    },
  ]));

  const pdl15 = out.summaries.find((x) => x.source === "OPTION_PDL" && x.horizonMinutes === 15)!;
  assert.equal(pdl15.forwardCoveredCount, 1);
  assert.equal(pdl15.stopObservedCount, 0);
  const example = out.exampleObservations.find((x) => x.source === "OPTION_PDL" && x.horizonMinutes === 15)!;
  assert.equal(example.forwardBidRowCount, 1);
  assert.equal(example.stopObserved, false);
});

test("fails closed when recorded candidate levels are not below entry", () => {
  const out = buildH1ExecutionInvalidationAuditV1(request, replay([
    { ...candidate, pdl: 100, day_low: 101 },
  ]));
  assert.ok(out.blockers.includes("NO_RECORDED_INVALIDATION_LEVEL_BELOW_ENTRY"));
  assert.ok(out.blockers.includes("NO_SAME_CONTRACT_FORWARD_BID_COVERAGE"));
  assert.ok(out.summaries.every((x) => x.levelAvailableCount === 0));
});

test("surfaces replay failure without fabricating evidence", () => {
  const out = buildH1ExecutionInvalidationAuditV1(request, {
    ok: false,
    mode: "READ_ONLY_H1_3M_REPLAY",
    productionImpact: "NONE",
    request,
    reason: "DATABASE_URL_NOT_CONFIGURED",
  } as any);
  assert.ok(out.blockers.includes("DATABASE_URL_NOT_CONFIGURED"));
  assert.equal(out.candidateObservationCount, 0);
  assert.equal(out.sourceSelectionDecision, "NOT_SELECTED");
  assert.equal(out.affectsExecution, false);
});
