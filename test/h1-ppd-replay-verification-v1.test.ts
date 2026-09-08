import test from "node:test";
import assert from "node:assert/strict";
import type { H1ReplayHttpResult, H1ReplayRequest } from "../h1-replay-http.js";
import { buildH1PpdReplayVerification } from "../h1-ppd-replay-verification-v1.js";

const request: H1ReplayRequest = {
  symbol: "NIFTY",
  tradeDate: "2026-09-07",
  fromTime: "09:15",
  toTime: "09:30",
  scope: "CORE",
};

function row(minute: string, expiry: string, dte: number, side: "CE" | "PE", ltp: number, stale = false) {
  return {
    symbol: "NIFTY",
    minute_bucket: new Date(minute),
    expiry,
    expiry_bucket: "Current Expiry",
    dte,
    strike: 23850,
    option_type: side,
    atm_offset: 0,
    ltp,
    bid: ltp - 0.05,
    ask: ltp + 0.05,
    quote_age_seconds: 1,
    validation_status: stale ? "STALE" : "RESEARCH_ELIGIBLE",
    truth_verdict: stale ? "STALE" : "TRUE",
  };
}

function replay(options: Record<string, unknown>[]): H1ReplayHttpResult {
  return {
    ok: true,
    mode: "READ_ONLY_H1_3M_REPLAY",
    productionImpact: "NONE",
    request,
    counts: { market: 0, options: options.length, chain: 0, markers: 0, canonical: 0 },
    options,
  };
}

test("replay verification reconstructs Sep-7 style 6m PE PPD and multi-DTE context without hindsight", () => {
  const options = [
    row("2026-09-07T03:45:00.000Z", "2026-09-08", 1, "CE", 87.55),
    row("2026-09-07T03:45:00.000Z", "2026-09-08", 1, "PE", 58.15),
    row("2026-09-07T03:51:00.000Z", "2026-09-08", 1, "CE", 74.70),
    row("2026-09-07T03:51:00.000Z", "2026-09-08", 1, "PE", 68.55),
    row("2026-09-07T03:45:00.000Z", "2026-09-15", 8, "CE", 150),
    row("2026-09-07T03:45:00.000Z", "2026-09-15", 8, "PE", 132),
    row("2026-09-07T03:51:00.000Z", "2026-09-15", 8, "CE", 143),
    row("2026-09-07T03:51:00.000Z", "2026-09-15", 8, "PE", 141),
  ];
  const result = buildH1PpdReplayVerification(request, replay(options));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const current = result.verification.windows.find((x) => x.windowMinutes === 6 && x.dte === 1);
  assert.ok(current);
  assert.equal(current?.controllingSide, "PE");
  assert.ok((current?.netPpdSeparationPp ?? 0) > 32 && (current?.netPpdSeparationPp ?? 0) < 33);
  assert.equal(result.verification.multiDteSnapshots, 1);
  const context = result.verification.multiDte[0]?.context;
  assert.equal(context?.ok, true);
  if (context?.ok) assert.equal(context.alignment, "ALL_PE");
  assert.equal(result.interpretation.noHindsightOutcomeUsed, true);
  assert.equal(result.interpretation.winnerOnlyThresholdPromoted, false);
  assert.equal(result.safety.affectsVerdict, false);
  assert.equal(result.safety.affectsExecution, false);
});

test("stale paired evidence fails closed and is not ranked", () => {
  const options = [
    row("2026-09-07T03:45:00.000Z", "2026-09-08", 1, "CE", 100),
    row("2026-09-07T03:45:00.000Z", "2026-09-08", 1, "PE", 100),
    row("2026-09-07T03:51:00.000Z", "2026-09-08", 1, "CE", 80, true),
    row("2026-09-07T03:51:00.000Z", "2026-09-08", 1, "PE", 120),
  ];
  const result = buildH1PpdReplayVerification(request, replay(options));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.verification.validWindows, 0);
  assert.equal(result.verification.invalidPairCount, 1);
  assert.equal(result.verification.windows.length, 0);
});

test("output remains bounded and does not expose raw option rows", () => {
  const options: Record<string, unknown>[] = [];
  for (let i = 0; i <= 20; i += 1) {
    const minute = new Date(Date.parse("2026-09-07T03:45:00.000Z") + i * 3 * 60_000).toISOString();
    options.push(row(minute, "2026-09-08", 1, "CE", 100 + i));
    options.push(row(minute, "2026-09-08", 1, "PE", 100 - i * 0.5));
  }
  const result = buildH1PpdReplayVerification(request, replay(options), 5);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.verification.windows.length <= 5);
  const topLevel = result as Record<string, unknown>;
  assert.equal("options" in topLevel, false);
  assert.equal(result.boundedOutput.rawOptionRowsOmitted, true);
});
