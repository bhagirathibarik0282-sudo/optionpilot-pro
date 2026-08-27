import { liveCalcGreeks } from "./live-option-model-spec.js";

export type IvSolverConditioningState = "WELL_CONDITIONED" | "ILL_CONDITIONED_LOW_VEGA" | "INVALID_INPUT";

/** Research-only parity threshold. Not a production trading threshold. */
export const PARITY_TEST_MIN_VEGA_PER_VOL_POINT = 0.01;

export function classifyIvSolverConditioning(input: {
  spot: number;
  strike: number;
  volatilityPct: number;
  daysToExpiry: number;
  isCall: boolean;
  minVegaPerVolPoint?: number;
}): { state: IvSolverConditioningState; vegaPerVolPoint: number; threshold: number } {
  const threshold = input.minVegaPerVolPoint ?? PARITY_TEST_MIN_VEGA_PER_VOL_POINT;
  if (![input.spot,input.strike,input.volatilityPct,input.daysToExpiry,threshold].every(Number.isFinite)
    || input.spot <= 0 || input.strike <= 0 || input.volatilityPct <= 0 || input.daysToExpiry <= 0 || threshold < 0) {
    return { state: "INVALID_INPUT", vegaPerVolPoint: 0, threshold };
  }
  const vegaPerVolPoint = liveCalcGreeks(input.spot,input.strike,input.volatilityPct,input.daysToExpiry,input.isCall).vega;
  return {
    state: vegaPerVolPoint >= threshold ? "WELL_CONDITIONED" : "ILL_CONDITIONED_LOW_VEGA",
    vegaPerVolPoint,
    threshold,
  };
}
