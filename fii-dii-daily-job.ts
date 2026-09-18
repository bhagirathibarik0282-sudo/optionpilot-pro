import { fetchOfficialFiiDiiLiveV3 } from "./canonical-fii-dii-live-fetch-v3.js";
import { normalizedCashFromOfficialRows } from "./canonical-fii-dii-production-row.js";
import { assertFiiDiiSessionNotBehindMarketSession } from "./canonical-fii-dii-production-readiness.js";
import { fetchNseParticipantDerivatives } from "./fii-dii-nse.js";
import {
  ensureFiiDiiSchema,
  latestRecordedMarketSessionDate,
  upsertFiiDiiCashDaily,
  upsertNseParticipantDerivativesDaily,
  withFiiDiiDb,
} from "./fii-dii-store.js";

async function main(): Promise<void> {
  const result = await withFiiDiiDb(async (pool) => {
    await ensureFiiDiiSchema(pool);

    const fetched = await fetchOfficialFiiDiiLiveV3({ retryCount: 2 }, fetch);
    if (!fetched.ok || !fetched.sourceUrl) {
      throw new Error(fetched.blocker ?? "FII_DII_OFFICIAL_FETCH_FAILED");
    }

    const data = normalizedCashFromOfficialRows({
      rows: fetched.rows,
      sourceUrl: fetched.sourceUrl,
    });

    let expectedMarketSessionDate: string | null = null;
    try {
      expectedMarketSessionDate = await latestRecordedMarketSessionDate(pool);
      assertFiiDiiSessionNotBehindMarketSession(data.date, expectedMarketSessionDate);
    } catch (err) {
      const message = err instanceof Error ? err.message : "FII_DII_FRESHNESS_CHECK_FAILED";
      if (message.startsWith("FII_DII_OFFICIAL_SESSION_BEHIND_MARKET:")) throw err;
      console.warn("[FII_DII_DAILY] freshness comparison unavailable", message);
    }

    await upsertFiiDiiCashDaily(pool, data);

    const verify = await pool.query<{
      trade_date: string;
      source: string;
      source_url: string;
      fii_buy: number;
      fii_sell: number;
      fii_net: number;
      dii_buy: number;
      dii_sell: number;
      dii_net: number;
    }>(`
      SELECT trade_date::text, source, source_url,
             fii_buy, fii_sell, fii_net, dii_buy, dii_sell, dii_net
      FROM fii_dii_cash_daily
      WHERE trade_date=$1::date
      LIMIT 1
    `, [data.date]);

    const stored = verify.rows[0];
    if (!stored) throw new Error("FII_DII_DB_READBACK_MISSING");
    if (
      stored.source !== data.source ||
      stored.source_url !== data.sourceUrl ||
      Number(stored.fii_buy) !== data.fii.buy ||
      Number(stored.fii_sell) !== data.fii.sell ||
      Number(stored.fii_net) !== data.fii.net ||
      Number(stored.dii_buy) !== data.dii.buy ||
      Number(stored.dii_sell) !== data.dii.sell ||
      Number(stored.dii_net) !== data.dii.net
    ) {
      throw new Error("FII_DII_DB_READBACK_MISMATCH");
    }

    const participantEnabled = process.env.NSE_PARTICIPANT_DERIVATIVES_ENABLED?.trim() === "1";
    let participantDerivatives: {
      enabled: boolean;
      storedRows: number;
      dbReadbackVerified: boolean;
    } = {
      enabled: participantEnabled,
      storedRows: 0,
      dbReadbackVerified: false,
    };

    if (participantEnabled) {
      const [oiRows, volumeRows] = await Promise.all([
        fetchNseParticipantDerivatives("OI", data.date, fetch),
        fetchNseParticipantDerivatives("VOLUME", data.date, fetch),
      ]);
      const participantRows = [...oiRows, ...volumeRows];
      await upsertNseParticipantDerivativesDaily(pool, participantRows);

      const participantReadback = await pool.query<{
        report_kind: string;
        participant: string;
        source_url: string;
      }>(`
        SELECT report_kind, participant, source_url
        FROM nse_participant_derivatives_daily
        WHERE trade_date=$1::date
          AND report_kind IN ('OI','VOLUME')
        ORDER BY report_kind, participant
      `, [data.date]);

      if (participantReadback.rows.length !== participantRows.length) {
        throw new Error(`NSE_PARTICIPANT_DB_READBACK_COUNT_MISMATCH:${participantReadback.rows.length}:EXPECTED:${participantRows.length}`);
      }
      const expectedByIdentity = new Map(
        participantRows.map((row) => [`${row.reportKind}:${row.participant}`, row.sourceUrl]),
      );
      for (const row of participantReadback.rows) {
        const identity = `${row.report_kind}:${row.participant}`;
        if (expectedByIdentity.get(identity) !== row.source_url) {
          throw new Error(`NSE_PARTICIPANT_DB_READBACK_MISMATCH:${identity}`);
        }
      }

      participantDerivatives = {
        enabled: true,
        storedRows: participantRows.length,
        dbReadbackVerified: true,
      };
    }

    return {
      storedTradeDate: data.date,
      expectedMarketSessionDate,
      source: data.source,
      sourceUrl: data.sourceUrl,
      fetchedAt: data.fetchedAt,
      attempts: fetched.attempts,
      fii: data.fii,
      dii: data.dii,
      dbReadbackVerified: true,
      participantDerivatives,
    };
  });

  console.log("[FII_DII_DAILY] success", JSON.stringify(result));
}

main().catch((err) => {
  console.error("[FII_DII_DAILY] failed", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
