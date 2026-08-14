export type DhanTruthState = "VERIFIED" | "DEGRADED" | "FROZEN" | "LOCKED";
export type DhanTimestampSource = "EXCHANGE" | "PROVIDER" | "BACKEND_RECEIVED" | "UNAVAILABLE";
export type DhanFieldState = "FRESH" | "STALE" | "UNAVAILABLE" | "INVALID";

export interface DhanTruthFieldInput {
  timestamp: string | null;
  source: DhanTimestampSource;
  maxAgeMs: number;
  requiredForCandidate: boolean;
}

export interface DhanTruthInput {
  nowMs?: number;
  symbol: string;
  expectedSymbol: string;
  expiry: string | null;
  expectedExpiry: string | null;
  optionType?: "CE" | "PE" | null;
  expectedOptionType?: "CE" | "PE" | null;
  securityId?: number | null;
  strike?: number | null;
  feedError?: boolean;
  sequenceGap?: boolean;
  fields: Record<string, DhanTruthFieldInput>;
}

export interface DhanTruthFieldReport {
  state: DhanFieldState;
  source: DhanTimestampSource;
  timestamp: string | null;
  ageMs: number | null;
  maxAgeMs: number;
  requiredForCandidate: boolean;
  strongTimestampProof: boolean;
  reason: string | null;
}

export interface DhanTruthReport {
  state: DhanTruthState;
  candidateEligible: boolean;
  reviewEligible: boolean;
  hardBlockReasons: string[];
  warnings: string[];
  fields: Record<string, DhanTruthFieldReport>;
  interpretationGuard: string;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 5_000;

/**
 * Dhan documents expiryTime as IST. A timestamp without Z/offset must
 * therefore be interpreted as IST, never as the Railway process timezone.
 */
export function parseDhanIstTimestampMs(value: string | null | undefined): number | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Explicit timezone is authoritative.
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)) {
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const match = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/
  );
  if (!match) return null;
  const [, y, mo, d, h, mi, s, fraction = "0"] = match;
  const utcLike = Date.UTC(
    Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s),
    Number(fraction.padEnd(3, "0"))
  );
  const result = utcLike - IST_OFFSET_MS;

  // Reject calendar rollover (for example 2026-02-31) instead of normalizing it.
  const roundTrip = new Date(result + IST_OFFSET_MS);
  if (
    roundTrip.getUTCFullYear() !== Number(y) ||
    roundTrip.getUTCMonth() !== Number(mo) - 1 ||
    roundTrip.getUTCDate() !== Number(d) ||
    roundTrip.getUTCHours() !== Number(h) ||
    roundTrip.getUTCMinutes() !== Number(mi) ||
    roundTrip.getUTCSeconds() !== Number(s)
  ) return null;
  return result;
}

export function dhanTokenNeedsRefresh(
  expiryTime: string | null | undefined,
  nowMs = Date.now(),
  refreshBufferMs = 5 * 60_000
): boolean {
  const expiresAt = parseDhanIstTimestampMs(expiryTime);
  return expiresAt == null || nowMs >= expiresAt - refreshBufferMs;
}

function isoDate(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function assessField(input: DhanTruthFieldInput, nowMs: number): DhanTruthFieldReport {
  const base = {
    source: input.source,
    timestamp: input.timestamp,
    ageMs: null,
    maxAgeMs: input.maxAgeMs,
    requiredForCandidate: input.requiredForCandidate,
    strongTimestampProof: input.source === "EXCHANGE" || input.source === "PROVIDER",
  };
  if (!input.timestamp || input.source === "UNAVAILABLE") {
    return { ...base, state: "UNAVAILABLE", reason: "TIMESTAMP_UNAVAILABLE" };
  }
  const timestampMs = Date.parse(input.timestamp);
  if (!Number.isFinite(timestampMs)) {
    return { ...base, state: "INVALID", reason: "TIMESTAMP_INVALID" };
  }
  const ageMs = nowMs - timestampMs;
  if (ageMs < -FUTURE_TOLERANCE_MS) {
    return { ...base, ageMs, state: "INVALID", reason: "TIMESTAMP_IN_FUTURE" };
  }
  if (ageMs > input.maxAgeMs) {
    return { ...base, ageMs, state: "STALE", reason: "AGE_LIMIT_EXCEEDED" };
  }
  return {
    ...base,
    ageMs: Math.max(0, ageMs),
    state: "FRESH",
    reason: input.source === "BACKEND_RECEIVED" ? "BACKEND_RECEIPT_PROXY_ONLY" : null,
  };
}

export function evaluateDhanTruth(input: DhanTruthInput): DhanTruthReport {
  const nowMs = input.nowMs ?? Date.now();
  const hardBlockReasons: string[] = [];
  const warnings: string[] = [];
  const fields: Record<string, DhanTruthFieldReport> = {};

  if (!input.symbol || input.symbol !== input.expectedSymbol) hardBlockReasons.push("UNDERLYING_IDENTITY_MISMATCH");
  if (!isoDate(input.expiry) || isoDate(input.expiry) !== isoDate(input.expectedExpiry)) hardBlockReasons.push("EXPIRY_IDENTITY_MISMATCH");
  if (input.expectedOptionType && input.optionType !== input.expectedOptionType) hardBlockReasons.push("OPTION_TYPE_IDENTITY_MISMATCH");
  if (Object.prototype.hasOwnProperty.call(input, "securityId") && (!Number.isInteger(input.securityId) || (input.securityId as number) <= 0)) hardBlockReasons.push("SECURITY_ID_INVALID");
  if (Object.prototype.hasOwnProperty.call(input, "strike") && (!Number.isFinite(input.strike) || (input.strike as number) <= 0)) hardBlockReasons.push("STRIKE_INVALID");
  if (input.feedError) hardBlockReasons.push("PROVIDER_FEED_ERROR");
  if (input.sequenceGap) hardBlockReasons.push("SEQUENCE_GAP_RESYNC_REQUIRED");
  if (Object.keys(input.fields).length === 0) hardBlockReasons.push("NO_TRUTH_FIELDS");

  for (const [name, field] of Object.entries(input.fields)) {
    const report = assessField(field, nowMs);
    fields[name] = report;
    if (report.source === "BACKEND_RECEIVED") warnings.push(`${name.toUpperCase()}_BACKEND_RECEIPT_PROXY`);
    if (!field.requiredForCandidate && report.state !== "FRESH") warnings.push(`${name.toUpperCase()}_${report.state}`);
  }

  const required = Object.entries(fields).filter(([name]) => input.fields[name].requiredForCandidate);
  if (required.length === 0) hardBlockReasons.push("NO_REQUIRED_FRESHNESS_FIELDS");
  const requiredInvalid = required.filter(([, report]) => report.state === "INVALID");
  const requiredUnavailable = required.filter(([, report]) => report.state === "UNAVAILABLE");
  const requiredStale = required.filter(([, report]) => report.state === "STALE");
  const requiredProxy = required.filter(([, report]) => report.state === "FRESH" && !report.strongTimestampProof);
  const optionalProblem = Object.entries(fields).some(([name, report]) =>
    !input.fields[name].requiredForCandidate && report.state !== "FRESH"
  );

  for (const [name] of requiredInvalid) hardBlockReasons.push(`${name.toUpperCase()}_TIMESTAMP_INVALID`);

  let state: DhanTruthState;
  if (hardBlockReasons.length > 0) state = "LOCKED";
  else if (requiredStale.length > 0 || requiredUnavailable.length > 0) state = "FROZEN";
  else if (requiredProxy.length > 0 || optionalProblem) state = "DEGRADED";
  else state = "VERIFIED";

  return {
    state,
    candidateEligible: state === "VERIFIED",
    reviewEligible: state === "VERIFIED" || state === "DEGRADED",
    hardBlockReasons: Array.from(new Set(hardBlockReasons)),
    warnings: Array.from(new Set(warnings)),
    fields,
    interpretationGuard:
      "VERIFIED proves identity and independently fresh provider/exchange timestamps. DEGRADED may be shown for Review & Confirm only; it must not be presented as a verified live candidate. FROZEN/LOCKED must never create a candidate.",
  };
}
