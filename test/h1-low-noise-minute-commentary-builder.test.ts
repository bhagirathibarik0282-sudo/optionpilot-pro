import assert from "node:assert/strict";
import test from "node:test";
import {
  buildH1LowNoiseMinuteCommentary,
  type H1CommentaryFrameEvidence,
} from "../h1-low-noise-minute-commentary-builder.js";
import type { H1CommentaryTimeframe } from "../h1-shadow-telegram-message-contract.js";

const policy = { minimumActiveRatio: 0.6, minimumPremiumChangePct: 2, minimumLeadScore: 0.15 };
const now = "2026-09-03T10:00:00.000Z";

function frame(
  timeframe: H1CommentaryTimeframe,
  side: "CE" | "PE" | "NONE" = "CE",
  fresh = true,
): H1CommentaryFrameEvidence {
  const ce = side === "CE"
    ? { activeCount: 5, observedCount: 7, premiumChangePct: 5 }
    : side === "PE"
      ? { activeCount: 1, observedCount: 7, premiumChangePct: -4 }
      : { activeCount: 3, observedCount: 7, premiumChangePct: 1 };
  const pe = side === "PE"
    ? { activeCount: 5, observedCount: 7, premiumChangePct: 5 }
    : side === "CE"
      ? { activeCount: 1, observedCount: 7, premiumChangePct: -4 }
      : { activeCount: 3, observedCount: 7, premiumChangePct: 1 };
  return { timeframe, observedAt: now, fresh, ce, pe };
}

test("selects the highest confirmed candle matching the one-minute side", () => {
  const out = buildH1LowNoiseMinuteCommentary([
    frame("1m"), frame("3m"), frame("6m"), frame("15m", "NONE"), frame("30m", "NONE"),
  ], now, policy);
  assert.equal(out.ready, true);
  assert.equal(out.commentary?.selectedCandle, "6m");
  assert.equal(out.commentary?.marketMode, "TRANSITION");
  assert.equal(out.commentary?.sameSide?.side, "CE");
  assert.equal(out.commentary?.oppositeSide?.side, "PE");
});

test("moves candle selection to 30m when the wider structure confirms", () => {
  const out = buildH1LowNoiseMinuteCommentary([
    frame("1m"), frame("3m"), frame("6m"), frame("15m"), frame("30m"),
  ], now, policy);
  assert.equal(out.commentary?.selectedCandle, "30m");
  assert.equal(out.commentary?.marketMode, "TRENDING");
});

test("keeps a different higher-timeframe side visible without a separate conflict state", () => {
  const out = buildH1LowNoiseMinuteCommentary([
    frame("1m"), frame("3m"), frame("6m"), frame("15m", "PE"), frame("30m", "PE"),
  ], now, policy);
  assert.equal(out.ready, true);
  assert.equal(out.commentary?.selectedCandle, "6m");
  assert.deepEqual(out.commentary?.timeframeViews.find((x) => x.timeframe === "15m"), {
    timeframe: "15m", side: "PE", state: "CONFIRMED",
  });
  assert.ok(out.commentary?.timeframeViews.every((x) => !String(x.state).includes("CONFLICT")));
});

test("marks an absent higher timeframe as missing while preserving valid minute commentary", () => {
  const out = buildH1LowNoiseMinuteCommentary([
    frame("1m"), frame("3m"), frame("6m"), frame("15m"),
  ], now, policy);
  assert.equal(out.ready, true);
  assert.deepEqual(out.commentary?.timeframeViews.find((x) => x.timeframe === "30m"), {
    timeframe: "30m", side: "NONE", state: "MISSING",
  });
});

test("aggregates same and opposite side counts continuously across fresh frames", () => {
  const out = buildH1LowNoiseMinuteCommentary([
    frame("1m"), frame("3m"), frame("6m"), frame("15m"), frame("30m"),
  ], now, policy);
  assert.deepEqual(out.commentary?.sameSide, {
    side: "CE", activeCount: 25, observedCount: 35, premiumChangePct: 5,
  });
  assert.deepEqual(out.commentary?.oppositeSide, {
    side: "PE", activeCount: 5, observedCount: 35, premiumChangePct: -4,
  });
});

test("fails closed when one-minute direction is missing or tied", () => {
  const missing = buildH1LowNoiseMinuteCommentary([
    frame("1m", "CE", false), frame("3m"), frame("6m"),
  ], now, policy);
  assert.equal(missing.ready, false);
  assert.ok(missing.blockers.includes("ONE_MINUTE_DIRECTIONAL_EVIDENCE_MISSING"));

  const tied = buildH1LowNoiseMinuteCommentary([
    frame("1m", "NONE"), frame("3m"), frame("6m"),
  ], now, policy);
  assert.equal(tied.ready, false);
  assert.ok(tied.blockers.includes("ONE_MINUTE_DIRECTIONAL_EVIDENCE_MISSING"));
});
