import test from "node:test";
import assert from "node:assert/strict";
import { h1OptionValidationStatus } from "../h1-recorder-adapter.js";

const NOW = new Date("2026-10-21T10:00:00.000Z");
const atAge = (seconds: number) => new Date(NOW.getTime() - seconds * 1000).toISOString();

test("TRUE option legs remain research eligible through the 60-second boundary", () => {
  assert.equal(h1OptionValidationStatus("TRUE", atAge(0), NOW), "RESEARCH_ELIGIBLE");
  assert.equal(h1OptionValidationStatus("TRUE", atAge(60), NOW), "RESEARCH_ELIGIBLE");
});

test("stale TRUE option legs fail closed instead of inheriting index eligibility", () => {
  assert.equal(h1OptionValidationStatus("TRUE", atAge(61), NOW), "DIAGNOSTIC_STALE_OPTION_QUOTE");
  assert.equal(h1OptionValidationStatus("TRUE", "1970-01-01T00:00:00.000Z", NOW), "DIAGNOSTIC_STALE_OPTION_QUOTE");
});

test("missing, malformed, and future option timestamps fail closed", () => {
  assert.equal(h1OptionValidationStatus("TRUE", null, NOW), "DIAGNOSTIC_MISSING_OPTION_QUOTE_TIMESTAMP");
  assert.equal(h1OptionValidationStatus("TRUE", "not-a-date", NOW), "DIAGNOSTIC_MISSING_OPTION_QUOTE_TIMESTAMP");
  assert.equal(h1OptionValidationStatus("TRUE", atAge(-1), NOW), "DIAGNOSTIC_FUTURE_OPTION_QUOTE");
});

test("index truth diagnostics retain priority over quote freshness", () => {
  assert.equal(h1OptionValidationStatus("PARTIAL", atAge(0), NOW), "DIAGNOSTIC_PARTIAL");
  assert.equal(h1OptionValidationStatus("STALE", atAge(0), NOW), "DIAGNOSTIC_STALE");
  assert.equal(h1OptionValidationStatus("INVALID", atAge(0), NOW), "DIAGNOSTIC_INVALID");
});
