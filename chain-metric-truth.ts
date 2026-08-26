import { createHash } from "node:crypto";
import { dbQuerySafe } from "./db.js";

export type ChainMetricName =
  | "ATM_STRADDLE"
  | "BAND7_OI_PCR"
  | "BAND7_VOLUME_PCR"
  | "FULL_CHAIN_OI_PCR"
  | "FULL_CHAIN_VOLUME_PCR"
  | "CALL_WALL"
  | "PUT_WALL"
  | "MAX_PAIN";

export type ChainMetricTruthState = "VALID" | "PARTIAL" | "BLOCKED" | "UNKNOWN";
export type ChainMetricUsability = "USABLE" | "CONTEXT_ONLY" | "BLOCKED";

export interface Phase46UniverseMetadata {
  provenance: "KITE_LIVE_INSTRUMENT_MASTER_OPTION_MAP";
  quoteReceivedAt: string;
  expectedContractCount: number;
  expectedCeCount: number;
  expectedPeCount: number;
  expectedStrikes: number[];
  expectedContractKeys: string[];
  uniqueTokenCount: number;
  quotedContractCount: number;
  missingQuoteKeys: string[];
  allQuotesPresent: boolean;
  allOiPresent: boolean;
  allVolumePresent: boolean;
  bandOiCoverageComplete: boolean;
  bandVolumeCoverageComplete: boolean;
  atmPairCoverageComplete: boolean;
  fullChainVolumePcr: number | null;
  fullChainCallWallStrike: number | null;
  fullChainCallWallOi: number | null;
  fullChainPutWallStrike: number | null;
  fullChainPutWallOi: number | null;
}

export interface Phase46MetricInputs {
  symbol: string;
  minuteBucket: string;
  expiry: string;
  metadata: Phase46UniverseMetadata | null | undefined;
  atmStraddle: number | null;
  band7OiPcr: number | null;
  band7VolumePcr: number | null;
  fullChainOiPcr: number | null;
  maxPain: number | null;
}

export interface ChainMetricTruthRecord {
  eventId: string;
  symbol: string;
  minuteBucket: string;
  expiry: string;
  metric: ChainMetricName;
  numericValue: number | null;
  detail: Record<string, unknown> | null;
  truthState: ChainMetricTruthState;
  usability: ChainMetricUsability;
  reasonCodes: string[];
  universeFingerprint: string | null;
  sourceProvenance: string | null;
  quoteReceivedAt: string | null;
  calculationVersion: "CHAIN_METRIC_TRUTH_PHASE46_V1";
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function canonical(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((k) => `${k}:${canonical(obj[k])}`).join(",")}}`;
  }
  return String(value);
}

export function phase46UniverseFingerprint(metadata: Phase46UniverseMetadata): string {
  return createHash("sha256").update(canonical({
    provenance: metadata.provenance,
    expectedContractCount: metadata.expectedContractCount,
    expectedCeCount: metadata.expectedCeCount,
    expectedPeCount: metadata.expectedPeCount,
    expectedStrikes: metadata.expectedStrikes,
    expectedContractKeys: metadata.expectedContractKeys,
    uniqueTokenCount: metadata.uniqueTokenCount,
  })).digest("hex");
}

function universeStructuralReasons(m: Phase46UniverseMetadata): string[] {
  const reasons: string[] = [];
  if (m.provenance !== "KITE_LIVE_INSTRUMENT_MASTER_OPTION_MAP") reasons.push("UNIVERSE_PROVENANCE_INVALID");
  if (!Number.isInteger(m.expectedContractCount) || m.expectedContractCount <= 0) reasons.push("EXPECTED_CONTRACT_COUNT_INVALID");
  if (m.expectedCeCount + m.expectedPeCount !== m.expectedContractCount) reasons.push("EXPECTED_SIDE_COUNTS_MISMATCH");
  if (m.expectedContractKeys.length !== m.expectedContractCount) reasons.push("EXPECTED_CONTRACT_KEYS_INCOMPLETE");
  if (new Set(m.expectedContractKeys).size !== m.expectedContractKeys.length) reasons.push("EXPECTED_CONTRACT_KEY_DUPLICATE");
  if (m.uniqueTokenCount !== m.expectedContractCount) reasons.push("INSTRUMENT_TOKEN_UNIQUENESS_FAILED");
  if (!m.expectedStrikes.length) reasons.push("EXPECTED_STRIKE_UNIVERSE_EMPTY");
  return reasons;
}

function record(args: {
  base: Phase46MetricInputs;
  metric: ChainMetricName;
  value: number | null;
  detail?: Record<string, unknown> | null;
  condition: boolean;
  reasons: string[];
  fingerprint: string | null;
}): ChainMetricTruthRecord {
  const numericValue = finite(args.value);
  const reasonCodes = [...new Set(args.reasons)];
  let truthState: ChainMetricTruthState = args.condition && numericValue !== null ? "VALID" : "BLOCKED";
  let usability: ChainMetricUsability = truthState === "VALID" ? "CONTEXT_ONLY" : "BLOCKED";

  // Phase 46 has an exact backend quote-response receipt boundary but not an
  // independently persisted exchange timestamp for every option quote. Keep
  // metric provenance valid while refusing live evidence promotion for now.
  if (truthState === "VALID") reasonCodes.push("QUOTE_TIME_BASIS_RESPONSE_RECEIPT");
  if (numericValue === null) reasonCodes.push("METRIC_VALUE_UNAVAILABLE");

  const key = {
    symbol: args.base.symbol,
    minuteBucket: args.base.minuteBucket,
    expiry: args.base.expiry,
    metric: args.metric,
    value: numericValue,
    detail: args.detail ?? null,
    universeFingerprint: args.fingerprint,
    quoteReceivedAt: args.base.metadata?.quoteReceivedAt ?? null,
  };
  return {
    eventId: createHash("sha256").update(canonical(key)).digest("hex"),
    symbol: args.base.symbol,
    minuteBucket: args.base.minuteBucket,
    expiry: args.base.expiry,
    metric: args.metric,
    numericValue,
    detail: args.detail ?? null,
    truthState,
    usability,
    reasonCodes: [...new Set(reasonCodes)],
    universeFingerprint: args.fingerprint,
    sourceProvenance: args.base.metadata?.provenance ?? null,
    quoteReceivedAt: args.base.metadata?.quoteReceivedAt ?? null,
    calculationVersion: "CHAIN_METRIC_TRUTH_PHASE46_V1",
  };
}

export function buildPhase46ChainMetricTruth(base: Phase46MetricInputs): ChainMetricTruthRecord[] {
  const m = base.metadata;
  if (!m) {
    return (["ATM_STRADDLE","BAND7_OI_PCR","BAND7_VOLUME_PCR","FULL_CHAIN_OI_PCR","FULL_CHAIN_VOLUME_PCR","CALL_WALL","PUT_WALL","MAX_PAIN"] as ChainMetricName[]).map((metric) =>
      record({ base, metric, value: null, condition: false, reasons: ["UNIVERSE_METADATA_MISSING"], fingerprint: null })
    );
  }

  const structural = universeStructuralReasons(m);
  const fingerprint = phase46UniverseFingerprint(m);
  const universeComplete = structural.length === 0 && m.allQuotesPresent && m.quotedContractCount === m.expectedContractCount && m.missingQuoteKeys.length === 0;
  const universeReasons = [
    ...structural,
    ...(!m.allQuotesPresent || m.quotedContractCount !== m.expectedContractCount ? ["FULL_UNIVERSE_QUOTE_COVERAGE_INCOMPLETE"] : []),
    ...(m.missingQuoteKeys.length ? ["FULL_UNIVERSE_MISSING_QUOTES"] : []),
  ];

  return [
    record({ base, metric:"ATM_STRADDLE", value:base.atmStraddle, condition:m.atmPairCoverageComplete, reasons:m.atmPairCoverageComplete ? [] : ["ATM_PAIR_COVERAGE_INCOMPLETE"], fingerprint }),
    record({ base, metric:"BAND7_OI_PCR", value:base.band7OiPcr, condition:m.bandOiCoverageComplete, reasons:m.bandOiCoverageComplete ? [] : ["BAND7_OI_COVERAGE_INCOMPLETE"], fingerprint }),
    record({ base, metric:"BAND7_VOLUME_PCR", value:base.band7VolumePcr, condition:m.bandVolumeCoverageComplete, reasons:m.bandVolumeCoverageComplete ? [] : ["BAND7_VOLUME_COVERAGE_INCOMPLETE"], fingerprint }),
    record({ base, metric:"FULL_CHAIN_OI_PCR", value:base.fullChainOiPcr, condition:universeComplete && m.allOiPresent, reasons:[...universeReasons, ...(!m.allOiPresent ? ["FULL_CHAIN_OI_FIELD_COVERAGE_INCOMPLETE"] : [])], fingerprint }),
    record({ base, metric:"FULL_CHAIN_VOLUME_PCR", value:m.fullChainVolumePcr, condition:universeComplete && m.allVolumePresent, reasons:[...universeReasons, ...(!m.allVolumePresent ? ["FULL_CHAIN_VOLUME_FIELD_COVERAGE_INCOMPLETE"] : [])], fingerprint }),
    record({ base, metric:"CALL_WALL", value:m.fullChainCallWallStrike, detail:{ oi:m.fullChainCallWallOi }, condition:universeComplete && m.allOiPresent && finite(m.fullChainCallWallOi) !== null, reasons:[...universeReasons, ...(!m.allOiPresent ? ["FULL_CHAIN_OI_FIELD_COVERAGE_INCOMPLETE"] : [])], fingerprint }),
    record({ base, metric:"PUT_WALL", value:m.fullChainPutWallStrike, detail:{ oi:m.fullChainPutWallOi }, condition:universeComplete && m.allOiPresent && finite(m.fullChainPutWallOi) !== null, reasons:[...universeReasons, ...(!m.allOiPresent ? ["FULL_CHAIN_OI_FIELD_COVERAGE_INCOMPLETE"] : [])], fingerprint }),
    // Max Pain formula provenance is intentionally deferred to Phase 47.
    record({ base, metric:"MAX_PAIN", value:base.maxPain, condition:false, reasons:["MAX_PAIN_CALCULATION_PROVENANCE_NOT_AUDITED"], fingerprint }),
  ];
}

export function chainMetricTruthSchemaSql(): string {
  return `
    CREATE TABLE IF NOT EXISTS chain_metric_truth_1m (
      event_id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      minute_bucket TIMESTAMPTZ NOT NULL,
      expiry DATE NOT NULL,
      metric TEXT NOT NULL,
      numeric_value DOUBLE PRECISION,
      detail JSONB,
      truth_state TEXT NOT NULL,
      usability TEXT NOT NULL,
      reason_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
      universe_fingerprint TEXT,
      source_provenance TEXT,
      quote_received_at TIMESTAMPTZ,
      calculation_version TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_chain_metric_truth_lookup
      ON chain_metric_truth_1m (symbol, expiry, metric, minute_bucket DESC);
  `;
}

let schemaReady = false;
export async function persistChainMetricTruth(rows: ChainMetricTruthRecord[]): Promise<number> {
  if (!rows.length) return 0;
  if (!schemaReady) {
    schemaReady = (await dbQuerySafe(chainMetricTruthSchemaSql())) !== null;
    if (!schemaReady) return 0;
  }
  let writes = 0;
  for (const row of rows) {
    const result = await dbQuerySafe<{event_id:string}>(`
      INSERT INTO chain_metric_truth_1m (
        event_id,symbol,minute_bucket,expiry,metric,numeric_value,detail,truth_state,usability,
        reason_codes,universe_fingerprint,source_provenance,quote_received_at,calculation_version
      ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10::jsonb,$11,$12,$13,$14)
      ON CONFLICT (event_id) DO NOTHING RETURNING event_id
    `, [
      row.eventId,row.symbol,row.minuteBucket,row.expiry,row.metric,row.numericValue,
      JSON.stringify(row.detail),row.truthState,row.usability,JSON.stringify(row.reasonCodes),
      row.universeFingerprint,row.sourceProvenance,row.quoteReceivedAt,row.calculationVersion,
    ]);
    if (result?.rows?.length) writes += 1;
  }
  return writes;
}

export const PHASE46_CHAIN_METRIC_SAFETY = Object.freeze({
  readOnlyForTrading: true,
  shadowOnly: true,
  affectsVerdict: false,
  affectsTelegram: false,
  affectsExecution: false,
  timingBoundary: "BACKEND_QUOTE_RESPONSE_RECEIPT_NOT_PER_CONTRACT_EXCHANGE_TIMESTAMP",
});
