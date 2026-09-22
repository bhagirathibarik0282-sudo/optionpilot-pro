import type { H1ExactPriceGreekObservation, H1ExactSnapshotBundle } from "./h1-live-exact-snapshot-aggregator.js";
import type { H1ExactUnderlyingObservation, H1KiteGreekModelPolicy } from "./h1-kite-exact-price-greek-adapter.js";
import type { H1ExactLiveSpotDirectionPolicy } from "./h1-exact-live-spot-direction-provider.js";

const YEAR_MS = 365 * 86_400_000;
const SQRT_2PI = Math.sqrt(2 * Math.PI);

export const H1_KITE_GREEK_MATH_CROSSCHECK_PERSIST_KIND = "H1_KITE_GREEK_MATH_CROSSCHECK_1M_V1" as const;

export interface H1KiteGreekMathCrosscheckPersistRecord {
  version: typeof H1_KITE_GREEK_MATH_CROSSCHECK_PERSIST_KIND;
  logicalKey: string;
  minuteBucket: string;
  instrumentToken: number;
  snapshot: H1ExactSnapshotBundle;
  underlying: H1ExactUnderlyingObservation;
  selectorDirectionAtCapture: "UP" | "DOWN" | null;
  expectedPremiumDirectionAtCapture: "UP" | "DOWN" | null;
  directionSourceId: "H1_EXACT_LIVE_SPOT_DIRECTION_PROVIDER_V1" | null;
  policyIdentity: H1KiteGreekEvidencePolicyIdentity;
  evidence: H1KiteGreekMathCrosscheckResult;
  productionImpact: "NONE";
  thresholdAuthority: "NONE";
  affectsSelector: false;
  affectsBusinessCard: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
  failClosed: true;
}

export interface H1KiteGreekEvidencePolicyIdentity {
  version: "H1_KITE_GREEK_EVIDENCE_POLICY_IDENTITY_V1";
  greekPolicy: H1KiteGreekModelPolicy;
  directionSourcePolicy: H1ExactLiveSpotDirectionPolicy | null;
  greekPolicySemantics: "SHADOW_CALIBRATION_ONLY";
  directionSourcePolicySemantics: "MARKET_OPEN_CONTEXT_ONLY" | null;
  prospectiveP75Bound: false;
  productionPolicyBound: false;
}

export interface H1KiteGreekEvidencePolicyContext {
  greekPolicy: H1KiteGreekModelPolicy;
  directionSourcePolicy: H1ExactLiveSpotDirectionPolicy | null;
}

export interface H1KiteGreekMathCrosscheckResult {
  version: "H1_KITE_GREEK_MATH_CROSSCHECK_V1";
  ready: boolean;
  symbol: H1ExactPriceGreekObservation["symbol"] | null;
  expiryDate: string | null;
  strike: number | null;
  side: H1ExactPriceGreekObservation["side"] | null;
  observedAt: string | null;
  underlyingObservedAt: string | null;
  underlyingSkewMs: number | null;
  absoluteDeltaError: number | null;
  absoluteGammaError: number | null;
  absoluteIvErrorPctPoints: number | null;
  numericalDelta: number | null;
  numericalGamma: number | null;
  independentIvPct: number | null;
  blockers: string[];
  source: "KITE_WEBSOCKET_FULL_PLUS_INTERNAL_MATH_CROSSCHECK";
  productionImpact: "NONE";
  thresholdAuthority: "NONE";
  affectsSelector: false;
  affectsBusinessCard: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
  failClosed: true;
}

function time(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function normalPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

function normalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * z);
  const erf = sign * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z));
  return 0.5 * (1 + erf);
}

function price(
  side: "CE" | "PE",
  spot: number,
  strike: number,
  years: number,
  rate: number,
  dividendYield: number,
  sigma: number,
): number {
  const rootT = Math.sqrt(years);
  const d1 = (Math.log(spot / strike) + (rate - dividendYield + 0.5 * sigma * sigma) * years) / (sigma * rootT);
  const d2 = d1 - sigma * rootT;
  const ds = spot * Math.exp(-dividendYield * years);
  const dk = strike * Math.exp(-rate * years);
  return side === "CE"
    ? ds * normalCdf(d1) - dk * normalCdf(d2)
    : dk * normalCdf(-d2) - ds * normalCdf(-d1);
}

function independentIvNewton(
  side: "CE" | "PE",
  premium: number,
  spot: number,
  strike: number,
  years: number,
  rate: number,
  dividendYield: number,
): number | null {
  let sigma = 0.2;
  for (let i = 0; i < 80; i += 1) {
    if (!Number.isFinite(sigma) || sigma <= 0 || sigma > 5) return null;
    const current = price(side, spot, strike, years, rate, dividendYield, sigma);
    const error = current - premium;
    if (Math.abs(error) <= 1e-8) return sigma;

    const h = Math.max(1e-6, sigma * 1e-4);
    const low = Math.max(1e-6, sigma - h);
    const high = sigma + h;
    const numericalVega = (price(side, spot, strike, years, rate, dividendYield, high) -
      price(side, spot, strike, years, rate, dividendYield, low)) / (high - low);
    if (!Number.isFinite(numericalVega) || Math.abs(numericalVega) < 1e-10) return null;

    const next = sigma - error / numericalVega;
    sigma = Math.min(5, Math.max(0.0001, next));
  }
  const finalError = Math.abs(price(side, spot, strike, years, rate, dividendYield, sigma) - premium);
  return finalError <= 1e-6 ? sigma : null;
}

function invalidResult(blockers: string[]): H1KiteGreekMathCrosscheckResult {
  return {
    version: "H1_KITE_GREEK_MATH_CROSSCHECK_V1",
    ready: false,
    symbol: null,
    expiryDate: null,
    strike: null,
    side: null,
    observedAt: null,
    underlyingObservedAt: null,
    underlyingSkewMs: null,
    absoluteDeltaError: null,
    absoluteGammaError: null,
    absoluteIvErrorPctPoints: null,
    numericalDelta: null,
    numericalGamma: null,
    independentIvPct: null,
    blockers: [...new Set(blockers)],
    source: "KITE_WEBSOCKET_FULL_PLUS_INTERNAL_MATH_CROSSCHECK",
    productionImpact: "NONE",
    thresholdAuthority: "NONE",
    affectsSelector: false,
    affectsBusinessCard: false,
    affectsTelegram: false,
    affectsExecution: false,
    createsOrders: false,
    failClosed: true,
  };
}

/**
 * Kite-only mathematical implementation cross-check.
 *
 * This does not claim broker-published Greeks: Kite Connect does not provide
 * them. It compares the existing analytical Greeks/IV against an independent
 * numerical finite-difference/Newton implementation using the same exact Kite
 * option premium and underlying observation.
 */
export function crosscheckH1KiteGreeks(
  observation: H1ExactPriceGreekObservation,
  underlying: H1ExactUnderlyingObservation,
  policy: H1KiteGreekModelPolicy,
): H1KiteGreekMathCrosscheckResult {
  const blockers: string[] = [];
  const observedMs = time(observation?.observedAt);
  const underlyingMs = time(underlying?.observedAt);

  if (observation?.source !== "LIVE_RUNTIME_EXACT") blockers.push("EXACT_KITE_GREEK_OBSERVATION_REQUIRED");
  if (underlying?.source !== "LIVE_RUNTIME_EXACT") blockers.push("EXACT_KITE_UNDERLYING_REQUIRED");
  if (observation?.symbol !== underlying?.symbol) blockers.push("SYMBOL_MISMATCH");
  if (!Number.isFinite(observation?.ltp) || observation.ltp <= 0) blockers.push("VALID_OPTION_PREMIUM_REQUIRED");
  if (!Number.isFinite(underlying?.price) || underlying.price <= 0) blockers.push("VALID_UNDERLYING_PRICE_REQUIRED");
  if (!Number.isFinite(observation?.strike) || observation.strike <= 0) blockers.push("VALID_STRIKE_REQUIRED");
  if (!Number.isFinite(observation?.iv) || observation.iv <= 0) blockers.push("VALID_PRIMARY_IV_REQUIRED");
  if (!Number.isFinite(observation?.delta) || !Number.isFinite(observation?.gamma) || observation.gamma < 0) blockers.push("VALID_PRIMARY_GREEKS_REQUIRED");
  if (observedMs == null || underlyingMs == null) blockers.push("VALID_TIMESTAMPS_REQUIRED");
  if (!Number.isFinite(policy?.annualRiskFreeRate) || !Number.isFinite(policy?.annualDividendYield)) blockers.push("VALID_MODEL_RATES_REQUIRED");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(observation?.expiryDate ?? "")) blockers.push("VALID_EXPIRY_REQUIRED");
  if (blockers.length) return invalidResult(blockers);

  const expiryMs = Date.parse(`${observation.expiryDate}T10:00:00.000Z`);
  if (!Number.isFinite(expiryMs) || expiryMs <= observedMs!) return invalidResult(["POSITIVE_TIME_TO_EXPIRY_REQUIRED"]);
  const years = (expiryMs - observedMs!) / YEAR_MS;
  const sigma = observation.iv / 100;

  const spot = underlying.price;
  const h = Math.max(0.01, Math.cbrt(Number.EPSILON) * Math.max(spot, 1));
  if (spot - h <= 0) return invalidResult(["NUMERICAL_SPOT_STEP_INVALID"]);

  const base = price(observation.side, spot, observation.strike, years, policy.annualRiskFreeRate, policy.annualDividendYield, sigma);
  const up = price(observation.side, spot + h, observation.strike, years, policy.annualRiskFreeRate, policy.annualDividendYield, sigma);
  const down = price(observation.side, spot - h, observation.strike, years, policy.annualRiskFreeRate, policy.annualDividendYield, sigma);
  const numericalDelta = (up - down) / (2 * h);
  const numericalGamma = (up - 2 * base + down) / (h * h);
  const independentIv = independentIvNewton(
    observation.side,
    observation.ltp,
    spot,
    observation.strike,
    years,
    policy.annualRiskFreeRate,
    policy.annualDividendYield,
  );

  if (![numericalDelta, numericalGamma].every(Number.isFinite)) return invalidResult(["NUMERICAL_GREEK_CROSSCHECK_FAILED"]);
  if (independentIv == null || !Number.isFinite(independentIv)) return invalidResult(["INDEPENDENT_IV_CROSSCHECK_FAILED"]);

  return {
    version: "H1_KITE_GREEK_MATH_CROSSCHECK_V1",
    ready: true,
    symbol: observation.symbol,
    expiryDate: observation.expiryDate,
    strike: observation.strike,
    side: observation.side,
    observedAt: observation.observedAt,
    underlyingObservedAt: underlying.observedAt,
    underlyingSkewMs: Math.abs(observedMs! - underlyingMs!),
    absoluteDeltaError: Math.abs(observation.delta - numericalDelta),
    absoluteGammaError: Math.abs(observation.gamma - numericalGamma),
    absoluteIvErrorPctPoints: Math.abs(observation.iv - independentIv * 100),
    numericalDelta,
    numericalGamma,
    independentIvPct: independentIv * 100,
    blockers: [],
    source: "KITE_WEBSOCKET_FULL_PLUS_INTERNAL_MATH_CROSSCHECK",
    productionImpact: "NONE",
    thresholdAuthority: "NONE",
    affectsSelector: false,
    affectsBusinessCard: false,
    affectsTelegram: false,
    affectsExecution: false,
    createsOrders: false,
    failClosed: true,
  };
}


export function buildH1KiteGreekMathCrosscheckPersistRecord(
  instrumentToken: number,
  snapshot: H1ExactSnapshotBundle,
  underlying: H1ExactUnderlyingObservation,
  evidence: H1KiteGreekMathCrosscheckResult,
  directionContext: {
    selectorDirectionAtCapture: "UP" | "DOWN";
    expectedPremiumDirectionAtCapture: "UP" | "DOWN";
    directionSourceId: "H1_EXACT_LIVE_SPOT_DIRECTION_PROVIDER_V1";
  } | null,
  policyContext: H1KiteGreekEvidencePolicyContext,
): H1KiteGreekMathCrosscheckPersistRecord | null {
  const greekPolicy = policyContext?.greekPolicy;
  const directionSourcePolicy = policyContext?.directionSourcePolicy ?? null;
  const validGreekPolicy = !!greekPolicy &&
    Number.isFinite(greekPolicy.annualRiskFreeRate) &&
    Number.isFinite(greekPolicy.annualDividendYield) &&
    Number.isFinite(greekPolicy.maxAgeMs) && greekPolicy.maxAgeMs > 0 &&
    Number.isFinite(greekPolicy.maxUnderlyingSkewMs) && greekPolicy.maxUnderlyingSkewMs > 0;
  const validDirectionPolicy = directionContext == null
    ? directionSourcePolicy == null
    : !!directionSourcePolicy &&
      Number.isFinite(directionSourcePolicy.maxObservationGapMs) && directionSourcePolicy.maxObservationGapMs > 0 &&
      Number.isFinite(directionSourcePolicy.minAbsoluteSpotMovePct) && directionSourcePolicy.minAbsoluteSpotMovePct >= 0;
  if (!Number.isInteger(instrumentToken) || instrumentToken <= 0 || !snapshot?.ready || !snapshot.priceGreek || !snapshot.depth ||
      snapshot.semantics !== "SAME_CONTRACT_LIVE_RUNTIME_EXACT_ONLY" || underlying?.source !== "LIVE_RUNTIME_EXACT" ||
      !evidence?.ready || !evidence.observedAt || !validGreekPolicy || !validDirectionPolicy) return null;
  const observedMs = Date.parse(evidence.observedAt);
  if (!Number.isFinite(observedMs)) return null;
  const minuteBucket = new Date(Math.floor(observedMs / 60_000) * 60_000).toISOString();
  return {
    version: H1_KITE_GREEK_MATH_CROSSCHECK_PERSIST_KIND,
    logicalKey: `${minuteBucket}|${instrumentToken}`,
    minuteBucket,
    instrumentToken,
    snapshot: structuredClone(snapshot),
    underlying: structuredClone(underlying),
    selectorDirectionAtCapture: directionContext?.selectorDirectionAtCapture ?? null,
    expectedPremiumDirectionAtCapture: directionContext?.expectedPremiumDirectionAtCapture ?? null,
    directionSourceId: directionContext?.directionSourceId ?? null,
    policyIdentity: {
      version: "H1_KITE_GREEK_EVIDENCE_POLICY_IDENTITY_V1",
      greekPolicy: structuredClone(greekPolicy!),
      directionSourcePolicy: directionSourcePolicy ? structuredClone(directionSourcePolicy) : null,
      greekPolicySemantics: "SHADOW_CALIBRATION_ONLY",
      directionSourcePolicySemantics: directionContext ? "MARKET_OPEN_CONTEXT_ONLY" : null,
      prospectiveP75Bound: false,
      productionPolicyBound: false,
    },
    evidence: structuredClone(evidence),
    productionImpact: "NONE",
    thresholdAuthority: "NONE",
    affectsSelector: false,
    affectsBusinessCard: false,
    affectsTelegram: false,
    affectsExecution: false,
    createsOrders: false,
    failClosed: true,
  };
}
