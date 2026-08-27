import type { SourceTruthPersistenceRecord } from "./source-truth-db.js";
import type { EvidenceUsability, QualityState, SourceTruthReasonCode } from "./source-truth-types.js";

function uniqueReasons(reasons: SourceTruthReasonCode[]): SourceTruthReasonCode[] {
  return [...new Set(reasons)];
}

function sourceVersion(row: SourceTruthPersistenceRecord): string {
  return String(row.sourceVersion ?? "");
}

function isKiteMasterOption(row: SourceTruthPersistenceRecord): boolean {
  return row.recordKind === "OPTION" && row.sourceProvider === "KITE" && sourceVersion(row).includes("LIVE_CONTRACT_MASTER");
}

function isKiteMasterFuture(row: SourceTruthPersistenceRecord): boolean {
  return row.recordKind === "FUTURES" &&
    row.sourceProvider === "KITE" &&
    sourceVersion(row).includes("FUTURES_LIVE_CONTRACT_MASTER") &&
    sourceVersion(row).includes("QUOTE_RESPONSE_RECEIPT");
}

function optionIdentityComplete(row: SourceTruthPersistenceRecord): boolean {
  const id = row.identity;
  return !!id && !!id.underlying && !!id.exchange && !!id.segment && id.instrumentToken != null &&
    !!id.tradingSymbol && !!id.expiry && id.strike != null && !!id.optionType;
}

function futureIdentityComplete(row: SourceTruthPersistenceRecord): boolean {
  const id = row.identity;
  return !!id && !!id.underlying && !!id.exchange && !!id.segment && id.instrumentToken != null &&
    !!id.tradingSymbol && !!id.expiry;
}

function optionTradingSymbolMatches(row: SourceTruthPersistenceRecord): boolean {
  const id = row.identity;
  if (!id?.tradingSymbol || !id.underlying || id.strike == null || !id.optionType) return false;
  const ts = id.tradingSymbol.trim().toUpperCase();
  const underlying = id.underlying.trim().toUpperCase();
  const strike = Number.isInteger(id.strike) ? String(id.strike) : String(id.strike).replace(".", "");
  return ts.startsWith(underlying) && ts.endsWith(`${strike}${id.optionType}`);
}

function futureTradingSymbolMatches(row: SourceTruthPersistenceRecord): boolean {
  const id = row.identity;
  if (!id?.tradingSymbol || !id.underlying) return false;
  const ts = id.tradingSymbol.trim().toUpperCase();
  return ts.startsWith(id.underlying.trim().toUpperCase()) && ts.endsWith("FUT");
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

function promoteCompleteIdentity(
  row: SourceTruthPersistenceRecord,
  reasons: SourceTruthReasonCode[],
  identityComplete: boolean,
  symbolMatches: boolean,
  receiptApprox: boolean,
): SourceTruthPersistenceRecord {
  if (!identityComplete) {
    if (!reasons.includes("CONTRACT_IDENTITY_INCOMPLETE")) reasons.push("CONTRACT_IDENTITY_INCOMPLETE");
    return { ...row, identityState: "PARTIAL", qualityState: "PARTIAL", usability: "BLOCKED", reasonCodes: uniqueReasons(reasons) };
  }
  if (!symbolMatches) {
    if (!reasons.includes("TRADING_SYMBOL_SHAPE_MISMATCH")) reasons.push("TRADING_SYMBOL_SHAPE_MISMATCH");
    return { ...row, identityState: "MISMATCH", qualityState: "INVALID", usability: "BLOCKED", reasonCodes: uniqueReasons(reasons) };
  }

  const cleaned = reasons.filter((reason) =>
    reason !== "IDENTITY_NOT_CROSSCHECKED" && reason !== "TOKEN_MISSING" &&
    reason !== "FUTURE_TOKEN_UNAVAILABLE" && reason !== "CONTRACT_IDENTITY_INCOMPLETE"
  );
  return {
    ...row,
    identityState: "VALID",
    qualityState: qualityFromFreshness(row, receiptApprox),
    usability: usabilityFromFreshness(row, receiptApprox),
    reasonCodes: uniqueReasons(cleaned),
  };
}

/** Shadow-only final truth promotion. Identity never overrides freshness. */
export function promoteSourceTruthRecord(row: SourceTruthPersistenceRecord): SourceTruthPersistenceRecord {
  const reasons = [...row.reasonCodes];
  const version = sourceVersion(row);
  const receiptApprox = version.includes("SNAPSHOT_RECEIPT_PROXY");

  if (receiptApprox && !reasons.includes("RECEIVED_AT_APPROXIMATED")) reasons.push("RECEIVED_AT_APPROXIMATED");
  if (row.recordKind === "MARKET" && row.sourceProvider === "KITE" && !row.sourceTimestamp) {
    if (!reasons.includes("SOURCE_TS_PROXY_BACKEND")) reasons.push("SOURCE_TS_PROXY_BACKEND");
  }

  if (isKiteMasterOption(row)) {
    return promoteCompleteIdentity(row, reasons, optionIdentityComplete(row), optionTradingSymbolMatches(row), receiptApprox);
  }

  if (isKiteMasterFuture(row)) {
    return promoteCompleteIdentity(row, reasons, futureIdentityComplete(row), futureTradingSymbolMatches(row), false);
  }

  return { ...row, reasonCodes: uniqueReasons(reasons) };
}

export function promoteSourceTruthRecords(rows: SourceTruthPersistenceRecord[]): SourceTruthPersistenceRecord[] {
  return rows.map(promoteSourceTruthRecord);
}
