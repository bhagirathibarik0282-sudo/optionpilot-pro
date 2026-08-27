import type { IdentityState, SourceTruthReasonCode } from "./source-truth-types.js";

export interface LivePremiumMetadataLike {
  strike?: number | null;
  instrumentToken?: string | number | null;
  tradingSymbol?: string | null;
  expiryDate?: string | null;
  optionType?: "CE" | "PE" | null;
  exchange?: string | null;
  segment?: string | null;
  contractRegime?: string | null;
}

export interface LiveMetadataAudit {
  state: IdentityState;
  usable: boolean;
  reasons: SourceTruthReasonCode[];
}

function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function strikeToken(strike: number): string {
  return Number.isInteger(strike) ? String(strike) : String(strike).replace(".", "");
}

/**
 * Audits metadata already copied by server.ts from the exact Kite instrument-master
 * record used to form the quote key. This is a provenance/consistency audit; it
 * does not fetch Kite and does not create a market signal.
 */
export function auditKitePremiumMetadata(args: {
  underlying: string;
  expiry: string;
  strike: number;
  side: "CE" | "PE";
  observed: LivePremiumMetadataLike;
}): LiveMetadataAudit {
  const reasons: SourceTruthReasonCode[] = [];
  const o = args.observed;

  if (o.contractRegime !== "LIVE_CONTRACT_MASTER") {
    reasons.push("INSTRUMENT_MASTER_PROVENANCE_MISSING");
  }

  if (o.instrumentToken == null || !o.tradingSymbol || !o.expiryDate || !o.optionType || !o.exchange || !o.segment || o.strike == null) {
    reasons.push("CONTRACT_IDENTITY_INCOMPLETE");
  }

  if (dateOnly(o.expiryDate) && dateOnly(o.expiryDate) !== dateOnly(args.expiry)) reasons.push("EXPIRY_MISMATCH");
  if (o.optionType && o.optionType !== args.side) reasons.push("OPTION_TYPE_MISMATCH");
  if (o.strike != null && Number(o.strike) !== Number(args.strike)) reasons.push("STRIKE_MISMATCH");

  const ts = normalizeText(o.tradingSymbol);
  if (ts) {
    const expectedPrefix = normalizeText(args.underlying);
    const expectedSuffix = `${strikeToken(args.strike)}${args.side}`;
    if (!ts.startsWith(expectedPrefix) || !ts.endsWith(expectedSuffix)) {
      reasons.push("TRADING_SYMBOL_SHAPE_MISMATCH");
    }
  }

  const unique = [...new Set(reasons)];
  const hardMismatch = unique.some((r) =>
    r === "EXPIRY_MISMATCH" || r === "OPTION_TYPE_MISMATCH" || r === "STRIKE_MISMATCH" || r === "TRADING_SYMBOL_SHAPE_MISMATCH"
  );
  if (hardMismatch) return { state: "MISMATCH", usable: false, reasons: unique };
  if (unique.length) return { state: "PARTIAL", usable: false, reasons: unique };
  return { state: "VALID", usable: true, reasons: [] };
}

/**
 * Current FuturesContract snapshots contain tradingsymbol/expiry but not the
 * broker instrument token/segment. Keep futures identity PARTIAL until that
 * metadata is carried through from the instrument master.
 */
export function auditCurrentFutureMetadata(observed: { tradingSymbol?: string | null; expiry?: string | null; instrumentToken?: string | number | null; segment?: string | null }): LiveMetadataAudit {
  const reasons: SourceTruthReasonCode[] = [];
  if (!observed.tradingSymbol || !observed.expiry) reasons.push("CONTRACT_IDENTITY_INCOMPLETE");
  if (observed.instrumentToken == null || !observed.segment) reasons.push("FUTURE_TOKEN_UNAVAILABLE");
  const unique = [...new Set(reasons)];
  if (unique.length) return { state: "PARTIAL", usable: false, reasons: unique };
  return { state: "VALID", usable: true, reasons: [] };
}
