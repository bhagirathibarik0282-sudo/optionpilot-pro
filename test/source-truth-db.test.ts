import test from "node:test";
import assert from "node:assert/strict";
import {
  sourceTruthObservationId,
  sourceTruthSchemaSql,
  sourceTruthShadowEnabled,
  type SourceTruthPersistenceRecord,
} from "../source-truth-db.js";

const base: SourceTruthPersistenceRecord = {
  recordKind: "OPTION",
  symbol: "NIFTY",
  minuteBucket: "2026-08-26T04:00:00.000Z",
  expiry: "2026-08-27",
  strike: 25000,
  optionType: "CE",
  sourceProvider: "KITE",
  sourceTimestamp: "2026-08-26T04:00:05.000Z",
  receivedAt: "2026-08-26T04:00:06.000Z",
  computedAt: "2026-08-26T04:00:06.100Z",
  dataAgeMs: 1000,
  freshnessState: "FRESH",
  identityState: "PARTIAL",
  qualityState: "PARTIAL",
  usability: "CONTEXT_ONLY",
  reasonCodes: ["IDENTITY_NOT_CROSSCHECKED"],
  identity: {
    underlying: "NIFTY",
    segment: "NFO",
    instrumentToken: "123",
    tradingSymbol: "NIFTY26AUG25000CE",
    expiry: "2026-08-27",
    strike: 25000,
    optionType: "CE",
  },
};

test("observation id is deterministic for the same source event", () => {
  assert.equal(sourceTruthObservationId(base), sourceTruthObservationId({ ...base, receivedAt: "2026-08-26T04:00:07.000Z" }));
});

test("missing source time uses received time to keep distinct known-then observations", () => {
  const a = sourceTruthObservationId({ ...base, sourceTimestamp: null, receivedAt: "2026-08-26T04:00:06.000Z" });
  const b = sourceTruthObservationId({ ...base, sourceTimestamp: null, receivedAt: "2026-08-26T04:00:07.000Z" });
  assert.notEqual(a, b);
});

test("source truth schema is additive and append-only by design", () => {
  const sql = sourceTruthSchemaSql().toUpperCase();
  assert.ok(sql.includes("CREATE TABLE IF NOT EXISTS SOURCE_TRUTH_OBSERVATION_1M"));
  assert.ok(sql.includes("SOURCE_TRUTH_REVISION_LOG"));
  assert.equal(sql.includes("DROP TABLE"), false);
  assert.equal(sql.includes("TRUNCATE"), false);
  assert.equal(sql.includes("ON CONFLICT"), false);
});

test("shadow persistence defaults off", () => {
  assert.equal(sourceTruthShadowEnabled({} as NodeJS.ProcessEnv), false);
  assert.equal(sourceTruthShadowEnabled({ SOURCE_TRUTH_SHADOW: "true" } as NodeJS.ProcessEnv), true);
  assert.equal(sourceTruthShadowEnabled({ SOURCE_TRUTH_SHADOW: "0" } as NodeJS.ProcessEnv), false);
});
