import assert from "node:assert/strict";
import test from "node:test";
import { deriveH1ExactWeightedHeavyweightLiveFact } from "../h1-exact-weighted-heavyweight-live-adapter.js";
import { validateH1OfficialHeavyweightWeightReference } from "../h1-official-heavyweight-weight-authority.js";
import type { CanonicalConstituentTokenEntry } from "../canonical-constituent-token-registry.js";
import type { KiteConstituentMinuteRecord } from "../kite-constituent-runtime-bridge-v1.js";

const now = Date.parse("2026-09-14T12:05:30.000Z");
const symbols = ["AAA", "BBB", "CCC", "DDD"] as const;
const weights = [40, 30, 20, 10] as const;
const policy = {
  lookbackMinutes: 3,
  maxLatestAgeMs: 90_000,
  maxAuthorityAgeMs: 24 * 60 * 60 * 1000,
  minWindowCoveragePct: 90,
  minLiveWeightCoveragePct: 95,
  neutralMovePct: 0.05,
};

function authority() {
  return validateH1OfficialHeavyweightWeightReference({
    symbol: "NIFTY",
    reference: {
      authorityClass: "OFFICIAL_INDEX_PROVIDER_VERSIONED_REFERENCE",
      providerId: "OFFICIAL_NIFTY_PROVIDER",
      symbol: "NIFTY",
      asOfMs: now - 60 * 60 * 1000,
      receivedAtMs: now - 59 * 60 * 1000,
      sourceDocumentId: "official-nifty-weights-2026-09-14",
      sourceVersion: "2026-09-14",
      sourceManifestHash: "sha256:nifty-weights-v1",
      constituents: symbols.map((tradingSymbol, index) => ({
        constituentId: `ID-${index + 1}`,
        tradingSymbol,
        weightPct: weights[index],
      })),
    },
    policy: {
      expectedProviderIdBySymbol: { NIFTY: "OFFICIAL_NIFTY_PROVIDER" },
      maxReferenceAgeMs: 24 * 60 * 60 * 1000,
      minConstituentCount: 4,
      minCoveragePct: 99,
      maxWeightSumDeviationPct: 1,
    },
    nowMs: now,
  });
}

function registry(): CanonicalConstituentTokenEntry[] {
  return symbols.map((tradingsymbol, index) => ({
    instrumentToken: index + 1,
    parentSymbol: "NIFTY",
    role: "HEAVYWEIGHT",
    tradingsymbol,
    sector: null,
    weight: null,
    source: "KITE_INSTRUMENT_MASTER",
  }));
}

function minutes(): KiteConstituentMinuteRecord[] {
  const starts = [
    Date.parse("2026-09-14T12:01:00.000Z"),
    Date.parse("2026-09-14T12:02:00.000Z"),
    Date.parse("2026-09-14T12:03:00.000Z"),
    Date.parse("2026-09-14T12:04:00.000Z"),
  ];
  const prices = [
    [100, 100, 100, 100],
    [101, 100.5, 99.5, 100.01],
    [102, 101, 99, 100.02],
    [104, 102, 98, 100.03],
  ];
  return starts.map((minuteStartMs, minuteIndex) => ({
    minuteStartMs,
    closedAtMs: minuteStartMs + 60_000,
    immutable: true as const,
    ticks: prices[minuteIndex].map((ltp, tokenIndex) => ({
      instrumentToken: tokenIndex + 1,
      exchangeTimestampMs: minuteStartMs + 50_000,
      receivedAtMs: minuteStartMs + 51_000,
      processedAtMs: minuteStartMs + 52_000,
      ingestSeq: minuteIndex * 4 + tokenIndex + 1,
      ltp,
    })),
  }));
}

test("joins official weights to existing exact constituent minutes without equal weighting", () => {
  const out = deriveH1ExactWeightedHeavyweightLiveFact({
    symbol: "NIFTY",
    authority: authority(),
    registry: registry(),
    constituentMinutes: minutes(),
    policy,
    nowMs: now,
  });
  assert.equal(out.ready, true);
  assert.equal(out.grantsHeavyweightFact, true);
  assert.equal(out.fact?.bullishWeightPct, 70);
  assert.equal(out.fact?.bearishWeightPct, 20);
  assert.equal(out.fact?.neutralWeightPct, 10);
  assert.equal(out.fact?.liveWeightCoveragePct, 100);
  assert.equal(out.fact?.officialWeightAuthorityVerified, true);
  assert.equal(out.fact?.normalizedMissingWeightAway, false);
  assert.equal(out.fetchesNetworkData, false);
  assert.equal(out.opensSocket, false);
  assert.equal(out.sendsTelegram, false);
  assert.equal(out.createsOrders, false);
});

test("insufficient fresh live weight coverage fails closed instead of renormalizing survivors", () => {
  const partial = minutes().map((row) => ({ ...row, ticks: row.ticks.filter((tick) => tick.instrumentToken !== 4) }));
  const out = deriveH1ExactWeightedHeavyweightLiveFact({
    symbol: "NIFTY",
    authority: authority(),
    registry: registry(),
    constituentMinutes: partial,
    policy,
    nowMs: now,
  });
  assert.equal(out.ready, false);
  assert.equal(out.fact, null);
  assert.ok(out.blockers.includes("LIVE_WEIGHT_COVERAGE_INSUFFICIENT"));
  assert.equal(out.normalizedMissingWeightAway, false);
});

test("missing or duplicate official constituent registry identity cannot acquire a weighted fact", () => {
  const missing = registry().filter((row) => row.tradingsymbol !== "DDD");
  const missingOut = deriveH1ExactWeightedHeavyweightLiveFact({
    symbol: "NIFTY", authority: authority(), registry: missing,
    constituentMinutes: minutes(), policy, nowMs: now,
  });
  assert.equal(missingOut.ready, false);
  assert.ok(missingOut.blockers.includes("OFFICIAL_CONSTITUENT_NOT_IN_LIVE_REGISTRY"));

  const duplicate = [...registry(), { ...registry()[0], instrumentToken: 99 }];
  const duplicateOut = deriveH1ExactWeightedHeavyweightLiveFact({
    symbol: "NIFTY", authority: authority(), registry: duplicate,
    constituentMinutes: minutes(), policy, nowMs: now,
  });
  assert.equal(duplicateOut.ready, false);
  assert.ok(duplicateOut.blockers.includes("LIVE_REGISTRY_CONSTITUENT_NOT_UNIQUE"));
});

test("cached weight authority is rechecked for freshness at live derivation time", () => {
  const out = deriveH1ExactWeightedHeavyweightLiveFact({
    symbol: "NIFTY",
    authority: authority(),
    registry: registry(),
    constituentMinutes: minutes(),
    policy,
    nowMs: now + 2 * 24 * 60 * 60 * 1000,
  });
  assert.equal(out.ready, false);
  assert.deepEqual(out.blockers, ["OFFICIAL_WEIGHT_AUTHORITY_STALE_OR_FUTURE"]);
});

test("unapproved authority result never falls back to live registry weights", () => {
  const bad = authority();
  bad.ready = false;
  bad.grantsWeightAuthority = false;
  bad.blockers = ["WEIGHT_REFERENCE_PROVIDER_MISMATCH"];
  const out = deriveH1ExactWeightedHeavyweightLiveFact({
    symbol: "NIFTY", authority: bad, registry: registry(), constituentMinutes: minutes(), policy, nowMs: now,
  });
  assert.equal(out.ready, false);
  assert.deepEqual(out.blockers, ["OFFICIAL_WEIGHT_AUTHORITY_NOT_READY"]);
});
