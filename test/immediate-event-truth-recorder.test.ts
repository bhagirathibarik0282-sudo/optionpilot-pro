import test from "node:test";
import assert from "node:assert/strict";
import { ImmediateEventTruthRecorder } from "../immediate-event-truth-recorder.js";

const event = {
  id: "evt-1",
  family: "PCR" as const,
  occurredAt: "2026-08-31T06:24:00.000Z",
  fact: "Band PCR expanded with the locked trend.",
  abnormalImmediateChange: true,
  fresh: true,
  alignment: "FAVOURS_TREND" as const,
};

test("records exact supplied event without inventing thresholds", () => {
  const recorder = new ImmediateEventTruthRecorder(10);
  const result = recorder.append({
    symbol: "NIFTY",
    source: "TEST_SOURCE",
    snapshotId: "snap-1",
    receivedAt: "2026-08-31T06:24:01.000Z",
    event,
  });

  assert.equal(result.ok, true);
  assert.equal(result.accepted, true);
  assert.equal(recorder.latest("NIFTY")?.event.fact, event.fact);
  assert.equal(recorder.latest("NIFTY")?.event.abnormalImmediateChange, true);
  assert.equal(recorder.stats().affectsExecution, false);
});

test("deduplicates same source snapshot event identity", () => {
  const recorder = new ImmediateEventTruthRecorder(10);
  const input = { symbol: "NIFTY" as const, source: "TEST_SOURCE", snapshotId: "snap-1", receivedAt: "2026-08-31T06:24:01.000Z", event };
  assert.equal(recorder.append(input).accepted, true);
  const duplicate = recorder.append(input);
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(recorder.stats().counts.NIFTY, 1);
});

test("keeps separate source updates separate even with same event id", () => {
  const recorder = new ImmediateEventTruthRecorder(10);
  assert.equal(recorder.append({ symbol: "NIFTY", source: "PCR_ENGINE", snapshotId: "snap-1", event }).accepted, true);
  assert.equal(recorder.append({ symbol: "NIFTY", source: "CHAIN_ENGINE", snapshotId: "snap-1", event }).accepted, true);
  assert.equal(recorder.stats().counts.NIFTY, 2);
});

test("returns events in event-time order even when received out of order", () => {
  const recorder = new ImmediateEventTruthRecorder(10);
  recorder.append({
    symbol: "NIFTY",
    source: "TEST_SOURCE",
    event: { ...event, id: "later", occurredAt: "2026-08-31T06:24:03.000Z" },
    receivedAt: "2026-08-31T06:24:03.100Z",
  });
  recorder.append({
    symbol: "NIFTY",
    source: "TEST_SOURCE",
    event: { ...event, id: "earlier", occurredAt: "2026-08-31T06:24:01.000Z" },
    receivedAt: "2026-08-31T06:24:04.000Z",
  });
  assert.deepEqual(recorder.list("NIFTY").map((x) => x.event.id), ["earlier", "later"]);
});

test("bounded storage evicts oldest ingested rows and frees dedupe key", () => {
  const recorder = new ImmediateEventTruthRecorder(2);
  recorder.append({ symbol: "NIFTY", source: "TEST", event: { ...event, id: "1", occurredAt: "2026-08-31T06:24:01.000Z" } });
  recorder.append({ symbol: "NIFTY", source: "TEST", event: { ...event, id: "2", occurredAt: "2026-08-31T06:24:02.000Z" } });
  recorder.append({ symbol: "NIFTY", source: "TEST", event: { ...event, id: "3", occurredAt: "2026-08-31T06:24:03.000Z" } });
  assert.equal(recorder.stats().counts.NIFTY, 2);
  assert.equal(recorder.append({ symbol: "NIFTY", source: "TEST", event: { ...event, id: "1", occurredAt: "2026-08-31T06:24:01.000Z" } }).accepted, true);
});

test("rejects malformed truth records", () => {
  const recorder = new ImmediateEventTruthRecorder();
  const result = recorder.append({
    symbol: "NIFTY",
    source: "TEST",
    event: { ...event, occurredAt: "not-a-time" },
  });
  assert.equal(result.ok, false);
  assert.equal(result.accepted, false);
});
