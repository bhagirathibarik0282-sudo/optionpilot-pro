import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPhase38ModelTruth } from "../phase38-model-provenance.js";
import type { MarketSnapshot1mRow, OptionSnapshot1mRow } from "../db.js";

const market: MarketSnapshot1mRow = {
  symbol:"NIFTY", minuteBucket:"2026-08-26T05:00:00.000Z",
  backendTimestamp:"2026-08-26T05:00:05.000Z", spotLtp:24500,
};
const base: OptionSnapshot1mRow = {
  symbol:"NIFTY", minuteBucket:market.minuteBucket, expiry:"2026-09-03", dte:8,
  strike:24500, optionType:"CE", ltp:260, iv:18, delta:0.55, gamma:0.0007,
  vega:12, theta:-18, quoteTimestamp:"2026-08-26T05:00:02.000Z",
};

test("positive-DTE model record is only shadow permission, not production permission", () => {
  const row=buildPhase38ModelTruth(base,market);
  assert.equal(row.audit.ivPermission,true);
  assert.equal(row.audit.greekPermission,true);
  assert.equal(row.payload.permissionScope,"SHADOW_RESEARCH_ONLY");
});

test("expiry day remains blocked after Gamma source proof", () => {
  const row=buildPhase38ModelTruth({...base,dte:0},market);
  assert.equal(row.audit.greekPermission,false);
  assert.ok(row.audit.reasons.includes("ZERO_DTE_GREEK_SEMANTIC_CONFLICT"));
});

test("missing Gamma remains blocked", () => {
  const row=buildPhase38ModelTruth({...base,gamma:null},market);
  assert.equal(row.audit.greekPermission,false);
});

test("ATM permission SQL requires exact FRESH VALID USABLE option source truth", () => {
  const source=readFileSync(new URL("../option-model-truth-db.ts",import.meta.url),"utf8");
  for(const marker of [
    "sto.record_kind = 'OPTION'",
    "sto.freshness_state = 'FRESH'",
    "sto.identity_state = 'VALID'",
    "sto.quality_state = 'VALID'",
    "sto.usability = 'USABLE'",
    "ATM_SOURCE_TRUTH_NOT_USABLE",
  ]) assert.ok(source.includes(marker),`missing conjunctive gate: ${marker}`);
});
