import assert from "node:assert/strict";
import test from "node:test";
import {
  buildH1GoldClosedHorizonCapture,
  H1_GOLD_HORIZON_CAPTURE_LOG_KIND,
  H1_GOLD_HORIZON_CLOSED_BLOCK_CAPTURE_V1,
} from "../h1-gold-horizon-closed-block-capture-v1.js";

function base(overrides: Record<string, unknown> = {}) {
  return {
    symbol: "NIFTY",
    timeframeMinutes: 15,
    blockStart: "2026-09-16T06:00:00.000Z",
    blockEnd: "2026-09-16T06:15:00.000Z",
    dataQuality: "COMPLETE_1M",
    stateCode: "RAW_BLOCK_ARCHIVE_ONLY",
    source: "market_snapshot_1m",
    semantics: "RAW_BLOCK_ARCHIVE_ONLY",
    ruleVersion: "STORAGE_V3_TF_PHASE1",
    sampleCount: 15,
    expected1mCount: 15,
    ...overrides,
  };
}

test("builds deterministic append-only NIFTY close capture with no authority", () => {
  const out = buildH1GoldClosedHorizonCapture(base());
  assert.ok(out);
  assert.equal(out.version, H1_GOLD_HORIZON_CLOSED_BLOCK_CAPTURE_V1);
  assert.equal(out.kind, H1_GOLD_HORIZON_CAPTURE_LOG_KIND);
  assert.equal(out.horizon, "15M");
  assert.equal(out.symbol, "NIFTY");
  assert.equal(out.capturedAt, out.blockEnd);
  assert.match(out.captureId, /NIFTY:15M:2026-09-16T06:15:00.000Z/);
  assert.equal(out.immutable, true);
  assert.equal(out.productionImpact, "NONE");
  assert.equal(out.affectsSelector, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.grantsPromotionAuthority, false);
  assert.equal(out.createsOrders, false);
  assert.equal(out.failClosed, true);
});

test("SENSEX 3M/6M/15M/30M are eligible capture horizons", () => {
  for (const minutes of [3, 6, 15, 30] as const) {
    const end = Date.parse("2026-09-16T06:30:00.000Z");
    const out = buildH1GoldClosedHorizonCapture(base({
      symbol: "SENSEX",
      timeframeMinutes: minutes,
      blockStart: new Date(end - minutes * 60_000).toISOString(),
      blockEnd: new Date(end).toISOString(),
      sampleCount: minutes,
      expected1mCount: minutes,
    }));
    assert.ok(out);
    assert.equal(out.horizon, `${minutes}M`);
    assert.equal(out.symbol, "SENSEX");
  }
});

test("BANKNIFTY and 60M are deliberately not captured for Gold horizonComplete", () => {
  assert.equal(buildH1GoldClosedHorizonCapture(base({ symbol: "BANKNIFTY" })), null);
  assert.equal(buildH1GoldClosedHorizonCapture(base({ timeframeMinutes: 60, sampleCount: 60, expected1mCount: 60, blockStart: "2026-09-16T05:15:00.000Z" })), null);
});

test("invalid duration and expected sample contract fail closed", () => {
  assert.equal(buildH1GoldClosedHorizonCapture(base({ blockStart: "2026-09-16T06:01:00.000Z" })), null);
  assert.equal(buildH1GoldClosedHorizonCapture(base({ expected1mCount: 14 })), null);
  assert.equal(buildH1GoldClosedHorizonCapture(base({ sampleCount: -1 })), null);
});

test("partial sampling is still captured as evidence but cannot claim completeness by itself", () => {
  const out = buildH1GoldClosedHorizonCapture(base({ dataQuality: "PARTIAL_SAMPLING", sampleCount: 10 }));
  assert.ok(out);
  assert.equal(out.dataQuality, "PARTIAL_SAMPLING");
  assert.equal(out.sampleCount, 10);
  assert.equal(out.immutable, true);
});
