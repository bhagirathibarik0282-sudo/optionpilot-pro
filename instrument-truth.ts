import type { ContractIdentity, ExpiryBucket, IdentityState, SourceTruthReasonCode } from "./source-truth-types.js";

export interface IdentityAudit {
  state: IdentityState;
  usable: boolean;
  reasons: SourceTruthReasonCode[];
}

function normDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = value.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

function eqText(a: unknown, b: unknown): boolean {
  return String(a ?? "").trim().toUpperCase() === String(b ?? "").trim().toUpperCase();
}

export function validateOptionIdentity(expected: ContractIdentity, actual: ContractIdentity): IdentityAudit {
  const reasons: SourceTruthReasonCode[] = [];
  const requiredMissing = [expected.expiry, actual.expiry, expected.strike, actual.strike, expected.optionType, actual.optionType]
    .some((value) => value === null || value === undefined || value === "");
  if (requiredMissing) reasons.push("CONTRACT_IDENTITY_INCOMPLETE");
  if (expected.instrumentToken == null || actual.instrumentToken == null) reasons.push("TOKEN_MISSING");
  else if (String(expected.instrumentToken) !== String(actual.instrumentToken)) reasons.push("TOKEN_MISMATCH");
  if (expected.tradingSymbol && actual.tradingSymbol && !eqText(expected.tradingSymbol, actual.tradingSymbol)) reasons.push("TRADING_SYMBOL_MISMATCH");
  if (expected.segment && actual.segment && !eqText(expected.segment, actual.segment)) reasons.push("EXCHANGE_SEGMENT_MISMATCH");
  if (normDate(expected.expiry) !== normDate(actual.expiry)) reasons.push("EXPIRY_MISMATCH");
  if (expected.strike != null && actual.strike != null && expected.strike !== actual.strike) reasons.push("STRIKE_MISMATCH");
  if (expected.optionType && actual.optionType && expected.optionType !== actual.optionType) reasons.push("OPTION_TYPE_MISMATCH");

  const hard = reasons.some((r) => r !== "TOKEN_MISSING");
  if (hard) return { state: "MISMATCH", usable: false, reasons };
  if (reasons.includes("TOKEN_MISSING")) return { state: "PARTIAL", usable: false, reasons };
  return { state: "VALID", usable: true, reasons: [] };
}

export interface ExpiryClassification {
  expiry: string;
  bucket: ExpiryBucket;
  isMonthly: boolean;
}

/**
 * Generic date-based classifier. Exchange-specific holiday-adjusted expiry dates
 * must already be supplied by the instrument master/calendar. No weekday rule is guessed here.
 */
export function classifyExpiryBuckets(tradeDate: string, expiries: string[], monthlyExpiries: string[] = []): ExpiryClassification[] {
  const td = normDate(tradeDate);
  if (!td) throw new Error("Invalid tradeDate");
  const unique = [...new Set(expiries.map(normDate).filter((x): x is string => !!x))].sort();
  const active = unique.filter((e) => e >= td);
  const current = active[0] ?? null;
  const next = active[1] ?? null;
  const monthly = new Set(monthlyExpiries.map(normDate).filter((x): x is string => !!x));
  return unique.map((expiry) => ({
    expiry,
    bucket: expiry === current ? "CURRENT" : expiry === next ? "NEXT" : monthly.has(expiry) ? "MONTHLY" : "OTHER",
    isMonthly: monthly.has(expiry),
  }));
}

export interface FutureContractLike {
  expiry?: string | null;
  instrumentToken?: string | number | null;
  tradingSymbol?: string | null;
}

export interface FutureResolution {
  contract: FutureContractLike | null;
  state: IdentityState;
  reasons: SourceTruthReasonCode[];
}

export function resolveFrontFuture(tradeDate: string, contracts: FutureContractLike[]): FutureResolution {
  const td = normDate(tradeDate);
  if (!td) throw new Error("Invalid tradeDate");
  const eligible = contracts
    .map((c) => ({ c, expiry: normDate(c.expiry) }))
    .filter((x): x is { c: FutureContractLike; expiry: string } => !!x.expiry && x.expiry >= td)
    .sort((a, b) => a.expiry.localeCompare(b.expiry));
  if (!eligible.length) return { contract: null, state: "UNKNOWN", reasons: ["EXPIRY_UNKNOWN"] };
  const firstExpiry = eligible[0].expiry;
  const nearest = eligible.filter((x) => x.expiry === firstExpiry);
  if (nearest.length !== 1) return { contract: null, state: "AMBIGUOUS", reasons: ["FUTURE_CONTRACT_AMBIGUOUS"] };
  return { contract: nearest[0].c, state: "VALID", reasons: [] };
}
