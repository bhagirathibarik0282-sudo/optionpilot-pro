export const CANONICAL_ONE_ROOF_MARKET_SNAPSHOT_V2 = "CANONICAL_ONE_ROOF_MARKET_SNAPSHOT_V2" as const;

export type CanonicalMarketSymbol = "NIFTY" | "SENSEX" | "BANKNIFTY";

export type CanonicalMarketFamily =
  | "MARKET_STRUCTURE"
  | "FUTURES_CONFIRMATION"
  | "OPTION_PREMIUMS"
  | "OI_POSITIONING"
  | "MULTI_DTE"
  | "VOLATILITY"
  | "HEAVYWEIGHTS"
  | "SECTOR_BREADTH"
  | "RESPONSE_LADDER"
  | "LIQUIDITY_EXECUTABILITY";

export type CanonicalComponentStatus = "VERIFIED" | "PENDING" | "BLOCKED";
export type CanonicalProvenance = "KITE_WS" | "KITE_INSTRUMENT_MASTER" | "LOCAL_DERIVED";
export type CanonicalQualityState = "VERIFIED" | "SHADOW_UNCALIBRATED" | "BLOCKED";

export interface CanonicalSourceTimeRange {
  fromMs: number;
  toMs: number;
}

export interface CanonicalMarketComponent<T = unknown> {
  family: CanonicalMarketFamily;
  status: CanonicalComponentStatus;
  exchangeTimestampMs: number;
  receivedAtMs: number;
  processedAtMs: number;
  ingestSeq: number;
  provenance: CanonicalProvenance;
  source: string;
  sourceTimeRange?: CanonicalSourceTimeRange;
  payload: T;
  devilFlags?: string[];
}

export interface CanonicalIngestTelemetry {
  queueDepth: number;
  queueLagMs: number;
  droppedPacketCount: number;
  backpressureActive: boolean;
}

export interface CanonicalOneRoofMarketSnapshotInput {
  snapshotId: string;
  symbol: CanonicalMarketSymbol;
  asOfMs: number;
  minuteClosed: boolean;
  connectionId: string;
  instrumentMasterVersion: string;
  components: CanonicalMarketComponent[];
  freshnessBudgetsMs: Partial<Record<CanonicalMarketFamily, number>>;
  ingestTelemetry: CanonicalIngestTelemetry;
}

export interface CanonicalOneRoofMarketSnapshot {
  version: typeof CANONICAL_ONE_ROOF_MARKET_SNAPSHOT_V2;
  snapshotId: string;
  symbol: CanonicalMarketSymbol;
  asOfMs: number;
  connectionId: string;
  instrumentMasterVersion: string;
  minuteClosed: boolean;
  immutableRecord: boolean;
  recordable: boolean;
  readyForStrictFiltering: boolean;
  qualityState: CanonicalQualityState;
  userFacingState: "READY_FOR_BUYER_SELLER_FILTER" | "WAIT_FOR_CONFIRMATION" | "SHADOW_UNCALIBRATED";
  newEntryGate: "ALLOW_NEW_ENTRIES" | "BLOCK_NEW_ENTRIES";
  components: CanonicalMarketComponent[];
  freshnessBudgetsMs: Partial<Record<CanonicalMarketFamily, number>>;
  ingestTelemetry: CanonicalIngestTelemetry;
  internalBlockers: string[];
  failClosed: true;
  createsOrders: false;
  affectsExecution: false;
  aiMayOverride: false;
}

const REQUIRED_FAMILIES: CanonicalMarketFamily[] = [
  "MARKET_STRUCTURE",
  "FUTURES_CONFIRMATION",
  "OPTION_PREMIUMS",
  "OI_POSITIONING",
  "MULTI_DTE",
  "VOLATILITY",
  "HEAVYWEIGHTS",
  "SECTOR_BREADTH",
  "RESPONSE_LADDER",
  "LIQUIDITY_EXECUTABILITY",
];

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * V2 one-roof envelope only. It records every received Kite-WebSocket-derived truth under
 * one canonical identity and never calculates direction, ranks candidates, sends Telegram,
 * creates orders, or grants AI/quantum authority.
 *
 * Recordability is intentionally separate from strict-filter readiness so raw/closed-minute
 * evidence is not erased when freshness, provenance, breadth or backpressure gates fail.
 */
export function buildCanonicalOneRoofMarketSnapshot(
  input: CanonicalOneRoofMarketSnapshotInput,
): CanonicalOneRoofMarketSnapshot {
  const blockers: string[] = [];
  const snapshotId = typeof input?.snapshotId === "string" ? input.snapshotId.trim() : "";
  const connectionId = typeof input?.connectionId === "string" ? input.connectionId.trim() : "";
  const instrumentMasterVersion = typeof input?.instrumentMasterVersion === "string"
    ? input.instrumentMasterVersion.trim()
    : "";
  const validAsOf = isPositiveFinite(input?.asOfMs);

  if (!snapshotId) blockers.push("SNAPSHOT_ID_REQUIRED");
  if (!validAsOf) blockers.push("INVALID_SNAPSHOT_TIMESTAMP");
  if (!connectionId) blockers.push("CONNECTION_ID_REQUIRED");
  if (!instrumentMasterVersion) blockers.push("INSTRUMENT_MASTER_VERSION_REQUIRED");
  if (!Array.isArray(input?.components)) blockers.push("COMPONENT_ARRAY_REQUIRED");

  const telemetry = input?.ingestTelemetry;
  const validTelemetry = Boolean(
    telemetry
      && isNonNegativeFinite(telemetry.queueDepth)
      && isNonNegativeFinite(telemetry.queueLagMs)
      && isNonNegativeFinite(telemetry.droppedPacketCount)
      && typeof telemetry.backpressureActive === "boolean",
  );
  if (!validTelemetry) {
    blockers.push("INGEST_TELEMETRY_INVALID");
  } else {
    if (telemetry.backpressureActive) blockers.push("INGEST_BACKPRESSURE_ACTIVE");
    if (telemetry.droppedPacketCount > 0) blockers.push("INGEST_PACKETS_DROPPED");
  }

  const components = Array.isArray(input?.components) ? input.components : [];
  const freshnessBudgets = input?.freshnessBudgetsMs ?? {};
  let freshnessUncalibrated = false;

  for (const family of REQUIRED_FAMILIES) {
    const budgetMs = freshnessBudgets[family];
    if (!isPositiveFinite(budgetMs)) {
      freshnessUncalibrated = true;
      blockers.push(`${family}:FRESHNESS_UNCALIBRATED`);
    }

    const rows = components.filter((component) => component?.family === family);
    if (rows.length !== 1) {
      blockers.push(`${family}:${rows.length === 0 ? "MISSING" : "DUPLICATE"}`);
      continue;
    }

    const component = rows[0];
    if (component.status !== "VERIFIED") blockers.push(`${family}:NOT_VERIFIED`);
    if (typeof component.source !== "string" || !component.source.trim()) blockers.push(`${family}:SOURCE_REQUIRED`);
    if (!["KITE_WS", "KITE_INSTRUMENT_MASTER", "LOCAL_DERIVED"].includes(component.provenance)) {
      blockers.push(`${family}:INVALID_PROVENANCE`);
    }

    if (!isPositiveFinite(component.exchangeTimestampMs)) blockers.push(`${family}:INVALID_EXCHANGE_TIMESTAMP`);
    if (!isPositiveFinite(component.receivedAtMs)) blockers.push(`${family}:INVALID_RECEIVED_AT`);
    if (!isPositiveFinite(component.processedAtMs)) blockers.push(`${family}:INVALID_PROCESSED_AT`);
    if (!Number.isInteger(component.ingestSeq) || component.ingestSeq <= 0) blockers.push(`${family}:INVALID_INGEST_SEQ`);

    if (
      isPositiveFinite(component.receivedAtMs)
      && isPositiveFinite(component.processedAtMs)
      && component.processedAtMs < component.receivedAtMs
    ) {
      blockers.push(`${family}:PROCESSING_TIME_REVERSED`);
    }

    if (component.sourceTimeRange) {
      const { fromMs, toMs } = component.sourceTimeRange;
      if (!isPositiveFinite(fromMs) || !isPositiveFinite(toMs) || fromMs > toMs) {
        blockers.push(`${family}:INVALID_SOURCE_TIME_RANGE`);
      }
    }

    if (isPositiveFinite(component.exchangeTimestampMs) && validAsOf && isPositiveFinite(budgetMs)) {
      const ageMs = input.asOfMs - component.exchangeTimestampMs;
      if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > budgetMs) {
        blockers.push(`${family}:OUTSIDE_FRESHNESS_BUDGET`);
      }
    }

    if ((component.devilFlags ?? []).length > 0) blockers.push(`${family}:DEVIL_CHECK_BLOCKED`);
  }

  const unsupported = components.filter((component) => !REQUIRED_FAMILIES.includes(component.family));
  if (unsupported.length > 0) blockers.push("UNSUPPORTED_COMPONENT_FAMILY");

  const uniqueBlockers = uniq(blockers);
  const recordable = Boolean(snapshotId && validAsOf);
  const readyForStrictFiltering = recordable && uniqueBlockers.length === 0;
  const qualityState: CanonicalQualityState = freshnessUncalibrated
    ? "SHADOW_UNCALIBRATED"
    : readyForStrictFiltering
      ? "VERIFIED"
      : "BLOCKED";

  const userFacingState = qualityState === "SHADOW_UNCALIBRATED"
    ? "SHADOW_UNCALIBRATED" as const
    : readyForStrictFiltering
      ? "READY_FOR_BUYER_SELLER_FILTER" as const
      : "WAIT_FOR_CONFIRMATION" as const;

  return {
    version: CANONICAL_ONE_ROOF_MARKET_SNAPSHOT_V2,
    snapshotId,
    symbol: input.symbol,
    asOfMs: input.asOfMs,
    connectionId,
    instrumentMasterVersion,
    minuteClosed: input.minuteClosed === true,
    immutableRecord: input.minuteClosed === true && recordable,
    recordable,
    readyForStrictFiltering,
    qualityState,
    userFacingState,
    newEntryGate: readyForStrictFiltering ? "ALLOW_NEW_ENTRIES" : "BLOCK_NEW_ENTRIES",
    components,
    freshnessBudgetsMs: freshnessBudgets,
    ingestTelemetry: telemetry,
    internalBlockers: uniqueBlockers,
    failClosed: true,
    createsOrders: false,
    affectsExecution: false,
    aiMayOverride: false,
  };
}
