import test from "node:test";
import assert from "node:assert/strict";
import type { H1LiveExactRawEvidenceRow } from "../h1-live-exact-raw-evidence-store.js";
import { publishH1ExactRawRuntimeRow, resetH1ExactRawRuntimeHistoryForTest } from "../h1-exact-raw-runtime-history-v1.js";
import { buildLiveExactZWatchRuntime } from "../telegram-z-watch-live-exact-runtime-v1.js";

process.env.NODE_ENV = "test";

function row(input: {
  token: number;
  side: "CE" | "PE";
  strike?: number;
  at: string;
  ltp: number;
  bid: number;
  ask: number;
}): H1LiveExactRawEvidenceRow {
  return {
    instrumentToken: input.token,
    symbol: "NIFTY",
    role: "OPTION",
    instrumentLabel: `NIFTY-${input.strike ?? 24000}-${input.side}`,
    expiry: "2026-09-17",
    strike: input.strike ?? 24000,
    optionSide: input.side,
    observedAt: input.at,
    receivedAt: input.at,
    ltp: input.ltp,
    bid: input.bid,
    ask: input.ask,
    bidQty: 100,
    askQty: 100,
  };
}

test("live exact runtime builds same-contract 3m CE/PE feed", () => {
  resetH1ExactRawRuntimeHistoryForTest();
  publishH1ExactRawRuntimeRow(row({ token: 101, side: "CE", at: "2026-09-11T09:15:00.000Z", ltp: 100, bid: 99, ask: 101 }));
  publishH1ExactRawRuntimeRow(row({ token: 102, side: "PE", at: "2026-09-11T09:15:00.000Z", ltp: 100, bid: 99, ask: 101 }));
  publishH1ExactRawRuntimeRow(row({ token: 101, side: "CE", at: "2026-09-11T09:18:00.000Z", ltp: 110, bid: 109, ask: 111 }));
  publishH1ExactRawRuntimeRow(row({ token: 102, side: "PE", at: "2026-09-11T09:18:00.000Z", ltp: 90, bid: 89, ask: 91 }));

  const out = buildLiveExactZWatchRuntime("NIFTY", "2026-09-11T09:18:01.000Z");
  assert.equal(out.ready, true);
  assert.equal(out.feed.ce.ready, true);
  assert.equal(out.feed.pe.ready, true);
  assert.equal(out.feed.ce.premium3mPct, 10);
  assert.equal(out.feed.pe.premium3mPct, -10);
  assert.equal(out.feed.future3m, null);
  assert.equal(out.feed.ceOi3m, null);
  assert.equal(out.feed.peOi3m, null);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.createsOrders, false);
});

test("contract roll has no invented 3m baseline", () => {
  resetH1ExactRawRuntimeHistoryForTest();
  publishH1ExactRawRuntimeRow(row({ token: 101, side: "CE", at: "2026-09-11T09:15:00.000Z", ltp: 100, bid: 99, ask: 101 }));
  publishH1ExactRawRuntimeRow(row({ token: 102, side: "PE", at: "2026-09-11T09:15:00.000Z", ltp: 100, bid: 99, ask: 101 }));
  publishH1ExactRawRuntimeRow(row({ token: 201, side: "CE", strike: 24050, at: "2026-09-11T09:18:00.000Z", ltp: 105, bid: 104, ask: 106 }));
  publishH1ExactRawRuntimeRow(row({ token: 202, side: "PE", strike: 24050, at: "2026-09-11T09:18:00.000Z", ltp: 95, bid: 94, ask: 96 }));

  const out = buildLiveExactZWatchRuntime("NIFTY", "2026-09-11T09:18:01.000Z");
  assert.equal(out.ready, false);
  assert.equal(out.feed.ce.ready, false);
  assert.equal(out.feed.pe.ready, false);
  assert.ok(out.blockers.some((x) => x.includes("PREVIOUS_3M_EXACT_ROW_UNAVAILABLE")));
});

test("CE/PE strike mismatch fails closed", () => {
  resetH1ExactRawRuntimeHistoryForTest();
  publishH1ExactRawRuntimeRow(row({ token: 101, side: "CE", strike: 24000, at: "2026-09-11T09:15:00.000Z", ltp: 100, bid: 99, ask: 101 }));
  publishH1ExactRawRuntimeRow(row({ token: 102, side: "PE", strike: 24050, at: "2026-09-11T09:15:00.000Z", ltp: 100, bid: 99, ask: 101 }));
  publishH1ExactRawRuntimeRow(row({ token: 101, side: "CE", strike: 24000, at: "2026-09-11T09:18:00.000Z", ltp: 110, bid: 109, ask: 111 }));
  publishH1ExactRawRuntimeRow(row({ token: 102, side: "PE", strike: 24050, at: "2026-09-11T09:18:00.000Z", ltp: 90, bid: 89, ask: 91 }));

  const out = buildLiveExactZWatchRuntime("NIFTY", "2026-09-11T09:18:01.000Z");
  assert.equal(out.ready, false);
  assert.equal(out.feed.ce.ready, false);
  assert.equal(out.feed.pe.ready, false);
  assert.ok(out.blockers.includes("CE_PE_CONTRACT_PAIR_MISMATCH"));
});
