import { readFileSync } from 'node:fs';

// Run the actual production DDL and UPSERTs against transaction-local tables.
// No connection to production is needed or implied by this fixture.
export function casOptionWriterPrecedenceSql(source = readFileSync(new URL('../db.ts', import.meta.url), 'utf8')) {
  function schema(table, temp) {
    const ddl = source.match(new RegExp('CREATE TABLE IF NOT EXISTS ' + table + ' \\([\\s\\S]*?\\n      \\);'))?.[0];
    if (!ddl) throw Error('Production schema not found: ' + table);
    return ddl.replace('CREATE TABLE IF NOT EXISTS ' + table, 'CREATE TEMP TABLE ' + temp);
  }
  function upsert(name, values) {
    const fn = source.slice(source.indexOf('export async function ' + name));
    const sql = fn.match(/await p\.query\(`([\s\S]*?)`, \[/)?.[1];
    if (!sql) throw Error('Production UPSERT not found: ' + name);
    const literal = v => v == null ? 'NULL' : typeof v === 'boolean' ? String(v) : typeof v === 'number' ? String(v) : "'" + v.replaceAll("'", "''") + "'";
    return sql.replaceAll('market_snapshot_1m', 'cas_market_writer_test')
      .replaceAll('option_snapshot_1m', 'cas_option_writer_test')
      .replace(/\$(\d+)/g, (_, n) => literal(values[Number(n) - 1])) + ';';
  }
  const h1 = 'H1_RUNTIME_BRIDGE_V1', storage = 'STORAGE_V3_PHASE1';
  const minute = '2026-10-19T09:45:00Z';
  function market(version, id) {
    return upsert('dbUpsertMarketSnapshot1m', ['NIFTY', minute, id, null, minute,
      version === h1 ? 'TRUE' : null, 23000, 23000, 23010, 22990, 22900,
      null, 23100, 22800, null, 23010, null, null, null, null, 10, 14, null, version]);
  }
  function option(version, id, { ltp = 100, status = 'RESEARCH_ELIGIBLE', at = minute,
    expiry = '2026-10-19', strike = 23000, side = 'CE', oi = 1200 } = {}) {
    return upsert('dbUpsertOptionSnapshot1m', ['NIFTY', at, id, expiry, 'Current Expiry', 0,
      strike, side, 0, version === h1, false, ltp, ltp == null ? null : ltp - 1,
      ltp == null ? null : ltp + 1, ltp == null ? null : 2, 500, oi, null,
      null, .5, null, null, null, 0, ltp, 120, 80, 130, 70, at, 0, 'LIQUID', status, version,
      ltp == null ? null : version === h1 ? 10 : 100, ltp == null ? null : version === h1 ? 20 : 200]);
  }
  const check = (condition, name) => `DO $$ BEGIN IF (${condition}) IS DISTINCT FROM TRUE THEN RAISE EXCEPTION '${name}'; END IF; END $$;`;
  const coherent = `(SELECT m.snapshot_id = 'h1' AND o.snapshot_id = m.snapshot_id
    AND o.calculation_version = '${h1}' AND o.ltp = 100 AND o.bid = 99 AND o.ask = 101
    AND o.is_candidate AND o.oi = 1200 AND o.validation_status = 'RESEARCH_ELIGIBLE'
    ${source.includes('bid_qty BIGINT') ? 'AND o.bid_qty = 10 AND o.ask_qty = 20' : ''}
    FROM cas_market_writer_test m JOIN cas_option_writer_test o USING(symbol, minute_bucket))`;
  return [
    'BEGIN;', "SET LOCAL statement_timeout = '15s';",
    schema('market_snapshot_1m', 'cas_market_writer_test'),
    schema('option_snapshot_1m', 'cas_option_writer_test'),
    market(h1, 'h1'), option(h1, 'h1'), market(storage, 'storage'), option(storage, 'storage', { ltp: 200, oi: 9000 }),
    check(coherent, 'H1 then Storage split market and option snapshot identity'),
    'TRUNCATE cas_market_writer_test, cas_option_writer_test;',
    market(storage, 'storage'), option(storage, 'storage', { ltp: 200, oi: 9000 }), market(h1, 'h1'), option(h1, 'h1'),
    check(coherent, 'Storage then H1 lost whole H1 option row'),
    option(h1, 'partial', { ltp: null, status: 'PARTIAL', oi: null }),
    option(storage, 'storage', { ltp: 200 }),
    check("(SELECT snapshot_id = 'partial' AND ltp IS NULL AND bid IS NULL AND oi IS NULL AND validation_status = 'PARTIAL' FROM cas_option_writer_test)", 'H1 invalidation revived stale option values'),
    'TRUNCATE cas_option_writer_test;',
    option(storage, 'storage'), option(storage, 'missing', { ltp: null, status: null, oi: null }),
    check("(SELECT snapshot_id = 'missing' AND ltp IS NULL AND validation_status IS NULL FROM cas_option_writer_test)", 'standalone Storage invalidation blocked'),
    'TRUNCATE cas_option_writer_test;',
    option(h1, 'prior', { at: '2026-10-19T09:44:00Z', oi: 1000 }),
    option(h1, 'h1'), option(storage, 'storage', { oi: 9000 }),
    check("(SELECT snapshot_id = 'h1' AND derived_oi_change = 200 AND derived_oi_change_gap_seconds = 60 FROM cas_option_writer_test WHERE minute_bucket = '2026-10-19T09:45:00Z')", 'Storage changed H1 derived OI provenance'),
    option(storage, 'other-expiry', { expiry: '2026-10-26' }),
    option(storage, 'other-strike', { strike: 23050 }),
    option(storage, 'other-side', { side: 'PE' }),
    check('(SELECT count(*) = 5 FROM cas_option_writer_test)', 'distinct minute or contract suppressed'),
    'ROLLBACK;',
    "SELECT 'CAS_OPTION_WRITER_6_CHECKS_PASS' AS result;",
  ].join('\n');
}
