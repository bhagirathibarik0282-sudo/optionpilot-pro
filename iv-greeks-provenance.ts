export type ModelValueSource = "INTERNAL_MODEL" | "BROKER_FIELD" | "EXCHANGE_REFERENCE" | "UNKNOWN";
export type ModelTruthState = "VALID" | "PARTIAL" | "INVALID" | "UNKNOWN";
export type ModelEvidenceUsability = "USABLE" | "CONTEXT_ONLY" | "BLOCKED";

export type ModelTruthReason =
  | "IV_VALUE_MISSING"
  | "GREEK_VALUE_MISSING"
  | "IV_PROVENANCE_UNKNOWN"
  | "GREEKS_PROVENANCE_UNKNOWN"
  | "MODEL_NAME_MISSING"
  | "MODEL_VERSION_MISSING"
  | "SOLVER_NAME_MISSING"
  | "SOLVER_VERSION_MISSING"
  | "SPOT_INPUT_MISSING"
  | "OPTION_PRICE_INPUT_MISSING"
  | "STRIKE_INPUT_MISSING"
  | "EXPIRY_INPUT_MISSING"
  | "VALUATION_TIME_MISSING"
  | "RISK_FREE_RATE_MISSING"
  | "DIVIDEND_YIELD_MISSING"
  | "DAY_COUNT_MISSING"
  | "IV_INPUT_MISSING_FOR_GREEKS"
  | "BROKER_FIELD_NAME_MISSING"
  | "BROKER_FIELD_VERSION_MISSING"
  | "NON_FINITE_MODEL_INPUT"
  | "GAMMA_PROVENANCE_UNVERIFIED"
  | "IV_SOLVER_ILL_CONDITIONED"
  | "IV_SOLVER_CONDITIONING_UNKNOWN";

export interface OptionModelTruthInput {
  iv?: number | null;
  delta?: number | null;
  gamma?: number | null;
  vega?: number | null;
  theta?: number | null;

  ivSource?: ModelValueSource | null;
  greeksSource?: ModelValueSource | null;

  modelName?: string | null;
  modelVersion?: string | null;
  solverName?: string | null;
  solverVersion?: string | null;
  brokerFieldName?: string | null;
  brokerFieldVersion?: string | null;

  spot?: number | null;
  optionPrice?: number | null;
  strike?: number | null;
  expiry?: string | null;
  valuationTimestamp?: string | null;
  riskFreeRate?: number | null;
  dividendYield?: number | null;
  dayCountConvention?: string | null;
}

export interface OptionModelTruthAudit {
  ivState: ModelTruthState;
  greeksState: ModelTruthState;
  usability: ModelEvidenceUsability;
  reasons: ModelTruthReason[];
  ivPermission: boolean;
  greekPermission: boolean;
  provenanceVersion: "OPTION_MODEL_TRUTH_V1";
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const text = (value: unknown): boolean => typeof value === "string" && value.trim().length > 0;
const validTime = (value: unknown): boolean => text(value) && Number.isFinite(new Date(String(value)).getTime());

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function auditInternalIv(input: OptionModelTruthInput, reasons: ModelTruthReason[]): ModelTruthState {
  if (!finite(input.iv)) reasons.push("IV_VALUE_MISSING");
  if (!text(input.modelName)) reasons.push("MODEL_NAME_MISSING");
  if (!text(input.modelVersion)) reasons.push("MODEL_VERSION_MISSING");
  if (!text(input.solverName)) reasons.push("SOLVER_NAME_MISSING");
  if (!text(input.solverVersion)) reasons.push("SOLVER_VERSION_MISSING");
  if (!finite(input.spot)) reasons.push("SPOT_INPUT_MISSING");
  if (!finite(input.optionPrice)) reasons.push("OPTION_PRICE_INPUT_MISSING");
  if (!finite(input.strike)) reasons.push("STRIKE_INPUT_MISSING");
  if (!text(input.expiry)) reasons.push("EXPIRY_INPUT_MISSING");
  if (!validTime(input.valuationTimestamp)) reasons.push("VALUATION_TIME_MISSING");
  if (!finite(input.riskFreeRate)) reasons.push("RISK_FREE_RATE_MISSING");
  if (!finite(input.dividendYield)) reasons.push("DIVIDEND_YIELD_MISSING");
  if (!text(input.dayCountConvention)) reasons.push("DAY_COUNT_MISSING");
  return reasons.length ? "PARTIAL" : "VALID";
}

function auditBrokerIv(input: OptionModelTruthInput, reasons: ModelTruthReason[]): ModelTruthState {
  if (!finite(input.iv)) reasons.push("IV_VALUE_MISSING");
  if (!text(input.brokerFieldName)) reasons.push("BROKER_FIELD_NAME_MISSING");
  if (!text(input.brokerFieldVersion)) reasons.push("BROKER_FIELD_VERSION_MISSING");
  return reasons.length ? "PARTIAL" : "VALID";
}

function auditInternalGreeks(input: OptionModelTruthInput, reasons: ModelTruthReason[]): ModelTruthState {
  for (const value of [input.delta, input.gamma, input.vega, input.theta]) {
    if (!finite(value)) reasons.push("GREEK_VALUE_MISSING");
  }
  if (!text(input.modelName)) reasons.push("MODEL_NAME_MISSING");
  if (!text(input.modelVersion)) reasons.push("MODEL_VERSION_MISSING");
  if (!finite(input.spot)) reasons.push("SPOT_INPUT_MISSING");
  if (!finite(input.strike)) reasons.push("STRIKE_INPUT_MISSING");
  if (!text(input.expiry)) reasons.push("EXPIRY_INPUT_MISSING");
  if (!validTime(input.valuationTimestamp)) reasons.push("VALUATION_TIME_MISSING");
  if (!finite(input.riskFreeRate)) reasons.push("RISK_FREE_RATE_MISSING");
  if (!finite(input.dividendYield)) reasons.push("DIVIDEND_YIELD_MISSING");
  if (!finite(input.iv)) reasons.push("IV_INPUT_MISSING_FOR_GREEKS");
  if (!text(input.dayCountConvention)) reasons.push("DAY_COUNT_MISSING");
  return reasons.length ? "PARTIAL" : "VALID";
}

function auditBrokerGreeks(input: OptionModelTruthInput, reasons: ModelTruthReason[]): ModelTruthState {
  for (const value of [input.delta, input.gamma, input.vega, input.theta]) {
    if (!finite(value)) reasons.push("GREEK_VALUE_MISSING");
  }
  if (!text(input.brokerFieldName)) reasons.push("BROKER_FIELD_NAME_MISSING");
  if (!text(input.brokerFieldVersion)) reasons.push("BROKER_FIELD_VERSION_MISSING");
  return reasons.length ? "PARTIAL" : "VALID";
}

/**
 * Fail-closed audit for IV/Greeks provenance.
 *
 * A numeric IV or Greek is not evidence by itself. INTERNAL_MODEL values are
 * usable only when their model, version and required pricing inputs are known.
 * Explicit broker fields can be recognised as provenance-valid, but remain
 * CONTEXT_ONLY because broker model assumptions are not independently known.
 */
export function auditOptionModelTruth(input: OptionModelTruthInput): OptionModelTruthAudit {
  const ivReasons: ModelTruthReason[] = [];
  const greekReasons: ModelTruthReason[] = [];

  let ivState: ModelTruthState = "UNKNOWN";
  if (input.ivSource === "INTERNAL_MODEL") ivState = auditInternalIv(input, ivReasons);
  else if (input.ivSource === "BROKER_FIELD" || input.ivSource === "EXCHANGE_REFERENCE") ivState = auditBrokerIv(input, ivReasons);
  else {
    if (finite(input.iv)) ivReasons.push("IV_PROVENANCE_UNKNOWN");
    else ivReasons.push("IV_VALUE_MISSING");
  }

  let greeksState: ModelTruthState = "UNKNOWN";
  if (input.greeksSource === "INTERNAL_MODEL") greeksState = auditInternalGreeks(input, greekReasons);
  else if (input.greeksSource === "BROKER_FIELD" || input.greeksSource === "EXCHANGE_REFERENCE") greeksState = auditBrokerGreeks(input, greekReasons);
  else {
    const anyGreek = [input.delta, input.gamma, input.vega, input.theta].some(finite);
    greekReasons.push(anyGreek ? "GREEKS_PROVENANCE_UNKNOWN" : "GREEK_VALUE_MISSING");
  }

  const ivInternalUsable = ivState === "VALID" && input.ivSource === "INTERNAL_MODEL";
  const greekInternalUsable = greeksState === "VALID" && input.greeksSource === "INTERNAL_MODEL" && ivInternalUsable;
  const brokerContext =
    (ivState === "VALID" && (input.ivSource === "BROKER_FIELD" || input.ivSource === "EXCHANGE_REFERENCE")) ||
    (greeksState === "VALID" && (input.greeksSource === "BROKER_FIELD" || input.greeksSource === "EXCHANGE_REFERENCE"));

  const usability: ModelEvidenceUsability = greekInternalUsable
    ? "USABLE"
    : brokerContext
      ? "CONTEXT_ONLY"
      : "BLOCKED";

  return {
    ivState,
    greeksState,
    usability,
    reasons: unique([...ivReasons, ...greekReasons]),
    ivPermission: ivInternalUsable,
    greekPermission: greekInternalUsable,
    provenanceVersion: "OPTION_MODEL_TRUTH_V1",
  };
}

export function greekDependentEvidenceAllowed(input: OptionModelTruthInput): boolean {
  return auditOptionModelTruth(input).greekPermission;
}
