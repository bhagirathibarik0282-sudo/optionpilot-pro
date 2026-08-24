// OptionPilot Pro — 7-Index Daily Research Auto Updater
//
// Purpose:
//   Keep the Graham/Bogle broad-market research history current without
//   requiring a manual CSV upload every day.
//
// Source of truth:
//   NSE Indices Limited official Daily Snapshot CSV:
//   https://www.niftyindices.com/Daily_Snapshot/ind_close_all_DDMMYYYY.csv
//
// Safety / scope:
//   - Research data only. Does NOT affect live verdicts, scoring, Telegram,
//     candidate selection, or order execution.
//   - Idempotent: UNIQUE(index_key, trade_date) + ON CONFLICT UPDATE.
//   - Gap recovery: each run scans a small rolling calendar lookback so a
//     missed Railway run, weekend, or holiday does not require manual repair.
//   - Fail closed: a day is considered complete only when all 7 required
//     indices are present in the same official snapshot.

import pg from "pg";

const { Pool } = pg;

const INDEXES = [
  { key: "NIFTY50", sourceName: "Nifty 50" },
  { key: "NEXT50", sourceName: "Nifty Next 50" },
  { key: "NIFTY100", sourceName: "Nifty 100" },
  { key: "NIFTY200", sourceName: "Nifty 200" },
  { key: "NIFTY500", sourceName: "Nifty 500" },
  { key: "MIDCAP150", sourceName: "Nifty Midcap 150" },
  { key: "SMALLCAP250", sourceName: "Nifty Smallcap 250" },
];

const SOURCE_BY_NAME = new Map(INDEXES.map((x) => [x.sourceName.toLowerCase(), x]));
const LOOKBACK_DAYS = Math.max(1, Math.min(30, Number(process.env.RESEARCH_INDEX_LOOKBACK_DAYS || 10)));
const REQUEST_TIMEOUT_MS = Math.max(5_000, Math.min(60_000, Number(process.env.RESEARCH_INDEX_HTTP_TIMEOUT_MS || 20_000)));

function istCalendarDate(offsetDays = 0) {
  const now = new Date();
  const istMs = now.getTime() + (5 * 60 + 30) * 60 * 1000;
  const d = new Date(istMs);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function snapshotUrl(date) {
  const ddmmyyyy = `${pad2(date.day)}${pad2(date.month)}${date.year}`;
  return `https://www.niftyindices.com/Daily_Snapshot/ind_close_all_${ddmmyyyy}.csv`;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }

  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ""));
}

function num(value) {
  const s = String(value ?? "").trim();
  if (!s || s === "-") return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseTradeDate(value) {
  const m = String(value || "").trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function rowsFromSnapshot(csvText, sourceUrl) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) return { rows: [], errors: ["CSV_EMPTY_OR_HEADER_ONLY"] };

  const header = rows[0].map((x) => x.trim());
  const idx = Object.fromEntries(header.map((name, i) => [name, i]));
  const requiredHeaders = [
    "Index Name",
    "Index Date",
    "Open Index Value",
    "High Index Value",
    "Low Index Value",
    "Closing Index Value",
  ];
  const missingHeaders = requiredHeaders.filter((h) => idx[h] == null);
  if (missingHeaders.length) {
    return { rows: [], errors: [`MISSING_HEADERS:${missingHeaders.join("|")}`] };
  }

  const found = new Map();
  for (const r of rows.slice(1)) {
    const rawName = String(r[idx["Index Name"]] || "").trim();
    const def = SOURCE_BY_NAME.get(rawName.toLowerCase());
    if (!def) continue;

    const tradeDate = parseTradeDate(r[idx["Index Date"]]);
    const open = num(r[idx["Open Index Value"]]);
    const high = num(r[idx["High Index Value"]]);
    const low = num(r[idx["Low Index Value"]]);
    const close = num(r[idx["Closing Index Value"]]);

    if (!tradeDate || open == null || high == null || low == null || close == null) continue;

    found.set(def.key, {
      indexKey: def.key,
      indexName: def.sourceName,
      tradeDate,
      open,
      high,
      low,
      close,
      pointsChange: idx["Points Change"] == null ? null : num(r[idx["Points Change"]]),
      changePct: idx["Change(%)"] == null ? null : num(r[idx["Change(%)"]]),
      volume: idx["Volume"] == null ? null : num(r[idx["Volume"]]),
      turnoverCr: idx["Turnover (Rs. Cr.)"] == null ? null : num(r[idx["Turnover (Rs. Cr.)"]]),
      pe: idx["P/E"] == null ? null : num(r[idx["P/E"]]),
      pb: idx["P/B"] == null ? null : num(r[idx["P/B"]]),
      divYield: idx["Div Yield"] == null ? null : num(r[idx["Div Yield"]]),
      sourceUrl,
    });
  }

  const missing = INDEXES.filter((x) => !found.has(x.key)).map((x) => x.key);
  const parsed = INDEXES.map((x) => found.get(x.key)).filter(Boolean);
  const dates = [...new Set(parsed.map((x) => x.tradeDate))];
  const errors = [];
  if (missing.length) errors.push(`MISSING_INDEXES:${missing.join("|")}`);
  if (dates.length > 1) errors.push(`MIXED_TRADE_DATES:${dates.join("|")}`);

  return { rows: parsed, errors };
}

async function fetchSnapshot(date) {
  const url = snapshotUrl(date);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "OptionPilot-Pro-Research-Updater/1.0",
        accept: "text/csv,application/octet-stream,*/*",
      },
    });
    if (response.status === 404) return { status: "NO_REPORT", url, rows: [], errors: [] };
    if (!response.ok) return { status: "HTTP_ERROR", url, rows: [], errors: [`HTTP_${response.status}`] };

    const text = await response.text();
    const parsed = rowsFromSnapshot(text, url);
    if (parsed.errors.length || parsed.rows.length !== INDEXES.length) {
      return { status: "INVALID_REPORT", url, ...parsed };
    }
    return { status: "OK", url, ...parsed };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { status: "FETCH_ERROR", url, rows: [], errors: [msg] };
  } finally {
    clearTimeout(timer);
  }
}

function poolFromEnv() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL is required for the research daily updater");
  const isLocal = /localhost|127\.0\.0\.1/.test(url);
  return new Pool({
    connectionString: url,
    max: 2,
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
  });
}

async function ensureSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS research_index_daily (
      index_key TEXT NOT NULL,
      index_name TEXT NOT NULL,
      trade_date DATE NOT NULL,
      open NUMERIC NOT NULL,
      high NUMERIC NOT NULL,
      low NUMERIC NOT NULL,
      close NUMERIC NOT NULL,
      points_change NUMERIC,
      change_pct NUMERIC,
      volume NUMERIC,
      turnover_cr NUMERIC,
      pe NUMERIC,
      pb NUMERIC,
      div_yield NUMERIC,
      source TEXT NOT NULL DEFAULT 'NSE_INDICES_DAILY_SNAPSHOT',
      source_url TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (index_key, trade_date)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_research_index_daily_date ON research_index_daily (trade_date DESC);`);
}

async function upsertRows(pool, rows) {
  const sql = `
    INSERT INTO research_index_daily (
      index_key, index_name, trade_date, open, high, low, close,
      points_change, change_pct, volume, turnover_cr, pe, pb, div_yield,
      source, source_url, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
      'NSE_INDICES_DAILY_SNAPSHOT',$15,now()
    )
    ON CONFLICT (index_key, trade_date) DO UPDATE SET
      index_name = EXCLUDED.index_name,
      open = EXCLUDED.open,
      high = EXCLUDED.high,
      low = EXCLUDED.low,
      close = EXCLUDED.close,
      points_change = EXCLUDED.points_change,
      change_pct = EXCLUDED.change_pct,
      volume = EXCLUDED.volume,
      turnover_cr = EXCLUDED.turnover_cr,
      pe = EXCLUDED.pe,
      pb = EXCLUDED.pb,
      div_yield = EXCLUDED.div_yield,
      source = EXCLUDED.source,
      source_url = EXCLUDED.source_url,
      updated_at = now()
  `;

  await pool.query("BEGIN");
  try {
    for (const row of rows) {
      await pool.query(sql, [
        row.indexKey,
        row.indexName,
        row.tradeDate,
        row.open,
        row.high,
        row.low,
        row.close,
        row.pointsChange,
        row.changePct,
        row.volume,
        row.turnoverCr,
        row.pe,
        row.pb,
        row.divYield,
        row.sourceUrl,
      ]);
    }
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }
}

async function coverageReport(pool) {
  const keys = INDEXES.map((x) => x.key);
  const result = await pool.query(
    `SELECT index_key, MAX(trade_date)::text AS latest_trade_date, COUNT(*)::int AS observations
       FROM research_index_daily
      WHERE index_key = ANY($1::text[])
      GROUP BY index_key`,
    [keys],
  );
  const byKey = new Map(result.rows.map((r) => [r.index_key, r]));
  const items = INDEXES.map((x) => ({
    indexKey: x.key,
    latestTradeDate: byKey.get(x.key)?.latest_trade_date || null,
    observations: byKey.get(x.key)?.observations || 0,
  }));
  const latestDates = items.map((x) => x.latestTradeDate).filter(Boolean);
  const commonLatestDate = latestDates.length === INDEXES.length && new Set(latestDates).size === 1
    ? latestDates[0]
    : null;
  return {
    coverage: `${items.filter((x) => x.latestTradeDate).length}/${INDEXES.length}`,
    alignedLatestDate: commonLatestDate != null,
    latestTradeDate: commonLatestDate,
    items,
  };
}

async function main() {
  const pool = poolFromEnv();
  const runStartedAt = new Date().toISOString();
  const fetched = [];
  let upsertedTradingDays = 0;

  try {
    await ensureSchema(pool);

    // Search a rolling window. Weekends/holidays simply return NO_REPORT.
    // Re-reading recent trading days is intentional: ON CONFLICT makes this
    // safe and repairs a previously incomplete run automatically.
    for (let offset = 0; offset > -LOOKBACK_DAYS; offset -= 1) {
      const date = istCalendarDate(offset);
      const result = await fetchSnapshot(date);
      fetched.push({ status: result.status, url: result.url, errors: result.errors });
      if (result.status !== "OK") continue;
      await upsertRows(pool, result.rows);
      upsertedTradingDays += 1;
    }

    const coverage = await coverageReport(pool);
    const ok = coverage.coverage === "7/7" && coverage.alignedLatestDate;
    const summary = {
      ok,
      mode: "RESEARCH_DAILY_AUTO_UPDATE",
      productionImpact: "NONE",
      source: "NSE_INDICES_OFFICIAL_DAILY_SNAPSHOT",
      runStartedAt,
      runFinishedAt: new Date().toISOString(),
      lookbackCalendarDays: LOOKBACK_DAYS,
      upsertedTradingDays,
      ...coverage,
      fetched,
    };

    console.log(JSON.stringify(summary, null, 2));
    if (!ok) process.exitCode = 2;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    mode: "RESEARCH_DAILY_AUTO_UPDATE",
    productionImpact: "NONE",
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
});
