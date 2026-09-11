import pg from "pg";

const { Pool } = pg;

const CASH_SOURCE = "EQUITYTIMER_NSE_COMBINED_CASH_MIRROR";
const CASH_SOURCE_URL = "https://equitytimer.com/fii-dii-data/";
const DERIV_SOURCE = "EQUITYTIMER_NSE_PARTICIPANT_OI_MIRROR";
const DERIV_SOURCE_URL = "https://equitytimer.com/fii-dii-data/";
const NSE_REPORTS_URL = "https://www.nseindia.com/all-reports-derivatives";

// signalFrom is the first next trading session on which this EOD institutional
// context is allowed to influence an intraday backtest. This prevents look-ahead.
const rows = [
  { d:"2026-08-31", signalFrom:"2026-09-01", fb:60025.88, fs:68011.76, fn:-7985.88, db:19730.38, ds:15141.50, dn:4588.88, nifty:24080.40, niftyPct:-0.39, callCh:4558, putCh:-42953, callNet:-225000, putNet:551000, futCh:-6682, futNet:-209000 },
  { d:"2026-09-01", signalFrom:"2026-09-02", fb:17807.53, fs:16664.15, fn:1143.38, db:15635.49, ds:13788.55, dn:1846.94, nifty:24055.80, niftyPct:-0.10, callCh:-22599, putCh:81058, callNet:-248000, putNet:632000, futCh:-12717, futNet:-222000 },
  { d:"2026-09-02", signalFrom:"2026-09-03", fb:26715.88, fs:20027.51, fn:6688.37, db:17639.89, ds:14826.91, dn:2812.98, nifty:23914.45, niftyPct:-0.59, callCh:-51192, putCh:-39242, callNet:-299000, putNet:593000, futCh:-7131, futNet:-229000 },
  { d:"2026-09-03", signalFrom:"2026-09-04", fb:13596.04, fs:15941.91, fn:-2345.87, db:17063.65, ds:12086.19, dn:4977.46, nifty:23873.45, niftyPct:-0.17, callCh:-12954, putCh:56826, callNet:-312000, putNet:650000, futCh:-5939, futNet:-235000 },
  { d:"2026-09-04", signalFrom:"2026-09-07", fb:13857.58, fs:16969.52, fn:-3111.94, db:19254.19, ds:10324.07, dn:8930.12, nifty:23897.70, niftyPct:0.10, callCh:8753, putCh:-69138, callNet:-303000, putNet:581000, futCh:-736, futNet:-236000 },
  { d:"2026-09-07", signalFrom:"2026-09-08", fb:9581.19, fs:9301.06, fn:280.13, db:13154.13, ds:12587.37, dn:566.76, nifty:23779.15, niftyPct:-0.50, callCh:5352, putCh:50236, callNet:-298000, putNet:631000, futCh:-14255, futNet:-250000 },
  { d:"2026-09-08", signalFrom:"2026-09-09", fb:11704.84, fs:11828.03, fn:-123.19, db:14678.53, ds:13328.89, dn:1349.64, nifty:23635.10, niftyPct:-0.61, callCh:-3980, putCh:19498, callNet:-302000, putNet:651000, futCh:-11464, futNet:-262000 },
  { d:"2026-09-09", signalFrom:"2026-09-10", fb:16392.90, fs:16975.89, fn:-582.99, db:18130.76, ds:16621.72, dn:1509.04, nifty:23431.50, niftyPct:-0.86, callCh:-40561, putCh:9607, callNet:-343000, putNet:660000, futCh:-14693, futNet:-276000 },
  { d:"2026-09-10", signalFrom:"2026-09-11", fb:11882.95, fs:12321.19, fn:-438.24, db:13326.33, ds:12300.48, dn:1025.85, nifty:23477.80, niftyPct:0.20, callCh:23772, putCh:2512, callNet:-319000, putNet:663000, futCh:-5594, futNet:-282000 },
];

function derivativeBehaviour(r: typeof rows[number]): string {
  const fut = r.futCh < 0 ? "INDEX_FUTURES_NET_SHORT_INCREASED" : "INDEX_FUTURES_NET_SHORT_REDUCED";
  const call = r.callCh < 0 ? "CALL_NET_SHORT_INCREASED" : "CALL_NET_SHORT_REDUCED";
  const put = r.putCh > 0 ? "PUT_NET_LONG_INCREASED" : "PUT_NET_LONG_REDUCED";
  return `${fut}|${call}|${put}`;
}

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL_REQUIRED");
  const isLocal = /localhost|127\.0\.0\.1/.test(url);
  const pool = new Pool({ connectionString: url, ssl: isLocal ? undefined : { rejectUnauthorized: false }, max: 2 });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS institutional_daily_context (
        trade_date DATE PRIMARY KEY,
        signal_eligible_from DATE NOT NULL,
        cash_source TEXT NOT NULL,
        cash_source_url TEXT NOT NULL,
        derivative_source TEXT NOT NULL,
        derivative_source_url TEXT NOT NULL,
        nse_derivative_reports_url TEXT NOT NULL,
        fii_buy DOUBLE PRECISION NOT NULL,
        fii_sell DOUBLE PRECISION NOT NULL,
        fii_net DOUBLE PRECISION NOT NULL,
        dii_buy DOUBLE PRECISION NOT NULL,
        dii_sell DOUBLE PRECISION NOT NULL,
        dii_net DOUBLE PRECISION NOT NULL,
        nifty_close DOUBLE PRECISION NOT NULL,
        nifty_change_pct DOUBLE PRECISION NOT NULL,
        fii_index_call_net_change BIGINT NOT NULL,
        fii_index_put_net_change BIGINT NOT NULL,
        fii_index_call_net_position BIGINT NOT NULL,
        fii_index_put_net_position BIGINT NOT NULL,
        fii_index_futures_net_change BIGINT NOT NULL,
        fii_index_futures_net_position BIGINT NOT NULL,
        derivative_behaviour TEXT NOT NULL,
        inserted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await pool.query(`ALTER TABLE institutional_daily_context ADD COLUMN IF NOT EXISTS signal_eligible_from DATE`);

    for (const r of rows) {
      await pool.query(`
        INSERT INTO institutional_daily_context (
          trade_date, signal_eligible_from, cash_source, cash_source_url,
          derivative_source, derivative_source_url, nse_derivative_reports_url,
          fii_buy, fii_sell, fii_net, dii_buy, dii_sell, dii_net,
          nifty_close, nifty_change_pct,
          fii_index_call_net_change, fii_index_put_net_change,
          fii_index_call_net_position, fii_index_put_net_position,
          fii_index_futures_net_change, fii_index_futures_net_position,
          derivative_behaviour, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,now()
        )
        ON CONFLICT (trade_date) DO UPDATE SET
          signal_eligible_from=EXCLUDED.signal_eligible_from,
          cash_source=EXCLUDED.cash_source,
          cash_source_url=EXCLUDED.cash_source_url,
          derivative_source=EXCLUDED.derivative_source,
          derivative_source_url=EXCLUDED.derivative_source_url,
          nse_derivative_reports_url=EXCLUDED.nse_derivative_reports_url,
          fii_buy=EXCLUDED.fii_buy,
          fii_sell=EXCLUDED.fii_sell,
          fii_net=EXCLUDED.fii_net,
          dii_buy=EXCLUDED.dii_buy,
          dii_sell=EXCLUDED.dii_sell,
          dii_net=EXCLUDED.dii_net,
          nifty_close=EXCLUDED.nifty_close,
          nifty_change_pct=EXCLUDED.nifty_change_pct,
          fii_index_call_net_change=EXCLUDED.fii_index_call_net_change,
          fii_index_put_net_change=EXCLUDED.fii_index_put_net_change,
          fii_index_call_net_position=EXCLUDED.fii_index_call_net_position,
          fii_index_put_net_position=EXCLUDED.fii_index_put_net_position,
          fii_index_futures_net_change=EXCLUDED.fii_index_futures_net_change,
          fii_index_futures_net_position=EXCLUDED.fii_index_futures_net_position,
          derivative_behaviour=EXCLUDED.derivative_behaviour,
          updated_at=now()
      `, [
        r.d, r.signalFrom, CASH_SOURCE, CASH_SOURCE_URL, DERIV_SOURCE, DERIV_SOURCE_URL, NSE_REPORTS_URL,
        r.fb, r.fs, r.fn, r.db, r.ds, r.dn, r.nifty, r.niftyPct,
        r.callCh, r.putCh, r.callNet, r.putNet, r.futCh, r.futNet, derivativeBehaviour(r),
      ]);
    }

    const readback = await pool.query(`
      SELECT trade_date::text, signal_eligible_from::text, fii_net, dii_net,
             fii_index_futures_net_position, fii_index_call_net_position,
             fii_index_put_net_position, derivative_behaviour
      FROM institutional_daily_context
      WHERE trade_date BETWEEN '2026-08-31' AND '2026-09-10'
      ORDER BY trade_date
    `);
    if (readback.rowCount !== rows.length) {
      throw new Error(`INSTITUTIONAL_BACKFILL_READBACK_MISMATCH expected=${rows.length} actual=${readback.rowCount}`);
    }
    if (readback.rows.some((r) => !r.signal_eligible_from || r.signal_eligible_from <= r.trade_date)) {
      throw new Error("INSTITUTIONAL_BACKFILL_LOOKAHEAD_GUARD_FAILED");
    }
    console.log("[INSTITUTIONAL_BACKFILL] success", JSON.stringify({ rows: readback.rows, count: readback.rowCount, lookaheadSafe: true }));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[INSTITUTIONAL_BACKFILL] failed", err);
  process.exit(1);
});
