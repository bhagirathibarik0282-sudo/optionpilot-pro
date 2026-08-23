import type { ResearchIndexCode, ResearchIndexDailyRecord, ResearchIndexStore } from "./research-index-types.js";
import type { ResearchIndexImporter } from "./research-index-types.js";
import { RESEARCH_INDEX_CODES } from "./research-index-health.js";
import { validateResearchIndexRecord } from "./research-index-validator.js";

export interface ResearchIndexLoadItem {
  indexCode: ResearchIndexCode;
  requested: number;
  valid: number;
  rejected: number;
  written: number;
  writeFailed: number;
  firstTradeDate: string | null;
  lastTradeDate: string | null;
  warnings: string[];
  errors: string[];
}

export interface ResearchIndexLoadAudit {
  mode: "RESEARCH_MODE";
  productionImpact: "NONE";
  loadType: "LATEST" | "HISTORICAL_RANGE";
  startedAt: string;
  completedAt: string;
  from: string | null;
  to: string | null;
  totalRequested: number;
  totalValid: number;
  totalRejected: number;
  totalWritten: number;
  totalWriteFailed: number;
  items: ResearchIndexLoadItem[];
}

function sorted(records: ResearchIndexDailyRecord[]): ResearchIndexDailyRecord[] {
  return [...records].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
}

function prepareRecord(record: ResearchIndexDailyRecord): {
  record: ResearchIndexDailyRecord;
  valid: boolean;
  warnings: string[];
  errors: string[];
} {
  // Do not fabricate freshness. Official daily snapshots identify the trade
  // date but may not expose a trustworthy source timestamp.
  const base = { ...record };
  const validation = validateResearchIndexRecord(base);
  const normalized: ResearchIndexDailyRecord = {
    ...base,
    validationStatus: validation.status,
  };
  return {
    record: normalized,
    valid: validation.valid,
    warnings: validation.warnings,
    errors: validation.errors,
  };
}

async function persistBatch(
  indexCode: ResearchIndexCode,
  records: ResearchIndexDailyRecord[],
  store: ResearchIndexStore,
): Promise<ResearchIndexLoadItem> {
  let valid = 0;
  let rejected = 0;
  let written = 0;
  let writeFailed = 0;
  const warnings: string[] = [];
  const errors: string[] = [];
  const acceptedDates: string[] = [];

  for (const sourceRecord of sorted(records)) {
    const prepared = prepareRecord(sourceRecord);
    warnings.push(...prepared.warnings.map((x) => `${prepared.record.tradeDate}:${x}`));
    errors.push(...prepared.errors.map((x) => `${prepared.record.tradeDate}:${x}`));

    if (!prepared.valid) {
      rejected += 1;
      continue;
    }

    valid += 1;
    acceptedDates.push(prepared.record.tradeDate);
    const ok = await store.upsertDaily(prepared.record);
    if (ok) written += 1;
    else writeFailed += 1;
  }

  return {
    indexCode,
    requested: records.length,
    valid,
    rejected,
    written,
    writeFailed,
    firstTradeDate: acceptedDates[0] ?? null,
    lastTradeDate: acceptedDates.at(-1) ?? null,
    warnings,
    errors,
  };
}

function finishAudit(
  loadType: ResearchIndexLoadAudit["loadType"],
  startedAt: string,
  items: ResearchIndexLoadItem[],
  from: string | null,
  to: string | null,
): ResearchIndexLoadAudit {
  return {
    mode: "RESEARCH_MODE",
    productionImpact: "NONE",
    loadType,
    startedAt,
    completedAt: new Date().toISOString(),
    from,
    to,
    totalRequested: items.reduce((n, x) => n + x.requested, 0),
    totalValid: items.reduce((n, x) => n + x.valid, 0),
    totalRejected: items.reduce((n, x) => n + x.rejected, 0),
    totalWritten: items.reduce((n, x) => n + x.written, 0),
    totalWriteFailed: items.reduce((n, x) => n + x.writeFailed, 0),
    items,
  };
}

export async function loadLatestResearchIndices(
  importer: ResearchIndexImporter,
  store: ResearchIndexStore,
): Promise<ResearchIndexLoadAudit> {
  const startedAt = new Date().toISOString();
  const items: ResearchIndexLoadItem[] = [];

  for (const indexCode of RESEARCH_INDEX_CODES) {
    const record = await importer.fetchLatest(indexCode);
    items.push(await persistBatch(indexCode, record ? [record] : [], store));
  }

  return finishAudit("LATEST", startedAt, items, null, null);
}

export async function loadHistoricalResearchIndices(
  importer: ResearchIndexImporter,
  store: ResearchIndexStore,
  from: string,
  to: string,
): Promise<ResearchIndexLoadAudit> {
  const startedAt = new Date().toISOString();
  const items: ResearchIndexLoadItem[] = [];

  // Sequential by design: avoids hammering the official source and makes the
  // audit deterministic. Historical backfill is research work, not a latency
  // critical live-trading path.
  for (const indexCode of RESEARCH_INDEX_CODES) {
    const records = await importer.fetchHistorical(indexCode, from, to);
    items.push(await persistBatch(indexCode, records, store));
  }

  return finishAudit("HISTORICAL_RANGE", startedAt, items, from, to);
}
