import { readFileSync } from 'node:fs';

// Exercise the actual production UPSERT, not a second implementation of it.
export function chainWriterPrecedenceSql() {
  const source = readFileSync(new URL('../db.ts', import.meta.url), 'utf8');
  const fn = source.slice(source.indexOf('export async function dbUpsertChainState1m'));
  const sql = fn.match(/await p\.query\(`([\s\S]*?)`, \[/)?.[1];
  if (!sql) throw new Error('Production chain UPSERT not found');
  const literal = v => v === null ? 'NULL' : typeof v === 'number' ? String(v) : "'" + v.replaceAll("'", "''") + "'";
  function write(version, wall, pcr, expiry = '2026-10-13', minute = '2026-10-08T03:45:00Z') {
    const values = ['NIFTY', minute, expiry, 'Current Expiry', 22500, pcr, .8,
      1.2, 22500, wall, wall === null ? null : 1000, wall === null ? null : .2,
      wall === null ? null : 500, null, wall === null ? null : 22000,
      wall === null ? null : 2000, wall === null ? null : .3,
      wall === null ? null : -500, null, 14, 200, null, 'RESEARCH_ELIGIBLE', version];
    return sql.replaceAll('chain_state_1m', 'chain_state_writer_test')
      .replace(/\$(\d+)/g, (_, n) => literal(values[Number(n) - 1])) + ';';
  }
  function check(condition, name) {
    return `DO $$ BEGIN IF (${condition}) IS DISTINCT FROM TRUE THEN RAISE EXCEPTION '${name}'; END IF; END $$;`;
  }
  const preferred = "(SELECT call_wall_strike = 23000 AND full_chain_oi_pcr = .9 AND calculation_version = 'STORAGE_V3_PHASE1' FROM chain_state_writer_test)";
  return [
    'BEGIN;',
    "SET LOCAL statement_timeout = '15s';",
    'CREATE TEMP TABLE chain_state_writer_test (LIKE public.chain_state_1m INCLUDING ALL) ON COMMIT DROP;',
    write('STORAGE_V3_PHASE1', 23000, .9),
    write('H1_RUNTIME_BRIDGE_V1', null, .8),
    check(preferred, 'normalized-then-H1 lost source row'),
    'TRUNCATE chain_state_writer_test;',
    write('H1_RUNTIME_BRIDGE_V1', null, .8),
    write('STORAGE_V3_PHASE1', 23000, .9),
    check(preferred, 'H1-then-normalized lost source row'),
    write('STORAGE_V3_PHASE1', null, null),
    check("(SELECT call_wall_strike IS NULL AND full_chain_oi_pcr IS NULL AND calculation_version = 'STORAGE_V3_PHASE1' FROM chain_state_writer_test)", 'own-source invalidation retained stale values'),
    write('H1_RUNTIME_BRIDGE_V1', null, .8, '2026-10-19'),
    write('H1_RUNTIME_BRIDGE_V1', null, .8, '2026-10-13', '2026-10-08T03:48:00Z'),
    check('(SELECT count(*) = 3 FROM chain_state_writer_test)', 'distinct expiry or minute suppressed'),
    check("(SELECT count(*) = 2 FROM chain_state_writer_test WHERE calculation_version = 'H1_RUNTIME_BRIDGE_V1' AND call_wall_strike IS NULL)", 'standalone H1 row rejected'),
    'ROLLBACK;',
    "SELECT 'CHAIN_WRITER_PRECEDENCE_5_CHECKS_PASS' AS result;",
  ].join('\n');
}
