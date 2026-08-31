import test from "node:test";
import assert from "node:assert/strict";
import { ImmediateMetricIngestBridge } from "../immediate-metric-ingest-bridge.js";
import { ImmediateEventTruthRecorder } from "../immediate-event-truth-recorder.js";

function sample(id: string, value: number, second: number) {
  return {
    id,
    family: "PCR" as const,
    occurredAt: `2026-08-31T06:00:${String(second).padStart(2, "0")}.000Z`,
    value,
    source: "TEST_STREAM",
    snapshotId: `snap-${second}`,
    effectWhenRising: "FAVOURS_CE" as const,
    effectWhenFalling: "FAVOURS_PE" as const,
    factLabel: "NIFTY PCR",
  };
}

test("warms up without inventing immediate events", () => {
  const truth = new ImmediateEventTruthRecorder();
  const bridge = new ImmediateMetricIngestBridge(truth);
  for (let i = 0; i < 8; i++) {
    const out = bridge.ingest({ symbol: "NIFTY", lockedTrendSide: "CE", sample: sample(`e${i}`, 1 + i * 0.001, i) });
    assert.equal(out.truthRecord, null);
  }
  assert.equal(truth.list("NIFTY", 100).length, 0);
});

test("records only detector-confirmed abnormal event", () => {
  const truth = new ImmediateEventTruthRecorder();
  const bridge = new ImmediateMetricIngestBridge(truth);
  for (let i = 0; i < 9; i++) {
    bridge.ingest({ symbol: "NIFTY", lockedTrendSide: "CE", sample: sample(`e${i}`, 1 + i * 0.001, i) });
  }
  const out = bridge.ingest({ symbol: "NIFTY", lockedTrendSide: "CE", sample: sample("jump", 1.20, 10) });
  assert.equal(out.detector.abnormal, true);
  assert.equal(out.detector.event?.alignment, "FAVOURS_TREND");
  assert.equal(out.truthRecord?.ok, true);
  assert.equal(truth.list("NIFTY", 100).length, 1);
});

test("keeps independent detector baselines per metric stream", () => {
  const truth = new ImmediateEventTruthRecorder();
  const bridge = new ImmediateMetricIngestBridge(truth);
  for (let i = 0; i < 8; i++) {
    bridge.ingest({ symbol: "NIFTY", lockedTrendSide: "CE", sample: sample(`p${i}`, 1 + i * 0.001, i) });
    bridge.ingest({ symbol: "BANKNIFTY", lockedTrendSide: "PE", sample: { ...sample(`b${i}`, 100 + i, i), factLabel: "BANK FUT OI", family: "FUTURES_OI", effectWhenRising: "FAVOURS_PE", effectWhenFalling: "FAVOURS_CE" } });
  }
  assert.equal(bridge.stats().detectorStreams, 2);
});
