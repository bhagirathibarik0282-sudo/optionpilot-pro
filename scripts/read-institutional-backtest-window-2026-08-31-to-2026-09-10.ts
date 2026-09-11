import pg from "pg";

const { Pool } = pg;

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL_REQUIRED");
  const isLocal = /localhost|127\.0\.0\.1/.test(url);
  const pool = new Pool({ connectionString: url, ssl: isLocal ? undefined : { rejectUnauthorized: false }, max: 2 });
  try {
    const source = await pool.query(`
      SELECT trade_date::text, signal_eligible_from::text,
             fii_buy, fii_sell, fii_net, dii_buy, dii_sell, dii_net,
             fii_index_futures_net_change, fii_index_futures_net_position,
             fii_index_call_net_change, fii_index_call_net_position,
             fii_index_put_net_change, fii_index_put_net_position,
             derivative_behaviour, cash_source, derivative_source
      FROM institutional_daily_context
      WHERE trade_date BETWEEN '2026-08-31' AND '2026-09-10'
      ORDER BY trade_date
    `);

    if (source.rowCount !== 9) {
      throw new Error(`INSTITUTIONAL_BACKTEST_SOURCE_INCOMPLETE expected=9 actual=${source.rowCount}`);
    }

    const backtest = await pool.query(`
      SELECT
        c.signal_eligible_from::text AS trade_date,
        c.trade_date::text AS institutional_context_date,
        c.fii_net,
        c.dii_net,
        c.fii_index_futures_net_change,
        c.fii_index_futures_net_position,
        c.fii_index_call_net_change,
        c.fii_index_call_net_position,
        c.fii_index_put_net_change,
        c.fii_index_put_net_position,
        c.derivative_behaviour,
        o.nifty_close AS outcome_nifty_close,
        o.nifty_change_pct AS outcome_nifty_change_pct
      FROM institutional_daily_context c
      JOIN institutional_daily_context o
        ON o.trade_date = c.signal_eligible_from
      WHERE c.trade_date BETWEEN '2026-08-31' AND '2026-09-09'
        AND c.signal_eligible_from BETWEEN '2026-09-01' AND '2026-09-10'
      ORDER BY c.signal_eligible_from
    `);

    if (backtest.rowCount !== 8) {
      throw new Error(`INSTITUTIONAL_BACKTEST_WINDOW_INCOMPLETE expected=8 actual=${backtest.rowCount}`);
    }
    if (backtest.rows.some((r) => r.institutional_context_date >= r.trade_date)) {
      throw new Error("INSTITUTIONAL_BACKTEST_LOOKAHEAD_DETECTED");
    }

    console.log("[INSTITUTIONAL_BACKTEST_WINDOW] ready", JSON.stringify({
      sourceSessions: source.rowCount,
      sourceRange: ["2026-08-31", "2026-09-10"],
      tradableBacktestSessions: backtest.rowCount,
      tradableRange: ["2026-09-01", "2026-09-10"],
      seedContextDate: "2026-08-31",
      lookaheadSafe: true,
      rows: backtest.rows,
    }));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[INSTITUTIONAL_BACKTEST_WINDOW] failed", err);
  process.exit(1);
});
