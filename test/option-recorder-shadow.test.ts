import test from "node:test";
import assert from "node:assert/strict";
import {
  OPTION_RECORDER_SHADOW_MODE,
  buildRecorderContractKey,
  recorderTelegramDestination,
  resolveRecorderConflict,
  validateRecorderOption,
  type RecorderMarketSnapshot,
  type RecorderOptionSnapshot,
} from "../option-recorder-shadow.js";

const market: RecorderMarketSnapshot = {
  snapshotId: "snap-1",
  symbol: "NIFTY",
  exchangeTimestamp: "2026-08-28T09:30:00.000Z",
  backendTimestamp: "2026-08-28T09:30:10.000Z",
  spot: 24500,
  future: 24520,
  futureOi: 100000,
  futureVolume: 50000,
  vwap: 24480,
  pdh: 24600,
  pdl: 24350,
};

function option(overrides: Partial<RecorderOptionSnapshot> = {}): RecorderOptionSnapshot {
  return {
    snapshotId: "snap-1",
    symbol: "NIFTY",
    expiry: "2026-09-03",
    strike: 24500,
    side: "CE",
    contractKey: buildRecorderContractKey("NIFTY", "2026-09-03", 24500, "CE"),
    exchangeTimestamp: "2026-08-28T09:30:00.000Z",
    backendTimestamp: "2026-08-28T09:30:10.000Z",
    ltp: 150,
    bid: 149.5,
    ask: 150.5,
    volume: 10000,
    oi: 50000,
    oiChange: 2500,
    iv: 14.5,
    delta: 0.52,
    gamma: 0.001,
    vega: 10,
    theta: -6,
    intrinsic: 0,
    extrinsic: 150,
    ...overrides,
  };
}

test("contract key isolates expiry/strike/side", () => {
  assert.equal(buildRecorderContractKey("NIFTY", "2026-09-03", 24500, "CE"), "NIFTY|2026-09-03|24500|CE");
  assert.notEqual(buildRecorderContractKey("NIFTY", "2026-09-03", 24500, "CE"), buildRecorderContractKey("NIFTY", "2026-09-10", 24500, "CE"));
});

test("valid quote passes", () => {
  const result = validateRecorderOption(market, option());
  assert.equal(result.blocked, false);
  assert.equal(result.state, "VALID");
});

test("stale quote blocks", () => {
  const result = validateRecorderOption(market, option({ exchangeTimestamp: "2026-08-28T09:20:00.000Z" }));
  assert.equal(result.blocked, true);
  assert.equal(result.state, "STALE");
});

test("wrong contract identity blocks", () => {
  const result = validateRecorderOption(market, option({ contractKey: "NIFTY|2026-09-03|24600|CE" }));
  assert.equal(result.blocked, true);
  assert.equal(result.state, "CONTRACT_MISMATCH");
});

test("missing IV alone is not a hard block", () => {
  const result = validateRecorderOption(market, option({ iv: null }));
  assert.equal(result.blocked, false);
});

test("conflicting tradeable strategy sides return conflict", () => {
  const result = resolveRecorderConflict([
    { mode: "SCALP", state: "TRADEABLE", direction: "CE", quality: "HIGH", evidence: [], conflicts: [] },
    { mode: "TRADER", state: "TRADEABLE", direction: "PE", quality: "HIGH", evidence: [], conflicts: [] },
    { mode: "SWING", state: "WATCH", direction: "NONE", quality: "LOW", evidence: [], conflicts: [] },
  ]);
  assert.equal(result, "CONFLICT");
});

test("telegram routing is strictly index isolated and shadow send is off", () => {
  assert.equal(recorderTelegramDestination("NIFTY"), "NIFTY_PREMIUM");
  assert.equal(recorderTelegramDestination("BANKNIFTY"), "BANKNIFTY_PREMIUM");
  assert.equal(recorderTelegramDestination("SENSEX"), "SENSEX_PREMIUM");
  assert.equal(OPTION_RECORDER_SHADOW_MODE.telegramSend, false);
  assert.equal(OPTION_RECORDER_SHADOW_MODE.productionImpact, "NONE");
});
