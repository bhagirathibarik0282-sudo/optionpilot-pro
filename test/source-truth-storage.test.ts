import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTruthEnvelope,
  deriveCompatibleDelta,
  deriveWallMigration,
  openingGapPct,
  returnFromPrevClosePct,
  summarizeFamilyHealth,
} from "../source-truth-storage.js";

const identity = {
  underlying: "NIFTY",
  exchange: "NSE",
  segment: "NFO",
  instrumentToken: "111",
  tradingSymbol: "NIFTY26AUG25000CE",
  expiry: "2026-08-27",
  strike: 25000,
  optionType: "CE" as const,
};

const policy = { freshMaxMs: 30_000, agingMaxMs: 90_000 };

test("truth envelope is usable only with valid identity and fresh time", () => {
  const r = buildTruthEnvelope({ expectedIdentity: identity, actualIdentity: { ...identity }, sourceProvider: "KITE", sourceTimestamp: "2026-08-26T04:00:00.000Z", receivedAt: "2026-08-26T04:00:10.000Z", policy });
  assert.equal(r.identityState, "VALID");
  assert.equal(r.freshnessState, "FRESH");
  assert.equal(r.usability, "USABLE");
});

test("fresh quote with wrong token remains blocked", () => {
  const r = buildTruthEnvelope({ expectedIdentity: identity, actualIdentity: { ...identity, instrumentToken: "222" }, sourceProvider: "KITE", sourceTimestamp: "2026-08-26T04:00:00.000Z", receivedAt: "2026-08-26T04:00:10.000Z", policy });
  assert.equal(r.identityState, "MISMATCH");
  assert.equal(r.usability, "BLOCKED");
});

test("opening gap and return from previous close are separate semantics", () => {
  assert.equal(openingGapPct(101, 100), 1);
  assert.equal(returnFromPrevClosePct(103, 100), 3);
  assert.equal(openingGapPct(101, 0), null);
});

test("compatible delta refuses unusable current observation", () => {
  const current = { symbol: "NIFTY", expiry: "2026-08-27", strike: 25000, optionType: "CE" as const, observedAt: "2026-08-26T04:01:00Z", sessionDate: "2026-08-26", value: 120, usability: "BLOCKED" as const };
  const previous = { ...current, observedAt: "2026-08-26T04:00:00Z", value: 100, usability: "USABLE" as const };
  assert.equal(deriveCompatibleDelta(current, previous, 120_000).reason, "CURRENT_NOT_USABLE");
});

test("compatible delta refuses overnight session bridging", () => {
  const current = { symbol: "NIFTY", expiry: "2026-08-27", strike: 25000, optionType: "CE" as const, observedAt: "2026-08-26T04:01:00Z", sessionDate: "2026-08-26", value: 120, usability: "USABLE" as const };
  const previous = { ...current, observedAt: "2026-08-25T09:59:00Z", sessionDate: "2026-08-25", value: 100 };
  const r = deriveCompatibleDelta(current, previous, 120_000);
  assert.equal(r.usable, false);
  assert.equal(r.reason, "SESSION_GAP");
});

test("compatible delta refuses wrong contract and cadence gap", () => {
  const current = { symbol: "NIFTY", expiry: "2026-08-27", strike: 25000, optionType: "CE" as const, observedAt: "2026-08-26T04:05:00Z", sessionDate: "2026-08-26", value: 120, usability: "USABLE" as const };
  const wrong = { ...current, strike: 25100, observedAt: "2026-08-26T04:04:00Z", value: 100 };
  assert.equal(deriveCompatibleDelta(current, wrong, 120_000).reason, "IDENTITY_MISMATCH");
  const old = { ...current, observedAt: "2026-08-26T04:00:00Z", value: 100 };
  assert.equal(deriveCompatibleDelta(current, old, 120_000).reason, "CADENCE_GAP");
});

test("compatible delta computes only valid same-session change", () => {
  const current = { symbol: "NIFTY", expiry: "2026-08-27", strike: 25000, optionType: "CE" as const, observedAt: "2026-08-26T04:01:00Z", sessionDate: "2026-08-26", value: 120, usability: "USABLE" as const };
  const previous = { ...current, observedAt: "2026-08-26T04:00:00Z", value: 100 };
  const r = deriveCompatibleDelta(current, previous, 120_000);
  assert.equal(r.usable, true);
  assert.equal(r.value, 20);
  assert.equal(r.elapsedMs, 60_000);
});

test("wall migration requires same expiry and valid cadence", () => {
  const current = { symbol: "NIFTY", expiry: "2026-08-27", observedAt: "2026-08-26T04:01:00Z", sessionDate: "2026-08-26", strike: 25100, usability: "USABLE" as const };
  const previous = { ...current, observedAt: "2026-08-26T04:00:00Z", strike: 25000 };
  assert.equal(deriveWallMigration(current, previous, 120_000).value, 100);
});

test("family health blocks hard states and degrades aging context", () => {
  const blocked = summarizeFamilyHealth({ family: "OPTIONS", freshnessState: "STALE", usability: "BLOCKED", reasons: ["QUOTE_STALE"] });
  assert.equal(blocked.state, "BLOCKED");
  assert.equal(blocked.blocksNewEvidence, true);

  const mismatch = summarizeFamilyHealth({ family: "OPTIONS", freshnessState: "FRESH", identityState: "MISMATCH", qualityState: "INVALID", usability: "CONTEXT_ONLY", reasons: ["TOKEN_MISMATCH"] });
  assert.equal(mismatch.state, "BLOCKED");
  assert.equal(mismatch.blocksNewEvidence, true);

  const aging = summarizeFamilyHealth({ family: "OI_CHAIN", freshnessState: "AGING", identityState: "VALID", qualityState: "VALID", usability: "CONTEXT_ONLY", reasons: ["QUOTE_AGING"] });
  assert.equal(aging.state, "DEGRADED");
  assert.equal(aging.blocksNewEvidence, false);
});
