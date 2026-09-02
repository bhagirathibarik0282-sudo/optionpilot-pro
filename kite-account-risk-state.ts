export interface KitePositionLike {
  realised?: number | null;
  realized?: number | null;
  unrealised?: number | null;
  unrealized?: number | null;
}

export interface KiteAccountRiskStateInput {
  positions: KitePositionLike[] | null | undefined;
  activeTradeOpenRisk: number | null | undefined;
  dynamicDailyLoss: number | null | undefined;
  estimatedExistingCosts: number | null | undefined;
}

export interface KiteAccountRiskStateResult {
  version: "KITE_ACCOUNT_RISK_STATE_V1";
  valid: boolean;
  dynamicDailyLoss: number;
  realisedLossToday: number;
  openRisk: number;
  estimatedExistingCosts: number;
  reasonCodes: string[];
  failClosed: true;
}

const finiteNonNegative = (v: number) => Number.isFinite(v) && v >= 0;
const finitePositive = (v: number) => Number.isFinite(v) && v > 0;

export function buildKiteAccountRiskState(input: KiteAccountRiskStateInput): KiteAccountRiskStateResult {
  const reasons: string[] = [];
  if (!Array.isArray(input?.positions)) reasons.push("POSITIONS_UNAVAILABLE");
  if (!finiteNonNegative(Number(input?.activeTradeOpenRisk))) reasons.push("OPEN_RISK_UNAVAILABLE");
  if (!finitePositive(Number(input?.dynamicDailyLoss))) reasons.push("DYNAMIC_DAILY_LOSS_UNAVAILABLE");
  if (!finiteNonNegative(Number(input?.estimatedExistingCosts))) reasons.push("COST_STATE_UNAVAILABLE");

  let realisedLossToday = 0;
  if (Array.isArray(input?.positions)) {
    for (const p of input.positions) {
      const raw = p?.realised ?? p?.realized;
      if (raw == null) {
        reasons.push("POSITION_REALISED_PNL_UNAVAILABLE");
        continue;
      }
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        reasons.push("POSITION_REALISED_PNL_INVALID");
        continue;
      }
      if (value < 0) realisedLossToday += Math.abs(value);
    }
  }

  if (reasons.length > 0) {
    return {
      version: "KITE_ACCOUNT_RISK_STATE_V1",
      valid: false,
      dynamicDailyLoss: 0,
      realisedLossToday: 0,
      openRisk: 0,
      estimatedExistingCosts: 0,
      reasonCodes: Array.from(new Set(reasons)),
      failClosed: true,
    };
  }

  return {
    version: "KITE_ACCOUNT_RISK_STATE_V1",
    valid: true,
    dynamicDailyLoss: Number(input.dynamicDailyLoss),
    realisedLossToday,
    openRisk: Number(input.activeTradeOpenRisk),
    estimatedExistingCosts: Number(input.estimatedExistingCosts),
    reasonCodes: ["KITE_ACCOUNT_RISK_STATE_READY"],
    failClosed: true,
  };
}
