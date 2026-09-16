export const H1_GOLD_HORIZON_PROVENANCE_CONTRACT_V1 = "H1_GOLD_HORIZON_PROVENANCE_CONTRACT_V1" as const;

export type H1GoldHorizon = "3M" | "6M" | "15M" | "30M";
export type H1GoldHorizonSymbol = "NIFTY" | "SENSEX";

export interface H1GoldHorizonCapturedWindow {
  horizon: H1GoldHorizon;
  symbol: H1GoldHorizonSymbol;
  blockStart: string;
  blockEnd: string;
  capturedAt: string;
  dataQuality: "COMPLETE_1M" | "PARTIAL_SAMPLING" | string;
  stateCode: string;
  source: string;
  semantics: string;
  ruleVersion: string;
  sampleCount: number;
  expected1mCount: number;
  immutable: boolean;
  immutableCaptureId: string | null;
}

export interface H1GoldHorizonProvenanceInput {
  symbol: H1GoldHorizonSymbol;
  observedAt: string;
  snapshotId: string;
  windows: H1GoldHorizonCapturedWindow[];
}

export interface H1GoldHorizonProvenanceResult {
  version: typeof H1_GOLD_HORIZON_PROVENANCE_CONTRACT_V1;
  state: "STRUCTURALLY_VALID" | "BLOCKED";
  readyForExactProducer: boolean;
  symbol: H1GoldHorizonSymbol;
  observedAt: string;
  snapshotId: string;
  requiredHorizons: readonly H1GoldHorizon[];
  validatedHorizons: H1GoldHorizon[];
  blockers: string[];
  directMutableTimeframeStateEligible: false;
  productionImpact: "NONE";
  affectsSelector: false;
  affectsTelegram: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  createsOrders: false;
  registersGoldFamily: false;
  failClosed: true;
  semantics: "IMMUTABLE_FORWARD_ONLY_PRE_T0_CLOSED_HORIZON_PROVENANCE_CONTRACT_NO_GOLD_AUTHORITY";
}

const REQUIRED_HORIZONS = ["3M", "6M", "15M", "30M"] as const;
const SEMANTICS = "IMMUTABLE_FORWARD_ONLY_PRE_T0_CLOSED_HORIZON_PROVENANCE_CONTRACT_NO_GOLD_AUTHORITY" as const;
const SOURCE = "market_snapshot_1m";
const ARCHIVE_SEMANTICS = "RAW_BLOCK_ARCHIVE_ONLY";
const STATE_CODE = "RAW_BLOCK_ARCHIVE_ONLY";
const RULE_VERSION = "STORAGE_V3_TF_PHASE1";

function validIso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function tfMinutes(horizon: H1GoldHorizon): number {
  return Number.parseInt(horizon, 10);
}

function marketOpenUtcMsFor(timestampMs: number): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestampMs));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), 3, 45, 0, 0);
}

function latestClosedBoundaryMs(observedAtMs: number, horizon: H1GoldHorizon): number | null {
  const openMs = marketOpenUtcMsFor(observedAtMs);
  const tfMs = tfMinutes(horizon) * 60_000;
  const elapsed = observedAtMs - openMs;
  if (!Number.isFinite(elapsed) || elapsed < tfMs) return null;
  return openMs + Math.floor(elapsed / tfMs) * tfMs;
}

function validateWindow(
  input: H1GoldHorizonProvenanceInput,
  row: H1GoldHorizonCapturedWindow,
  observedAtMs: number,
): string[] {
  const reasons: string[] = [];
  const prefix = row?.horizon || "UNKNOWN";
  if (!REQUIRED_HORIZONS.includes(row?.horizon)) return [`${prefix}:UNSUPPORTED_HORIZON`];
  if (row.symbol !== input.symbol) reasons.push(`${prefix}:SYMBOL_MISMATCH`);
  if (!validIso(row.blockStart) || !validIso(row.blockEnd) || !validIso(row.capturedAt)) {
    reasons.push(`${prefix}:INVALID_TIMESTAMP`);
    return reasons;
  }

  const startMs = Date.parse(row.blockStart);
  const endMs = Date.parse(row.blockEnd);
  const capturedAtMs = Date.parse(row.capturedAt);
  const tfMs = tfMinutes(row.horizon) * 60_000;
  const latestClosed = latestClosedBoundaryMs(observedAtMs, row.horizon);

  if (endMs > observedAtMs) reasons.push(`${prefix}:FUTURE_BLOCK_END`);
  if (capturedAtMs > observedAtMs) reasons.push(`${prefix}:CAPTURE_AFTER_DECISION_T0`);
  if (capturedAtMs !== observedAtMs) reasons.push(`${prefix}:NOT_EXACT_DECISION_CAPTURE`);
  if (endMs - startMs !== tfMs) reasons.push(`${prefix}:BLOCK_DURATION_MISMATCH`);
  if (latestClosed == null) reasons.push(`${prefix}:HORIZON_NOT_YET_CLOSABLE_AT_T0`);
  else if (endMs !== latestClosed) reasons.push(`${prefix}:LATEST_CLOSED_BOUNDARY_MISMATCH`);

  const expected = tfMinutes(row.horizon);
  if (row.dataQuality !== "COMPLETE_1M") reasons.push(`${prefix}:DATA_QUALITY_NOT_COMPLETE_1M`);
  if (!Number.isInteger(row.sampleCount) || row.sampleCount !== expected) reasons.push(`${prefix}:SAMPLE_COUNT_NOT_EXACT`);
  if (!Number.isInteger(row.expected1mCount) || row.expected1mCount !== expected) reasons.push(`${prefix}:EXPECTED_COUNT_MISMATCH`);
  if (row.stateCode !== STATE_CODE) reasons.push(`${prefix}:INVALID_STATE_CODE`);
  if (row.source !== SOURCE) reasons.push(`${prefix}:INVALID_SOURCE`);
  if (row.semantics !== ARCHIVE_SEMANTICS) reasons.push(`${prefix}:INVALID_ARCHIVE_SEMANTICS`);
  if (row.ruleVersion !== RULE_VERSION) reasons.push(`${prefix}:INVALID_RULE_VERSION`);
  if (row.immutable !== true) reasons.push(`${prefix}:MUTABLE_SOURCE_NOT_ALLOWED`);
  if (!row.immutableCaptureId?.trim()) reasons.push(`${prefix}:IMMUTABLE_CAPTURE_ID_REQUIRED`);

  return reasons;
}

/**
 * Pure, fail-closed contract for a future exact horizonComplete producer.
 *
 * IMPORTANT: this does not read timeframe_state, emit a Gold family signal,
 * register a source, or grant any production authority. Existing timeframe_state
 * rows are mutable through ON CONFLICT updates and therefore cannot satisfy the
 * immutable provenance requirement by themselves. Only a forward-only capture
 * made at the exact canonical decision T0 may become structurally valid here.
 */
export function validateH1GoldHorizonProvenance(
  input: H1GoldHorizonProvenanceInput,
): H1GoldHorizonProvenanceResult {
  const blockers: string[] = [];
  const validatedHorizons: H1GoldHorizon[] = [];
  const observedAtMs = validIso(input?.observedAt) ? Date.parse(input.observedAt) : Number.NaN;
  const symbol = input?.symbol === "SENSEX" ? "SENSEX" : "NIFTY";
  const observedAt = validIso(input?.observedAt) ? input.observedAt : new Date(0).toISOString();
  const snapshotId = input?.snapshotId?.trim() || "MISSING_SNAPSHOT_ID";

  if (input?.symbol !== "NIFTY" && input?.symbol !== "SENSEX") blockers.push("INVALID_GOLD_TARGET_SYMBOL");
  if (!Number.isFinite(observedAtMs)) blockers.push("INVALID_DECISION_TIMESTAMP");
  if (!input?.snapshotId?.trim()) blockers.push("MISSING_SNAPSHOT_ID");

  const rows = Array.isArray(input?.windows) ? input.windows : [];
  for (const horizon of REQUIRED_HORIZONS) {
    const matches = rows.filter((row) => row?.horizon === horizon);
    if (matches.length === 0) {
      blockers.push(`${horizon}:MISSING_REQUIRED_HORIZON`);
      continue;
    }
    if (matches.length > 1) {
      blockers.push(`${horizon}:DUPLICATE_REQUIRED_HORIZON`);
      continue;
    }
    if (!Number.isFinite(observedAtMs)) continue;
    const rowBlockers = validateWindow(input, matches[0], observedAtMs);
    if (rowBlockers.length > 0) blockers.push(...rowBlockers);
    else validatedHorizons.push(horizon);
  }

  for (const row of rows) {
    if (!REQUIRED_HORIZONS.includes(row?.horizon)) blockers.push(`${row?.horizon || "UNKNOWN"}:UNEXPECTED_HORIZON`);
  }
  if (rows.length !== REQUIRED_HORIZONS.length) blockers.push("EXACT_REQUIRED_HORIZON_SET_NOT_SATISFIED");

  const finalBlockers = unique(blockers);
  const valid = finalBlockers.length === 0 && validatedHorizons.length === REQUIRED_HORIZONS.length;
  return {
    version: H1_GOLD_HORIZON_PROVENANCE_CONTRACT_V1,
    state: valid ? "STRUCTURALLY_VALID" : "BLOCKED",
    readyForExactProducer: valid,
    symbol,
    observedAt,
    snapshotId,
    requiredHorizons: REQUIRED_HORIZONS,
    validatedHorizons,
    blockers: finalBlockers,
    directMutableTimeframeStateEligible: false,
    productionImpact: "NONE",
    affectsSelector: false,
    affectsTelegram: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    createsOrders: false,
    registersGoldFamily: false,
    failClosed: true,
    semantics: SEMANTICS,
  };
}
