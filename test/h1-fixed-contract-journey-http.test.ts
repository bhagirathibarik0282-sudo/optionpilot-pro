import test from "node:test";
import assert from "node:assert/strict";
import {
  buildH1FixedContractJourneyCoverage,
  parseH1FixedContractJourneyRequest,
} from "../h1-fixed-contract-journey-http.js";

test("parses one exact option contract journey without widening identity", () => {
  const parsed = parseH1FixedContractJourneyRequest({
    symbol: "nifty",
    expiry: "2026-10-08",
    strike: "24000",
    optionType: "ce",
    fromDate: "2026-10-01",
    toDate: "2026-10-08",
  });
  assert.deepEqual(parsed, {
    ok: true,
    value: {
      symbol: "NIFTY",
      expiry: "2026-10-08",
      strike: 24_000,
      optionType: "CE",
      fromDate: "2026-10-01",
      toDate: "2026-10-08",
      fromTime: "09:15",
      toTime: "15:30",
    },
  });
});

test("rejects ambiguous, invalid, or unbounded contract requests", () => {
  assert.deepEqual(
    parseH1FixedContractJourneyRequest({ symbol: "NIFTY", expiry: "2026-10-08", strike: 24_000, optionType: "CALL", fromDate: "2026-10-01" }),
    { ok: false, reason: "INVALID_OPTION_TYPE" },
  );
  assert.deepEqual(
    parseH1FixedContractJourneyRequest({ symbol: "NIFTY", expiry: "2026-10-08", strike: 0, optionType: "CE", fromDate: "2026-10-01" }),
    { ok: false, reason: "INVALID_STRIKE" },
  );
  assert.deepEqual(
    parseH1FixedContractJourneyRequest({ symbol: "NIFTY", expiry: "2026-10-08", strike: 24_000, optionType: "CE", fromDate: "2026-10-09" }),
    { ok: false, reason: "JOURNEY_START_AFTER_EXPIRY" },
  );
  assert.deepEqual(
    parseH1FixedContractJourneyRequest({ symbol: "NIFTY", expiry: "2026-12-31", strike: 24_000, optionType: "CE", fromDate: "2026-10-01", toDate: "2026-12-01" }),
    { ok: false, reason: "DATE_RANGE_EXCEEDS_45_DAYS" },
  );
});

test("discloses exact contract gaps and unmarked rows without granting authority", () => {
  const coverage = buildH1FixedContractJourneyCoverage(
    [
      { minute_bucket: "2026-10-01T03:45:00.000Z" },
      { minute_bucket: "2026-10-01T03:48:00.000Z" },
      { minute_bucket: "2026-10-01T03:51:00.000Z" },
    ],
    [
      { minute_bucket: "2026-10-01T03:45:00.000Z", truth_verdict: "TRUE" },
      { minute_bucket: "2026-10-01T03:51:00.000Z", truth_verdict: "TRUE" },
      { minute_bucket: "2026-10-01T03:52:00.000Z" },
    ],
  );

  assert.equal(coverage.semantics, "EXACT_CONTRACT_PRESENCE_ACROSS_EXISTING_H1_TRUTH_MARKERS");
  assert.equal(coverage.markerBuckets, 3);
  assert.equal(coverage.contractBuckets, 3);
  assert.equal(coverage.coveredMarkerBuckets, 2);
  assert.equal(coverage.coveragePct, 66.67);
  assert.equal(coverage.complete, false);
  assert.deepEqual(coverage.missingContractBuckets, ["2026-10-01T03:48:00.000Z"]);
  assert.deepEqual(coverage.unmarkedContractBuckets, ["2026-10-01T03:52:00.000Z"]);
});
