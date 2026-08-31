import type { ImmediateAlignment, ImmediateEventFamily, ImmediateVerifiedEvent } from "./immediate-expansion-chain.js";

export type MetricEffect = "FAVOURS_CE" | "FAVOURS_PE" | "VOLATILITY_ONLY" | "NEUTRAL";

export type ImmediateMetricSample = {
  id: string;
  family: ImmediateEventFamily;
  occurredAt: string;
  value: number;
  source: string;
  snapshotId?: string | null;
  effectWhenRising: MetricEffect;
  effectWhenFalling: MetricEffect;
  factLabel: string;
};

export type DetectorConfig = {
  minSamples?: number;
  windowSize?: number;
  robustZThreshold?: number;
  minRelativeMove?: number;
};

export type DetectorResult = {
  version: "IMMEDIATE_ABNORMAL_CHANGE_DETECTOR_V1";
  ready: boolean;
  abnormal: boolean;
  direction: "RISING" | "FALLING" | "FLAT";
  delta: number | null;
  relativeMove: number | null;
  robustZ: number | null;
  event: ImmediateVerifiedEvent | null;
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function effectToAlignment(effect: MetricEffect, lockedTrendSide: "CE" | "PE" | "NONE"): ImmediateAlignment {
  if (effect === "VOLATILITY_ONLY") return "VOLATILITY_ONLY";
  if (effect === "NEUTRAL" || lockedTrendSide === "NONE") return "NEUTRAL";
  if (effect === "FAVOURS_CE") return lockedTrendSide === "CE" ? "FAVOURS_TREND" : "CONFLICTS_TREND";
  return lockedTrendSide === "PE" ? "FAVOURS_TREND" : "CONFLICTS_TREND";
}

export class ImmediateAbnormalChangeDetector {
  private readonly history = new Map<string, ImmediateMetricSample[]>();
  private readonly minSamples: number;
  private readonly windowSize: number;
  private readonly robustZThreshold: number;
  private readonly minRelativeMove: number;

  constructor(config: DetectorConfig = {}) {
    this.minSamples = Math.max(4, config.minSamples ?? 8);
    this.windowSize = Math.max(this.minSamples, config.windowSize ?? 24);
    this.robustZThreshold = Math.max(1, config.robustZThreshold ?? 4);
    this.minRelativeMove = Math.max(0, config.minRelativeMove ?? 0.001);
  }

  observe(sample: ImmediateMetricSample, lockedTrendSide: "CE" | "PE" | "NONE", fresh = true): DetectorResult {
    if (!sample.id || !sample.source || !sample.factLabel || !Number.isFinite(sample.value) || !Date.parse(sample.occurredAt)) {
      throw new Error("INVALID_IMMEDIATE_METRIC_SAMPLE");
    }

    const key = `${sample.source}|${sample.family}|${sample.factLabel}`;
    const rows = this.history.get(key) ?? [];
    const previous = rows.at(-1) ?? null;
    const delta = previous ? sample.value - previous.value : null;
    const relativeMove = previous && previous.value !== 0 ? delta! / Math.abs(previous.value) : null;

    let robustZ: number | null = null;
    let abnormal = false;

    if (previous && rows.length >= this.minSamples) {
      const recentDeltas = rows.slice(-this.windowSize).slice(1).map((r, i, arr) => {
        const prior = rows.slice(-this.windowSize)[i];
        return r.value - prior.value;
      }).filter(Number.isFinite);

      if (recentDeltas.length >= this.minSamples - 1) {
        const center = median(recentDeltas);
        const deviations = recentDeltas.map((x) => Math.abs(x - center));
        const mad = median(deviations);
        const scale = mad > 0 ? 1.4826 * mad : Math.max(Math.abs(center) * 0.1, Number.EPSILON);
        robustZ = Math.abs((delta! - center) / scale);
        abnormal = robustZ >= this.robustZThreshold && (relativeMove == null || Math.abs(relativeMove) >= this.minRelativeMove);
      }
    }

    const direction = delta == null || delta === 0 ? "FLAT" : delta > 0 ? "RISING" : "FALLING";
    const effect = direction === "RISING" ? sample.effectWhenRising : direction === "FALLING" ? sample.effectWhenFalling : "NEUTRAL";
    const alignment = effectToAlignment(effect, lockedTrendSide);

    rows.push(sample);
    if (rows.length > this.windowSize + 1) rows.splice(0, rows.length - (this.windowSize + 1));
    this.history.set(key, rows);

    const event: ImmediateVerifiedEvent | null = abnormal ? {
      id: sample.id,
      family: sample.family,
      occurredAt: sample.occurredAt,
      fact: `${sample.factLabel} ${direction.toLowerCase()} immediately (${delta! >= 0 ? "+" : ""}${delta!.toFixed(4)}; robust-z ${robustZ!.toFixed(2)}).`,
      abnormalImmediateChange: true,
      fresh,
      alignment,
    } : null;

    return {
      version: "IMMEDIATE_ABNORMAL_CHANGE_DETECTOR_V1",
      ready: rows.length >= this.minSamples,
      abnormal,
      direction,
      delta,
      relativeMove,
      robustZ,
      event,
    };
  }
}
