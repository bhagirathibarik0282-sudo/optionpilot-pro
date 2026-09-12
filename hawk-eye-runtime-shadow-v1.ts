import type { CanonicalConstituentTokenEntry } from "./canonical-constituent-token-registry.ts";
import type { KiteConstituentMinuteRecord } from "./kite-constituent-runtime-bridge-v1.ts";
import type { SevenIndexMarketValueRow } from "./canonical-seven-index-market-value-parser.ts";
import {
  buildHawkEyeLiveObservationReport,
  type HawkEyeLiveObservationReport,
  type HawkEyeLiveSeries,
} from "./hawk-eye-live-observation-adapter-v1.ts";

export interface HawkEyeSevenIndexSnapshot {
  observedAtMs: number;
  rows: SevenIndexMarketValueRow[];
}

export interface HawkEyeRuntimeShadowInput {
  registry: CanonicalConstituentTokenEntry[];
  constituentMinutes: KiteConstituentMinuteRecord[];
  /** Already-fetched canonical seven-index snapshots only. This module never performs network I/O. */
  sevenIndexSnapshots?: HawkEyeSevenIndexSnapshot[];
  asOfMs: number;
  maxLatestAgeMs?: number;
}

export interface HawkEyeRuntimeShadowReport {
  version: "HAWK_EYE_RUNTIME_SHADOW_V1";
  mode: "SHADOW_OBSERVATION_ONLY";
  opensSocket: false;
  fetchesNetworkData: false;
  affectsSelector: false;
  affectsExecution: false;
  affectsTelegram: false;
  createsOrders: false;
  inputClosedMinuteCount: number;
  seriesCount: number;
  sisterSeriesCount: number;
  heavyweightSeriesCount: number;
  sectorSeriesCount: number;
  skippedSectorBaskets: string[];
  observation: HawkEyeLiveObservationReport;
}

function finitePositive(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

function entity(v: string): string {
  return v.trim().replace(/[^A-Za-z0-9_-]+/g, "_").toUpperCase();
}

function closedMinutes(records: KiteConstituentMinuteRecord[], asOfMs: number): KiteConstituentMinuteRecord[] {
  const byMinute = new Map<number, KiteConstituentMinuteRecord>();
  for (const record of records ?? []) {
    if (!record?.immutable || !finitePositive(record.minuteStartMs) || !finitePositive(record.closedAtMs)) continue;
    if (record.closedAtMs > asOfMs || record.closedAtMs < record.minuteStartMs + 60_000) continue;
    byMinute.set(record.minuteStartMs, record);
  }
  return [...byMinute.values()].sort((a, b) => a.minuteStartMs - b.minuteStartMs).slice(-30);
}

function heavyweightSeries(registry: CanonicalConstituentTokenEntry[], minutes: KiteConstituentMinuteRecord[]): HawkEyeLiveSeries[] {
  const unique = new Map<number, CanonicalConstituentTokenEntry>();
  for (const row of registry ?? []) {
    if (row.role !== "HEAVYWEIGHT" || !Number.isInteger(row.instrumentToken) || row.instrumentToken <= 0) continue;
    if (!unique.has(row.instrumentToken)) unique.set(row.instrumentToken, row);
  }
  return [...unique.values()].map((row) => ({
    family: "HEAVYWEIGHTS" as const,
    entity: entity(row.tradingsymbol),
    points: minutes.flatMap((minute) => {
      const tick = minute.ticks.find((x) => x.instrumentToken === row.instrumentToken);
      return tick && finitePositive(tick.ltp) && finitePositive(tick.exchangeTimestampMs)
        ? [{ observedAtMs: tick.exchangeTimestampMs, price: tick.ltp }]
        : [];
    }),
  })).filter((series) => series.points.length > 0);
}

function sectorSeries(registry: CanonicalConstituentTokenEntry[], minutes: KiteConstituentMinuteRecord[]): { series: HawkEyeLiveSeries[]; skipped: string[] } {
  const groups = new Map<string, CanonicalConstituentTokenEntry[]>();
  for (const row of registry ?? []) {
    if (row.role !== "SECTOR_CONSTITUENT" || !row.sector?.trim()) continue;
    const key = entity(row.sector);
    const group = groups.get(key) ?? [];
    if (!group.some((x) => x.instrumentToken === row.instrumentToken)) group.push(row);
    groups.set(key, group);
  }

  const series: HawkEyeLiveSeries[] = [];
  const skipped: string[] = [];
  for (const [sector, rows] of groups) {
    if (!rows.length || rows.some((row) => !finitePositive(row.weight))) {
      skipped.push(`${sector}:EXACT_WEIGHTS_REQUIRED`);
      continue;
    }
    const totalWeight = rows.reduce((sum, row) => sum + (row.weight ?? 0), 0);
    if (!finitePositive(totalWeight)) {
      skipped.push(`${sector}:WEIGHT_SUM_INVALID`);
      continue;
    }

    const baseByToken = new Map<number, number>();
    const points: Array<{ observedAtMs: number; price: number }> = [];
    for (const minute of minutes) {
      const ticks = rows.map((row) => minute.ticks.find((tick) => tick.instrumentToken === row.instrumentToken));
      if (ticks.some((tick) => !tick || !finitePositive(tick.ltp) || !finitePositive(tick.exchangeTimestampMs))) continue;
      const exactTicks = ticks as NonNullable<(typeof ticks)[number]>[];
      if (baseByToken.size === 0) {
        for (let i = 0; i < rows.length; i++) baseByToken.set(rows[i].instrumentToken, exactTicks[i].ltp);
      }
      if (rows.some((row) => !finitePositive(baseByToken.get(row.instrumentToken)))) continue;
      const level = rows.reduce((sum, row, i) => {
        const base = baseByToken.get(row.instrumentToken)!;
        return sum + ((row.weight ?? 0) / totalWeight) * (exactTicks[i].ltp / base) * 100;
      }, 0);
      const observedAtMs = Math.min(...exactTicks.map((tick) => tick.exchangeTimestampMs));
      if (finitePositive(level) && finitePositive(observedAtMs)) points.push({ observedAtMs, price: level });
    }
    if (points.length) {
      series.push({ family: "SECTORS", entity: `${sector}_REGISTERED_WEIGHTED_BASKET`, points });
    } else {
      skipped.push(`${sector}:NO_COMPLETE_CLOSED_MINUTES`);
    }
  }
  return { series, skipped };
}

function sisterSeries(snapshots: HawkEyeSevenIndexSnapshot[], asOfMs: number): HawkEyeLiveSeries[] {
  const groups = new Map<string, Array<{ observedAtMs: number; price: number }>>();
  for (const snapshot of snapshots ?? []) {
    if (!finitePositive(snapshot?.observedAtMs) || snapshot.observedAtMs > asOfMs) continue;
    for (const row of snapshot.rows ?? []) {
      if (!row?.indexId || !finitePositive(row.ltp)) continue;
      const key = entity(row.indexId);
      const points = groups.get(key) ?? [];
      points.push({ observedAtMs: Math.trunc(snapshot.observedAtMs), price: row.ltp });
      groups.set(key, points);
    }
  }
  return [...groups.entries()].map(([name, points]) => ({ family: "SISTERS" as const, entity: name, points }));
}

/**
 * Converts already-existing closed constituent minutes plus optional already-fetched
 * canonical seven-index snapshots into Hawk Eye raw observations. No socket, fetch,
 * candidate, Telegram or execution side effect is permitted here.
 */
export function buildHawkEyeRuntimeShadowV1(input: HawkEyeRuntimeShadowInput): HawkEyeRuntimeShadowReport {
  if (!finitePositive(input?.asOfMs)) throw new Error("HAWK_EYE_RUNTIME_INVALID_AS_OF");
  const minutes = closedMinutes(input.constituentMinutes ?? [], input.asOfMs);
  const sisters = sisterSeries(input.sevenIndexSnapshots ?? [], input.asOfMs);
  const heavyweights = heavyweightSeries(input.registry ?? [], minutes);
  const sectors = sectorSeries(input.registry ?? [], minutes);
  const all = [...sisters, ...heavyweights, ...sectors.series];
  const observation = buildHawkEyeLiveObservationReport(all, input.asOfMs, {
    maxLatestAgeMs: input.maxLatestAgeMs ?? 120_000,
  });
  return {
    version: "HAWK_EYE_RUNTIME_SHADOW_V1",
    mode: "SHADOW_OBSERVATION_ONLY",
    opensSocket: false,
    fetchesNetworkData: false,
    affectsSelector: false,
    affectsExecution: false,
    affectsTelegram: false,
    createsOrders: false,
    inputClosedMinuteCount: minutes.length,
    seriesCount: all.length,
    sisterSeriesCount: sisters.length,
    heavyweightSeriesCount: heavyweights.length,
    sectorSeriesCount: sectors.series.length,
    skippedSectorBaskets: sectors.skipped,
    observation,
  };
}
