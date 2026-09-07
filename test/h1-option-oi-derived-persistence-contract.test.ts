import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const dbSource = readFileSync(resolve(here, "../db.ts"), "utf8");
const replaySource = readFileSync(resolve(here, "../h1-replay-http.ts"), "utf8");

function optionUpsertBody(): string {
  const start = dbSource.indexOf("export async function dbUpsertOptionSnapshot1m");
  const end = dbSource.indexOf("export async function dbUpsertChainState1m", start);
  assert.notEqual(start, -1, "option upsert function must exist");
  assert.notEqual(end, -1, "option upsert function boundary must exist");
  return dbSource.slice(start, end);
}

test("derived OI persistence is additive and keeps native oi_change separate", () => {
  const body = optionUpsertBody();
  assert.match(body, /oi=EXCLUDED\.oi, oi_change=EXCLUDED\.oi_change,/);
  assert.match(body, /derived_oi_change=EXCLUDED\.derived_oi_change,/);
  assert.match(body, /derived_oi_change_source=EXCLUDED\.derived_oi_change_source,/);
  assert.match(body, /derived_oi_change_gap_seconds=EXCLUDED\.derived_oi_change_gap_seconds,/);
  assert.match(body, /row\.oi \?\? null,row\.oiChange \?\? null/);
});

test("derived OI uses only the latest prior matching contract on the same IST trading day", () => {
  const body = optionUpsertBody();
  assert.match(body, /WHERE symbol = \$1/);
  assert.match(body, /AND expiry = \$4::date/);
  assert.match(body, /AND strike = \$7/);
  assert.match(body, /AND option_type = \$8/);
  assert.match(body, /AND minute_bucket < \$2::timestamptz/);
  assert.match(body, /\(minute_bucket AT TIME ZONE 'Asia\/Kolkata'\)::date = \(\$2::timestamptz AT TIME ZONE 'Asia\/Kolkata'\)::date/);
  assert.match(body, /AND oi IS NOT NULL/);
  assert.match(body, /ORDER BY minute_bucket DESC\s+LIMIT 1/);
});

test("first observation fails closed and later observations record delta provenance and actual gap", () => {
  const body = optionUpsertBody();
  assert.match(body, /CASE WHEN p\.oi IS NOT NULL AND \$17::bigint IS NOT NULL THEN \$17::bigint - p\.oi ELSE NULL END AS oi_delta/);
  assert.match(body, /'DERIVED_PREVIOUS_PERSISTED_SNAPSHOT'::text ELSE NULL END AS oi_delta_source/);
  assert.match(body, /EXTRACT\(EPOCH FROM \(\$2::timestamptz - p\.minute_bucket\)\)::integer/);
  assert.match(body, /LEFT JOIN prior p ON TRUE/);
});

test("option persistence remains one SQL statement per upsert", () => {
  const body = optionUpsertBody();
  assert.equal((body.match(/await p\.query\(/g) ?? []).length, 1);
});

test("read-only H1 replay exposes all derived OI truth fields", () => {
  assert.match(replaySource, /o\.derived_oi_change, o\.derived_oi_change_source, o\.derived_oi_change_gap_seconds/);
});
