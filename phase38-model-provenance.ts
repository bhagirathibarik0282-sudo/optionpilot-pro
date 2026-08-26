import type { MarketSnapshot1mRow, OptionSnapshot1mRow } from "./db.js";
import { auditOptionModelTruth, type OptionModelTruthAudit, type ModelTruthReason } from "./iv-greeks-provenance.js";
import { classifyIvSolverConditioning, type IvSolverConditioningState } from "./iv-solver-conditioning.js";
import { LIVE_OPTION_MODEL_SPEC, LIVE_OPTION_MODEL_SPEC_VERSION } from "./live-option-model-spec.js";
import {
  LIVE_ADVANCED_GREEKS_SPEC,
  LIVE_ADVANCED_GREEKS_SPEC_VERSION,
  classifyExpiryDayGreekSemantics,
} from "./live-advanced-greeks-spec.js";

export interface Phase38ModelTruthRecord {
  symbol: string;
  minuteBucket: string;
  expiry: string;
  strike: number;
  optionType: "CE" | "PE";
  audit: OptionModelTruthAudit;
  conditioningState: IvSolverConditioningState | "UNKNOWN";
  payload: Record<string, unknown>;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
function unique<T>(values: T[]): T[] { return [...new Set(values)]; }

/**
 * Shadow-only known-then model provenance builder.
 * Phase 39 extends the Phase-38 record with source-audited Gamma provenance.
 * Positive-DTE Gamma was extracted from the current server and parity-tested
 * against an independent canonical Black-Scholes reference. Expiry day stays
 * blocked because calcAdvancedGreeks uses a T floor while the basic IV/Greeks
 * path rejects zero DTE.
 */
export function buildPhase38ModelTruth(
  option: OptionSnapshot1mRow,
  market: MarketSnapshot1mRow,
): Phase38ModelTruthRecord {
  const spot = finite(market.spotLtp) ? market.spotLtp : null;
  const optionPrice = finite(option.ltp) ? option.ltp : null;
  const dte = finite(option.dte) ? option.dte : null;
  const valuationTimestamp = option.quoteTimestamp ?? market.backendTimestamp ?? option.minuteBucket;
  const expirySemantics = dte === null ? "INVALID_DTE" : classifyExpiryDayGreekSemantics(dte);

  const completeCore = spot !== null && optionPrice !== null && dte !== null && dte > 0 &&
    finite(option.iv) && finite(option.delta) && finite(option.vega) && finite(option.theta);
  const gammaPresent = finite(option.gamma);

  const baseAudit = auditOptionModelTruth({
    iv: option.iv,
    delta: option.delta,
    gamma: option.gamma,
    vega: option.vega,
    theta: option.theta,
    ivSource: completeCore ? "INTERNAL_MODEL" : "UNKNOWN",
    greeksSource: completeCore ? "INTERNAL_MODEL" : "UNKNOWN",
    modelName: completeCore ? LIVE_OPTION_MODEL_SPEC.modelName : null,
    modelVersion: completeCore ? LIVE_OPTION_MODEL_SPEC_VERSION : null,
    solverName: completeCore ? LIVE_OPTION_MODEL_SPEC.ivSolver : null,
    solverVersion: completeCore ? `${LIVE_OPTION_MODEL_SPEC.ivSolver}_${LIVE_OPTION_MODEL_SPEC.ivSolverIterations}` : null,
    spot,
    optionPrice,
    strike: option.strike,
    expiry: option.expiry,
    valuationTimestamp,
    riskFreeRate: completeCore ? LIVE_OPTION_MODEL_SPEC.riskFreeRate : null,
    dividendYield: completeCore ? LIVE_OPTION_MODEL_SPEC.dividendYield : null,
    dayCountConvention: completeCore ? LIVE_OPTION_MODEL_SPEC.dayCountConvention : null,
  });

  const conditioning = completeCore
    ? classifyIvSolverConditioning({
        spot: spot!,
        strike: option.strike,
        volatilityPct: option.iv!,
        daysToExpiry: dte!,
        isCall: option.optionType === "CE",
      })
    : { state: "INVALID_INPUT" as const, vegaPerVolPoint: 0, threshold: null };

  const additionalReasons: ModelTruthReason[] = [];
  if (completeCore && !gammaPresent) additionalReasons.push("GAMMA_PROVENANCE_UNVERIFIED");
  if (expirySemantics === "ZERO_DTE_SEMANTIC_CONFLICT") additionalReasons.push("ZERO_DTE_GREEK_SEMANTIC_CONFLICT");
  if (conditioning.state === "ILL_CONDITIONED_LOW_VEGA") additionalReasons.push("IV_SOLVER_ILL_CONDITIONED");
  if (conditioning.state === "INVALID_INPUT") additionalReasons.push("IV_SOLVER_CONDITIONING_UNKNOWN");

  const ivConditioned = baseAudit.ivPermission && conditioning.state === "WELL_CONDITIONED";
  const gammaSourceAudited = completeCore && gammaPresent && expirySemantics === "CONSISTENT_POSITIVE_DTE";
  const greekConditioned = ivConditioned && baseAudit.greekPermission && gammaSourceAudited;

  const audit: OptionModelTruthAudit = {
    ...baseAudit,
    greeksState: greekConditioned ? "VALID" : baseAudit.greeksState === "VALID" ? "PARTIAL" : baseAudit.greeksState,
    usability: greekConditioned ? "USABLE" : ivConditioned ? "CONTEXT_ONLY" : "BLOCKED",
    ivPermission: ivConditioned,
    greekPermission: greekConditioned,
    reasons: unique([...baseAudit.reasons, ...additionalReasons]),
  };

  return {
    symbol: option.symbol,
    minuteBucket: option.minuteBucket,
    expiry: option.expiry,
    strike: option.strike,
    optionType: option.optionType,
    audit,
    conditioningState: completeCore ? conditioning.state : "UNKNOWN",
    payload: {
      source: "PHASE39_AUDITED_LIVE_MODEL_INPUTS",
      modelName: LIVE_OPTION_MODEL_SPEC.modelName,
      modelVersion: LIVE_OPTION_MODEL_SPEC_VERSION,
      solverName: LIVE_OPTION_MODEL_SPEC.ivSolver,
      solverVersion: `${LIVE_OPTION_MODEL_SPEC.ivSolver}_${LIVE_OPTION_MODEL_SPEC.ivSolverIterations}`,
      solverLowerVol: LIVE_OPTION_MODEL_SPEC.ivLowerVol,
      solverUpperVol: LIVE_OPTION_MODEL_SPEC.ivUpperVol,
      riskFreeRate: LIVE_OPTION_MODEL_SPEC.riskFreeRate,
      dividendYield: LIVE_OPTION_MODEL_SPEC.dividendYield,
      dayCountConvention: LIVE_OPTION_MODEL_SPEC.dayCountConvention,
      valuationTimestamp,
      spot,
      optionPrice,
      strike: option.strike,
      expiry: option.expiry,
      dte,
      optionType: option.optionType,
      iv: option.iv ?? null,
      delta: option.delta ?? null,
      gamma: option.gamma ?? null,
      vega: option.vega ?? null,
      theta: option.theta ?? null,
      conditioningState: completeCore ? conditioning.state : "UNKNOWN",
      conditioningVegaPerVolPoint: completeCore ? conditioning.vegaPerVolPoint : null,
      conditioningThreshold: completeCore ? conditioning.threshold : null,
      conditioningThresholdStatus: "RESEARCH_TEST_ONLY_NOT_PRODUCTION_FROZEN",
      gammaProvenance: gammaSourceAudited ? "SERVER_CALC_ADVANCED_GREEKS_PHASE39_PARITY_VERIFIED" : "NOT_ELIGIBLE",
      gammaModelVersion: LIVE_ADVANCED_GREEKS_SPEC_VERSION,
      gammaFormula: LIVE_ADVANCED_GREEKS_SPEC.gammaFormula,
      gammaTimeConvention: LIVE_ADVANCED_GREEKS_SPEC.timeConvention,
      expiryDayGreekSemantics: expirySemantics,
      permissionScope: "SHADOW_RESEARCH_ONLY",
    },
  };
}
