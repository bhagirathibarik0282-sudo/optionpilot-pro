export const OPTION_BUYER_BUSINESS_METRICS_V1 = "OPTION_BUYER_BUSINESS_METRICS_V1" as const;

export type OpportunityStage = "EARLY" | "ACTIVE" | "MATURE" | "EXHAUSTING";

export interface ShadowSafetyBoundary {
  semantics: "RESEARCH_SHADOW_ONLY";
  affectsVerdict: false;
  affectsStars: false;
  affectsCandidateAuthority: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
  failClosed: true;
}

const SAFETY: ShadowSafetyBoundary = {
  semantics: "RESEARCH_SHADOW_ONLY",
  affectsVerdict: false,
  affectsStars: false,
  affectsCandidateAuthority: false,
  affectsTelegram: false,
  affectsExecution: false,
  createsOrders: false,
  failClosed: true,
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp100(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export interface SellerStressProxyInput {
  /** Pre-normalized 0..100 research components. Do not pass raw incompatible units. */
  oiBuildShedPressure?: number | null;
  wallRetreatPressure?: number | null;
  premiumResidualPressure?: number | null;
  ivSkewPressure?: number | null;
  futuresPressure?: number | null;
  depthMicropricePressure?: number | null;
  persistencePressure?: number | null;
}

export interface SellerStressProxyResult extends ShadowSafetyBoundary {
  version: typeof OPTION_BUYER_BUSINESS_METRICS_V1;
  ready: boolean;
  score: number | null;
  state: "DEFENCE_HOLDING" | "STRESS_BUILDING" | "DEFENCE_WEAKENING" | "RETREAT_EVIDENCE" | null;
  componentCount: number;
  blockers: string[];
}

/**
 * Research proxy only. OI never proves writer identity by itself.
 * Components must already be normalized to the same 0..100 pressure scale.
 */
export function computeSellerStressProxy(input: SellerStressProxyInput): SellerStressProxyResult {
  const raw = [
    input.oiBuildShedPressure,
    input.wallRetreatPressure,
    input.premiumResidualPressure,
    input.ivSkewPressure,
    input.futuresPressure,
    input.depthMicropricePressure,
    input.persistencePressure,
  ];
  const invalid = raw.filter((v) => v != null && (!finite(v) || v < 0 || v > 100));
  if (invalid.length > 0) {
    return { version: OPTION_BUYER_BUSINESS_METRICS_V1, ready: false, score: null, state: null, componentCount: 0, blockers: ["INVALID_NORMALIZED_SELLER_STRESS_COMPONENT"], ...SAFETY };
  }
  const values = raw.filter((v): v is number => finite(v));
  if (values.length < 4) {
    return { version: OPTION_BUYER_BUSINESS_METRICS_V1, ready: false, score: null, state: null, componentCount: values.length, blockers: ["SELLER_STRESS_COMPONENTS_BELOW_4"], ...SAFETY };
  }
  const score = round4(values.reduce((a, b) => a + b, 0) / values.length);
  const state = score >= 80 ? "RETREAT_EVIDENCE" : score >= 65 ? "DEFENCE_WEAKENING" : score >= 45 ? "STRESS_BUILDING" : "DEFENCE_HOLDING";
  return { version: OPTION_BUYER_BUSINESS_METRICS_V1, ready: true, score, state, componentCount: values.length, blockers: [], ...SAFETY };
}

export interface PremiumEfficiencyInput {
  actualPremiumMoveAbs: number;
  expectedPremiumMoveAbs: number;
}

export function computePremiumEfficiency(input: PremiumEfficiencyInput) {
  if (!finite(input.actualPremiumMoveAbs) || input.actualPremiumMoveAbs < 0 || !finite(input.expectedPremiumMoveAbs) || input.expectedPremiumMoveAbs <= 0) {
    return { version: OPTION_BUYER_BUSINESS_METRICS_V1, ready: false, ratio: null, blockers: ["INVALID_PREMIUM_EFFICIENCY_INPUT"], ...SAFETY };
  }
  return {
    version: OPTION_BUYER_BUSINESS_METRICS_V1,
    ready: true,
    ratio: round4(input.actualPremiumMoveAbs / input.expectedPremiumMoveAbs),
    blockers: [],
    ...SAFETY,
  };
}

export interface PremiumPairSeparationInput {
  /** Candidate premium percentage change over the same aligned window. */
  candidateChangePct: number;
  /** Opposite premium percentage change over the same aligned window. */
  oppositeChangePct: number;
}

export function computePremiumPairSeparation(input: PremiumPairSeparationInput) {
  if (!finite(input.candidateChangePct) || !finite(input.oppositeChangePct)) {
    return { version: OPTION_BUYER_BUSINESS_METRICS_V1, ready: false, separationPct: null, state: null, blockers: ["INVALID_PREMIUM_PAIR_INPUT"], ...SAFETY };
  }
  const separationPct = round4(input.candidateChangePct - input.oppositeChangePct);
  let state: "DIRECTIONAL_EXPANSION" | "VOLATILITY_EXPANSION" | "COMPRESSION" | "CANDIDATE_MOMENTUM_FADING";
  if (input.candidateChangePct > 0 && input.oppositeChangePct < 0) state = "DIRECTIONAL_EXPANSION";
  else if (input.candidateChangePct > 0 && input.oppositeChangePct > 0) state = "VOLATILITY_EXPANSION";
  else if (Math.abs(input.candidateChangePct) < 2 && Math.abs(input.oppositeChangePct) < 2) state = "COMPRESSION";
  else state = "CANDIDATE_MOMENTUM_FADING";
  return { version: OPTION_BUYER_BUSINESS_METRICS_V1, ready: true, separationPct, state, blockers: [], ...SAFETY };
}

export interface PremiumResidualInput {
  actualPremiumChange: number;
  delta: number;
  gamma: number;
  spotChange: number;
  thetaChange?: number;
  vega?: number;
  ivChange?: number;
}

export function computeGreeksAdjustedPremiumResidual(input: PremiumResidualInput) {
  const required = [input.actualPremiumChange, input.delta, input.gamma, input.spotChange];
  if (required.some((v) => !finite(v)) || (input.thetaChange != null && !finite(input.thetaChange)) || (input.vega != null && !finite(input.vega)) || (input.ivChange != null && !finite(input.ivChange))) {
    return { version: OPTION_BUYER_BUSINESS_METRICS_V1, ready: false, expectedPremiumChange: null, residual: null, blockers: ["INVALID_PREMIUM_RESIDUAL_INPUT"], ...SAFETY };
  }
  const theta = input.thetaChange ?? 0;
  const vegaTerm = input.vega != null && input.ivChange != null ? input.vega * input.ivChange : 0;
  const expected = input.delta * input.spotChange + 0.5 * input.gamma * input.spotChange * input.spotChange + theta + vegaTerm;
  return {
    version: OPTION_BUYER_BUSINESS_METRICS_V1,
    ready: true,
    expectedPremiumChange: round4(expected),
    residual: round4(input.actualPremiumChange - expected),
    blockers: [],
    ...SAFETY,
  };
}

export interface RequiredMoveScenarioInput {
  delta: number;
  gamma: number;
  currentPremium: number;
  targetCostRecovery: number;
  thetaChange: number;
  vega: number;
  ivChanges: { down: number; flat: number; up: number };
}

/** Solve 0.5*gamma*dS^2 + delta*dS + theta + vega*dIV = targetCostRecovery for the smallest non-negative dS. */
function solveRequiredMove(delta: number, gamma: number, constantTerm: number): number | null {
  if (Math.abs(gamma) < 1e-12) {
    if (delta <= 0) return null;
    const x = -constantTerm / delta;
    return x >= 0 && finite(x) ? x : null;
  }
  const a = 0.5 * gamma;
  const b = delta;
  const c = constantTerm;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const roots = [(-b + root) / (2 * a), (-b - root) / (2 * a)].filter((x) => finite(x) && x >= 0);
  return roots.length ? Math.min(...roots) : null;
}

export function computeRequiredMoveScenarios(input: RequiredMoveScenarioInput) {
  const nums = [input.delta, input.gamma, input.currentPremium, input.targetCostRecovery, input.thetaChange, input.vega, input.ivChanges.down, input.ivChanges.flat, input.ivChanges.up];
  if (nums.some((v) => !finite(v)) || input.currentPremium <= 0 || input.targetCostRecovery < 0) {
    return { version: OPTION_BUYER_BUSINESS_METRICS_V1, ready: false, scenarios: null, blockers: ["INVALID_REQUIRED_MOVE_INPUT"], ...SAFETY };
  }
  const calc = (ivChange: number) => {
    const constant = input.thetaChange + input.vega * ivChange - input.targetCostRecovery;
    const x = solveRequiredMove(input.delta, input.gamma, constant);
    return x == null ? null : round4(x);
  };
  const scenarios = { ivDown: calc(input.ivChanges.down), ivFlat: calc(input.ivChanges.flat), ivUp: calc(input.ivChanges.up) };
  const ready = Object.values(scenarios).every((v) => v != null);
  return { version: OPTION_BUYER_BUSINESS_METRICS_V1, ready, scenarios, blockers: ready ? [] : ["REQUIRED_MOVE_SCENARIO_UNSOLVABLE"], ...SAFETY };
}

export interface ConvexityEfficiencyInput {
  expectedGammaBenefit: number;
  thetaBurnAbs: number;
  spreadCost: number;
  slippageCost: number;
}

export function computeConvexityEfficiency(input: ConvexityEfficiencyInput) {
  const values = [input.expectedGammaBenefit, input.thetaBurnAbs, input.spreadCost, input.slippageCost];
  if (values.some((v) => !finite(v) || v < 0)) {
    return { version: OPTION_BUYER_BUSINESS_METRICS_V1, ready: false, ratio: null, blockers: ["INVALID_CONVEXITY_INPUT"], ...SAFETY };
  }
  const burden = input.thetaBurnAbs + input.spreadCost + input.slippageCost;
  if (burden <= 0) return { version: OPTION_BUYER_BUSINESS_METRICS_V1, ready: false, ratio: null, blockers: ["CONVEXITY_BURDEN_ZERO"], ...SAFETY };
  return { version: OPTION_BUYER_BUSINESS_METRICS_V1, ready: true, ratio: round4(input.expectedGammaBenefit / burden), blockers: [], ...SAFETY };
}

export interface RemainingOpportunityInput {
  expectedMoveUsedPct?: number | null;
  atrUsedPct?: number | null;
  premiumExtensionPct?: number | null;
  ivExtensionPct?: number | null;
  sessionTimeUsedPct?: number | null;
}

export function computeRemainingOpportunity(input: RemainingOpportunityInput) {
  const raw = [input.expectedMoveUsedPct, input.atrUsedPct, input.premiumExtensionPct, input.ivExtensionPct, input.sessionTimeUsedPct];
  if (raw.some((v) => v != null && (!finite(v) || v < 0 || v > 100))) {
    return { version: OPTION_BUYER_BUSINESS_METRICS_V1, ready: false, remainingPct: null, stage: null, blockers: ["INVALID_OPPORTUNITY_UTILIZATION"], ...SAFETY };
  }
  const values = raw.filter((v): v is number => finite(v));
  if (values.length < 3) {
    return { version: OPTION_BUYER_BUSINESS_METRICS_V1, ready: false, remainingPct: null, stage: null, blockers: ["OPPORTUNITY_COMPONENTS_BELOW_3"], ...SAFETY };
  }
  const used = values.reduce((a, b) => a + b, 0) / values.length;
  const remainingPct = round4(clamp100(100 - used));
  const stage: OpportunityStage = remainingPct >= 70 ? "EARLY" : remainingPct >= 40 ? "ACTIVE" : remainingPct >= 20 ? "MATURE" : "EXHAUSTING";
  return { version: OPTION_BUYER_BUSINESS_METRICS_V1, ready: true, remainingPct, stage, blockers: [], ...SAFETY };
}
