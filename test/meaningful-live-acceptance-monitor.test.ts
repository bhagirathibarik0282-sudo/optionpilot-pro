import test from "node:test";
import assert from "node:assert/strict";
import {
  MeaningfulAcceptanceRuntime,
  classifyMeaningfulTelegramResponseBody,
  summarizePersistedMeaningfulEvents,
} from "../meaningful-live-acceptance-monitor.js";

const MEMORY = {
  symbol: "NIFTY" as const,
  state: "BULLISH_RELEASE" as const,
  stateSinceMs: Date.parse("2026-09-02T04:00:00.000Z"),
  lastMeaningfulAtMs: Date.parse("2026-09-02T04:02:00.000Z"),
  lastMessageId: "NIFTY:1",
  candidateKey: "NIFTY|2026-09-03|24100|CE",
  oppositeKey: "NIFTY|2026-09-03|24100|PE",
  footprintLeader: "FUTURES_LED" as const,
  fingerprint: "fp-1",
};

test("classifies synthetic unchanged suppression", () => {
  assert.equal(
    classifyMeaningfulTelegramResponseBody(true, {
      ok: true,
      result: { text: "OPTIONPILOT_MEANINGFUL_SUPPRESSED_UNCHANGED" },
    }),
    "SUPPRESSED_UNCHANGED",
  );
});

test("classifies a sent meaningful message", () => {
  assert.equal(
    classifyMeaningfulTelegramResponseBody(true, {
      ok: true,
      result: { text: "🧭 OPTIONPILOT MEANINGFUL V1\nNIFTY" },
    }),
    "MEANINGFUL_SENT",
  );
});

test("classifies untouched legacy/live pass-through", () => {
  assert.equal(
    classifyMeaningfulTelegramResponseBody(true, {
      ok: true,
      result: { text: "NIFTY PCR 0.80 Wall OI Premium" },
    }),
    "PASS_THROUGH",
  );
  assert.equal(classifyMeaningfulTelegramResponseBody(false, {}), "SEND_FAILURE");
});

test("keeps runtime counters isolated by index", () => {
  const runtime = new MeaningfulAcceptanceRuntime();
  runtime.record("NIFTY", "SUPPRESSED_UNCHANGED", "2026-09-02T04:00:00.000Z");
  runtime.record("NIFTY", "MEANINGFUL_SENT", "2026-09-02T04:01:00.000Z");
  runtime.record("BANKNIFTY", "PASS_THROUGH", "2026-09-02T04:02:00.000Z");

  assert.deepEqual(runtime.get("NIFTY"), {
    telegramAttempts: 2,
    meaningfulSent: 1,
    suppressedUnchanged: 1,
    passThrough: 0,
    sendFailures: 0,
    lastObservedAt: "2026-09-02T04:01:00.000Z",
    lastOutcome: "MEANINGFUL_SENT",
  });
  assert.equal(runtime.get("BANKNIFTY").passThrough, 1);
  assert.equal(runtime.get("SENSEX").telegramAttempts, 0);
});

test("summarizes persisted journal by India trading date", () => {
  const nowMs = Date.parse("2026-09-02T05:00:00.000Z");
  const summary = summarizePersistedMeaningfulEvents("NIFTY", [
    { memory: MEMORY, generatedAt: "2026-09-02T04:02:00.000Z" },
    { memory: { ...MEMORY, symbol: "BANKNIFTY", lastMeaningfulAtMs: Date.parse("2026-09-02T04:03:00.000Z") } },
  ], nowMs);

  assert.equal(summary.eventCountToday, 1);
  assert.equal(summary.latest?.state, "BULLISH_RELEASE");
  assert.equal(summary.latest?.footprintLeader, "FUTURES_LED");
  assert.equal(summary.latest?.candidateKey, "NIFTY|2026-09-03|24100|CE");
  assert.equal(summary.latest?.ageMinutes, 58);
});
