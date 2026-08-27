import test from "node:test";
import assert from "node:assert/strict";
import {
  exactTruthUsable,
  reconstructCompatibleMetric,
  restartDerivativeCadenceMs,
  restartReconstructionSchemaSql,
} from "../restart-safe-derivatives.js";
import type { SourceTruthPersistenceRecord } from "../source-truth-db.js";

const usableTruth: SourceTruthPersistenceRecord = {
  recordKind: "OPTION",
  symbol: "NIFTY",
  minuteBucket: "2026-08-26T04:31:00.000Z",
  expiry: "2026-08-27",
  strike: 24500,
  optionType: "CE",
  sourceProvider: "KITE",
  sourceTimestamp: "2026-08-26T04:31:01.000Z",
  receivedAt: "2026-08-26T04:31:02.000Z",
  dataAgeMs: 1000,
  freshnessState: "FRESH",
  identityState: "VALID",
  qualityState: "VALID",
  usability: "USABLE",
  reasonCodes: [],
};

test("Phase 40 cadence has no hidden default", () => {
  assert.equal(restartDerivativeCadenceMs({} as NodeJS.ProcessEnv), null);
  assert.equal(restartDerivativeCadenceMs({ SOURCE_TRUTH_DERIVATIVE_MAX_CADENCE_MS: "90000" } as NodeJS.ProcessEnv), 90000);
  assert.equal(restartDerivativeCadenceMs({ SOURCE_TRUTH_DERIVATIVE_MAX_CADENCE_MS: "0" } as NodeJS.ProcessEnv), null);
});

test("exact source truth requires FRESH + VALID identity + VALID quality + USABLE", () => {
  assert.equal(exactTruthUsable(usableTruth), true);
  assert.equal(exactTruthUsable({ ...usableTruth, freshnessState: "AGING" }), false);
  assert.equal(exactTruthUsable({ ...usableTruth, identityState: "PARTIAL" }), false);
  assert.equal(exactTruthUsable({ ...usableTruth, qualityState: "PARTIAL" }), false);
  assert.equal(exactTruthUsable({ ...usableTruth, usability: "CONTEXT_ONLY" }), false);
});

test("same-contract same-session previous row reconstructs OI delta", () => {
  const r = reconstructCompatibleMetric({
    symbol: "NIFTY",
    currentMinuteBucket: "2026-08-26T04:31:00.000Z",
    currentValue: 1300,
    currentTruthUsable: true,
    previousMinuteBucket: "2026-08-26T04:30:00.000Z",
    previousValue: 1000,
    previousTruthUsable: true,
    expiry: "2026-08-27",
    strike: 24500,
    optionType: "CE",
    maxCadenceMs: 90000,
  });
  assert.equal(r.state, "DERIVED");
  assert.equal(r.delta?.value, 300);
});

test("restart reconstruction never invents zero when previous history is absent", () => {
  const r = reconstructCompatibleMetric({
    symbol: "NIFTY",
    currentMinuteBucket: "2026-08-26T04:31:00.000Z",
    currentValue: 1300,
    currentTruthUsable: true,
    previousMinuteBucket: null,
    previousValue: null,
    previousTruthUsable: false,
    expiry: "2026-08-27",
    strike: 24500,
    optionType: "CE",
    maxCadenceMs: 90000,
  });
  assert.equal(r.state, "NO_PREVIOUS_VALID");
  assert.equal(r.delta?.value, null);
  assert.equal(r.delta?.usable, false);
});

test("overnight/session bridge is blocked even inside a wide cadence", () => {
  const r = reconstructCompatibleMetric({
    symbol: "NIFTY",
    currentMinuteBucket: "2026-08-26T03:46:00.000Z",
    currentValue: 1300,
    currentTruthUsable: true,
    previousMinuteBucket: "2026-08-25T10:00:00.000Z",
    previousValue: 1000,
    previousTruthUsable: true,
    expiry: "2026-08-27",
    maxCadenceMs: 86400000,
  });
  assert.equal(r.state, "SESSION_GAP");
  assert.equal(r.delta?.usable, false);
});

test("cadence gap is blocked rather than jumped over", () => {
  const r = reconstructCompatibleMetric({
    symbol: "NIFTY",
    currentMinuteBucket: "2026-08-26T04:35:00.000Z",
    currentValue: 1300,
    currentTruthUsable: true,
    previousMinuteBucket: "2026-08-26T04:30:00.000Z",
    previousValue: 1000,
    previousTruthUsable: true,
    expiry: "2026-08-27",
    maxCadenceMs: 90000,
  });
  assert.equal(r.state, "CADENCE_GAP");
  assert.equal(r.delta?.value, null);
});

test("blocked current truth cannot produce a derived change", () => {
  const r = reconstructCompatibleMetric({
    symbol: "NIFTY",
    currentMinuteBucket: "2026-08-26T04:31:00.000Z",
    currentValue: 1300,
    currentTruthUsable: false,
    previousMinuteBucket: "2026-08-26T04:30:00.000Z",
    previousValue: 1000,
    previousTruthUsable: true,
    expiry: "2026-08-27",
    maxCadenceMs: 90000,
  });
  assert.equal(r.state, "CURRENT_TRUTH_BLOCKED");
  assert.equal(r.delta, null);
});

test("audit schema is additive append-only and does not overwrite reconstruction truth", () => {
  const sql = restartReconstructionSchemaSql().toUpperCase();
  assert.match(sql, /CREATE TABLE IF NOT EXISTS DERIVATIVE_RECONSTRUCTION_TRUTH_1M/);
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE|ON CONFLICT[^\n]+DO UPDATE/);
});
