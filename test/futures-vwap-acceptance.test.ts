import test from "node:test";
import assert from "node:assert/strict";
import { evaluateFuturesVwapAcceptance } from "../futures-vwap-acceptance.js";

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
