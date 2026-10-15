import { readFileSync } from 'node:fs';

// Execute the production schema and UPSERT, not a separate policy simulation.
export function marketWriterPrecedenceSql() {
  const source = readFileSync(new URL('../db.ts', import.meta.url), 'utf8');
  const schema = source.match(/CREATE TABLE IF NOT EXISTS market_snapshot_1m \([\s\S]*?\n      \);/)?.[0];
  const fn = source.slice(source.indexOf('export async function dbUpsertMarketSnapshot1m'));
  const sql = fn.match(/await p\.query\(`([\s\S]*?)`, \[/)?.[1];
  if (!schema || !sql) throw Error('Production market schema/UPSERT not found');
  const literal = v => v === null ? 'NULL' : typeof v === 'number' ? String(v) : "'" + v.replaceAll("'", "''") + "'";
  function write(version, id, fresh, spot = 101, minute = '2026-10-15T03:45:00Z') {
    const values = ['NIFTY', minute, id, null, minute, fresh, spot, 100, 102, 99, 99,
      100, 102, 98, 100 / 99, 102, null, 1000, null, 2000, 1, 14, .1, version];
    return sql.replaceAll('market_snapshot_1m', 'market_writer_test')
      .replace(/\$(\d+)/g, (_, n) => literal(values[Number(n) - 1])) + ';';
  }
  const check = (condition, name) => `DO $$ BEGIN IF (${condition}) IS DISTINCT FROM TRUE THEN RAISE EXCEPTION '${name}'; END IF; END $$;`;
  const h1 = "(SELECT snapshot_id = 'h1' AND freshness_status = 'TRUE' AND spot_ltp = 101 AND calculation_version = 'H1_RUNTIME_BRIDGE_V1' FROM market_writer_test)";
  return [
    'BEGIN;',
    schema.replace('CREATE TABLE IF NOT EXISTS market_snapshot_1m', 'CREATE TEMP TABLE market_writer_test'),
    write('H1_RUNTIME_BRIDGE_V1', 'h1', 'TRUE'),
    write('STORAGE_V3_PHASE1', 'storage', null, 105),
    check(h1, 'H1 then Storage lost whole truth row'),
    'TRUNCATE market_writer_test;',
    write('STORAGE_V3_PHASE1', 'storage', null, 105),
    write('H1_RUNTIME_BRIDGE_V1', 'h1', 'TRUE'),
    check(h1, 'Storage then H1 lost whole truth row'),
    write('H1_RUNTIME_BRIDGE_V1', 'partial', 'PARTIAL', null),
    check("(SELECT snapshot_id = 'partial' AND freshness_status = 'PARTIAL' AND spot_ltp IS NULL FROM market_writer_test)", 'H1 invalidation retained stale truth'),
    'TRUNCATE market_writer_test;',
    write('STORAGE_V3_PHASE1', 'storage', null),
    write('STORAGE_V3_PHASE1', 'missing', null, null),
    check("(SELECT snapshot_id = 'missing' AND freshness_status IS NULL AND spot_ltp IS NULL FROM market_writer_test)", 'standalone Storage invalidation blocked'),
    write('H1_RUNTIME_BRIDGE_V1', 'next', 'TRUE', 101, '2026-10-15T03:48:00Z'),
    check('(SELECT count(*) = 2 FROM market_writer_test)', 'distinct minute suppressed'),
    'ROLLBACK;',
  ].join('\n');
}
