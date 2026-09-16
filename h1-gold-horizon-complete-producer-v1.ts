import {
  CANONICAL_ONE_ROOF_MARKET_SNAPSHOT_V2,
  buildCanonicalOneRoofMarketSnapshot,
  type CanonicalOneRoofMarketSnapshot,
} from "./canonical-one-roof-market-snapshot.js";
import { dbQuerySafe } from "./db.js";
import {
  H1_GOLD_HORIZON_CAPTURE_LOG_KIND,
  H1_GOLD_HORIZON_CLOSED_BLOCK_CAPTURE_V1,
  type H1GoldClosedHorizonCaptureEvent,
} from "./h1-gold-horizon-closed-block-capture-v1.js";
import {
  expectedH1GoldClosedBoundaryMs,
  isH1GoldHorizon,
  validateH1GoldHorizonProvenance,
  type H1GoldHorizonCapturedWindow,
  type H1GoldHorizonSymbol,
} from "./h1-gold-horizon-provenance-contract-v1.js";
import type { H1GoldExactFamilySignal } from "./h1-gold-evidence-adapter-v1.js";

export const H1_GOLD_HORIZON_COMPLETE_PRODUCER_V1 = "H1_GOLD_HORIZON_COMPLETE_PRODUCER_V1" as const;
export const H1_GOLD_HORIZON_COMPLETE_SOURCE = "H1_GOLD_IMMUTABLE_HORIZON_COMPLETE_V1" as const;

export interface H1GoldHorizonCompleteInput {
  symbol: H1GoldHorizonSymbol;
  observedAt: string;
  canonicalSnapshot: CanonicalOneRoofMarketSnapshot;
  windows: H1GoldHorizonCapturedWindow[];
  captureStoreBlockers?: string[];
}

export interface H1GoldHorizonCompleteResult {
  version: typeof H1_GOLD_HORIZON_COMPLETE_PRODUCER_V1;
  ready: boolean;
  state: "PASS" | "MISSING";
  symbol: H1GoldHorizonSymbol;
  observedAt: string;
  validatedHorizons: string[];
  signal: H1GoldExactFamilySignal;
  blockers: string[];
  productionImpact: "NONE";
  affectsSelector: false;
  affectsTelegram: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  createsOrders: false;
  calculatesThresholds: false;
  usesFutureOutcome: false;
  readsMutableTimeframeStateDirectly: false;
  failClosed: true;
  semantics: "CANONICAL_T0_BOUND_IMMUTABLE_PREEXISTING_3M_6M_15M_30M_CLOSED_HORIZON_COMPLETENESS_NO_THRESHOLD_NO_FUTURE_OUTCOME";
}

export interface H1GoldHorizonCaptureStoreLoadResult {
  windows: H1GoldHorizonCapturedWindow[];
  blockers: string[];
}

type AppStateCaptureRow = {
  payload: unknown;
  created_at: string | Date;
};

type QueryFn = <T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
) => Promise<{ rows: T[] } | null>;

const SEMANTICS = "CANONICAL_T0_BOUND_IMMUTABLE_PREEXISTING_3M_6M_15M_30M_CLOSED_HORIZON_COMPLETENESS_NO_THRESHOLD_NO_FUTURE_OUTCOME" as const;

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function validIso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validateCanonical(input: H1GoldHorizonCompleteInput): string[] {
  const reasons: string[] = [];
  const snapshot = input?.canonicalSnapshot;
  const observedAtMs = validIso(input?.observedAt) ? Date.parse(input.observedAt) : Number.NaN;
  if (!snapshot) return ["MISSING_CANONICAL_SNAPSHOT"];
  if (snapshot.version !== CANONICAL_ONE_ROOF_MARKET_SNAPSHOT_V2) reasons.push("INVALID_CANONICAL_SNAPSHOT_VERSION");
  if (!snapshot.snapshotId?.trim()) reasons.push("MISSING_CANONICAL_SNAPSHOT_ID");
  if (snapshot.symbol !== input.symbol) reasons.push("CANONICAL_SYMBOL_MISMATCH");
  if (!Number.isFinite(observedAtMs)) reasons.push("INVALID_CANDIDATE_TIMESTAMP");
  if (!Number.isFinite(snapshot.asOfMs) || snapshot.asOfMs !== observedAtMs) reasons.push("CANONICAL_DECISION_TIMESTAMP_MISMATCH");

  const rebuilt = buildCanonicalOneRoofMarketSnapshot({
    snapshotId: snapshot.snapshotId,
    symbol: snapshot.symbol,
    asOfMs: snapshot.asOfMs,
    minuteClosed: snapshot.minuteClosed,
    connectionId: snapshot.connectionId,
    instrumentMasterVersion: snapshot.instrumentMasterVersion,
    components: snapshot.components,
    freshnessBudgetsMs: snapshot.freshnessBudgetsMs,
    ingestTelemetry: snapshot.ingestTelemetry,
  });
  if (!rebuilt.readyForStrictFiltering) reasons.push("CANONICAL_NOT_READY_FOR_STRICT_FILTERING");
  if (rebuilt.qualityState !== "VERIFIED") reasons.push("CANONICAL_QUALITY_NOT_VERIFIED");
  if (rebuilt.newEntryGate !== "ALLOW_NEW_ENTRIES") reasons.push("CANONICAL_NEW_ENTRY_GATE_BLOCKED");
  if (rebuilt.internalBlockers.length > 0) reasons.push("CANONICAL_INTERNAL_BLOCKERS_PRESENT");
  return unique(reasons);
}

function signal(
  state: "PASS" | "MISSING",
  snapshotId: string,
  observedAt: string,
  reasons: string[],
): H1GoldExactFamilySignal {
  return {
    state,
    source: H1_GOLD_HORIZON_COMPLETE_SOURCE,
    snapshotId,
    observedAt,
    provenance: "LIVE_RUNTIME_EXACT",
    reasonCodes: unique(reasons),
  };
}

function isCaptureEvent(value: unknown): value is H1GoldClosedHorizonCaptureEvent {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<H1GoldClosedHorizonCaptureEvent>;
  return row.version === H1_GOLD_HORIZON_CLOSED_BLOCK_CAPTURE_V1
    && row.kind === H1_GOLD_HORIZON_CAPTURE_LOG_KIND
    && typeof row.captureId === "string" && row.captureId.trim().length > 0
    && isH1GoldHorizon(row.horizon)
    && (row.symbol === "NIFTY" || row.symbol === "SENSEX")
    && row.immutable === true
    && row.productionImpact === "NONE"
    && row.affectsSelector === false
    && row.affectsTelegram === false
    && row.affectsExecution === false
    && row.grantsPromotionAuthority === false
    && row.createsOrders === false
    && row.failClosed === true
    && row.captureSemantics === "APPEND_ONLY_FORMAL_BLOCK_CLOSE_EVENT_NO_GOLD_AUTHORITY";
}

function eventToWindow(event: H1GoldClosedHorizonCaptureEvent, persistedAt: string): H1GoldHorizonCapturedWindow {
  return {
    horizon: event.horizon,
    symbol: event.symbol,
    blockStart: event.blockStart,
    blockEnd: event.blockEnd,
    capturedAt: event.capturedAt,
    persistedAt,
    dataQuality: event.dataQuality,
    stateCode: event.stateCode,
    source: event.source,
    semantics: event.semantics,
    ruleVersion: event.ruleVersion,
    sampleCount: event.sampleCount,
    expected1mCount: event.expected1mCount,
    immutable: event.immutable,
    immutableCaptureId: event.captureId,
  };
}

/**
 * Loads only append-only close events already persisted by decision T0.
 * The mutable timeframe_state table is deliberately not queried here.
 */
export async function loadH1GoldHorizonCaptureStore(
  symbol: H1GoldHorizonSymbol,
  observedAt: string,
  query: QueryFn = dbQuerySafe,
): Promise<H1GoldHorizonCaptureStoreLoadResult> {
  if ((symbol !== "NIFTY" && symbol !== "SENSEX") || !validIso(observedAt)) {
    return { windows: [], blockers: ["INVALID_CAPTURE_STORE_REQUEST"] };
  }

  const result = await query<AppStateCaptureRow>(`
    SELECT payload, created_at
    FROM app_state_log
    WHERE kind = $1
      AND payload->>'symbol' = $2
      AND created_at <= $3::timestamptz
    ORDER BY created_at ASC
  `, [H1_GOLD_HORIZON_CAPTURE_LOG_KIND, symbol, observedAt]);
  if (!result) return { windows: [], blockers: ["HORIZON_CAPTURE_STORE_UNAVAILABLE"] };

  const observedAtMs = Date.parse(observedAt);
  const blockers: string[] = [];
  const exactBoundaryRows: Array<{ event: H1GoldClosedHorizonCaptureEvent; persistedAt: string; serialized: string }> = [];

  for (const row of result.rows) {
    if (!isCaptureEvent(row?.payload)) {
      blockers.push("MALFORMED_HORIZON_CAPTURE_EVENT");
      continue;
    }
    const event = row.payload;
    if (event.symbol !== symbol) {
      blockers.push(`${event.horizon}:CAPTURE_STORE_SYMBOL_MISMATCH`);
      continue;
    }
    const persistedAt = new Date(row.created_at).toISOString();
    if (!validIso(persistedAt) || Date.parse(persistedAt) > observedAtMs) {
      blockers.push(`${event.horizon}:CAPTURE_STORE_ROW_AFTER_T0`);
      continue;
    }
    const expectedBoundary = expectedH1GoldClosedBoundaryMs(observedAtMs, event.horizon);
    if (expectedBoundary == null || Date.parse(event.blockEnd) !== expectedBoundary) continue;
    exactBoundaryRows.push({ event, persistedAt, serialized: JSON.stringify(event) });
  }

  const byCaptureId = new Map<string, Array<{ event: H1GoldClosedHorizonCaptureEvent; persistedAt: string; serialized: string }>>();
  for (const row of exactBoundaryRows) {
    const list = byCaptureId.get(row.event.captureId) ?? [];
    list.push(row);
    byCaptureId.set(row.event.captureId, list);
  }

  const windows: H1GoldHorizonCapturedWindow[] = [];
  for (const [captureId, rows] of byCaptureId) {
    const payloads = new Set(rows.map((row) => row.serialized));
    if (payloads.size > 1) {
      blockers.push(`DIVERGENT_DUPLICATE_CAPTURE_ID:${captureId}`);
      for (const row of rows) windows.push(eventToWindow(row.event, row.persistedAt));
      continue;
    }
    const earliest = [...rows].sort((a, b) => Date.parse(a.persistedAt) - Date.parse(b.persistedAt))[0];
    windows.push(eventToWindow(earliest.event, earliest.persistedAt));
  }

  return { windows, blockers: unique(blockers) };
}

export function buildH1GoldHorizonComplete(
  input: H1GoldHorizonCompleteInput,
): H1GoldHorizonCompleteResult {
  const observedAt = validIso(input?.observedAt) ? input.observedAt : new Date(0).toISOString();
  const snapshotId = input?.canonicalSnapshot?.snapshotId?.trim() || "MISSING_CANONICAL_SNAPSHOT";
  const canonicalBlockers = validateCanonical(input);
  const captureStoreBlockers = Array.isArray(input?.captureStoreBlockers) ? input.captureStoreBlockers : [];
  const provenance = validateH1GoldHorizonProvenance({
    symbol: input?.symbol,
    observedAt,
    snapshotId,
    windows: Array.isArray(input?.windows) ? input.windows : [],
  });
  const blockers = unique([...canonicalBlockers, ...captureStoreBlockers, ...provenance.blockers]);
  const pass = blockers.length === 0 && provenance.readyForExactProducer;
  const reasons = pass
    ? ["IMMUTABLE_3M_6M_15M_30M_HORIZONS_PREEXISTED_CANONICAL_DECISION_T0"]
    : blockers;

  return {
    version: H1_GOLD_HORIZON_COMPLETE_PRODUCER_V1,
    ready: pass,
    state: pass ? "PASS" : "MISSING",
    symbol: input?.symbol === "SENSEX" ? "SENSEX" : "NIFTY",
    observedAt,
    validatedHorizons: provenance.validatedHorizons,
    signal: signal(pass ? "PASS" : "MISSING", snapshotId, observedAt, reasons),
    blockers: pass ? [] : blockers,
    productionImpact: "NONE",
    affectsSelector: false,
    affectsTelegram: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    createsOrders: false,
    calculatesThresholds: false,
    usesFutureOutcome: false,
    readsMutableTimeframeStateDirectly: false,
    failClosed: true,
    semantics: SEMANTICS,
  };
}

export async function loadAndBuildH1GoldHorizonComplete(
  input: Omit<H1GoldHorizonCompleteInput, "windows" | "captureStoreBlockers">,
  query: QueryFn = dbQuerySafe,
): Promise<H1GoldHorizonCompleteResult> {
  const loaded = await loadH1GoldHorizonCaptureStore(input.symbol, input.observedAt, query);
  return buildH1GoldHorizonComplete({ ...input, windows: loaded.windows, captureStoreBlockers: loaded.blockers });
}
