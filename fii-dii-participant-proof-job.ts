import { pathToFileURL } from "node:url";
import {
  fetchNseParticipantDerivativesWithRetry,
  normalizeNseDate,
} from "./fii-dii-nse.js";
import {
  ensureFiiDiiSchema,
  upsertNseParticipantDerivativesDaily,
  withFiiDiiDb,
} from "./fii-dii-store.js";

type ReadbackRow = {
  report_kind: string;
  participant: string;
  source_url: string;
};

export function requireParticipantProofWriteEnabled(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NSE_PARTICIPANT_PROOF_WRITE_ENABLED?.trim() !== "1") {
    throw new Error("NSE_PARTICIPANT_PROOF_WRITE_ENABLED_REQUIRED");
  }
}

export function participantProofTradeDate(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.NSE_PARTICIPANT_PROOF_TRADE_DATE?.trim() ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error("NSE_PARTICIPANT_PROOF_TRADE_DATE_REQUIRED_ISO");
  }
  const normalized = normalizeNseDate(raw);
  if (normalized !== raw) throw new Error("NSE_PARTICIPANT_PROOF_TRADE_DATE_INVALID");
  return raw;
}

export function assertParticipantProofReadback(
  rows: ReadbackRow[],
  expectedByIdentity: Map<string, string>,
): void {
  if (rows.length !== 8) {
    throw new Error(`NSE_PARTICIPANT_PROOF_DB_READBACK_COUNT_MISMATCH:${rows.length}:EXPECTED:8`);
  }
  const identities = new Set(rows.map((row) => `${row.report_kind}:${row.participant}`));
  if (identities.size !== 8) {
    throw new Error(`NSE_PARTICIPANT_PROOF_DB_IDENTITY_COUNT_MISMATCH:${identities.size}:EXPECTED:8`);
  }
  for (const row of rows) {
    const identity = `${row.report_kind}:${row.participant}`;
    const expectedSourceUrl = expectedByIdentity.get(identity);
    if (!expectedSourceUrl || expectedSourceUrl !== row.source_url) {
      throw new Error(`NSE_PARTICIPANT_PROOF_DB_SOURCE_MISMATCH:${identity}`);
    }
  }
}

export async function runParticipantProof(tradeDate: string) {
  return withFiiDiiDb(async (pool) => {
    await ensureFiiDiiSchema(pool);

    const [oiFetch, volumeFetch] = await Promise.all([
      fetchNseParticipantDerivativesWithRetry("OI", tradeDate, { retryCount: 2, baseDelayMs: 750 }, fetch),
      fetchNseParticipantDerivativesWithRetry("VOLUME", tradeDate, { retryCount: 2, baseDelayMs: 750 }, fetch),
    ]);
    const rows = [...oiFetch.rows, ...volumeFetch.rows];
    if (rows.length !== 8) {
      throw new Error(`NSE_PARTICIPANT_PROOF_FETCH_COUNT_MISMATCH:${rows.length}:EXPECTED:8`);
    }

    const expectedByIdentity = new Map(rows.map((row) => [
      `${row.reportKind}:${row.participant}`,
      row.sourceUrl,
    ]));
    if (expectedByIdentity.size !== 8) {
      throw new Error(`NSE_PARTICIPANT_PROOF_FETCH_IDENTITY_COUNT_MISMATCH:${expectedByIdentity.size}:EXPECTED:8`);
    }

    await upsertNseParticipantDerivativesDaily(pool, rows);

    const readback = await pool.query<ReadbackRow>(`
      SELECT report_kind, participant, source_url
      FROM nse_participant_derivatives_daily
      WHERE trade_date=$1::date
        AND report_kind IN ('OI','VOLUME')
        AND participant IN ('CLIENT','DII','FII','PRO')
      ORDER BY report_kind, participant
    `, [tradeDate]);

    assertParticipantProofReadback(readback.rows, expectedByIdentity);

    return {
      tradeDate,
      storedRows: readback.rows.length,
      expectedRows: 8,
      dbReadbackVerified: true,
      attempts: oiFetch.attempts + volumeFetch.attempts,
      source: "OFFICIAL_NSE" as const,
      readOnlyConsumer: false as const,
      contextOnly: true as const,
      affectsVerdict: false as const,
      affectsCandidate: false as const,
      affectsTelegram: false as const,
      affectsExecution: false as const,
    };
  });
}

async function main(): Promise<void> {
  requireParticipantProofWriteEnabled();
  const tradeDate = participantProofTradeDate();
  const result = await runParticipantProof(tradeDate);
  console.log("[FII_DII_PARTICIPANT_PROOF] success", JSON.stringify(result));
}

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (invokedDirectly) {
  main().catch((err) => {
    console.error("[FII_DII_PARTICIPANT_PROOF] failed", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
