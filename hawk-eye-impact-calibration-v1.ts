import type { HawkEyeFamily, HawkEyeTarget } from "./hawk-eye-business-z-v1.ts";
import type { HawkEyeImpactCalibration } from "./hawk-eye-z-bridge-v1.ts";

const TARGETS: HawkEyeTarget[] = ["NIFTY", "BANKNIFTY", "SENSEX"];
const DEFAULT_HORIZONS_MINUTES = [3, 6, 15, 30] as const;

export interface HawkEyeHistoricalFeaturePoint {
  family: HawkEyeFamily;
  feature: string;
  observedAtMs: number;
  raw: number | null;
}

export interface HawkEyeTargetPricePoint {
  target: HawkEyeTarget;
  observedAtMs: number;
  price: number | null;
}

export interface HawkEyeImpactCalibrationOptions {
  horizonsMinutes?: number[];
  maxStartLagMs?: number;
  maxFutureLagMs?: number;
  minTrainSamples?: number;
  minValidationSamples?: number;
  minTestSamples?: number;
  minAbsCorrelation?: number;
  nonOverlappingOutcomes?: boolean;
}

export interface HawkEyeImpactEvaluation {
  family: HawkEyeFamily;
  feature: string;
  target: HawkEyeTarget;
  horizonMinutes: number;
  alignedSampleCount: number;
  trainSampleCount: number;
  validationSampleCount: number;
  testSampleCount: number;
  trainCorrelation: number | null;
  validationCorrelation: number | null;
  testCorrelation: number | null;
  trainValidationStable: boolean;
  selectedByValidation: boolean;
  acceptedOutOfSample: boolean;
  impact: number | null;
  reason:
    | "ACCEPTED"
    | "INSUFFICIENT_ALIGNED_SAMPLES"
    | "TRAIN_CORRELATION_NOT_READY"
    | "VALIDATION_UNSTABLE"
    | "NOT_SELECTED_HORIZON"
    | "TEST_CORRELATION_NOT_READY"
    | "TEST_SIGN_OR_STRENGTH_FAILED";
}

export interface HawkEyeImpactCalibrationReport {
  version: "HAWK_EYE_IMPACT_CALIBRATION_V1";
  mode: "HISTORICAL_RESEARCH_ONLY";
  noLookahead: true;
  usesRandomSplit: false;
  nonOverlappingOutcomes: boolean;
  causalClaim: false;
  affectsSelector: false;
  affectsExecution: false;
  affectsTelegram: false;
  createsOrders: false;
  featurePointCount: number;
  targetPricePointCount: number;
  acceptedTargetFeatureCount: number;
  calibrations: HawkEyeImpactCalibration[];
  evaluations: HawkEyeImpactEvaluation[];
  targetPolicy: Record<HawkEyeTarget, { candidateEligible: boolean; contextOnly: boolean }>;
}

interface AlignedPair {
  observedAtMs: number;
  x: number;
  y: number;
}

interface SplitCorrelation {
  trainN: number;
  validationN: number;
  testN: number;
  train: number | null;
  validation: number | null;
  test: number | null;
}

const DEFAULTS = Object.freeze({
  maxStartLagMs: 120_000,
  maxFutureLagMs: 120_000,
  minTrainSamples: 30,
  minValidationSamples: 15,
  minTestSamples: 15,
  minAbsCorrelation: 0.08,
});

function finite(v: unknown): number | null {
  if (v === null || v === undefined || typeof v === "boolean") return null;
  if (typeof v === "string" && !v.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function positiveMs(v: unknown): number | null {
  const n = finite(v);
  return n !== null && n > 0 ? Math.trunc(n) : null;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function sign(v: number | null): -1 | 0 | 1 {
  if (v === null || !Number.isFinite(v) || Math.abs(v) <= 1e-12) return 0;
  return v > 0 ? 1 : -1;
}

function sameNonZeroSign(a: number | null, b: number | null): boolean {
  const sa = sign(a);
  return sa !== 0 && sa === sign(b);
}

function normalizeHorizons(values: number[] | undefined): number[] {
  const source = values?.length ? values : [...DEFAULT_HORIZONS_MINUTES];
  return [...new Set(source
    .map((v) => Math.trunc(finite(v) ?? 0))
    .filter((v) => v > 0 && v <= 240))]
    .sort((a, b) => a - b);
}

function normalizeFeatures(points: HawkEyeHistoricalFeaturePoint[]): HawkEyeHistoricalFeaturePoint[] {
  const byKey = new Map<string, HawkEyeHistoricalFeaturePoint>();
  for (const row of points ?? []) {
    const observedAtMs = positiveMs(row?.observedAtMs);
    const raw = finite(row?.raw);
    const feature = typeof row?.feature === "string" ? row.feature.trim() : "";
    const family = row?.family;
    if (!observedAtMs || raw === null || !feature || !(["SISTERS", "HEAVYWEIGHTS", "SECTORS"] as const).includes(family)) continue;
    byKey.set(`${family}|${feature}|${observedAtMs}`, { family, feature, observedAtMs, raw });
  }
  return [...byKey.values()].sort((a, b) => a.observedAtMs - b.observedAtMs);
}

function normalizeTargetPrices(points: HawkEyeTargetPricePoint[]): Map<HawkEyeTarget, Array<{ observedAtMs: number; price: number }>> {
  const maps = Object.fromEntries(TARGETS.map((target) => [target, new Map<number, number>()])) as Record<HawkEyeTarget, Map<number, number>>;
  for (const row of points ?? []) {
    if (!TARGETS.includes(row?.target)) continue;
    const observedAtMs = positiveMs(row?.observedAtMs);
    const price = finite(row?.price);
    if (!observedAtMs || price === null || price <= 0) continue;
    maps[row.target].set(observedAtMs, price);
  }
  return new Map(TARGETS.map((target) => [target, [...maps[target].entries()]
    .map(([observedAtMs, price]) => ({ observedAtMs, price }))
    .sort((a, b) => a.observedAtMs - b.observedAtMs)]));
}

function latestAtOrBefore(
  points: Array<{ observedAtMs: number; price: number }>,
  atMs: number,
  maxLagMs: number,
): { observedAtMs: number; price: number } | null {
  let lo = 0;
  let hi = points.length - 1;
  let found: { observedAtMs: number; price: number } | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const row = points[mid];
    if (row.observedAtMs <= atMs) {
      found = row;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (!found || atMs - found.observedAtMs > maxLagMs) return null;
  return found;
}

function earliestAtOrAfter(
  points: Array<{ observedAtMs: number; price: number }>,
  atMs: number,
  maxLagMs: number,
): { observedAtMs: number; price: number } | null {
  let lo = 0;
  let hi = points.length - 1;
  let found: { observedAtMs: number; price: number } | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const row = points[mid];
    if (row.observedAtMs >= atMs) {
      found = row;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  if (!found || found.observedAtMs - atMs > maxLagMs) return null;
  return found;
}

function alignPairs(
  features: HawkEyeHistoricalFeaturePoint[],
  targetPrices: Array<{ observedAtMs: number; price: number }>,
  horizonMinutes: number,
  maxStartLagMs: number,
  maxFutureLagMs: number,
  nonOverlapping: boolean,
): AlignedPair[] {
  const horizonMs = horizonMinutes * 60_000;
  const candidates: AlignedPair[] = [];
  for (const feature of features) {
    const x = finite(feature.raw);
    if (x === null) continue;
    const start = latestAtOrBefore(targetPrices, feature.observedAtMs, maxStartLagMs);
    const desiredFutureMs = feature.observedAtMs + horizonMs;
    const future = earliestAtOrAfter(targetPrices, desiredFutureMs, maxFutureLagMs);
    if (!start || !future) continue;
    if (start.observedAtMs > feature.observedAtMs || future.observedAtMs <= feature.observedAtMs) continue;
    if (!(start.price > 0) || !(future.price > 0)) continue;
    const y = ((future.price / start.price) - 1) * 100;
    if (!Number.isFinite(y)) continue;
    candidates.push({ observedAtMs: feature.observedAtMs, x, y });
  }

  candidates.sort((a, b) => a.observedAtMs - b.observedAtMs);
  if (!nonOverlapping) return candidates;
  const out: AlignedPair[] = [];
  let lastAcceptedAt = Number.NEGATIVE_INFINITY;
  for (const row of candidates) {
    if (row.observedAtMs - lastAcceptedAt < horizonMs) continue;
    out.push(row);
    lastAcceptedAt = row.observedAtMs;
  }
  return out;
}

function ranks(values: number[]): number[] {
  const indexed = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value || a.index - b.index);
  const out = new Array<number>(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i + 1;
    while (j < indexed.length && indexed[j].value === indexed[i].value) j++;
    const averageRank = ((i + 1) + j) / 2;
    for (let k = i; k < j; k++) out[indexed[k].index] = averageRank;
    i = j;
  }
  return out;
}

function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx <= 1e-12 || vy <= 1e-12) return null;
  return clamp(cov / Math.sqrt(vx * vy), -1, 1);
}

function spearman(rows: AlignedPair[]): number | null {
  if (rows.length < 3) return null;
  return pearson(ranks(rows.map((row) => row.x)), ranks(rows.map((row) => row.y)));
}

function splitCorrelation(rows: AlignedPair[]): SplitCorrelation {
  const trainEnd = Math.floor(rows.length * 0.50);
  const validationEnd = trainEnd + Math.floor(rows.length * 0.25);
  const trainRows = rows.slice(0, trainEnd);
  const validationRows = rows.slice(trainEnd, validationEnd);
  const testRows = rows.slice(validationEnd);
  return {
    trainN: trainRows.length,
    validationN: validationRows.length,
    testN: testRows.length,
    train: spearman(trainRows),
    validation: spearman(validationRows),
    test: spearman(testRows),
  };
}

function roundCorrelation(v: number | null): number | null {
  return v === null ? null : Number(v.toFixed(6));
}

function evaluationBase(
  family: HawkEyeFamily,
  feature: string,
  target: HawkEyeTarget,
  horizonMinutes: number,
  rows: AlignedPair[],
  split: SplitCorrelation,
): Omit<HawkEyeImpactEvaluation, "trainValidationStable" | "selectedByValidation" | "acceptedOutOfSample" | "impact" | "reason"> {
  return {
    family,
    feature,
    target,
    horizonMinutes,
    alignedSampleCount: rows.length,
    trainSampleCount: split.trainN,
    validationSampleCount: split.validationN,
    testSampleCount: split.testN,
    trainCorrelation: roundCorrelation(split.train),
    validationCorrelation: roundCorrelation(split.validation),
    testCorrelation: roundCorrelation(split.test),
  };
}

function groupKey(family: HawkEyeFamily, feature: string): string {
  return `${family}|${feature}`;
}

function targetGroupKey(family: HawkEyeFamily, feature: string, target: HawkEyeTarget): string {
  return `${groupKey(family, feature)}|${target}`;
}

/**
 * Historical/replay-only empirical association calibration for Hawk Eye.
 * It computes strictly-forward target returns, uses non-random chronological
 * Train/Validation/Test partitions, selects horizon using Train+Validation only,
 * and accepts that pre-selected horizon only if the untouched Test split confirms it.
 * This measures association, not causation, and has no runtime authority.
 */
export function calibrateHawkEyeImpactsV1(
  featurePointsInput: HawkEyeHistoricalFeaturePoint[],
  targetPricePointsInput: HawkEyeTargetPricePoint[],
  options: HawkEyeImpactCalibrationOptions = {},
): HawkEyeImpactCalibrationReport {
  const features = normalizeFeatures(featurePointsInput ?? []);
  const targetPrices = normalizeTargetPrices(targetPricePointsInput ?? []);
  const horizons = normalizeHorizons(options.horizonsMinutes);
  const maxStartLagMs = Math.max(0, Math.trunc(finite(options.maxStartLagMs) ?? DEFAULTS.maxStartLagMs));
  const maxFutureLagMs = Math.max(0, Math.trunc(finite(options.maxFutureLagMs) ?? DEFAULTS.maxFutureLagMs));
  const minTrainSamples = Math.max(3, Math.trunc(finite(options.minTrainSamples) ?? DEFAULTS.minTrainSamples));
  const minValidationSamples = Math.max(3, Math.trunc(finite(options.minValidationSamples) ?? DEFAULTS.minValidationSamples));
  const minTestSamples = Math.max(3, Math.trunc(finite(options.minTestSamples) ?? DEFAULTS.minTestSamples));
  const minAbsCorrelation = clamp(finite(options.minAbsCorrelation) ?? DEFAULTS.minAbsCorrelation, 0, 1);
  const nonOverlapping = options.nonOverlappingOutcomes !== false;

  const groupedFeatures = new Map<string, HawkEyeHistoricalFeaturePoint[]>();
  for (const row of features) {
    const key = groupKey(row.family, row.feature);
    const group = groupedFeatures.get(key) ?? [];
    group.push(row);
    groupedFeatures.set(key, group);
  }

  const evaluations: HawkEyeImpactEvaluation[] = [];
  const evalByTargetGroup = new Map<string, HawkEyeImpactEvaluation[]>();

  for (const group of groupedFeatures.values()) {
    const family = group[0].family;
    const feature = group[0].feature;
    for (const target of TARGETS) {
      const prices = targetPrices.get(target) ?? [];
      const targetEvals: HawkEyeImpactEvaluation[] = [];
      for (const horizonMinutes of horizons) {
        const rows = alignPairs(group, prices, horizonMinutes, maxStartLagMs, maxFutureLagMs, nonOverlapping);
        const split = splitCorrelation(rows);
        const enough = split.trainN >= minTrainSamples && split.validationN >= minValidationSamples && split.testN >= minTestSamples;
        const trainReady = split.train !== null && Math.abs(split.train) >= minAbsCorrelation;
        const validationStable = enough && trainReady && sameNonZeroSign(split.train, split.validation)
          && split.validation !== null && Math.abs(split.validation) >= minAbsCorrelation;
        const reason: HawkEyeImpactEvaluation["reason"] = !enough
          ? "INSUFFICIENT_ALIGNED_SAMPLES"
          : !trainReady
            ? "TRAIN_CORRELATION_NOT_READY"
            : !validationStable
              ? "VALIDATION_UNSTABLE"
              : "NOT_SELECTED_HORIZON";
        targetEvals.push({
          ...evaluationBase(family, feature, target, horizonMinutes, rows, split),
          trainValidationStable: validationStable,
          selectedByValidation: false,
          acceptedOutOfSample: false,
          impact: null,
          reason,
        });
      }

      const selectable = targetEvals.filter((row) => row.trainValidationStable);
      selectable.sort((a, b) => {
        const aScore = Math.min(Math.abs(a.trainCorrelation ?? 0), Math.abs(a.validationCorrelation ?? 0));
        const bScore = Math.min(Math.abs(b.trainCorrelation ?? 0), Math.abs(b.validationCorrelation ?? 0));
        return bScore - aScore || a.horizonMinutes - b.horizonMinutes;
      });
      const selected = selectable[0];
      if (selected) {
        selected.selectedByValidation = true;
        const testReady = selected.testCorrelation !== null;
        if (!testReady) {
          selected.reason = "TEST_CORRELATION_NOT_READY";
        } else if (!sameNonZeroSign(selected.validationCorrelation, selected.testCorrelation)
          || Math.abs(selected.testCorrelation) < minAbsCorrelation) {
          selected.reason = "TEST_SIGN_OR_STRENGTH_FAILED";
        } else {
          const direction = sign(selected.trainCorrelation);
          const conservativeMagnitude = Math.min(
            Math.abs(selected.trainCorrelation ?? 0),
            Math.abs(selected.validationCorrelation ?? 0),
            Math.abs(selected.testCorrelation ?? 0),
          );
          selected.impact = Number((direction * clamp(conservativeMagnitude, 0, 1)).toFixed(6));
          selected.acceptedOutOfSample = true;
          selected.reason = "ACCEPTED";
        }
      }

      evaluations.push(...targetEvals);
      evalByTargetGroup.set(targetGroupKey(family, feature, target), targetEvals);
    }
  }

  const calibrations: HawkEyeImpactCalibration[] = [];
  for (const group of groupedFeatures.values()) {
    const family = group[0].family;
    const feature = group[0].feature;
    const impact: Partial<Record<HawkEyeTarget, number>> = {};
    for (const target of TARGETS) {
      const selected = (evalByTargetGroup.get(targetGroupKey(family, feature, target)) ?? [])
        .find((row) => row.selectedByValidation && row.acceptedOutOfSample && row.impact !== null);
      if (selected?.impact !== null && selected?.impact !== undefined) impact[target] = selected.impact;
    }
    if (Object.keys(impact).length) calibrations.push({ family, feature, impact });
  }

  return {
    version: "HAWK_EYE_IMPACT_CALIBRATION_V1",
    mode: "HISTORICAL_RESEARCH_ONLY",
    noLookahead: true,
    usesRandomSplit: false,
    nonOverlappingOutcomes: nonOverlapping,
    causalClaim: false,
    affectsSelector: false,
    affectsExecution: false,
    affectsTelegram: false,
    createsOrders: false,
    featurePointCount: features.length,
    targetPricePointCount: [...targetPrices.values()].reduce((sum, rows) => sum + rows.length, 0),
    acceptedTargetFeatureCount: evaluations.filter((row) => row.acceptedOutOfSample).length,
    calibrations,
    evaluations,
    targetPolicy: {
      NIFTY: { candidateEligible: true, contextOnly: false },
      BANKNIFTY: { candidateEligible: false, contextOnly: true },
      SENSEX: { candidateEligible: true, contextOnly: false },
    },
  };
}

export const HAWK_EYE_IMPACT_CALIBRATION_V1_LIMITS = Object.freeze({
  horizonsMinutes: DEFAULT_HORIZONS_MINUTES,
  defaultMaxStartLagMs: DEFAULTS.maxStartLagMs,
  defaultMaxFutureLagMs: DEFAULTS.maxFutureLagMs,
  defaultMinTrainSamples: DEFAULTS.minTrainSamples,
  defaultMinValidationSamples: DEFAULTS.minValidationSamples,
  defaultMinTestSamples: DEFAULTS.minTestSamples,
  defaultMinAbsCorrelation: DEFAULTS.minAbsCorrelation,
});
