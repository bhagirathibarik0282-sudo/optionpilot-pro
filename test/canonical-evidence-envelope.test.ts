import test from "node:test";
import assert from "node:assert/strict";
import { buildCanonicalEvidenceEnvelope } from "../canonical-evidence-envelope.js";

const temporal = (timeframe: "3M" | "6M" | "15M" | "30M") => ({
  symbol: "NIFTY",
  timeframe,
  blockEnd: "2026-09-03T04:00:00.000Z",
  previousBlockEnd: "2026-09-03T03:54:00.000Z",
  state: "STABLE" as const,
  direction: "UP" as const,
  currentReturnPct: 0.1,
  previousReturnPct: 0.08,
  currentRangePct: 0.2,
  previousRangePct: 0.18,
  currentCoveragePct: 100,
  previousCoveragePct: 100,
  reasons: ["usable"],
  ruleVersion: "TEF_FOUNDATION_V1" as const,
  affectsVerdict: false as const,
  affectsTelegram: false as const,
  affectsExecution: false as const,
});

test("canonical envelope preserves zero authority and 3/6/15/30 sequence", () => {
  const out = buildCanonicalEvidenceEnvelope({
    symbol: "NIFTY",
    institutionalContext: {
      latestTradeDate: "2026-09-02",
      windows: [],
      freshness: "PRIOR_SESSION",
      reasons: ["context only"],
      ruleVersion: "FII_DII_CONTEXT_V1",
      semantics: "CONTEXT_ONLY",
      affectsVerdict: false,
      affectsTelegram: false,
      affectsExecution: false,
    },
    clue3m: temporal("3M"),
    confirm6m: temporal("6M"),
    validate15m: temporal("15M"),
    sustain30m: temporal("30M"),
    combinations: {
      symbol: "NIFTY",
      minuteBucket: "2026-09-03T04:00:00.000Z",
      combinations: [],
      availableCount: 0,
      warningCount: 0,
      conflictCount: 0,
      ruleVersion: "TEF_COMBINATION_V1",
      affectsVerdict: false,
      affectsTelegram: false,
      affectsExecution: false,
    },
  });

  assert.equal(out.evidenceFresh, true);
  assert.equal(out.temporal.confirm6m.timeframe, "6M");
  assert.equal(out.affectsVerdict, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.aiMayOverride, false);
});
