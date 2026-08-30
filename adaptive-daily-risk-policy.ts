import { tightenOnlyLimit } from "./quantum-inspired-core.js";

export type RiskRegime = "STRONG" | "NORMAL" | "UNCERTAIN" | "STRESSED";

export interface AdaptiveDailyRiskPolicyInput {
  accountEquity: number;
  baseRiskPct: number;
  minRiskPct: number;
  maxRiskPct: number;
  absoluteEmergencyCeiling: number;
  regime: RiskRegime;
  quantumUncertainty: number;
  recentLossStreak: number;
  estimatedDayCosts: number;
}

export interface AdaptiveDailyRiskPolicyResult {
  version: "ADAPTIVE_DAILY_RISK_POLICY_V2";
  valid: boolean;
  dynamicDailyLoss: number;
  warningLoss: number;
  absoluteEmergencyCeiling: number;
  effectiveRiskPct: number;
  regimeMultiplier: number;
  uncertaintyMultiplier: number;
  lossStreakMultiplier: number;
  reasonCodes: string[];
}

const finitePositive = (v: number) => Number.isFinite(v) && v > 0;
const finiteNonNegative = (v: number) => Number.isFinite(v) && v >= 0;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const REGIME_MULTIPLIER: Record<RiskRegime, number> = {
  STRONG: 1.0,
  NORMAL: 0.85,
  UNCERTAIN: 0.65,
  STRESSED: 0.4,
};

export function buildAdaptiveDailyRiskPolicy(input: AdaptiveDailyRiskPolicyInput): AdaptiveDailyRiskPolicyResult {
  const reasons: string[] = [];
  if (!finitePositive(input?.accountEquity)) reasons.push("INVALID_ACCOUNT_EQUITY");
  if (!finitePositive(input?.baseRiskPct) || !finitePositive(input?.minRiskPct) || !finitePositive(input?.maxRiskPct)) reasons.push("INVALID_RISK_PERCENTAGES");
  if (input?.minRiskPct > input?.baseRiskPct || input?.baseRiskPct > input?.maxRiskPct) reasons.push("RISK_PERCENTAGE_ORDER_INVALID");
  if (!finitePositive(input?.absoluteEmergencyCeiling)) reasons.push("INVALID_EMERGENCY_CEILING");
  if (!REGIME_MULTIPLIER[input?.regime]) reasons.push("INVALID_REGIME");
  if (!Number.isFinite(input?.quantumUncertainty) || input.quantumUncertainty < 0 || input.quantumUncertainty > 1) reasons.push("INVALID_QUANTUM_UNCERTAINTY");
  if (!Number.isInteger(input?.recentLossStreak) || input.recentLossStreak < 0) reasons.push("INVALID_LOSS_STREAK");
  if (!finiteNonNegative(input?.estimatedDayCosts)) reasons.push("INVALID_DAY_COSTS");

  if (reasons.length) {
    return {
      version: "ADAPTIVE_DAILY_RISK_POLICY_V2",
      valid: false,
      dynamicDailyLoss: 0,
      warningLoss: 0,
      absoluteEmergencyCeiling: finitePositive(input?.absoluteEmergencyCeiling) ? input.absoluteEmergencyCeiling : 0,
      effectiveRiskPct: 0,
      regimeMultiplier: 0,
      uncertaintyMultiplier: 0,
      lossStreakMultiplier: 0,
      reasonCodes: reasons,
    };
  }

  const regimeMultiplier = REGIME_MULTIPLIER[input.regime];
  const uncertaintyMultiplier = clamp(1 - 0.6 * input.quantumUncertainty, 0.4, 1);
  const lossStreakMultiplier = clamp(1 - 0.15 * input.recentLossStreak, 0.4, 1);

  const rawPct = input.baseRiskPct * regimeMultiplier * uncertaintyMultiplier * lossStreakMultiplier;
  const effectiveRiskPct = clamp(rawPct, input.minRiskPct, input.maxRiskPct);
  const equityRiskAllowance = input.accountEquity * (effectiveRiskPct / 100);
  const afterCostAllowance = Math.max(0, equityRiskAllowance - input.estimatedDayCosts);
  const dynamicDailyLoss = tightenOnlyLimit(input.absoluteEmergencyCeiling, afterCostAllowance);

  // Warning zone remains adaptive as a proportion of today's dynamically allowed loss.
  const warningLoss = dynamicDailyLoss * 0.88;

  return {
    version: "ADAPTIVE_DAILY_RISK_POLICY_V2",
    valid: true,
    dynamicDailyLoss,
    warningLoss,
    absoluteEmergencyCeiling: input.absoluteEmergencyCeiling,
    effectiveRiskPct,
    regimeMultiplier,
    uncertaintyMultiplier,
    lossStreakMultiplier,
    reasonCodes: ["ADAPTIVE_DAILY_RISK_READY", "QUANTUM_CAN_TIGHTEN_NOT_EXPAND", "ABSOLUTE_CEILING_ENFORCED"],
  };
}
