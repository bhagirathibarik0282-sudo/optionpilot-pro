import test from "node:test";
import assert from "node:assert/strict";
import { createShadowTradeEvidence, recordShadowTradeEvent } from "../shadow-trade-evidence-recorder.js";

const entry = createShadowTradeEvidence({ tradeId: "T1", ts: "2026-08-31T09:20:00+05:30", index: "NIFTY", entryPremium: 120, entryQty: 130, initialTrailingSl: 112 });

test("creates shadow-only entry evidence", () => {
  assert.ok(entry);
  assert.equal(entry?.brokerOrderAllowed, false);
  assert.equal(entry?.remainingQty, 130);
});

test("tracks MFE and unrealised PnL", () => {
  const s = recordShadowTradeEvent(entry!, { ts: "2026-08-31T09:25:00+05:30", event: "TSL_UPDATE", premium: 136, trailingSl: 118 });
  assert.equal(s?.mfePoints, 16);
  assert.equal(s?.unrealisedShadowPnl, 2080);
});

test("tracks MAE", () => {
  const s = recordShadowTradeEvent(entry!, { ts: "2026-08-31T09:22:00+05:30", event: "TSL_UPDATE", premium: 116, trailingSl: 113 });
  assert.equal(s?.maePoints, 4);
});

test("partial exit reduces quantity and books shadow pnl", () => {
  const s = recordShadowTradeEvent(entry!, { ts: "2026-08-31T09:30:00+05:30", event: "PARTIAL_EXIT", premium: 140, quantity: 65, trailingSl: 120 });
  assert.equal(s?.remainingQty, 65);
  assert.equal(s?.realisedShadowPnl, 1300);
  assert.equal(s?.closed, false);
});

test("runner exit closes remaining quantity", () => {
  const p = recordShadowTradeEvent(entry!, { ts: "2026-08-31T09:30:00+05:30", event: "PARTIAL_EXIT", premium: 140, quantity: 65, trailingSl: 120 })!;
  const s = recordShadowTradeEvent(p, { ts: "2026-08-31T09:45:00+05:30", event: "RUNNER_EXIT", premium: 150, quantity: 65, trailingSl: 138 });
  assert.equal(s?.remainingQty, 0);
  assert.equal(s?.closed, true);
  assert.equal(s?.realisedShadowPnl, 3250);
});

test("TSL never widens", () => {
  const s = recordShadowTradeEvent(entry!, { ts: "2026-08-31T09:25:00+05:30", event: "TSL_UPDATE", premium: 135, trailingSl: 110 });
  assert.equal(s, null);
});

test("rejects full quantity as partial exit", () => {
  const s = recordShadowTradeEvent(entry!, { ts: "2026-08-31T09:30:00+05:30", event: "PARTIAL_EXIT", premium: 140, quantity: 130, trailingSl: 120 });
  assert.equal(s, null);
});

test("rejects out of order timestamp", () => {
  const s = recordShadowTradeEvent(entry!, { ts: "2026-08-31T09:19:00+05:30", event: "TSL_UPDATE", premium: 122, trailingSl: 113 });
  assert.equal(s, null);
});

test("closed trade cannot accept more events", () => {
  const s = recordShadowTradeEvent(entry!, { ts: "2026-08-31T09:45:00+05:30", event: "RUNNER_EXIT", premium: 130, quantity: 130, trailingSl: 118 })!;
  const again = recordShadowTradeEvent(s, { ts: "2026-08-31T09:46:00+05:30", event: "TSL_UPDATE", premium: 131, trailingSl: 119 });
  assert.equal(again, null);
});
