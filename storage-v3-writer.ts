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
import { persistUnknownModelTruthForOptions } from "./option-model-truth-db.js";

export type StorageV3Symbol = "NIFTY" | "BANKNIFTY" | "SENSEX";

export interface StorageV3MinutePayload {
  market: MarketSnapshot1mRow;
  options?: OptionSnapshot1mRow[];
  chains?: ChainState1mRow[];
  sourceTruth?: SourceTruthPersistenceRecord[];
}

export interface StorageV3WriteResult {
  ok: boolean;
  marketWrites: number;
  optionWrites: number;
  chainWrites: number;
  truthWrites?: number;
  modelTruthWrites?: number;
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
    (payload.sourceTruth ?? []).every((row) => row.minuteBucket === bucket);
}

/** STORAGE ONLY. No fetch/scoring/verdict/Telegram/execution side effect. */
export async function persistStorageV3Minute(payload: StorageV3MinutePayload): Promise<StorageV3WriteResult> {
  if (!storageSessionAllowed()) return { ok:false, marketWrites:0, optionWrites:0, chainWrites:0, truthWrites:0, modelTruthWrites:0 };
  if (!validSymbol(payload.market.symbol)) return { ok:false, marketWrites:0, optionWrites:0, chainWrites:0, truthWrites:0, modelTruthWrites:0 };
  if (!payload.market.minuteBucket || !sameMinuteBucket(payload)) return { ok:false, marketWrites:0, optionWrites:0, chainWrites:0, truthWrites:0, modelTruthWrites:0 };

  const options = (payload.options ?? []).filter((row) => row.symbol === payload.market.symbol);
  const chains = (payload.chains ?? []).filter((row) => row.symbol === payload.market.symbol);
  const truth = promoteSourceTruthRecords((payload.sourceTruth ?? []).filter((row) => row.symbol === payload.market.symbol));

  try {
    await dbUpsertMarketSnapshot1m(payload.market);
    for (const row of options) await dbUpsertOptionSnapshot1m(row);
    for (const row of chains) await dbUpsertChainState1m(row);

    let truthWrites = 0;
    let modelTruthWrites = 0;
    if (sourceTruthShadowEnabled()) {
      if (truth.length) truthWrites = await persistSourceTruthRecords(truth);
      // Current live snapshot does not yet prove IV/Greek model provenance.
      // Persist that absence explicitly so Greek-dependent research fails closed.
      if (options.length) modelTruthWrites = await persistUnknownModelTruthForOptions(options);
    }

    await persistClosedTimeframesFromMinute(payload.market.symbol, payload.market.minuteBucket);
    return { ok:true, marketWrites:1, optionWrites:options.length, chainWrites:chains.length, truthWrites, modelTruthWrites };
  } catch (err) {
    console.error("[Storage V3] unexpected write failure:", err instanceof Error ? err.message : err);
    return { ok:false, marketWrites:0, optionWrites:0, chainWrites:0, truthWrites:0, modelTruthWrites:0 };
  }
}

export function minuteBucketUtcIso(timestamp: Date | string | number = new Date()): string {
  const date = timestamp instanceof Date ? new Date(timestamp.getTime()) : new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid timestamp for minute bucket");
  date.setUTCSeconds(0, 0);
  return date.toISOString();
}
