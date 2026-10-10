// OptionPilot EOD archive coverage inventory. Standalone, read-only, never runs on app startup.
// Usage: node scripts/eod-archive-coverage-audit.mjs
// This intentionally does not authorize retention or restore; counts are not row-identity proof.
import pg from "pg";
const { Pool } = pg;
const SOURCES = [
  [
    "marketSnapshots",
    "market_snapshot_1m",
    "(minute_bucket AT TIME ZONE 'Asia/Kolkata')::date::text",
    ""
  ],
  [
    "optionSnapshots",
    "option_snapshot_1m",
    "(minute_bucket AT TIME ZONE 'Asia/Kolkata')::date::text",
    ""
  ],
  [
    "chainStates",
    "chain_state_1m",
    "(minute_bucket AT TIME ZONE 'Asia/Kolkata')::date::text",
    ""
  ],
  [
    "timeframeStates",
    "timeframe_state",
    "(block_end AT TIME ZONE 'Asia/Kolkata')::date::text",
    ""
  ],
  [
    "candidates",
    "candidate_history",
    "(observed_at AT TIME ZONE 'Asia/Kolkata')::date::text",
    ""
  ],
  [
    "tradePlans",
    "trade_plan_history",
    "(created_at AT TIME ZONE 'Asia/Kolkata')::date::text",
    ""
  ],
  [
    "tradeEvents",
    "trade_event_history",
    "(event_at AT TIME ZONE 'Asia/Kolkata')::date::text",
    ""
  ],
  [
    "meaningfulNarrativeEvents",
    "app_state_log",
    "(created_at AT TIME ZONE 'Asia/Kolkata')::date::text",
    "kind = 'meaningful_narrative_event'"
  ],
  [
    "researchMemories",
    "app_state_log",
    "payload->>'tradeDate'",
    "kind IN ('CAS_CLOSING_FIXED_CONTRACT_MEMORY_V1','INTRADAY_NOTABLE_EVENT_V1','INTRADAY_PREMIUM_RESPONSE_V1','INTRADAY_MEMORY_SESSION_RECEIPT_V1') AND payload->>'tradeDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'"
  ]
];
const RECEIPT_SQL = "SELECT COALESCE(r.trading_date,p.trading_date)::text AS trading_date, r.status, r.record_count AS receipt_count, r.drive_file_id, r.checksum_sha256, p.record_count AS payload_count, p.payload->>'schemaVersion' AS schema_version, jsonb_build_object('marketSnapshots',jsonb_array_length(COALESCE(p.payload->'marketSnapshots','[]'::jsonb)),'optionSnapshots',jsonb_array_length(COALESCE(p.payload->'optionSnapshots','[]'::jsonb)),'chainStates',jsonb_array_length(COALESCE(p.payload->'chainStates','[]'::jsonb)),'timeframeStates',jsonb_array_length(COALESCE(p.payload->'timeframeStates','[]'::jsonb)),'candidates',jsonb_array_length(COALESCE(p.payload->'candidates','[]'::jsonb)),'tradePlans',jsonb_array_length(COALESCE(p.payload->'tradePlans','[]'::jsonb)),'tradeEvents',jsonb_array_length(COALESCE(p.payload->'tradeEvents','[]'::jsonb)),'meaningfulNarrativeEvents',jsonb_array_length(COALESCE(p.payload->'meaningfulNarrativeEvents','[]'::jsonb)),'researchMemories',jsonb_array_length(COALESCE(p.payload->'researchMemories','[]'::jsonb))) AS payload_counts FROM eod_archive_runs r FULL JOIN eod_archive_payloads p ON p.trading_date=r.trading_date ORDER BY COALESCE(r.trading_date,p.trading_date)";
const url = process.env.DATABASE_URL?.trim();
if (!url) { console.error("EOD_COVERAGE_DATABASE_URL_NOT_SET"); process.exitCode=2; }
else {
  const isLocal = /localhost|127\.0\.0\.1/.test(url);
  const pool = new Pool({ connectionString: url, max: 1, ssl: isLocal ? undefined : { rejectUnauthorized: false } });
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '45000ms'");
    const tables = [...new Set([...SOURCES.map((s)=>s[1]),"eod_archive_runs","eod_archive_payloads"])];
    const absent=[];
    for (const table of tables) {
      const found = await client.query("SELECT to_regclass($1) IS NOT NULL AS exists", ["public."+table]);
      if (!found.rows[0]?.exists) absent.push(table);
    }
    if (absent.length) throw new Error("REQUIRED_TABLES_MISSING:"+absent.join(","));
    const dateMap = new Map();
    for (const [category,table,dateExpr,where] of SOURCES) {
      const sql = "SELECT "+dateExpr+" AS trade_date, COUNT(*)::bigint AS n FROM "+table+(where?" WHERE "+where:"")+" GROUP BY 1 ORDER BY 1";
      const rows = await client.query(sql);
      for (const r of rows.rows) {
        if (!r.trade_date) continue;
        const current = dateMap.get(r.trade_date)||{ tradingDate:r.trade_date, sourceCounts:{} };
        current.sourceCounts[category] = Number(r.n);
        dateMap.set(r.trade_date,current);
      }
    }
    const receipts = await client.query(RECEIPT_SQL);
    for (const r of receipts.rows) {
      const current = dateMap.get(r.trading_date)||{ tradingDate:r.trading_date, sourceCounts:{} };
      current.receipt = r;
      dateMap.set(r.trading_date,current);
    }
    const dates=[...dateMap.values()].sort((a,b)=>a.tradingDate.localeCompare(b.tradingDate)).map(item=>{
      const sourceCount=Object.values(item.sourceCounts).reduce((a,b)=>a+b,0);
      const receipt=item.receipt;
      const payloadCounts=receipt?.payload_counts||{};
      const payloadSum=Object.values(payloadCounts).reduce((a,b)=>a+Number(b||0),0);
      const matchingGroups = SOURCES.every(([name])=>Number(item.sourceCounts[name]||0)===Number(payloadCounts[name]||0));
      let status;
      if (!sourceCount) status="NO_SOURCE_ROWS_TO_COMPARE";
      else if (!receipt || receipt.status!=="DRIVE_VERIFIED" || !receipt.drive_file_id || !receipt.checksum_sha256) status="NO_VERIFIED_DRIVE_RECEIPT";
      else if (receipt.schema_version!=="EOD_ARCHIVE_V2") status="NOT_V2_ARCHIVE";
      else if (Number(receipt.receipt_count)!==sourceCount || Number(receipt.payload_count)!==sourceCount || payloadSum!==sourceCount || !matchingGroups) status="COUNT_MISMATCH_OR_LATE_ROWS";
      else status="DB_RECEIPT_COUNTS_MATCH_ONLY";
      return {
        tradingDate:item.tradingDate, sourceCount, sourceCounts:item.sourceCounts,
        archiveStatus:receipt?.status||null, driveFileId:receipt?.drive_file_id||null,
        schemaVersion:receipt?.schema_version||null, receiptCount:receipt?Number(receipt.receipt_count):null,
        payloadCount:receipt?Number(receipt.payload_count):null, payloadEmbeddedCount:receipt?payloadSum:null,
        sourcePayloadCategoryMatch:receipt?matchingGroups:false, safetyStatus:status,
      };
    });
    await client.query("COMMIT");
    console.log(JSON.stringify({
      mode:"READ_ONLY_EOD_ARCHIVE_COVERAGE_V1",
      generatedAt:new Date().toISOString(),
      isolation:"REPEATABLE_READ_READ_ONLY",
      productionWrites:0, deletionAuthorized:false,
      limitations:["No current Google Drive byte download or checksum comparison in this script","Count parity never proves exact row identity or successful restore","Only EOD V2 selected tables; not a full PostgreSQL backup"],
      dayCount:dates.length, dates
    },null,2));
  } catch(e) {
    try { if(client) await client.query("ROLLBACK"); } catch {}
    console.error("EOD_COVERAGE_AUDIT_FAILED:"+(e instanceof Error?e.message:String(e)));
    process.exitCode=1;
  } finally {
    if(client) client.release();
    await pool.end();
  }
}
