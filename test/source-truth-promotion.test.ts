import test from "node:test";
import assert from "node:assert/strict";
import { promoteSourceTruthRecord } from "../source-truth-promotion.js";
import type { SourceTruthPersistenceRecord } from "../source-truth-db.js";

function baseOption(overrides: Partial<SourceTruthPersistenceRecord> = {}): SourceTruthPersistenceRecord {
  return {
    recordKind: "OPTION", symbol: "NIFTY", minuteBucket: "2026-08-26T04:00:00.000Z",
    expiry: "2026-08-27", strike: 25000, optionType: "CE", sourceProvider: "KITE",
    sourceTimestamp: "2026-08-26T04:00:05.000Z", receivedAt: "2026-08-26T04:00:06.000Z",
    computedAt: "2026-08-26T04:00:06.100Z", dataAgeMs: 1000, freshnessState: "FRESH",
    identityState: "PARTIAL", qualityState: "PARTIAL", usability: "CONTEXT_ONLY",
    reasonCodes: ["IDENTITY_NOT_CROSSCHECKED"], sourceVersion: "KITE_LIVE_CONTRACT_MASTER|SNAPSHOT_RECEIPT_PROXY",
    identity: { underlying: "NIFTY", exchange: "NFO", segment: "NFO-OPT", instrumentToken: 123,
      tradingSymbol: "NIFTY26AUG25000CE", expiry: "2026-08-27", strike: 25000, optionType: "CE" },
    ...overrides,
  };
}

function baseFuture(overrides: Partial<SourceTruthPersistenceRecord> = {}): SourceTruthPersistenceRecord {
  return {
    ...baseOption(), recordKind: "FUTURES", expiry: "2026-08-27", strike: null, optionType: null,
    sourceVersion: "KITE_FUTURES_LIVE_CONTRACT_MASTER|QUOTE_RESPONSE_RECEIPT",
    identity: { underlying: "NIFTY", exchange: "NFO", segment: "NFO-FUT", instrumentToken: 987,
      tradingSymbol: "NIFTY26AUGFUT", expiry: "2026-08-27" },
    ...overrides,
  };
}

test("audited Kite master option promotes identity to VALID but receipt proxy keeps context-only", () => {
  const out = promoteSourceTruthRecord(baseOption());
  assert.equal(out.identityState, "VALID"); assert.equal(out.qualityState, "PARTIAL");
  assert.equal(out.usability, "CONTEXT_ONLY"); assert.ok(out.reasonCodes.includes("RECEIVED_AT_APPROXIMATED"));
});

test("stale master option can have valid identity but remains blocked", () => {
  const out = promoteSourceTruthRecord(baseOption({ freshnessState: "STALE", usability: "BLOCKED", reasonCodes: ["QUOTE_STALE", "IDENTITY_NOT_CROSSCHECKED"] }));
  assert.equal(out.identityState, "VALID"); assert.equal(out.usability, "BLOCKED");
});

test("wrong option trading symbol shape becomes MISMATCH", () => {
  const row = baseOption(); row.identity = { ...row.identity!, tradingSymbol: "BANKNIFTY26AUG25000PE" };
  const out = promoteSourceTruthRecord(row);
  assert.equal(out.identityState, "MISMATCH"); assert.equal(out.qualityState, "INVALID"); assert.equal(out.usability, "BLOCKED");
});

test("missing option token cannot be promoted", () => {
  const row = baseOption(); row.identity = { ...row.identity!, instrumentToken: null };
  const out = promoteSourceTruthRecord(row);
  assert.equal(out.identityState, "PARTIAL"); assert.equal(out.usability, "BLOCKED");
});

test("exact Kite master future with quote-response receipt can promote to VALID", () => {
  const out = promoteSourceTruthRecord(baseFuture());
  assert.equal(out.identityState, "VALID"); assert.equal(out.qualityState, "VALID"); assert.equal(out.usability, "USABLE");
  assert.equal(out.reasonCodes.includes("IDENTITY_NOT_CROSSCHECKED"), false);
});

test("stale exact future keeps valid identity but blocks evidence", () => {
  const out = promoteSourceTruthRecord(baseFuture({ freshnessState: "STALE", usability: "BLOCKED", reasonCodes: ["QUOTE_STALE", "IDENTITY_NOT_CROSSCHECKED"] }));
  assert.equal(out.identityState, "VALID"); assert.equal(out.usability, "BLOCKED");
});

test("future with wrong symbol shape becomes mismatch", () => {
  const row = baseFuture(); row.identity = { ...row.identity!, tradingSymbol: "BANKNIFTY26AUGFUT" };
  const out = promoteSourceTruthRecord(row);
  assert.equal(out.identityState, "MISMATCH"); assert.equal(out.usability, "BLOCKED");
});

test("snapshot-proxy future is not promoted", () => {
  const out = promoteSourceTruthRecord({ ...baseFuture(), sourceVersion: "KITE_FUTURES_SNAPSHOT_RECEIPT_PROXY", identityState: "PARTIAL" });
  assert.equal(out.identityState, "PARTIAL"); assert.notEqual(out.identityState, "VALID");
});

test("spot/index missing exchange time is explicitly marked as backend proxy", () => {
  const out = promoteSourceTruthRecord({ ...baseOption(), recordKind: "MARKET", strike: null, optionType: null,
    expiry: null, sourceTimestamp: null, sourceVersion: "KITE_INDEX_SNAPSHOT_RECEIPT_PROXY",
    identityState: "PARTIAL", identity: { underlying: "NIFTY" } });
  assert.ok(out.reasonCodes.includes("SOURCE_TS_PROXY_BACKEND"));
});
