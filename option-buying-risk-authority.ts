// Pure, fail-closed adapter between the adaptive daily-risk policy and option-buying alerts.
// No broker/network side effects. This module never expands risk beyond the caller-supplied
// dynamic daily loss allowance and never invents missing risk state.

export interface OptionBuyingRiskAuthorityInput {
  dynamicDailyLoss: number;
  realisedLossToday: number;
  openRisk: number;
  estimatedExistingCosts: number;
}

export interface OptionBuyingRiskAuthorityResult {
  version: "OPTION_BUYING_RISK_AUTHORITY_V1";
  valid: boolean;
  maxLossForNewTrade: number;
  remainingDayRisk: number;
  reasonCodes: string[];
  failClosed: true;
}

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function resolveOptionBuyingRiskAuthority(
  input: OptionBuyingRiskAuthorityInput,
): OptionBuyingRiskAuthorityResult {
  const reasons: string[] = [];

  if (!finitePositive(input?.dynamicDailyLoss)) reasons.push("INVALID_DYNAMIC_DAILY_LOSS");
  if (!finiteNonNegative(input?.realisedLossToday)) reasons.push("INVALID_REALISED_LOSS_TODAY");
  if (!finiteNonNegative(input?.openRisk)) reasons.push("INVALID_OPEN_RISK");
  if (!finiteNonNegative(input?.estimatedExistingCosts)) reasons.push("INVALID_EXISTING_COSTS");

  if (reasons.length > 0) {
    return {
      version: "OPTION_BUYING_RISK_AUTHORITY_V1",
      valid: false,
      maxLossForNewTrade: 0,
      remainingDayRisk: 0,
      reasonCodes: reasons,
      failClosed: true,
    };
  }

  const usedDayRisk = input.realisedLossToday + input.openRisk + input.estimatedExistingCosts;
  const remainingDayRisk = Math.max(0, input.dynamicDailyLoss - usedDayRisk);

  if (remainingDayRisk <= 0) {
    return {
      version: "OPTION_BUYING_RISK_AUTHORITY_V1",
      valid: true,
      maxLossForNewTrade: 0,
      remainingDayRisk: 0,
      reasonCodes: ["NO_REMAINING_DAY_RISK"],
      failClosed: true,
    };
  }

  return {
    version: "OPTION_BUYING_RISK_AUTHORITY_V1",
    valid: true,
    maxLossForNewTrade: remainingDayRisk,
    remainingDayRisk,
    reasonCodes: ["DYNAMIC_REMAINING_DAY_RISK_AUTHORITY"],
    failClosed: true,
  };
}
