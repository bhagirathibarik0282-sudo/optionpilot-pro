export type FreshnessState = "FRESH" | "AGING" | "STALE" | "UNKNOWN";
export type IdentityState = "VALID" | "PARTIAL" | "MISMATCH" | "AMBIGUOUS" | "UNKNOWN";
export type QualityState = "VALID" | "PARTIAL" | "INVALID" | "UNKNOWN";
export type EvidenceUsability = "USABLE" | "CONTEXT_ONLY" | "BLOCKED";
export type SourceProvider = "KITE" | "DHAN" | "INTERNAL_MODEL" | "EXCHANGE_REFERENCE" | "UNKNOWN";
export type ExpiryBucket = "CURRENT" | "NEXT" | "MONTHLY" | "OTHER" | "UNKNOWN";

export type SourceTruthReasonCode =
  | "SOURCE_TS_MISSING"
  | "SOURCE_TS_INVALID"
  | "SOURCE_TS_FUTURE"
  | "QUOTE_AGING"
  | "QUOTE_STALE"
  | "TOKEN_MISSING"
  | "TOKEN_MISMATCH"
  | "TRADING_SYMBOL_MISMATCH"
  | "EXCHANGE_SEGMENT_MISMATCH"
  | "EXPIRY_MISMATCH"
  | "STRIKE_MISMATCH"
  | "OPTION_TYPE_MISMATCH"
  | "CONTRACT_AMBIGUOUS"
  | "EXPIRY_UNKNOWN"
  | "FUTURE_CONTRACT_AMBIGUOUS"
  | "IV_PROVENANCE_UNKNOWN"
  | "GREEKS_PROVENANCE_UNKNOWN"
  | "OI_CADENCE_GAP"
  | "PARTIAL_EXPIRY_COVERAGE"
  | "CRITICAL_FIELD_UNKNOWN";

export interface ContractIdentity {
  underlying: string;
  exchange?: string | null;
  segment?: string | null;
  instrumentToken?: string | number | null;
  tradingSymbol?: string | null;
  expiry?: string | null;
  strike?: number | null;
  optionType?: "CE" | "PE" | null;
  resolverVersion?: string | null;
}

export interface SourceTruthEnvelope {
  identity: ContractIdentity | null;
  sourceProvider: SourceProvider;
  sourceTimestamp: string | null;
  receivedAt: string;
  computedAt?: string | null;
  dataAgeMs: number | null;
  freshnessState: FreshnessState;
  identityState: IdentityState;
  qualityState: QualityState;
  usability: EvidenceUsability;
  reasonCodes: SourceTruthReasonCode[];
  sourceVersion?: string | null;
  calculationVersion?: string | null;
}
