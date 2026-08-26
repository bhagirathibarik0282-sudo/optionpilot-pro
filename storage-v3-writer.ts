import {
  dbUpsertMarketSnapshot1m,
  dbUpsertOptionSnapshot1m,
  dbUpsertChainState1m,
  type MarketSnapshot1mRow,
  type OptionSnapshot1mRow,
  type ChainState1mRow,
} from "./db.js";
import { persistClosedTimeframesFromMinute } from "./timeframe-storage.js";
import {
  persistSourceTruthRecords,
  sourceTruthShadowEnabled,
  type SourceTruthPersistenceRecord,
} from "./source-truth-db.js";
import { promoteSourceTruthRecords } from "./source-truth-promotion.js";
import { persistOptionModelTruthRecords } from "./option-model-truth-db.js";
import { buildPhase38ModelTruth } from "./phase38-model-provenance.js";
import {
  reconstructRestartSafeDerivatives,
  persistRestartReconstructionAudits,
} from "./restart-safe-derivatives.js";
import { persistChainMetricTruth, type ChainMetricTruthRecord } from "./chain-metric-truth.js";

export type StorageV3Symbol = "NIFTY" | "BANKNIFTY" | "SENSEX";

export interface StorageV3MinutePayload {
  market: MarketSnapshot1mRow;
  options?: OptionSnapshot1mRow[];
  chains?: ChainState1mRow[];
  sourceTruth?: SourceTruthPersistenceRecord[];
  chainMetricTruth?: ChainMetricTruthRecord[];
}

export interface StorageV3WriteResult {
  ok: boolean;
  marketWrites: number;
  optionWrites: number;
  chainWrites: number;
  truthWrites?: number;
  modelTruthWrites?: number;
  reconstructionAuditWrites?: number;
  chainMetricTruthWrites?: number;
}

const INDIA_TIME_ZONE = "Asia/Kolkata";
const MARKET_OPEN_MINUTE_IST = 9 * 60 + 15;
const MARKET_CLOSE_MINUTE_IST = 15 * 60 + 30;

function storageSessionAllowed(now: Date = new Date()): boolean {
  if (!Number.isFinite(now.getTime())) return false;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: INDIA_TIME_ZONE, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false;
  if (weekday === "Sat" || weekday === "Sun") return false;
  const minuteOfDay = hour * 60 + minute;
  return minuteOfDay >= MARKET_OPEN_MINUTE_IST && minuteOfDay <= MARKET_CLOSE_MINUTE_IST;
}

function validSymbol(symbol: string): symbol is StorageV3Symbol {
  return symbol === "NIFTY" || symbol === "BANKNIFTY" || symbol === "SENSEX";
}

function sameMinuteBucket(payload: StorageV3MinutePayload): boolean {
  const bucket = payload.market.minuteBucket;
  return (payload.options ?? []).every((row) => row.minuteBucket === bucket) &&
    (payload.chains ?? []).every((row) => row.minuteBucket === bucket) &&
    (payload.sourceTruth ?? []).every((row) => row.minuteBucket === bucket) &&
    (payload.chainMetricTruth ?? []).every((row) => row.minuteBucket === bucket);
}

function zeroResult(): StorageV3WriteResult {
  return { ok:false, marketWrites:0, optionWrites:0, chainWrites:0, truthWrites:0, modelTruthWrites:0, reconstructionAuditWrites:0, chainMetricTruthWrites:0 };
}

/** STORAGE ONLY. No fetch/scoring/verdict/Telegram/execution side effect. */
export async function persistStorageV3Minute(payload: StorageV3MinutePayload): Promise<StorageV3WriteResult> {
  if (!storageSessionAllowed()) return zeroResult();
  if (!validSymbol(payload.market.symbol)) return zeroResult();
  if (!payload.market.minuteBucket || !sameMinuteBucket(payload)) return zeroResult();

  let market = { ...payload.market };
  let options = (payload.options ?? []).filter((row) => row.symbol === payload.market.symbol).map((row) => ({ ...row }));
  let chains = (payload.chains ?? []).filter((row) => row.symbol === payload.market.symbol).map((row) => ({ ...row }));
  const truth = promoteSourceTruthRecords((payload.sourceTruth ?? []).filter((row) => row.symbol === payload.market.symbol));
  const chainMetricTruth = (payload.chainMetricTruth ?? []).filter((row) => row.symbol === payload.market.symbol);
  const shadow = sourceTruthShadowEnabled();
  let reconstructionAudits = [] as Awaited<ReturnType<typeof reconstructRestartSafeDerivatives>>["audits"];

  try {
    if (shadow) {
      const rebuilt = await reconstructRestartSafeDerivatives(market, options, chains, truth);
      market = rebuilt.market;
      options = rebuilt.options;
      chains = rebuilt.chains;
      reconstructionAudits = rebuilt.audits;
    }

    await dbUpsertMarketSnapshot1m(market);
    for (const row of options) await dbUpsertOptionSnapshot1m(row);
    for (const row of chains) await dbUpsertChainState1m(row);

    let truthWrites = 0;
    let modelTruthWrites = 0;
    let reconstructionAuditWrites = 0;
    let chainMetricTruthWrites = 0;
    if (shadow) {
      if (truth.length) truthWrites = await persistSourceTruthRecords(truth);
      if (reconstructionAudits.length) reconstructionAuditWrites = await persistRestartReconstructionAudits(reconstructionAudits);
      if (chainMetricTruth.length) chainMetricTruthWrites = await persistChainMetricTruth(chainMetricTruth);
      if (options.length) {
        const modelRows = options.map((option) => buildPhase38ModelTruth(option, market));
        modelTruthWrites = await persistOptionModelTruthRecords(modelRows);
      }
    }

    await persistClosedTimeframesFromMinute(market.symbol, market.minuteBucket);
    return { ok:true, marketWrites:1, optionWrites:options.length, chainWrites:chains.length, truthWrites, modelTruthWrites, reconstructionAuditWrites, chainMetricTruthWrites };
  } catch (err) {
    console.error("[Storage V3] unexpected write failure:", err instanceof Error ? err.message : err);
    return zeroResult();
  }
}

export function minuteBucketUtcIso(timestamp: Date | string | number = new Date()): string {
  const date = timestamp instanceof Date ? new Date(timestamp.getTime()) : new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid timestamp for minute bucket");
  date.setUTCSeconds(0, 0);
  return date.toISOString();
}
