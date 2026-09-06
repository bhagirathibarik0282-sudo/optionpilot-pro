import test from "node:test";
import assert from "node:assert/strict";
import { normalizedCashFromOfficialRows } from "../canonical-fii-dii-production-row.ts";

const sourceUrl = "https://www.nseindia.com/api/fiidiiTradeNse";
const rows = [
  { date: "2026-09-04", category: "FII_FPI" as const, buyCrore: 100, sellCrore: 125, netCrore: -25 },
  { date: "2026-09-04", category: "DII" as const, buyCrore: 150, sellCrore: 120, netCrore: 30 },
];

test("converts exact official FII/FPI and DII session into production DB shape", () => {
  const out = normalizedCashFromOfficialRows({ rows, sourceUrl, fetchedAt: "2026-09-04T13:33:42.000Z" });
  assert.equal(out.date, "2026-09-04");
  assert.deepEqual(out.fii, { buy: 100, sell: 125, net: -25 });
  assert.deepEqual(out.dii, { buy: 150, sell: 120, net: 30 });
  assert.equal(out.sourceUrl, sourceUrl);
});

test("does not reject a valid official session because another market table is one day behind", () => {
  const out = normalizedCashFromOfficialRows({ rows, sourceUrl });
  assert.equal(out.date, "2026-09-04");
});

test("fails closed on non-official source, incomplete session, date mismatch or net mismatch", () => {
  assert.throws(() => normalizedCashFromOfficialRows({ rows, sourceUrl: "https://example.com/data" }), /SOURCE_NOT_OFFICIAL/);
  assert.throws(() => normalizedCashFromOfficialRows({ rows: rows.slice(0, 1), sourceUrl }), /EXACT_TWO_ROWS_REQUIRED/);
  assert.throws(() => normalizedCashFromOfficialRows({ rows: [rows[0], { ...rows[1], date: "2026-09-03" }], sourceUrl }), /DATE_MISMATCH/);
  assert.throws(() => normalizedCashFromOfficialRows({ rows: [rows[0], { ...rows[1], netCrore: 31 }], sourceUrl }), /NET_MISMATCH/);
});
