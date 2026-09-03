import type { FiiDiiContextSnapshot } from "./fii-dii-context.js";
import type { MeaningfulCombinationSnapshot } from "./meaningful-combination-engine.js";
import type { TemporalEvidenceSnapshot } from "./temporal-evidence-fusion.js";

export interface CanonicalEvidenceEnvelope {
  symbol: "NIFTY" | "BANKNIFTY" | "SENSEX";
  generatedAt: string;
  institutionalContext: FiiDiiContextSnapshot;
  temporal: {
    clue3m: TemporalEvidenceSnapshot;
    confirm6m: TemporalEvidenceSnapshot;
    validate15m: TemporalEvidenceSnapshot;
    sustain30m: TemporalEvidenceSnapshot;
  };
  combinations: MeaningfulCombinationSnapshot;
  evidenceFresh: boolean;
  blockers: string[];
  ruleVersion: "CANONICAL_EVIDENCE_ENVELOPE_V1";
  semantics: "RESEARCH_SHADOW_ONLY";
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
  aiMayOverride: false;
}

export function buildCanonicalEvidenceEnvelope(input: {
  symbol: CanonicalEvidenceEnvelope["symbol"];
  institutionalContext: FiiDiiContextSnapshot;
  clue3m: TemporalEvidenceSnapshot;
  confirm6m: TemporalEvidenceSnapshot;
  validate15m: TemporalEvidenceSnapshot;
  sustain30m: TemporalEvidenceSnapshot;
  combinations: MeaningfulCombinationSnapshot;
}): CanonicalEvidenceEnvelope {
  const blockers: string[] = [];
  const temporal = [input.clue3m, input.confirm6m, input.validate15m, input.sustain30m];

  if (temporal.some((t) => t.symbol !== input.symbol)) blockers.push("TEMPORAL_SYMBOL_MISMATCH");
  if (input.combinations.symbol !== input.symbol) blockers.push("COMBINATION_SYMBOL_MISMATCH");
  if (input.clue3m.timeframe !== "3M") blockers.push("MISSING_3M_CLUE");
  if (input.confirm6m.timeframe !== "6M") blockers.push("MISSING_6M_CONFIRMATION");
  if (input.validate15m.timeframe !== "15M") blockers.push("MISSING_15M_VALIDATION");
  if (input.sustain30m.timeframe !== "30M") blockers.push("MISSING_30M_SUSTAINED_STATE");
  if (temporal.some((t) => t.state === "INSUFFICIENT_DATA")) blockers.push("TEMPORAL_EVIDENCE_INCOMPLETE");

  return {
    symbol: input.symbol,
    generatedAt: new Date().toISOString(),
    institutionalContext: input.institutionalContext,
    temporal: {
      clue3m: input.clue3m,
      confirm6m: input.confirm6m,
      validate15m: input.validate15m,
      sustain30m: input.sustain30m,
    },
    combinations: input.combinations,
    evidenceFresh: blockers.length === 0,
    blockers,
    ruleVersion: "CANONICAL_EVIDENCE_ENVELOPE_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
    aiMayOverride: false,
  };
}
