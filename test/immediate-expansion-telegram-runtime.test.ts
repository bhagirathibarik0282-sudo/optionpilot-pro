import test from "node:test";
import assert from "node:assert/strict";
import { buildImmediateExpansionTelegramRuntime } from "../immediate-expansion-telegram-runtime.js";
import type { RecorderIngestPayload } from "../option-recorder-runtime.js";

const ts = "2026-08-31T06:24:00.000Z";

function basePayload(): RecorderIngestPayload {
  return {
    market: {
      snapshotId: "snap-1",
      symbol: "NIFTY",
      exchangeTimestamp: ts,
      backendTimestamp: ts,
      spot: 24042,
      future: 24226.6,
      futureOi: 15474940,
      futureVolume: 1000,
      vwap: 24000,
      pdh: 24188.3,
      pdl: 24076.85,
    },
    options: [],
    verdicts: [],
  };
}

test("no verified immediate context produces no Telegram message", () => {
  const out = buildImmediateExpansionTelegramRuntime(basePayload());
  assert.equal(out.eligible, false);
  assert.equal(out.reason, "NO_IMMEDIATE_CONTEXT");
  assert.equal(out.text, null);
});

test("fresh synchronized CE events produce CE verdict message", () => {
  const p = basePayload();
  p.immediateExpansion = {
    lockedTrendSide: "CE",
    trendValid: true,
    clusterReady: true,
    events: [
      { id: "pcr-1", family: "PCR", occurredAt: "2026-08-31T06:24:01.000Z", fact: "PCR jumped immediately.", abnormalImmediateChange: true, fresh: true, alignment: "FAVOURS_TREND" },
      { id: "wall-1", family: "CALL_WALL", occurredAt: "2026-08-31T06:24:03.000Z", fact: "Call wall shed immediately.", abnormalImmediateChange: true, fresh: true, alignment: "FAVOURS_TREND" },
      { id: "ce-1", family: "CE_PREMIUM", occurredAt: "2026-08-31T06:24:05.000Z", fact: "CE premium expanded immediately.", abnormalImmediateChange: true, fresh: true, alignment: "FAVOURS_TREND" },
      { id: "iv-1", family: "CE_IV", occurredAt: "2026-08-31T06:24:06.000Z", fact: "CE IV expanded.", abnormalImmediateChange: true, fresh: true, alignment: "VOLATILITY_ONLY" },
    ],
  };
  const out = buildImmediateExpansionTelegramRuntime(p);
  assert.equal(out.eligible, true);
  assert.equal(out.chain?.verdict, "CE_FAVOURED");
  assert.match(out.text ?? "", /WHY NOW:/);
  assert.match(out.text ?? "", /VERDICT: CE FAVOURED/);
  assert.match(out.text ?? "", /WATCH:/);
  assert.match(out.text ?? "", /INVALIDATION:/);
  assert.ok(out.fingerprint?.includes("snap-1"));
});

test("fresh conflict fails closed to WAIT and no send-ready text", () => {
  const p = basePayload();
  p.immediateExpansion = {
    lockedTrendSide: "CE",
    trendValid: true,
    clusterReady: true,
    events: [
      { id: "ce-1", family: "CE_PREMIUM", occurredAt: ts, fact: "CE premium expanded.", abnormalImmediateChange: true, fresh: true, alignment: "FAVOURS_TREND" },
      { id: "put-1", family: "PUT_WALL", occurredAt: ts, fact: "Put support shed immediately.", abnormalImmediateChange: true, fresh: true, alignment: "CONFLICTS_TREND" },
    ],
  };
  const out = buildImmediateExpansionTelegramRuntime(p);
  assert.equal(out.eligible, false);
  assert.equal(out.reason, "WAIT_VERDICT");
  assert.equal(out.chain?.verdict, "WAIT");
  assert.equal(out.text, null);
});

test("IV/VIX-only expansion cannot create direction", () => {
  const p = basePayload();
  p.immediateExpansion = {
    lockedTrendSide: "NONE",
    trendValid: false,
    clusterReady: true,
    events: [
      { id: "iv-1", family: "ATM_IV", occurredAt: ts, fact: "ATM IV jumped.", abnormalImmediateChange: true, fresh: true, alignment: "VOLATILITY_ONLY" },
      { id: "vix-1", family: "INDIA_VIX", occurredAt: ts, fact: "India VIX accelerated.", abnormalImmediateChange: true, fresh: true, alignment: "VOLATILITY_ONLY" },
    ],
  };
  const out = buildImmediateExpansionTelegramRuntime(p);
  assert.equal(out.eligible, false);
  assert.equal(out.chain?.verdict, "WAIT");
});
