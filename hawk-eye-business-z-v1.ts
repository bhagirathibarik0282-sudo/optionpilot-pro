export type HawkEyeFamily = "SISTERS" | "HEAVYWEIGHTS" | "SECTORS";
export type HawkEyeTarget = "NIFTY" | "BANKNIFTY" | "SENSEX";

export interface HawkEyeBaseline {
  mean: number;
  sd: number;
  sampleCount: number;
}

export interface HawkEyeObservation {
  family: HawkEyeFamily;
  feature: string;
  raw: number | null;
  baseline: HawkEyeBaseline | null;
  /** Historical/validated directional impact coefficient, -1..+1, per target index. */
  impact: Partial<Record<HawkEyeTarget, number>>;
  /** Optional reliability weight inside the family. Defaults to 1. */
  weight?: number;
}

export interface HawkEyeFeatureResult {
  family: HawkEyeFamily;
  feature: string;
  raw: number | null;
  z: number | null;
  ready: boolean;
  sampleCount: number;
  targetContribution: Record<HawkEyeTarget, number | null>;
}

export interface HawkEyeFamilyResult {
  family: HawkEyeFamily;
  readyFeatureCount: number;
  totalFeatureCount: number;
  targetScore: Record<HawkEyeTarget, number | null>;
}

export interface HawkEyeTargetRating {
  target: HawkEyeTarget;
  directionalZ: number | null;
  buyerStars: number;
  sellerStars: number;
  confidencePct: number;
  readyFamilies: number;
  state:
    | "BASELINE_NOT_READY"
    | "BULLISH_INTERNAL_PRESSURE"
    | "BEARISH_INTERNAL_PRESSURE"
    | "NEUTRAL_INTERNAL_PRESSURE";
}

export interface HawkEyeBusinessZReport {
  version: "HAWK_EYE_BUSINESS_Z_V1";
  mode: "SHADOW_CALIBRATION_ONLY";
  requiresPersistentBaseline: true;
  affectsSelector: false;
  affectsExecution: false;
  createsOrders: false;
  features: HawkEyeFeatureResult[];
  families: HawkEyeFamilyResult[];
  ratings: Record<HawkEyeTarget, HawkEyeTargetRating>;
}

const FAMILIES: HawkEyeFamily[] = ["SISTERS", "HEAVYWEIGHTS", "SECTORS"];
const TARGETS: HawkEyeTarget[] = ["NIFTY", "BANKNIFTY", "SENSEX"];
const MIN_BASELINE_SAMPLES = 30;
const Z_CAP = 4;
const FULL_STRENGTH_Z = 2.5;
const IMPACT_EPS = 1e-9;

function finite(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function halfStar(v: number): number {
  return clamp(Math.round(v * 2) / 2, 0, 5);
}

function safeWeight(v: unknown): number {
  const n = finite(v);
  return n === null || n <= 0 ? 1 : clamp(n, 0.05, 5);
}

function calibratedImpact(v: unknown): number | null {
  const n = finite(v);
  if (n === null) return null;
  const impact = clamp(n, -1, 1);
  return Math.abs(impact) <= IMPACT_EPS ? null : impact;
}

function zScore(raw: number | null, baseline: HawkEyeBaseline | null): number | null {
  if (raw === null || !baseline) return null;
  const mean = finite(baseline.mean);
  const sd = finite(baseline.sd);
  const sampleCount = finite(baseline.sampleCount);
  if (mean === null || sd === null || sampleCount === null) return null;
  if (sampleCount < MIN_BASELINE_SAMPLES || sd <= 1e-9) return null;
  return clamp((raw - mean) / sd, -Z_CAP, Z_CAP);
}

function buildFeatureResult(input: HawkEyeObservation): HawkEyeFeatureResult {
  const raw = finite(input.raw);
  const z = zScore(raw, input.baseline);
  const ready = z !== null;
  const sampleCount = input.baseline && Number.isFinite(input.baseline.sampleCount)
    ? Math.max(0, Math.trunc(input.baseline.sampleCount))
    : 0;
  const targetContribution = Object.fromEntries(TARGETS.map((target) => {
    const impact = calibratedImpact(input.impact[target]);
    return [target, ready && impact !== null ? z * impact : null];
  })) as Record<HawkEyeTarget, number | null>;
  return { family: input.family, feature: input.feature, raw, z, ready, sampleCount, targetContribution };
}

function buildFamilyResult(
  family: HawkEyeFamily,
  observations: HawkEyeObservation[],
  featureResults: HawkEyeFeatureResult[],
): HawkEyeFamilyResult {
  const familyObservations = observations.filter((x) => x.family === family);
  const familyResults = featureResults.filter((x) => x.family === family);
  const targetScore = Object.fromEntries(TARGETS.map((target) => {
    let weighted = 0;
    let weights = 0;
    for (let i = 0; i < familyResults.length; i++) {
      const contribution = familyResults[i].targetContribution[target];
      if (contribution === null) continue;
      const w = safeWeight(familyObservations[i]?.weight);
      weighted += contribution * w;
      weights += w;
    }
    // Weighted average inside a family prevents a large constituent list from
    // winning merely because it has more rows (anti-double-count protection).
    // Rows with no calibrated target impact are excluded rather than diluted to zero.
    return [target, weights > 0 ? weighted / weights : null];
  })) as Record<HawkEyeTarget, number | null>;

  return {
    family,
    readyFeatureCount: familyResults.filter((x) => x.ready).length,
    totalFeatureCount: familyResults.length,
    targetScore,
  };
}

function targetRating(target: HawkEyeTarget, families: HawkEyeFamilyResult[]): HawkEyeTargetRating {
  const active = families
    .map((family) => ({ family: family.family, score: family.targetScore[target] }))
    .filter((x): x is { family: HawkEyeFamily; score: number } => x.score !== null && Number.isFinite(x.score));

  if (!active.length) {
    return {
      target,
      directionalZ: null,
      buyerStars: 0,
      sellerStars: 0,
      confidencePct: 0,
      readyFamilies: 0,
      state: "BASELINE_NOT_READY",
    };
  }

  // Equal family voting avoids counting the same market move repeatedly through
  // many correlated constituents. Historical calibration may later change family weights.
  const directionalZ = active.reduce((sum, x) => sum + x.score, 0) / active.length;
  const positive = active.filter((x) => x.score > 0.10).length;
  const negative = active.filter((x) => x.score < -0.10).length;
  const neutral = active.length - positive - negative;
  const dominant = Math.max(positive, negative, neutral);
  const agreement = dominant / active.length;
  const coverage = active.length / FAMILIES.length;
  const confidencePct = Math.round(clamp(100 * coverage * (0.5 + 0.5 * agreement), 0, 100));

  const strength = clamp(Math.abs(directionalZ) / FULL_STRENGTH_Z, 0, 1);
  const effectiveStrength = strength * (confidencePct / 100);
  const stars = halfStar(5 * effectiveStrength);
  const buyerStars = directionalZ > 0.10 ? stars : 0;
  const sellerStars = directionalZ < -0.10 ? stars : 0;
  const state = directionalZ > 0.10
    ? "BULLISH_INTERNAL_PRESSURE"
    : directionalZ < -0.10
      ? "BEARISH_INTERNAL_PRESSURE"
      : "NEUTRAL_INTERNAL_PRESSURE";

  return {
    target,
    directionalZ: Number(directionalZ.toFixed(4)),
    buyerStars,
    sellerStars,
    confidencePct,
    readyFamilies: active.length,
    state,
  };
}

export function buildHawkEyeBusinessZReport(observations: HawkEyeObservation[]): HawkEyeBusinessZReport {
  const featureResults = observations.map(buildFeatureResult);
  const families = FAMILIES.map((family) => buildFamilyResult(family, observations, featureResults));
  const ratings = Object.fromEntries(TARGETS.map((target) => [target, targetRating(target, families)])) as Record<HawkEyeTarget, HawkEyeTargetRating>;
  return {
    version: "HAWK_EYE_BUSINESS_Z_V1",
    mode: "SHADOW_CALIBRATION_ONLY",
    requiresPersistentBaseline: true,
    affectsSelector: false,
    affectsExecution: false,
    createsOrders: false,
    features: featureResults,
    families,
    ratings,
  };
}

export const HAWK_EYE_BUSINESS_Z_V1_LIMITS = Object.freeze({
  minBaselineSamples: MIN_BASELINE_SAMPLES,
  zCap: Z_CAP,
  fullStrengthZ: FULL_STRENGTH_Z,
});
