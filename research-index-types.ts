export type ResearchIndexCode =
  | "NIFTY50"
  | "NIFTY100"
  | "NIFTY200"
  | "NIFTY500"
  | "NEXT50"
  | "MIDCAP150"
  | "SMALLCAP250";

export type FreshnessStatus = "FRESH" | "STALE" | "UNKNOWN";
export type ValidationStatus = "VALID" | "INVALID" | "PARTIAL";
export type DataQualityStatus = "GOOD" | "PARTIAL" | "STALE" | "INVALID";

export interface ResearchIndexDailyRecord {
  tradeDate: string;
  indexCode: ResearchIndexCode;
  indexName: string;
  open: number;
  high: number;
  low: number;
  close: number;
  triClose: number | null;
  source: string;
  sourceTimestamp: string | null;
  freshnessStatus: FreshnessStatus;
  validationStatus: ValidationStatus;
}

export interface ResearchIndexMetrics {
  tradeDate: string;
  indexCode: ResearchIndexCode;
  return1d: number | null;
  return5d: number | null;
  return20d: number | null;
  return60d: number | null;
  return120d: number | null;
  return252d: number | null;
  rsVsNifty50_5d: number | null;
  rsVsNifty50_20d: number | null;
  rsVsNifty50_60d: number | null;
}

export interface ValidationResult {
  valid: boolean;
  status: ValidationStatus;
  warnings: string[];
  errors: string[];
}

export interface ResearchIndexImporter {
  fetchHistorical(
    indexCode: ResearchIndexCode,
    from: string,
    to: string,
  ): Promise<ResearchIndexDailyRecord[]>;
  fetchLatest(indexCode: ResearchIndexCode): Promise<ResearchIndexDailyRecord | null>;
}

export interface ResearchIndexStore {
  upsertDaily(record: ResearchIndexDailyRecord): Promise<boolean>;
  upsertMetrics(metrics: ResearchIndexMetrics): Promise<boolean>;
  getHistory(indexCode: ResearchIndexCode, limit?: number): Promise<ResearchIndexDailyRecord[]>;
  getHistoryRange(
    indexCode: ResearchIndexCode,
    from: string,
    to: string,
  ): Promise<ResearchIndexDailyRecord[]>;
  getLatest(indexCode: ResearchIndexCode): Promise<ResearchIndexDailyRecord | null>;
  getMetrics(indexCode: ResearchIndexCode, limit?: number): Promise<ResearchIndexMetrics[]>;
}

export interface ResearchIndexDerivedEngine {
  buildMetrics(
    history: ResearchIndexDailyRecord[],
    nifty50History: ResearchIndexDailyRecord[],
  ): ResearchIndexMetrics[];
}
