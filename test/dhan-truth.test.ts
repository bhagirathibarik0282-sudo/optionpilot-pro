import test from "node:test";
import assert from "node:assert/strict";
import { dhanTokenNeedsRefresh, evaluateDhanTruth, parseDhanIstTimestampMs } from "../dhan-truth.js";

test("parses Dhan zone-less expiryTime as IST, not Railway UTC", () => {
  assert.equal(
    new Date(parseDhanIstTimestampMs("2026-08-14T21:28:37.771")!).toISOString(),
    "2026-08-14T15:58:37.771Z"
  );
  assert.equal(
    parseDhanIstTimestampMs("2026-08-14T15:58:37.771Z"),
    Date.parse("2026-08-14T15:58:37.771Z")
  );
});

test("refreshes inside the five-minute buffer using the correct IST instant", () => {
  assert.equal(
    dhanTokenNeedsRefresh("2026-08-14T21:28:37.771", Date.parse("2026-08-14T15:55:02.287Z")),
    true
  );
});

test("fresh optional mobile delivery does not weaken verified market truth", () => {
  const nowMs = Date.parse("2026-08-14T10:00:10.000Z");
  const report = evaluateDhanTruth({
    nowMs,
    symbol: "NIFTY",
    expectedSymbol: "NIFTY",
    expiry: "2026-08-20",
    expectedExpiry: "2026-08-20",
    optionType: "CE",
    expectedOptionType: "CE",
    securityId: 123,
    strike: 24500,
    fields: {
      spot: { timestamp: "2026-08-14T10:00:08.000Z", source: "EXCHANGE", maxAgeMs: 30_000, requiredForCandidate: true },
      optionQuote: { timestamp: "2026-08-14T10:00:08.000Z", source: "PROVIDER", maxAgeMs: 30_000, requiredForCandidate: true },
      optionChain: { timestamp: "2026-08-14T10:00:08.000Z", source: "PROVIDER", maxAgeMs: 30_000, requiredForCandidate: true },
      oi: { timestamp: "2026-08-14T10:00:08.000Z", source: "PROVIDER", maxAgeMs: 60_000, requiredForCandidate: true },
      mobileDelivery: { timestamp: "2026-08-14T10:00:09.000Z", source: "BACKEND_RECEIVED", maxAgeMs: 30_000, requiredForCandidate: false },
    },
  });
  assert.equal(report.state, "VERIFIED");
  assert.equal(report.candidateEligible, true);
  assert.equal(report.reviewEligible, true);
  assert.match(report.warnings.join(","), /MOBILEDELIVERY_BACKEND_RECEIPT_PROXY/);
});

test("all required provider/exchange timestamps can reach VERIFIED", () => {
  const report = evaluateDhanTruth({
    nowMs: Date.parse("2026-08-14T10:00:10.000Z"),
    symbol: "BANKNIFTY",
    expectedSymbol: "BANKNIFTY",
    expiry: "2026-08-26",
    expectedExpiry: "2026-08-26",
    fields: {
      spot: { timestamp: "2026-08-14T10:00:09.000Z", source: "EXCHANGE", maxAgeMs: 30_000, requiredForCandidate: true },
      optionQuote: { timestamp: "2026-08-14T10:00:09.000Z", source: "PROVIDER", maxAgeMs: 30_000, requiredForCandidate: true },
      optionChain: { timestamp: "2026-08-14T10:00:09.000Z", source: "PROVIDER", maxAgeMs: 30_000, requiredForCandidate: true },
      oi: { timestamp: "2026-08-14T10:00:09.000Z", source: "PROVIDER", maxAgeMs: 60_000, requiredForCandidate: true },
    },
  });
  assert.equal(report.state, "VERIFIED");
  assert.equal(report.candidateEligible, true);
});

test("backend receipt proxies never become VERIFIED", () => {
  const nowMs = Date.parse("2026-08-14T10:00:10.000Z");
  const report = evaluateDhanTruth({
    nowMs,
    symbol: "NIFTY",
    expectedSymbol: "NIFTY",
    expiry: "2026-08-20",
    expectedExpiry: "2026-08-20",
    fields: {
      optionQuote: { timestamp: "2026-08-14T10:00:09.000Z", source: "BACKEND_RECEIVED", maxAgeMs: 30_000, requiredForCandidate: true },
    },
  });
  assert.equal(report.state, "DEGRADED");
  assert.equal(report.candidateEligible, false);
  assert.match(report.warnings.join(","), /OPTIONQUOTE_BACKEND_RECEIPT_PROXY/);
});

test("stale required data freezes and identity mismatch locks", () => {
  const base = {
    nowMs: Date.parse("2026-08-14T10:05:00.000Z"),
    symbol: "NIFTY",
    expectedSymbol: "NIFTY",
    expiry: "2026-08-20",
    expectedExpiry: "2026-08-20",
    fields: {
      oi: { timestamp: "2026-08-14T10:00:00.000Z", source: "PROVIDER" as const, maxAgeMs: 60_000, requiredForCandidate: true },
    },
  };
  const frozen = evaluateDhanTruth(base);
  assert.equal(frozen.state, "FROZEN");
  assert.equal(frozen.reviewEligible, false);

  const locked = evaluateDhanTruth({ ...base, symbol: "BANKNIFTY" });
  assert.equal(locked.state, "LOCKED");
  assert.match(locked.hardBlockReasons.join(","), /UNDERLYING_IDENTITY_MISMATCH/);
});

test("future timestamp and sequence gap lock instead of inventing freshness", () => {
  const report = evaluateDhanTruth({
    nowMs: Date.parse("2026-08-14T10:00:00.000Z"),
    symbol: "SENSEX",
    expectedSymbol: "SENSEX",
    expiry: "2026-08-21",
    expectedExpiry: "2026-08-21",
    sequenceGap: true,
    fields: {
      optionChain: { timestamp: "2026-08-14T10:01:00.000Z", source: "PROVIDER", maxAgeMs: 30_000, requiredForCandidate: true },
    },
  });
  assert.equal(report.state, "LOCKED");
  assert.equal(report.candidateEligible, false);
  assert.ok(report.hardBlockReasons.includes("SEQUENCE_GAP_RESYNC_REQUIRED"));
  assert.ok(report.hardBlockReasons.includes("OPTIONCHAIN_TIMESTAMP_INVALID"));
});

test("missing required contract identity and empty freshness input fail closed", () => {
  const report = evaluateDhanTruth({
    symbol: "NIFTY",
    expectedSymbol: "NIFTY",
    expiry: "2026-08-20",
    expectedExpiry: "2026-08-20",
    securityId: null,
    strike: null,
    fields: {},
  });
  assert.equal(report.state, "LOCKED");
  assert.ok(report.hardBlockReasons.includes("SECURITY_ID_INVALID"));
  assert.ok(report.hardBlockReasons.includes("STRIKE_INVALID"));
  assert.ok(report.hardBlockReasons.includes("NO_TRUTH_FIELDS"));
  assert.ok(report.hardBlockReasons.includes("NO_REQUIRED_FRESHNESS_FIELDS"));
});
