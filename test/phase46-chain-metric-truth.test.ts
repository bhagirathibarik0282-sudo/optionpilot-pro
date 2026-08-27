import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildPhase46ChainMetricTruth,
  phase46UniverseFingerprint,
  chainMetricTruthSchemaSql,
  PHASE46_CHAIN_METRIC_SAFETY,
  type Phase46UniverseMetadata,
} from "../chain-metric-truth.js";
import { MAX_PAIN_CALCULATION_VERSION } from "../max-pain-provenance.js";

function metadata(): Phase46UniverseMetadata {
  const strikes = [22000,22100,22200];
  const keys = strikes.flatMap((s) => [`${s}_CE`,`${s}_PE`]).sort();
  return {
    provenance:"KITE_LIVE_INSTRUMENT_MASTER_OPTION_MAP",
    quoteReceivedAt:"2026-08-26T04:30:00.000Z",
    expectedContractCount:6, expectedCeCount:3, expectedPeCount:3,
    expectedStrikes:strikes, expectedContractKeys:keys, uniqueTokenCount:6,
    quotedContractCount:6, missingQuoteKeys:[], allQuotesPresent:true,
    allOiPresent:true, allVolumePresent:true,
    bandOiCoverageComplete:true, bandVolumeCoverageComplete:true, atmPairCoverageComplete:true,
    fullChainVolumePcr:1.2,
    fullChainCallWallStrike:22200, fullChainCallWallOi:5000,
    fullChainPutWallStrike:22000, fullChainPutWallOi:5200,
  };
}

function build(m: Phase46UniverseMetadata = metadata(), maxPain:number|null=22100) {
  return buildPhase46ChainMetricTruth({
    symbol:"NIFTY", minuteBucket:"2026-08-26T04:30:00.000Z", expiry:"2026-08-27",
    metadata:m, atmStraddle:205, band7OiPcr:1.1, band7VolumePcr:0.95,
    fullChainOiPcr:1.25, maxPain,
  });
}

test("complete master universe produces metric-specific valid provenance but receipt-time context only", () => {
  const rows = build();
  for (const metric of ["ATM_STRADDLE","BAND7_OI_PCR","BAND7_VOLUME_PCR","FULL_CHAIN_OI_PCR","FULL_CHAIN_VOLUME_PCR","CALL_WALL","PUT_WALL","MAX_PAIN"]) {
    const row = rows.find((r) => r.metric === metric)!;
    assert.equal(row.truthState, "VALID", metric);
    assert.equal(row.usability, "CONTEXT_ONLY", metric);
    assert.ok(row.reasonCodes.includes("QUOTE_TIME_BASIS_RESPONSE_RECEIPT"));
  }
  const maxPain = rows.find((r) => r.metric === "MAX_PAIN")!;
  assert.equal(maxPain.detail?.calculationVersion,MAX_PAIN_CALCULATION_VERSION);
  assert.match(String(maxPain.detail?.interpretationGuard),/not a seller target/i);
  assert.equal(maxPain.detail?.tieBreak,"LOWEST_STRIKE_ON_EQUAL_MINIMUM_PAYOUT");
});

test("missing full-universe quote blocks full-chain metrics without blocking exact ATM pair", () => {
  const m = metadata();
  m.allQuotesPresent = false; m.quotedContractCount = 5; m.missingQuoteKeys = ["22200_PE"];
  m.allOiPresent = false; m.allVolumePresent = false;
  const rows = build(m);
  assert.equal(rows.find((r)=>r.metric==="ATM_STRADDLE")?.truthState, "VALID");
  for (const metric of ["FULL_CHAIN_OI_PCR","FULL_CHAIN_VOLUME_PCR","CALL_WALL","PUT_WALL","MAX_PAIN"]) {
    const row = rows.find((r)=>r.metric===metric)!;
    assert.equal(row.truthState,"BLOCKED",metric);
    assert.ok(row.reasonCodes.includes("FULL_UNIVERSE_QUOTE_COVERAGE_INCOMPLETE"));
  }
});

test("missing OI blocks audited Max Pain even when legacy numeric value exists", () => {
  const m=metadata(); m.allOiPresent=false;
  const row=build(m,22100).find((r)=>r.metric==="MAX_PAIN")!;
  assert.equal(row.truthState,"BLOCKED");
  assert.equal(row.usability,"BLOCKED");
  assert.ok(row.reasonCodes.includes("MAX_PAIN_OI_FIELD_COVERAGE_INCOMPLETE"));
});

test("band OI and band Volume PCR are independently gated and never mislabeled full-chain", () => {
  const m = metadata(); m.bandVolumeCoverageComplete = false;
  const rows = build(m);
  assert.equal(rows.find((r)=>r.metric==="BAND7_OI_PCR")?.truthState,"VALID");
  assert.equal(rows.find((r)=>r.metric==="BAND7_VOLUME_PCR")?.truthState,"BLOCKED");
  assert.ok(rows.some((r)=>r.metric==="FULL_CHAIN_VOLUME_PCR"));
});

test("duplicate instrument token universe fails closed", () => {
  const m = metadata(); m.uniqueTokenCount = 5;
  for (const metric of ["FULL_CHAIN_OI_PCR","MAX_PAIN"]) {
    const row = build(m).find((r)=>r.metric===metric)!;
    assert.equal(row.truthState,"BLOCKED");
    assert.ok(row.reasonCodes.includes("INSTRUMENT_TOKEN_UNIQUENESS_FAILED"));
  }
});

test("universe fingerprint is deterministic and changes with expected universe", () => {
  const a = metadata(), b = metadata();
  assert.equal(phase46UniverseFingerprint(a), phase46UniverseFingerprint(b));
  b.expectedContractKeys = [...b.expectedContractKeys, "22300_CE"];
  assert.notEqual(phase46UniverseFingerprint(a), phase46UniverseFingerprint(b));
});

test("metric truth schema is additive append-only", () => {
  const sql = chainMetricTruthSchemaSql();
  assert.match(sql,/CREATE TABLE IF NOT EXISTS chain_metric_truth_1m/);
  assert.match(sql,/ON CONFLICT \(event_id\) DO NOTHING|CREATE TABLE/);
  const src = readFileSync(new URL("../chain-metric-truth.ts", import.meta.url),"utf8");
  assert.doesNotMatch(src,/UPDATE\s+chain_metric_truth_1m/i);
  assert.doesNotMatch(src,/DELETE\s+FROM\s+chain_metric_truth_1m/i);
});

test("Phase 46 chain metric truth has no production decision authority", () => {
  assert.deepEqual(PHASE46_CHAIN_METRIC_SAFETY, {
    readOnlyForTrading:true, shadowOnly:true, affectsVerdict:false, affectsTelegram:false, affectsExecution:false,
    timingBoundary:"BACKEND_QUOTE_RESPONSE_RECEIPT_NOT_PER_CONTRACT_EXCHANGE_TIMESTAMP",
  });
});
