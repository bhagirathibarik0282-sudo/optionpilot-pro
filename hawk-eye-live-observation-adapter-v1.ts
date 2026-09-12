import type { HawkEyeFamily } from "./hawk-eye-business-z-v1.ts";

export interface HawkEyeLivePoint {
  observedAtMs: number;
  price: number | null;
  /** Optional cumulative session volume. */
  volume?: number | null;
}

export interface HawkEyeLiveSeries {
  family: HawkEyeFamily;
  /** Stable entity key, e.g. FINNIFTY, HDFCBANK, NIFTY_IT. */
  entity: string;
  points: HawkEyeLivePoint[];
}

export interface HawkEyeRawFeature {
  family: HawkEyeFamily;
  entity: string;
  feature: string;
  metric: "RETURN_PCT" | "VOLUME_RATE";
  windowMinutes: 3 | 6 | 15;
  raw: number;
  observedAtMs: number;
  sourceCurrentAtMs: number;
  sourceAnchorAtMs: number;
}

export interface HawkEyeSeriesDiagnostic {
  family: HawkEyeFamily;
  entity: string;
  latestObservedAtMs: number | null;
  fresh: boolean;
  generatedFeatureCount: number;
  skippedWindows: Array<3 | 6 | 15>;
  reason: "READY" | "NO_VALID_POINTS" | "STALE_LATEST" | "NO_WINDOW_ANCHOR";
}

export interface HawkEyeLiveObservationReport {
  version: "HAWK_EYE_LIVE_OBSERVATION_ADAPTER_V1";
  mode: "SHADOW_OBSERVATION_ONLY";
  affectsSelector: false;
  affectsExecution: false;
  createsOrders: false;
  asOfMs: number;
  features: HawkEyeRawFeature[];
  diagnostics: HawkEyeSeriesDiagnostic[];
}

export interface HawkEyeLiveObservationOptions {
  /** Latest usable point must be this fresh relative to asOfMs. */
  maxLatestAgeMs?: number;
  /** Anchor may precede the exact window cutoff by at most this amount. */
  maxAnchorLagMs?: number;
}

const WINDOWS = [3, 6, 15] as const;
const DEFAULT_MAX_LATEST_AGE_MS = 120_000;
const DEFAULT_MAX_ANCHOR_LAG_MS = 120_000;

function finite(v: unknown): number | null {
  if (v === null || v === undefined || typeof v === "boolean" || (typeof v === "string" && v.trim() === "")) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeEntity(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.replace(/[^A-Za-z0-9_-]+/g, "_").toUpperCase() : null;
}

function normalizedPoints(points: HawkEyeLivePoint[], asOfMs: number): Array<{ observedAtMs: number; price: number; volume: number | null }> {
  const byTimestamp = new Map<number, { observedAtMs: number; price: number; volume: number | null }>();
  for (const point of points ?? []) {
    const observedAtMs = finite(point?.observedAtMs);
    const price = finite(point?.price);
    const volume = finite(point?.volume);
    if (observedAtMs === null || observedAtMs <= 0 || observedAtMs > asOfMs || price === null || price <= 0) continue;
    const ts = Math.trunc(observedAtMs);
    byTimestamp.set(ts, { observedAtMs: ts, price, volume: volume !== null && volume >= 0 ? volume : null });
  }
  return [...byTimestamp.values()].sort((a, b) => a.observedAtMs - b.observedAtMs);
}

function anchorForWindow(
  points: Array<{ observedAtMs: number; price: number; volume: number | null }>,
  cutoffMs: number,
  maxAnchorLagMs: number,
): { observedAtMs: number; price: number; volume: number | null } | null {
  for (let i = points.length - 1; i >= 0; i--) {
    const point = points[i];
    if (point.observedAtMs > cutoffMs) continue;
    if ((cutoffMs - point.observedAtMs) > maxAnchorLagMs) return null;
    return point;
  }
  return null;
}

function pctReturn(current: number, anchor: number): number | null {
  if (!(current > 0) || !(anchor > 0)) return null;
  const value = ((current / anchor) - 1) * 100;
  return Number.isFinite(value) ? value : null;
}

/**
 * Pure/configuration-driven adapter. It does not fetch data, assign constituent weights,
 * estimate causal impact, select contracts, send Telegram messages, or create orders.
 * It converts timestamped sister/heavyweight/sector histories into comparable raw
 * 3m/6m/15m features for the persistent Z + impact layers downstream.
 */
export function buildHawkEyeLiveObservationReport(
  series: HawkEyeLiveSeries[],
  asOfMs: number,
  options: HawkEyeLiveObservationOptions = {},
): HawkEyeLiveObservationReport {
  const safeAsOfMs = finite(asOfMs);
  if (safeAsOfMs === null || safeAsOfMs <= 0) {
    throw new Error("HAWK_EYE_INVALID_AS_OF");
  }
  const maxLatestAgeMs = Math.max(1, Math.trunc(finite(options.maxLatestAgeMs) ?? DEFAULT_MAX_LATEST_AGE_MS));
  const maxAnchorLagMs = Math.max(0, Math.trunc(finite(options.maxAnchorLagMs) ?? DEFAULT_MAX_ANCHOR_LAG_MS));
  const features: HawkEyeRawFeature[] = [];
  const diagnostics: HawkEyeSeriesDiagnostic[] = [];

  for (const input of series ?? []) {
    const entity = normalizeEntity(input?.entity);
    const family = input?.family;
    if (!entity || !(["SISTERS", "HEAVYWEIGHTS", "SECTORS"] as const).includes(family)) continue;

    const points = normalizedPoints(input.points ?? [], safeAsOfMs);
    if (!points.length) {
      diagnostics.push({ family, entity, latestObservedAtMs: null, fresh: false, generatedFeatureCount: 0, skippedWindows: [...WINDOWS], reason: "NO_VALID_POINTS" });
      continue;
    }

    const latest = points[points.length - 1];
    const fresh = (safeAsOfMs - latest.observedAtMs) <= maxLatestAgeMs;
    if (!fresh) {
      diagnostics.push({ family, entity, latestObservedAtMs: latest.observedAtMs, fresh: false, generatedFeatureCount: 0, skippedWindows: [...WINDOWS], reason: "STALE_LATEST" });
      continue;
    }

    const skippedWindows: Array<3 | 6 | 15> = [];
    const beforeCount = features.length;
    for (const windowMinutes of WINDOWS) {
      const cutoffMs = safeAsOfMs - (windowMinutes * 60_000);
      const anchor = anchorForWindow(points, cutoffMs, maxAnchorLagMs);
      if (!anchor || anchor.observedAtMs >= latest.observedAtMs) {
        skippedWindows.push(windowMinutes);
        continue;
      }

      const returnPct = pctReturn(latest.price, anchor.price);
      if (returnPct !== null) {
        features.push({
          family,
          entity,
          feature: `${entity}_RETURN_${windowMinutes}M`,
          metric: "RETURN_PCT",
          windowMinutes,
          raw: returnPct,
          observedAtMs: Math.trunc(safeAsOfMs),
          sourceCurrentAtMs: latest.observedAtMs,
          sourceAnchorAtMs: anchor.observedAtMs,
        });
      }

      // If cumulative session volume is available, derive average incremental volume/minute.
      // A volume reset/decrease is not interpreted; the feature is omitted fail-closed.
      if (latest.volume !== null && anchor.volume !== null && latest.volume >= anchor.volume) {
        const elapsedMinutes = (latest.observedAtMs - anchor.observedAtMs) / 60_000;
        if (elapsedMinutes > 0) {
          const volumeRate = (latest.volume - anchor.volume) / elapsedMinutes;
          if (Number.isFinite(volumeRate)) {
            features.push({
              family,
              entity,
              feature: `${entity}_VOLUME_RATE_${windowMinutes}M`,
              metric: "VOLUME_RATE",
              windowMinutes,
              raw: volumeRate,
              observedAtMs: Math.trunc(safeAsOfMs),
              sourceCurrentAtMs: latest.observedAtMs,
              sourceAnchorAtMs: anchor.observedAtMs,
            });
          }
        }
      }
    }

    const generatedFeatureCount = features.length - beforeCount;
    diagnostics.push({
      family,
      entity,
      latestObservedAtMs: latest.observedAtMs,
      fresh: true,
      generatedFeatureCount,
      skippedWindows,
      reason: generatedFeatureCount > 0 ? "READY" : "NO_WINDOW_ANCHOR",
    });
  }

  return {
    version: "HAWK_EYE_LIVE_OBSERVATION_ADAPTER_V1",
    mode: "SHADOW_OBSERVATION_ONLY",
    affectsSelector: false,
    affectsExecution: false,
    createsOrders: false,
    asOfMs: Math.trunc(safeAsOfMs),
    features,
    diagnostics,
  };
}

export const HAWK_EYE_LIVE_OBSERVATION_V1_LIMITS = Object.freeze({
  windowsMinutes: WINDOWS,
  defaultMaxLatestAgeMs: DEFAULT_MAX_LATEST_AGE_MS,
  defaultMaxAnchorLagMs: DEFAULT_MAX_ANCHOR_LAG_MS,
});
