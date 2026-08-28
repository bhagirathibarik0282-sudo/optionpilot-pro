import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { mountOptionRecorderExportRoute } from "../option-recorder-export-route.js";
import { adaptRecorderExport } from "../option-recorder-source-adapter.js";

test("export route fails closed without token configuration", async () => {
  const old = process.env.OPTION_RECORDER_EXPORT_TOKEN;
  delete process.env.OPTION_RECORDER_EXPORT_TOKEN;
  try {
    const app = new Hono();
    mountOptionRecorderExportRoute(app, () => ({ marketSnapshot: {} }));
    const res = await app.request("/api/option-recorder/export");
    assert.equal(res.status, 503);
  } finally {
    if (old === undefined) delete process.env.OPTION_RECORDER_EXPORT_TOKEN;
    else process.env.OPTION_RECORDER_EXPORT_TOKEN = old;
  }
});

test("export route requires bearer token", async () => {
  const old = process.env.OPTION_RECORDER_EXPORT_TOKEN;
  process.env.OPTION_RECORDER_EXPORT_TOKEN = "unit-secret";
  try {
    const app = new Hono();
    mountOptionRecorderExportRoute(app, () => ({ marketSnapshot: {} }));
    const res = await app.request("/api/option-recorder/export");
    assert.equal(res.status, 401);
  } finally {
    if (old === undefined) delete process.env.OPTION_RECORDER_EXPORT_TOKEN;
    else process.env.OPTION_RECORDER_EXPORT_TOKEN = old;
  }
});

test("enriched adapter preserves expiry liquidity futures and multi-expiry evidence", () => {
  const now = new Date().toISOString();
  const history = [
    { snapshotId: "r1", backendTimestamp: now, snapshotStatus: "LIVE", NIFTY: { spot: 25000, vwap: 24980, ceLtp: 100, peLtp: 90 } },
    { snapshotId: "r2", backendTimestamp: now, snapshotStatus: "LIVE", NIFTY: { spot: 25020, vwap: 24990, ceLtp: 105, peLtp: 86 } },
    { snapshotId: "r3", backendTimestamp: now, snapshotStatus: "LIVE", NIFTY: { spot: 25050, vwap: 25000, ceLtp: 112, peLtp: 82 } },
  ];

  const leg = (strike: number, side: "CE" | "PE", expiryDate: string, oi: number) => ({
    strike,
    side,
    isAtm: true,
    expiryDate,
    bid: 110,
    ask: 112,
    lastPrice: 111,
    volume: 10000,
    oi,
    iv: 14,
    delta: side === "CE" ? 0.52 : -0.48,
    gamma: 0.001,
    vega: 10,
    theta: -8,
    quoteTimestamp: now,
  });

  const source: any = {
    ok: true,
    architectureRole: "OPTION_RECORDER_EXPORT_V1",
    generatedAt: now,
    recorderSnapshots: history,
    symbols: {
      NIFTY: {
        snapshotId: "live-nifty",
        backendTimestamp: now,
        exchangeTimestamp: now,
        spot: 25050,
        vwap: 25000,
        pdh: 25100,
        pdl: 24800,
        futuresVwapBias: "UP",
        futuresContracts: [{ label: "Near", ltp: 25070, oi: 500000, volume: 120000, quoteTimestamp: now }],
        expiries: [
          { expiryDate: "2026-09-03", ce: [leg(25050, "CE", "2026-09-03", 100000)], pe: [leg(25050, "PE", "2026-09-03", 130000)] },
          { expiryDate: "2026-09-10", ce: [leg(25050, "CE", "2026-09-10", 90000)], pe: [leg(25050, "PE", "2026-09-10", 120000)] },
          { expiryDate: "2026-09-24", ce: [leg(25050, "CE", "2026-09-24", 80000)], pe: [leg(25050, "PE", "2026-09-24", 110000)] },
        ],
      },
    },
  };

  const payloads = adaptRecorderExport(source);
  assert.equal(payloads.length, 1);
  const p = payloads[0];
  assert.equal(p.market.future, 25070);
  assert.equal(p.market.futureOi, 500000);
  assert.equal(p.options[0].expiry, "2026-09-03");
  assert.equal(p.options[0].bid, 110);
  assert.equal(p.options[0].ask, 112);
  assert.equal(p.options[0].volume, 10000);
  assert.ok(p.options.some((o) => o.expiry === "2026-09-24"));
  assert.equal(p.verdicts.find((v) => v.mode === "TRADER")?.direction, "CE");
  assert.equal(p.verdicts.find((v) => v.mode === "SWING")?.direction, "CE");
});
