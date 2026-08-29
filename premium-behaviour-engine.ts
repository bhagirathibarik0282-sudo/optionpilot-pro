// Research-only premium behaviour classification for an exact selected option contract.
// No thresholds are invented here: upstream deterministic evidence evaluators must supply booleans/null.

export type PremiumBehaviourState =
  | "RESPONDING_WELL"
  | "WEAK_RESPONSE"
  | "OVEREXTENDED"
  | "IV_DRIVEN"
  | "THETA_PRESSURE"
  | "OPPOSITE_PREMIUM_WARNING"
  | "DIVERGING"
  | "DATA_UNAVAILABLE";

export interface PremiumBehaviourEvidence {
  dataFresh: boolean | null;
  contractValid: boolean | null;
  liquidityOk: boolean | null;
  selectedPremiumDirectionConfirmed: boolean | null;
  responseStrengthConfirmed: boolean | null;
  oppositePremiumWarning: boolean | null;
  overextended: boolean | null;
  ivDominant: boolean | null;
  thetaPressure: boolean | null;
  diverging: boolean | null;
}

export interface PremiumBehaviourResult {
  version: "PREMIUM_BEHAVIOUR_ENGINE_V1";
  semantics: "RESEARCH_SHADOW_ONLY";
  state: PremiumBehaviourState;
  reasons: string[];
  devilFlags: string[];
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
}

const requiredEvidenceKeys: Array<keyof PremiumBehaviourEvidence> = [
  "dataFresh",
  "contractValid",
  "liquidityOk",
  "selectedPremiumDirectionConfirmed",
  "responseStrengthConfirmed",
  "oppositePremiumWarning",
  "overextended",
  "ivDominant",
  "thetaPressure",
  "diverging",
];

function result(state: PremiumBehaviourState, reasons: string[], devilFlags: string[] = []): PremiumBehaviourResult {
  return {
    version: "PREMIUM_BEHAVIOUR_ENGINE_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    state,
    reasons,
    devilFlags,
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
  };
}

/**
 * Precedence is intentionally conservative:
 * missing/stale/invalid data -> unavailable; then explicit risk/warning states;
 * only a fully confirmed, non-conflicted response can become RESPONDING_WELL.
 */
export function classifyPremiumBehaviour(evidence: PremiumBehaviourEvidence): PremiumBehaviourResult {
  const missing = requiredEvidenceKeys.filter((key) => evidence[key] == null);
  if (missing.length > 0) {
    return result("DATA_UNAVAILABLE", missing.map((key) => `MISSING_${String(key).toUpperCase()}`));
  }

  if (!evidence.dataFresh) return result("DATA_UNAVAILABLE", ["DATA_NOT_FRESH"], ["STALE_DATA"]);
  if (!evidence.contractValid) return result("DATA_UNAVAILABLE", ["CONTRACT_NOT_VALID"], ["CONTRACT_IDENTITY_GATE_FAILED"]);
  if (!evidence.liquidityOk) return result("DATA_UNAVAILABLE", ["LIQUIDITY_NOT_ACCEPTABLE"], ["LIQUIDITY_GATE_FAILED"]);

  if (evidence.diverging) return result("DIVERGING", ["PREMIUM_DIVERGENCE_CONFIRMED"], ["THESIS_CONFLICT"]);
  if (evidence.oppositePremiumWarning) return result("OPPOSITE_PREMIUM_WARNING", ["OPPOSITE_PREMIUM_WARNING_CONFIRMED"]);
  if (evidence.overextended) return result("OVEREXTENDED", ["SELECTED_PREMIUM_OVEREXTENDED"]);
  if (evidence.thetaPressure) return result("THETA_PRESSURE", ["THETA_PRESSURE_CONFIRMED"]);
  if (evidence.ivDominant) return result("IV_DRIVEN", ["IV_DOMINANCE_CONFIRMED"]);

  if (!evidence.selectedPremiumDirectionConfirmed || !evidence.responseStrengthConfirmed) {
    return result("WEAK_RESPONSE", ["PREMIUM_RESPONSE_NOT_FULLY_CONFIRMED"]);
  }

  return result("RESPONDING_WELL", ["DIRECTION_AND_RESPONSE_STRENGTH_CONFIRMED"]);
}
