import { buildHawkEyeBusinessZReport, type HawkEyeObservation, type HawkEyeTarget, type HawkEyeFamily, type HawkEyeTargetRating } from "./hawk-eye-business-z-v1.ts";
import { loadHawkEyeBaselineAndRecordCurrent, type HawkEyeBaselineSample, type HawkEyeBaselineStoreResult } from "./hawk-eye-baseline-store-v1.ts";
import type { HawkEyeLiveObservationReport, HawkEyeRawFeature } from "./hawk-eye-live-observation-adapter-v1.ts";

const TARGETS: HawkEyeTarget[] = ["NIFTY", "BANKNIFTY", "SENSEX"];
const MAX_FEATURES_PER_REPORT = 180;

export interface HawkEyeImpactCalibration {
  family: HawkEyeFamily;
  feature: string;
  /** Validated historical directional impact only. Missing/zero means no contribution. */
  impact: Partial<Record<HawkEyeTarget, number>>;
  /** Optional reliability weight inside the family. */
  weight?: number;
}

export interface HawkEyeZBridgeDeps {
  loadBaseline: (sample: HawkEyeBaselineSample) => Promise<HawkEyeBaselineStoreResult>;
}

export interface HawkEyeZBridgeTargetResult {
  target: HawkEyeTarget;
  rating: HawkEyeTargetRating;
  baselineReadyCount: number;
  baselineNotReadyCount: number;
  calibratedFeatureCount: number;
  baselineReasons: Record<string, number>;
}

export interface HawkEyeZBridgeReport {
  version: "HAWK_EYE_Z_BRIDGE_V1";
  mode: "SHADOW_CALIBRATION_ONLY";
  sourceVersion: "HAWK_EYE_LIVE_OBSERVATION_ADAPTER_V1";
  affectsSelector: false;
  affectsExecution: false;
  createsOrders: false;
  inputFeatureCount: number;
  processedFeatureCount: number;
  truncated: boolean;
  targets: Record<HawkEyeTarget, HawkEyeZBridgeTargetResult>;
}

const defaultDeps: HawkEyeZBridgeDeps = {
  loadBaseline: loadHawkEyeBaselineAndRecordCurrent,
};

function impactKey(family: HawkEyeFamily, feature: string): string {
  return `${family}:${feature.trim()}`;
}

function calibrationIndex(calibrations: HawkEyeImpactCalibration[]): Map<string, HawkEyeImpactCalibration> {
  const out = new Map<string, HawkEyeImpactCalibration>();
  for (const row of calibrations ?? []) {
    if (!row?.feature?.trim()) continue;
    if (!TARGETS.some((target) => Number.isFinite(Number(row.impact?.[target])) && Math.abs(Number(row.impact?.[target])) > 1e-9)) continue;
    out.set(impactKey(row.family, row.feature), row);
  }
  return out;
}

function singleTargetImpact(target: HawkEyeTarget, row: HawkEyeImpactCalibration | undefined): Partial<Record<HawkEyeTarget, number>> {
  const raw = row?.impact?.[target];
  const n = Number(raw);
  if (!Number.isFinite(n) || Math.abs(n) <= 1e-9) return {};
  return { [target]: Math.max(-1, Math.min(1, n)) } as Partial<Record<HawkEyeTarget, number>>;
}

function bumpReason(reasons: Record<string, number>, reason: string): void {
  reasons[reason] = (reasons[reason] ?? 0) + 1;
}

function sampleFromFeature(target: HawkEyeTarget, feature: HawkEyeRawFeature): HawkEyeBaselineSample {
  return {
    target,
    family: feature.family,
    feature: feature.feature,
    raw: feature.raw,
    observedAtMs: feature.observedAtMs,
    sampleId: `${feature.sourceCurrentAtMs}:${feature.sourceAnchorAtMs}`,
  };
}

/**
 * Bridges raw live Hawk Eye features into persistent Z baselines and the existing
 * Business Z fusion core. The bridge is target-isolated because baseline history is
 * stored per target/family/feature. It never invents impact coefficients: only supplied,
 * calibrated impacts can contribute to a target rating.
 *
 * Shadow-only: no selector, Telegram, execution, or order wiring.
 */
export async function buildHawkEyeZBridgeReport(
  source: HawkEyeLiveObservationReport,
  calibrations: HawkEyeImpactCalibration[],
  deps: HawkEyeZBridgeDeps = defaultDeps,
): Promise<HawkEyeZBridgeReport> {
  if (!source || source.version !== "HAWK_EYE_LIVE_OBSERVATION_ADAPTER_V1") {
    throw new Error("HAWK_EYE_Z_BRIDGE_INVALID_SOURCE");
  }

  const inputFeatures = Array.isArray(source.features) ? source.features : [];
  const features = inputFeatures.slice(0, MAX_FEATURES_PER_REPORT);
  const calibrationByKey = calibrationIndex(calibrations);
  const targetEntries: Array<[HawkEyeTarget, HawkEyeZBridgeTargetResult]> = [];

  for (const target of TARGETS) {
    const observations: HawkEyeObservation[] = [];
    const baselineReasons: Record<string, number> = {};
    let baselineReadyCount = 0;
    let baselineNotReadyCount = 0;
    let calibratedFeatureCount = 0;

    for (const feature of features) {
      const calibration = calibrationByKey.get(impactKey(feature.family, feature.feature));
      const targetImpact = singleTargetImpact(target, calibration);
      if (targetImpact[target] !== undefined) calibratedFeatureCount++;

      let baselineResult: HawkEyeBaselineStoreResult;
      try {
        baselineResult = await deps.loadBaseline(sampleFromFeature(target, feature));
      } catch {
        baselineResult = {
          baseline: null,
          sampleCount: 0,
          persisted: false,
          reason: "DB_READ_FAILED",
          historyLimit: 0,
        };
      }
      bumpReason(baselineReasons, baselineResult.reason);
      if (baselineResult.baseline) baselineReadyCount++;
      else baselineNotReadyCount++;

      observations.push({
        family: feature.family,
        feature: feature.feature,
        raw: feature.raw,
        baseline: baselineResult.baseline,
        impact: targetImpact,
        weight: calibration?.weight,
      });
    }

    const business = buildHawkEyeBusinessZReport(observations);
    targetEntries.push([target, {
      target,
      rating: business.ratings[target],
      baselineReadyCount,
      baselineNotReadyCount,
      calibratedFeatureCount,
      baselineReasons,
    }]);
  }

  return {
    version: "HAWK_EYE_Z_BRIDGE_V1",
    mode: "SHADOW_CALIBRATION_ONLY",
    sourceVersion: "HAWK_EYE_LIVE_OBSERVATION_ADAPTER_V1",
    affectsSelector: false,
    affectsExecution: false,
    createsOrders: false,
    inputFeatureCount: inputFeatures.length,
    processedFeatureCount: features.length,
    truncated: inputFeatures.length > features.length,
    targets: Object.fromEntries(targetEntries) as Record<HawkEyeTarget, HawkEyeZBridgeTargetResult>,
  };
}

export const HAWK_EYE_Z_BRIDGE_V1_LIMITS = Object.freeze({
  maxFeaturesPerReport: MAX_FEATURES_PER_REPORT,
  targets: TARGETS,
});
