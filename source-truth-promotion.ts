import type { SourceTruthPersistenceRecord } from "./source-truth-db.js";
import type { EvidenceUsability, QualityState, SourceTruthReasonCode } from "./source-truth-types.js";

function uniqueReasons(reasons: SourceTruthReasonCode[]): SourceTruthReasonCode[] {
  return [...new Set(reasons)];
}

function isKiteMasterOption(row: SourceTruthPersistenceRecord): boolean {
  return row.recordKind === "OPTION" &&
    row.sourceProvider === "KITE" &&
    String(row.sourceVersion ?? "").includes("LIVE_CONTRACT_MASTER");
}

function optionIdentityComplete(row: SourceTruthPersistenceRecord): boolean {
  const id = row.identity;
  return !!id &&
    !!id.underlying &&
    !!id.segment &&
    id.instrumentToken != null &&
    !!id.tradingSymbol &&
    !!id.expiry &&
    id.strike != null &&
    !!id.optionType;
}

function tradingSymbolShapeMatches(row: SourceTruthPersistenceRecord): boolean {
  const id = row.identity;
  if (!id?.tradingSymbol || !id.underlying || id.strike == null || !id.optionType) return false;
  const ts = id.tradingSymbol.trim().toUpperCase();
  const underlying = id.underlying.trim().toUpperCase();
  const strike = Number.isInteger(id.strike) ? String(id.strike) : String(id.strike).replace(".", "");
  return ts.startsWith(underlying) && ts.endsWith(`${strike}${id.optionType}`);
}

function usabilityFromFreshness(row: SourceTruthPersistenceRecord, receiptApprox: boolean): EvidenceUsability {
  if (row.freshnessState === "STALE" || row.freshnessState === "UNKNOWN") return "BLOCKED";
  if (row.freshnessState === "AGING" || receiptApprox) return "CONTEXT_ONLY";
  return "USABLE";
}

function qualityFromFreshness(row: SourceTruthPersistenceRecord, receiptApprox: boolean): QualityState {
  if (row.freshnessState === "STALE" || row.freshnessState === "UNKNOWN") return "UNKNOWN";
  if (row.freshnessState === "AGING" || receiptApprox) return "PARTIAL";
  return "VALID";
}

/**
 * Final shadow-only promotion immediately before source-truth persistence.
 *
 * Phase 31 proved that OptionPilot's PremiumData metadata is copied from the
 * exact Kite instrument-master object used to form the quote key. The runtime
 * wiring marks those rows with LIVE_CONTRACT_MASTER. This function may upgrade
 * identityState from PARTIAL to VALID only for that proven path and only when
 * the contract identity is complete and the trading-symbol structure agrees.
 *
 * Freshness and receive-time quality remain independent. A VALID option
 * identity can still be BLOCKED by stale/unknown time or kept CONTEXT_ONLY when
 * receivedAt is a snapshot-level proxy rather than an exact per-response time.
 */
export function promoteSourceTruthRecord(row: SourceTruthPersistenceRecord): SourceTruthPersistenceRecord {
  const reasons = [...row.reasonCodes];
  const version = String(row.sourceVersion ?? "");
  const receiptApprox = version.includes("SNAPSHOT_RECEIPT_PROXY");

  if (receiptApprox && !reasons.includes("RECEIVED_AT_APPROXIMATED")) {
    reasons.push("RECEIVED_AT_APPROXIMATED");
  }

  if (row.recordKind === "MARKET" && row.sourceProvider === "KITE" && !row.sourceTimestamp) {
    if (!reasons.includes("SOURCE_TS_PROXY_BACKEND")) reasons.push("SOURCE_TS_PROXY_BACKEND");
  }

  if (!isKiteMasterOption(row)) {
    return { ...row, reasonCodes: uniqueReasons(reasons) };
  }

  if (!optionIdentityComplete(row)) {
    if (!reasons.includes("CONTRACT_IDENTITY_INCOMPLETE")) reasons.push("CONTRACT_IDENTITY_INCOMPLETE");
    return {
      ...row,
      identityState: "PARTIAL",
      qualityState: "PARTIAL",
      usability: "BLOCKED",
      reasonCodes: uniqueReasons(reasons),
    };
  }

  if (!tradingSymbolShapeMatches(row)) {
    if (!reasons.includes("TRADING_SYMBOL_SHAPE_MISMATCH")) reasons.push("TRADING_SYMBOL_SHAPE_MISMATCH");
    return {
      ...row,
      identityState: "MISMATCH",
      qualityState: "INVALID",
      usability: "BLOCKED",
      reasonCodes: uniqueReasons(reasons),
    };
  }

  const cleaned = reasons.filter((reason) =>
    reason !== "IDENTITY_NOT_CROSSCHECKED" &&
    reason !== "TOKEN_MISSING" &&
    reason !== "CONTRACT_IDENTITY_INCOMPLETE"
  );

  return {
    ...row,
    identityState: "VALID",
    qualityState: qualityFromFreshness(row, receiptApprox),
    usability: usabilityFromFreshness(row, receiptApprox),
    reasonCodes: uniqueReasons(cleaned),
  };
}

export function promoteSourceTruthRecords(rows: SourceTruthPersistenceRecord[]): SourceTruthPersistenceRecord[] {
  return rows.map(promoteSourceTruthRecord);
}
