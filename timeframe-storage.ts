import { dbQuerySafe } from "./db.js";
import type { StorageV3Symbol } from "./storage-v3-writer.js";

const TIMEFRAMES = [3, 15, 30, 60] as const;
type TfMinutes = typeof TIMEFRAMES[number];

type MarketRow = {
  minute_bucket: string | Date;
  spot_ltp: number | null;
  future_ltp: number | null;
  india_vix: number | null;
};

function marketOpenUtcMsFor(timestampMs: number): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestampMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const y = get("year"), m = get("month"), d = get("day");
  return Date.UTC(y, m - 1, d, 3, 45, 0, 0); // 09:15 IST
}

function closedBlockAt(minuteIso: string, tf: TfMinutes): { startIso: string; endIso: string } | null {
  const nowMs = new Date(minuteIso).getTime();
  if (!Number.isFinite(nowMs)) return null;
  const openMs = marketOpenUtcMsFor(nowMs);
  const tfMs = tf * 60_000;
  const elapsed = nowMs - openMs;
  if (elapsed <= 0 || elapsed % tfMs !== 0) return null;
  return {
    startIso: new Date(nowMs - tfMs).toISOString(),
    endIso: new Date(nowMs).toISOString(),
  };
}

function finite(values: Array<number | null>): number[] {
  return values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
}

export async function persistClosedTimeframesFromMinute(
  symbol: StorageV3Symbol,
  minuteBucket: string,
): Promise<void> {
  for (const tf of TIMEFRAMES) {
    const block = closedBlockAt(minuteBucket, tf);
    if (!block) continue;

    const data = await dbQuerySafe<MarketRow>(`
      SELECT minute_bucket, spot_ltp, future_ltp, india_vix
      FROM market_snapshot_1m
      WHERE symbol = $1
        AND minute_bucket >= $2::timestamptz
        AND minute_bucket < $3::timestamptz
      ORDER BY minute_bucket ASC
    `, [symbol, block.startIso, block.endIso]);
    if (!data || data.rows.length === 0) continue;

    const spot = finite(data.rows.map((r) => r.spot_ltp));
    const futures = finite(data.rows.map((r) => r.future_ltp));
    const vix = finite(data.rows.map((r) => r.india_vix));
    const sampleCount = data.rows.length;
    const coveragePct = Math.round((sampleCount / tf) * 1000) / 10;
    const dataQuality = sampleCount >= tf ? "COMPLETE_1M" : "PARTIAL_SAMPLING";

    const summary = {
      sampleCount,
      expected1mCount: tf,
      coveragePct,
      spot: spot.length ? { open: spot[0], close: spot[spot.length - 1], high: Math.max(...spot), low: Math.min(...spot) } : null,
      future: futures.length ? { open: futures[0], close: futures[futures.length - 1], high: Math.max(...futures), low: Math.min(...futures) } : null,
      indiaVix: vix.length ? { open: vix[0], close: vix[vix.length - 1], high: Math.max(...vix), low: Math.min(...vix) } : null,
      source: "market_snapshot_1m",
      semantics: "RAW_BLOCK_ARCHIVE_ONLY",
    };

    await dbQuerySafe(`
      INSERT INTO timeframe_state (
        symbol, timeframe, block_start, block_end,
        direction, strength, transition, regime,
        data_quality, state_code, evidence_compact, conflict_compact, rule_version
      ) VALUES ($1,$2,$3,$4,NULL,NULL,NULL,NULL,$5,$6,$7::jsonb,NULL,$8)
      ON CONFLICT (symbol, timeframe, block_end) DO UPDATE SET
        block_start=EXCLUDED.block_start,
        data_quality=EXCLUDED.data_quality,
        state_code=EXCLUDED.state_code,
        evidence_compact=EXCLUDED.evidence_compact,
        rule_version=EXCLUDED.rule_version
    `, [
      symbol,
      `${tf}M`,
      block.startIso,
      block.endIso,
      dataQuality,
      "RAW_BLOCK_ARCHIVE_ONLY",
      JSON.stringify(summary),
      "STORAGE_V3_TF_PHASE1",
    ]);
  }
}
