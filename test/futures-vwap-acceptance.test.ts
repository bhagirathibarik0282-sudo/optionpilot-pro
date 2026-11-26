import test from "node:test";
import assert from "node:assert/strict";
import { evaluateFuturesVwapAcceptance, recordedNearFuturesVwap } from "../futures-vwap-acceptance.js";

const bullish = {
  side: "CE" as const, spot: 25030, dailyPivot: 25000, futuresLtp: 25140, futuresVwap: 25100,
  futuresVwapSource: "NIFTY26SEPFUT traded VWAP", nearFutureSymbol: "NIFTY26SEPFUT",
  recentObservations: [{ spot: 25010, futuresLtp: 25110 }, { spot: 25020, futuresLtp: 25120 }],
};

test("accepts CE only when futures and spot independently hold their own references", () => {
  const result = evaluateFuturesVwapAcceptance(bullish);
  assert.equal(result.sourceStatus, "TRUSTED_NEAR_FUTURES_VWAP");
  assert.equal(result.priceStructureAccepted, true);
});

test("accepts the mirrored PE structure", () => {
  const result = evaluateFuturesVwapAcceptance({ ...bullish, side: "PE", spot: 24970, futuresLtp: 25060,
    recentObservations: [{ spot: 24990, futuresLtp: 25090 }, { spot: 24980, futuresLtp: 25080 }] });
  assert.equal(result.priceStructureAccepted, true);
});

test("fails closed when VWAP provenance does not match the near future", () => {
  const result = evaluateFuturesVwapAcceptance({ ...bullish, futuresVwapSource: "NIFTY BANK spot VWAP" });
  assert.equal(result.sourceStatus, "SOURCE_MISMATCH");
  assert.equal(result.priceStructureAccepted, false);
});

test("does not let positive futures basis fake spot acceptance", () => {
  const result = evaluateFuturesVwapAcceptance({ ...bullish, spot: 24990,
    recentObservations: [{ spot: 24980, futuresLtp: 25110 }, { spot: 24990, futuresLtp: 25120 }] });
  assert.equal(result.futuresVwapAccepted, true);
  assert.equal(result.spotPivotAccepted, false);
  assert.equal(result.priceStructureAccepted, false);
});

test("requires the configured number of valid observations", () => {
  const result = evaluateFuturesVwapAcceptance({ ...bullish, recentObservations: [{ spot: 25010, futuresLtp: 25110 }] });
  assert.equal(result.priceStructureAccepted, false);
});

test("archives only the named near futures VWAP from a fresh, in-session quote", () => {
  const source = "NIFTY26NOVFUT traded VWAP";
  const receivedAt = "2026-11-26T04:10:25.000Z";
  const near = { label: "Near", tradingsymbol: "NIFTY26NOVFUT", ltp: 25140, quoteTimestamp: "2026-11-26T04:10:00.000Z" };
  assert.equal(recordedNearFuturesVwap(25100, source, near, receivedAt), 25100);
  assert.equal(recordedNearFuturesVwap(25100, source, { ...near, label: "Next" }, receivedAt), null);
  assert.equal(recordedNearFuturesVwap(25100, "NIFTY27JANFUT traded VWAP", near, receivedAt), null);
  assert.equal(recordedNearFuturesVwap(25100, source, { ...near, quoteTimestamp: "2026-11-26T04:09:54.999Z" }, receivedAt), null);
  assert.equal(recordedNearFuturesVwap(25100, source, { ...near, quoteTimestamp: "2026-11-26T04:10:26.000Z" }, receivedAt), null);
  assert.equal(recordedNearFuturesVwap(25100, source, { ...near, quoteTimestamp: "2026-11-25T04:10:00.000Z" }, receivedAt), null);
  assert.equal(recordedNearFuturesVwap(0, source, near, receivedAt), null);
});
