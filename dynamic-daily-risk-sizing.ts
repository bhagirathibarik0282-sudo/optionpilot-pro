export type RiskSizingDecision = "TWO_LOTS" | "ONE_LOT" | "NO_TRADE";

export interface DynamicDailyRiskPolicy {
  warningLoss: number;
  hardDailyLoss: number;
}

export interface DynamicDailyRiskInput {
  realisedLossToday: number;
  openRisk: number;
  estimatedExistingCosts: number;
  entryPremium: number;
  stopPremium: number;
  lotSize: number;
  estimatedRoundTripCostPerLot: number;
  policy: DynamicDailyRiskPolicy;
}

export interface DynamicDailyRiskResult {
  version: "DYNAMIC_DAILY_RISK_SIZING_V1";
  decision: RiskSizingDecision;
  selectedLots: 0 | 1 | 2;
  remainingDayRisk: number | null;
  oneLotProjectedRisk: number | null;
  twoLotProjectedRisk: number | null;
  warningZone: boolean;
  hardStopTriggered: boolean;
  reasonCodes: string[];
  failClosed: true;
}

function finiteNonNegative(v: number): boolean {
  return Number.isFinite(v) && v >= 0;
}

function finitePositive(v: number): boolean {
  return Number.isFinite(v) && v > 0;
}

export function evaluateDynamicDailyRiskSizing(input: DynamicDailyRiskInput): DynamicDailyRiskResult {
  const reasons: string[] = [];
  const p = input?.policy;

  if (!p || !finitePositive(p.warningLoss) || !finitePositive(p.hardDailyLoss) || p.warningLoss >= p.hardDailyLoss) reasons.push("INVALID_RISK_POLICY");
  if (!finiteNonNegative(input?.realisedLossToday) || !finiteNonNegative(input?.openRisk) || !finiteNonNegative(input?.estimatedExistingCosts)) reasons.push("INVALID_DAY_RISK_STATE");
  if (!finitePositive(input?.entryPremium) || !finitePositive(input?.stopPremium) || input.stopPremium >= input.entryPremium) reasons.push("INVALID_ENTRY_STOP");
  if (!Number.isInteger(input?.lotSize) || input.lotSize <= 0) reasons.push("INVALID_LOT_SIZE");
  if (!finiteNonNegative(input?.estimatedRoundTripCostPerLot)) reasons.push("INVALID_COST_ESTIMATE");

  if (reasons.length > 0) {
    return {
      version: "DYNAMIC_DAILY_RISK_SIZING_V1",
      decision: "NO_TRADE",
      selectedLots: 0,
      remainingDayRisk: null,
      oneLotProjectedRisk: null,
      twoLotProjectedRisk: null,
      warningZone: false,
      hardStopTriggered: false,
      reasonCodes: reasons,
      failClosed: true,
    };
  }

  const usedDayRisk = input.realisedLossToday + input.openRisk + input.estimatedExistingCosts;
  const remainingDayRisk = Math.max(0, p.hardDailyLoss - usedDayRisk);
  const warningZone = usedDayRisk >= p.warningLoss;
  const hardStopTriggered = usedDayRisk >= p.hardDailyLoss;
  const structureRiskPerUnit = input.entryPremium - input.stopPremium;
  const oneLotProjectedRisk = structureRiskPerUnit * input.lotSize + input.estimatedRoundTripCostPerLot;
  const twoLotProjectedRisk = structureRiskPerUnit * input.lotSize * 2 + input.estimatedRoundTripCostPerLot * 2;

  if (hardStopTriggered) {
    return {
      version: "DYNAMIC_DAILY_RISK_SIZING_V1",
      decision: "NO_TRADE",
      selectedLots: 0,
      remainingDayRisk,
      oneLotProjectedRisk,
      twoLotProjectedRisk,
      warningZone: true,
      hardStopTriggered: true,
      reasonCodes: ["DAILY_HARD_STOP_TRIGGERED"],
      failClosed: true,
    };
  }

  if (!warningZone && twoLotProjectedRisk <= remainingDayRisk) {
    return {
      version: "DYNAMIC_DAILY_RISK_SIZING_V1",
      decision: "TWO_LOTS",
      selectedLots: 2,
      remainingDayRisk,
      oneLotProjectedRisk,
      twoLotProjectedRisk,
      warningZone,
      hardStopTriggered: false,
      reasonCodes: ["TWO_LOTS_FIT_REMAINING_DAY_RISK"],
      failClosed: true,
    };
  }

  if (oneLotProjectedRisk <= remainingDayRisk) {
    return {
      version: "DYNAMIC_DAILY_RISK_SIZING_V1",
      decision: "ONE_LOT",
      selectedLots: 1,
      remainingDayRisk,
      oneLotProjectedRisk,
      twoLotProjectedRisk,
      warningZone,
      hardStopTriggered: false,
      reasonCodes: warningZone ? ["WARNING_ZONE_REDUCE_TO_ONE_LOT"] : ["TWO_LOTS_DO_NOT_FIT_REDUCE_TO_ONE_LOT"],
      failClosed: true,
    };
  }

  return {
    version: "DYNAMIC_DAILY_RISK_SIZING_V1",
    decision: "NO_TRADE",
    selectedLots: 0,
    remainingDayRisk,
    oneLotProjectedRisk,
    twoLotProjectedRisk,
    warningZone,
    hardStopTriggered: false,
    reasonCodes: ["ONE_LOT_EXCEEDS_REMAINING_DAY_RISK"],
    failClosed: true,
  };
}
