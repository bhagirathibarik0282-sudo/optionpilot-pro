import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildH1FixedContractOptionSnapshotRow } from "../h1-fixed-contract-option-snapshot-bridge.js";
import { KiteImmediateTokenRegistry } from "../kite-immediate-token-registry.js";

const registry = new KiteImmediateTokenRegistry([
  { instrumentToken: 55, symbol: "NIFTY", role: "OPTION", instrumentLabel: "NIFTY08CE", expiry: "2026-09-08", strike: 25050, optionSide: "CE" },
]);
const policy = { annualRiskFreeRate: 0.05, annualDividendYield: 0, maxAgeMs: 5_000, maxUnderlyingSkewMs: 2_000 };
const packet = {
  mode: "full" as const,
  instrumentToken: 55,
  lastPrice: 188.75,
  volume: 12_345,
  oi: 67_890,
  high: 205,
  low: 170,
  exchangeTimestamp: "2026-09-04T08:10:00.000Z",
  isIndex: false,
  marketDepth: {
    buy: [{ price: 188.5, quantity: 50, orders: 2 }],
    sell: [{ price: 189, quantity: 60, orders: 3 }],
  },
};

test("maps exact Kite watchlist evidence into the existing normalized option row", () => {
  const row = buildH1FixedContractOptionSnapshotRow({
    packet,
    registry,
    underlying: {
      source: "LIVE_RUNTIME_EXACT", symbol: "NIFTY", price: 25050,
      observedAt: "2026-09-04T08:10:00.000Z", receivedAt: "2026-09-04T08:10:00.100Z",
    },
    receivedAt: "2026-09-04T08:10:00.200Z",
    greekPolicy: policy,
  });
  assert.ok(row);
  assert.deepEqual({ symbol: row.symbol, expiry: row.expiry, strike: row.strike, optionType: row.optionType }, {
    symbol: "NIFTY", expiry: "2026-09-08", strike: 25050, optionType: "CE",
  });
  assert.equal(row.minuteBucket, "2026-09-04T08:10:00.000Z");
  assert.equal(row.dte, 4);
  assert.equal(row.ltp, 188.75);
  assert.equal(row.bid, 188.5);
  assert.equal(row.ask, 189);
  assert.equal(row.spread, 0.5);
  assert.equal(row.volume, 12_345);
  assert.equal(row.oi, 67_890);
  assert.equal(row.dayHigh, 205);
  assert.equal(row.dayLow, 170);
  assert.equal(Number.isFinite(row.iv), true);
  assert.equal(Number.isFinite(row.delta), true);
  assert.equal(Number.isFinite(row.gamma), true);
  assert.equal(Number.isFinite(row.theta), true);
  assert.equal(row.vega, null);
  assert.equal(row.intrinsic, 0);
  assert.equal(row.extrinsic, 188.75);
  assert.equal(row.atmOffset, null);
  assert.equal(row.expiryBucket, null);
  assert.equal(row.isCandidate, false);
  assert.equal(row.isWall, false);
  assert.equal(row.validationStatus, "OBSERVATIONAL_LIVE_EXACT_WITH_GREEKS");
});

test("persists direct exact fields but leaves model fields null when same-time spot is unavailable", () => {
  const row = buildH1FixedContractOptionSnapshotRow({
    packet, registry, underlying: null,
    receivedAt: "2026-09-04T08:10:00.200Z", greekPolicy: policy,
  });
  assert.ok(row);
  assert.equal(row.oi, 67_890);
  assert.equal(row.iv, null);
  assert.equal(row.delta, null);
  assert.equal(row.gamma, null);
  assert.equal(row.theta, null);
  assert.equal(row.intrinsic, null);
  assert.equal(row.extrinsic, null);
  assert.equal(row.validationStatus, "OBSERVATIONAL_LIVE_EXACT_GREEKS_UNAVAILABLE");
});

test("fails closed on wrong token, non-full packet, invalid depth, or future chronology", () => {
  const base = { registry, underlying: null, receivedAt: "2026-09-04T08:10:00.200Z", greekPolicy: policy };
  assert.equal(buildH1FixedContractOptionSnapshotRow({ ...base, packet: { ...packet, instrumentToken: 999 } }), null);
  assert.equal(buildH1FixedContractOptionSnapshotRow({ ...base, packet: { ...packet, mode: "quote" } }), null);
  assert.equal(buildH1FixedContractOptionSnapshotRow({ ...base, packet: { ...packet, marketDepth: undefined } }), null);
  assert.equal(buildH1FixedContractOptionSnapshotRow({ ...base, packet: { ...packet, exchangeTimestamp: "2026-09-04T08:10:01.000Z" } }), null);
  assert.equal(buildH1FixedContractOptionSnapshotRow({ ...base, receivedAt: "2026-09-04T08:10:06.000Z", packet }), null);
});

test("observational DB collision policy fills gaps and cannot erase richer canonical values", () => {
  const source = readFileSync(new URL("../db.ts", import.meta.url), "utf8");
  const start = source.indexOf("export async function dbUpsertOptionSnapshot1mObservationalFill");
  const end = source.indexOf("export async function dbUpsertChainState1m", start);
  const bridgeSql = source.slice(start, end);
  assert.match(bridgeSql, /ON CONFLICT \(symbol, minute_bucket, expiry, strike, option_type\) DO UPDATE/);
  assert.match(bridgeSql, /iv=COALESCE\(option_snapshot_1m\.iv, EXCLUDED\.iv\)/);
  assert.match(bridgeSql, /is_candidate=option_snapshot_1m\.is_candidate OR EXCLUDED\.is_candidate/);
  assert.doesNotMatch(bridgeSql, /iv=EXCLUDED\.iv[,\n]/);
});
