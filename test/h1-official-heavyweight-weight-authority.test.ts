import assert from "node:assert/strict";
import test from "node:test";
import {
  validateH1OfficialHeavyweightWeightReference,
  type H1OfficialHeavyweightWeightReference,
} from "../h1-official-heavyweight-weight-authority.js";

const now = Date.now();

const policy = {
  expectedProviderIdBySymbol: { NIFTY: "OFFICIAL_NIFTY_PROVIDER" },
  maxReferenceAgeMs: 2 * 24 * 60 * 60 * 1000,
  minConstituentCount: 4,
  minCoveragePct: 99,
  maxWeightSumDeviationPct: 1,
};

function reference(): H1OfficialHeavyweightWeightReference {
  return {
    authorityClass: "OFFICIAL_INDEX_PROVIDER_VERSIONED_REFERENCE",
    providerId: "OFFICIAL_NIFTY_PROVIDER",
    symbol: "NIFTY",
    asOfMs: now - 6 * 60 * 60 * 1000,
    receivedAtMs: now - 5 * 60 * 60 * 1000,
    sourceDocumentId: "official-index-weight-file-2026-09-14",
    sourceVersion: "2026-09-14",
    sourceManifestHash: "sha256:official-reference-manifest",
    constituents: [
      { constituentId: "A", tradingSymbol: "AAA", weightPct: 40 },
      { constituentId: "B", tradingSymbol: "BBB", weightPct: 30 },
      { constituentId: "C", tradingSymbol: "CCC", weightPct: 20 },
      { constituentId: "D", tradingSymbol: "DDD", weightPct: 10 },
    ],
  };
}

test("grants weight authority only to complete versioned official reference", () => {
  const out = validateH1OfficialHeavyweightWeightReference({ symbol: "NIFTY", reference: reference(), policy, nowMs: now });
  assert.equal(out.ready, true);
  assert.equal(out.grantsWeightAuthority, true);
  assert.equal(out.coveragePct, 100);
  assert.equal(out.constituentCount, 4);
  assert.equal(out.liveRuntimeExact, false);
  assert.equal(out.grantsDirectionalSupport, false);
  assert.equal(out.sendsTelegram, false);
  assert.equal(out.createsOrders, false);
});

test("missing official reference fails closed instead of falling back to equal-weight breadth", () => {
  const out = validateH1OfficialHeavyweightWeightReference({ symbol: "NIFTY", reference: null, policy, nowMs: now });
  assert.equal(out.ready, false);
  assert.equal(out.grantsWeightAuthority, false);
  assert.deepEqual(out.blockers, ["OFFICIAL_WEIGHT_REFERENCE_UNAVAILABLE"]);
});

test("wrong provider cannot self-declare official authority", () => {
  const value = reference();
  value.providerId = "UNAPPROVED_PROVIDER";
  const out = validateH1OfficialHeavyweightWeightReference({ symbol: "NIFTY", reference: value, policy, nowMs: now });
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("WEIGHT_REFERENCE_PROVIDER_MISMATCH"));
});

test("stale reference is rejected", () => {
  const value = reference();
  value.asOfMs = now - 3 * 24 * 60 * 60 * 1000;
  value.receivedAtMs = value.asOfMs + 60_000;
  const out = validateH1OfficialHeavyweightWeightReference({ symbol: "NIFTY", reference: value, policy, nowMs: now });
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("WEIGHT_REFERENCE_STALE"));
});

test("partial or duplicate weight vector cannot acquire authority", () => {
  const value = reference();
  value.constituents = [
    { constituentId: "A", tradingSymbol: "AAA", weightPct: 40 },
    { constituentId: "A", tradingSymbol: "AAA", weightPct: 30 },
    { constituentId: "C", tradingSymbol: "CCC", weightPct: 20 },
    { constituentId: "D", tradingSymbol: "DDD", weightPct: 5 },
  ];
  const out = validateH1OfficialHeavyweightWeightReference({ symbol: "NIFTY", reference: value, policy, nowMs: now });
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("WEIGHT_REFERENCE_DUPLICATE_CONSTITUENT"));
  assert.ok(out.blockers.includes("WEIGHT_REFERENCE_COVERAGE_INSUFFICIENT"));
  assert.ok(out.blockers.includes("WEIGHT_REFERENCE_TOTAL_NOT_NEAR_100"));
  assert.equal(out.constituents.length, 0);
});

test("future reference timestamps are rejected", () => {
  const value = reference();
  value.asOfMs = now + 60_000;
  value.receivedAtMs = now + 120_000;
  const out = validateH1OfficialHeavyweightWeightReference({ symbol: "NIFTY", reference: value, policy, nowMs: now });
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("WEIGHT_REFERENCE_ASOF_FUTURE"));
  assert.ok(out.blockers.includes("WEIGHT_REFERENCE_RECEIVED_AT_FUTURE"));
});
