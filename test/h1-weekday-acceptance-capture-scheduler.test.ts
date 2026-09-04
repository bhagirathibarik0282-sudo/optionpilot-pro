import test from "node:test";
import assert from "node:assert/strict";
import { nextH1WeekdayAcceptanceCaptureAt } from "../h1-weekday-acceptance-capture-scheduler.js";

test("Friday evening schedules Monday 09:18 IST", () => {
  const next = nextH1WeekdayAcceptanceCaptureAt(new Date("2026-09-04T13:45:00.000Z"));
  assert.equal(next.toISOString(), "2026-09-07T03:48:00.000Z");
});

test("weekday before 09:18 IST schedules same weekday", () => {
  const next = nextH1WeekdayAcceptanceCaptureAt(new Date("2026-09-07T03:47:00.000Z"));
  assert.equal(next.toISOString(), "2026-09-07T03:48:00.000Z");
});

test("weekday after 09:18 IST schedules next weekday", () => {
  const next = nextH1WeekdayAcceptanceCaptureAt(new Date("2026-09-07T03:49:00.000Z"));
  assert.equal(next.toISOString(), "2026-09-08T03:48:00.000Z");
});

test("Saturday skips to Monday", () => {
  const next = nextH1WeekdayAcceptanceCaptureAt(new Date("2026-09-05T04:00:00.000Z"));
  assert.equal(next.toISOString(), "2026-09-07T03:48:00.000Z");
});
