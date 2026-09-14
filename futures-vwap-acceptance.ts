export type DirectionalOptionSide = "CE" | "PE";

export interface FuturesVwapObservation {
  spot: number | null | undefined;
  futuresLtp: number | null | undefined;
}

export interface FuturesVwapAcceptanceInput {
  side: DirectionalOptionSide | null;
  spot: number | null | undefined;
  dailyPivot: number | null | undefined;
  futuresLtp: number | null | undefined;
  futuresVwap: number | null | undefined;
  futuresVwapSource: string | null | undefined;
  nearFutureSymbol: string | null | undefined;
  recentObservations: FuturesVwapObservation[];
  requiredSamples?: number;
}

export type FuturesVwapSourceStatus = "TRUSTED_NEAR_FUTURES_VWAP" | "MISSING" | "SOURCE_MISMATCH";

export interface FuturesVwapAcceptanceResult {
  sourceStatus: FuturesVwapSourceStatus;
  futuresVwapReady: boolean;
  spotPivotReady: boolean;
  futuresAcceptanceSamples: number;
  spotPivotAcceptanceSamples: number;
  requiredSamples: number;
  futuresVwapAccepted: boolean;
  spotPivotAccepted: boolean;
  priceStructureAccepted: boolean;
}

function positiveFinite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function directionalHold(side: DirectionalOptionSide, value: number, reference: number): boolean {
  return side === "CE" ? value > reference : value < reference;
}

/** Never compare spot with futures VWAP: futures basis can fake acceptance. */
export function evaluateFuturesVwapAcceptance(input: FuturesVwapAcceptanceInput): FuturesVwapAcceptanceResult {
  const requiredSamples = Number.isInteger(input.requiredSamples) && (input.requiredSamples || 0) > 0
    ? input.requiredSamples as number
    : 2;
  const expectedSource = input.nearFutureSymbol ? `${input.nearFutureSymbol} traded VWAP` : null;
  const sourceStatus: FuturesVwapSourceStatus = !input.futuresVwapSource || !expectedSource
    ? "MISSING"
    : input.futuresVwapSource === expectedSource ? "TRUSTED_NEAR_FUTURES_VWAP" : "SOURCE_MISMATCH";
  const observations = input.recentObservations.slice(-requiredSamples);
  const futuresVwapReady = input.side != null
    && sourceStatus === "TRUSTED_NEAR_FUTURES_VWAP"
    && positiveFinite(input.futuresLtp)
    && positiveFinite(input.futuresVwap)
    && observations.length === requiredSamples
    && observations.every((row) => positiveFinite(row.futuresLtp));
  const spotPivotReady = input.side != null
    && positiveFinite(input.spot)
    && positiveFinite(input.dailyPivot)
    && observations.length === requiredSamples
    && observations.every((row) => positiveFinite(row.spot));
  const futuresAcceptanceSamples = futuresVwapReady
    ? observations.filter((row) => directionalHold(input.side!, row.futuresLtp!, input.futuresVwap!)).length : 0;
  const spotPivotAcceptanceSamples = spotPivotReady
    ? observations.filter((row) => directionalHold(input.side!, row.spot!, input.dailyPivot!)).length : 0;
  const futuresVwapAccepted = futuresVwapReady
    && futuresAcceptanceSamples === requiredSamples
    && directionalHold(input.side!, input.futuresLtp!, input.futuresVwap!);
  const spotPivotAccepted = spotPivotReady
    && spotPivotAcceptanceSamples === requiredSamples
    && directionalHold(input.side!, input.spot!, input.dailyPivot!);
  return {
    sourceStatus, futuresVwapReady, spotPivotReady, futuresAcceptanceSamples, spotPivotAcceptanceSamples,
    requiredSamples, futuresVwapAccepted, spotPivotAccepted,
    priceStructureAccepted: futuresVwapAccepted && spotPivotAccepted,
  };
}
