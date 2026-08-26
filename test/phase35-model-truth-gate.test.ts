import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unknownSnapshotModelTruth } from "../option-model-truth-db.js";

const combinationSource = readFileSync(new URL("../meaningful-combination-engine.ts", import.meta.url), "utf8");
const writerSource = readFileSync(new URL("../storage-v3-writer.ts", import.meta.url), "utf8");

const option:any = {
  symbol:"NIFTY", minuteBucket:"2026-08-26T05:00:00.000Z", snapshotId:"s1",
  expiry:"2026-08-27", expiryBucket:"CURRENT", dte:1, strike:25000, optionType:"CE",
  atmOffset:0, isCandidate:false, isWall:false, ltp:100, bid:99, ask:101, spread:2,
  volume:1000, oi:2000, oiChange:null, iv:12, delta:0.5, gamma:0.01, vega:8, theta:-10,
  intrinsic:20, extrinsic:80, dayHigh:120, dayLow:80, pdh:110, pdl:90,
  quoteTimestamp:"2026-08-26T05:00:00.000Z", quoteAgeSeconds:0, liquidityStatus:null,
  validationStatus:"VALID:FRESH:USABLE", calculationVersion:"TEST"
};

test("existing snapshot Greeks with no provenance are persisted as blocked model truth", () => {
  const row = unknownSnapshotModelTruth(option);
  assert.equal(row.audit.ivPermission, false);
  assert.equal(row.audit.greekPermission, false);
  assert.equal(row.audit.usability, "BLOCKED");
  assert.ok(row.audit.reasons.includes("IV_PROVENANCE_UNKNOWN"));
  assert.ok(row.audit.reasons.includes("GREEKS_PROVENANCE_UNKNOWN"));
});

test("Storage V3 shadow path persists explicit model-truth companion records", () => {
  assert.ok(writerSource.includes("persistOptionModelTruthRecords"));
  assert.ok(writerSource.includes("buildPhase38ModelTruth"));
  assert.ok(writerSource.includes("sourceTruthShadowEnabled()"));
});

test("COMB-02 and COMB-03 are gated by ATM model truth permission", () => {
  assert.ok(combinationSource.includes("getAtmModelTruthPermission"));
  assert.ok(combinationSource.includes("if(!permission.greekAllowed)"));
  assert.ok(combinationSource.includes("if(!permission.ivAllowed||!permission.greekAllowed)"));
  assert.ok(combinationSource.includes("Greek provenance gate blocked"));
  assert.ok(combinationSource.includes("IV/Greek provenance gate blocked"));
});

test("combination engine remains research-only and cannot affect execution", () => {
  assert.ok(combinationSource.includes("affectsVerdict:false"));
  assert.ok(combinationSource.includes("affectsTelegram:false"));
  assert.ok(combinationSource.includes("affectsExecution:false"));
});
