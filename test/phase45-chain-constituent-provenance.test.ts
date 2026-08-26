import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { auditChainConstituentProvenance, deriveChainMetricsFromVerifiedConstituents, chainConstituentSafetyContract, type ChainConstituent } from "../chain-constituent-provenance.js";

const now = "2026-08-26T04:30:30.000Z";
const expiry = "2026-08-27";
const under = "NIFTY";

function row(strike:number, optionType:"CE"|"PE", patch:Partial<ChainConstituent>={}): ChainConstituent {
  return {
    underlying: under,
    expiry,
    strike,
    optionType,
    exchange:"NFO",
    segment:"NFO-OPT",
    instrumentToken:`${optionType}-${strike}`,
    tradingSymbol:`NIFTY26AUG${strike}${optionType}`,
    sourceProvider:"KITE",
    sourceVersion:"KITE_LIVE_CONTRACT_MASTER_V1",
    quoteTimestamp:"2026-08-26T04:30:29.000Z",
    receivedAt:now,
    oi: optionType === "CE" ? 1000 + strike : 1200 + strike,
    volume: optionType === "CE" ? 100 + strike/100 : 120 + strike/100,
    ltp: optionType === "CE" ? 100 : 95,
    ...patch,
  };
}

function universe() {
  const strikes = Array.from({length:15},(_,i)=>24500+(i-7)*50);
  return {
    strikes,
    ceRows:strikes.map(s=>row(s,"CE")),
    peRows:strikes.map(s=>row(s,"PE")),
  };
}

test("exact fresh ATM pair may validate straddle even when full-universe completeness is unproven", () => {
  const u=universe();
  const a=auditChainConstituentProvenance({underlying:under,expiry,atmStrike:24500,ceRows:u.ceRows,peRows:u.peRows,nowIso:now,freshMaxMs:5000});
  assert.equal(a.atmPairComplete,true);
  assert.equal(a.metrics.ATM_STRADDLE.usable,true);
  assert.equal(a.universeComplete,false);
  assert.equal(a.metrics.CALL_WALL.usable,false);
  assert.equal(a.metrics.FULL_CHAIN_OI_PCR.usable,false);
  assert.ok(a.metrics.CALL_WALL.reasons.includes("CHAIN_UNIVERSE_COUNT_UNPROVEN"));
});

test("ATM±7 PCR requires both exact sides at all 15 band strikes", () => {
  const u=universe();
  const good=auditChainConstituentProvenance({underlying:under,expiry,atmStrike:24500,ceRows:u.ceRows,peRows:u.peRows,nowIso:now,freshMaxMs:5000});
  assert.equal(good.band7Complete,true);
  assert.equal(good.metrics.BAND7_OI_PCR.usable,true);
  const missingPe=u.peRows.filter(r=>r.strike!==24600);
  const bad=auditChainConstituentProvenance({underlying:under,expiry,atmStrike:24500,ceRows:u.ceRows,peRows:missingPe,nowIso:now,freshMaxMs:5000});
  assert.equal(bad.band7Complete,false);
  assert.equal(bad.metrics.BAND7_OI_PCR.usable,false);
});

test("full-chain walls/PCR require explicit expected counts, strike coverage and provenance", () => {
  const u=universe();
  const a=auditChainConstituentProvenance({
    underlying:under,expiry,atmStrike:24500,ceRows:u.ceRows,peRows:u.peRows,nowIso:now,freshMaxMs:5000,
    universeExpectation:{expectedCeCount:15,expectedPeCount:15,expectedStrikes:u.strikes,provenance:"LIVE_INSTRUMENT_MASTER_EXPIRY_UNIVERSE_V1"}
  });
  assert.equal(a.universeComplete,true);
  assert.equal(a.metrics.CALL_WALL.usable,true);
  assert.equal(a.metrics.PUT_WALL.usable,true);
  assert.equal(a.metrics.FULL_CHAIN_OI_PCR.usable,true);
  assert.equal(a.metrics.VOLUME_PCR.usable,true);
});

test("stale or identity-incomplete constituent blocks dependent metrics", () => {
  const u=universe();
  u.ceRows[7]=row(24500,"CE",{quoteTimestamp:"2026-08-26T04:29:00.000Z",instrumentToken:null});
  const a=auditChainConstituentProvenance({underlying:under,expiry,atmStrike:24500,ceRows:u.ceRows,peRows:u.peRows,nowIso:now,freshMaxMs:5000});
  assert.equal(a.metrics.ATM_STRADDLE.usable,false);
  assert.ok(a.reasons.includes("CONTRACT_IDENTITY_INCOMPLETE"));
  assert.ok(a.reasons.includes("QUOTE_NOT_FRESH"));
});

test("freshness policy must be explicit; no hidden default", () => {
  const u=universe();
  const a=auditChainConstituentProvenance({underlying:under,expiry,atmStrike:24500,ceRows:u.ceRows,peRows:u.peRows,nowIso:now,freshMaxMs:null});
  assert.equal(a.metrics.ATM_STRADDLE.usable,false);
  assert.ok(a.reasons.includes("FRESHNESS_POLICY_UNCONFIGURED"));
});

test("duplicate side/strike or token is blocked instead of double counted", () => {
  const u=universe();
  u.ceRows.push({...u.ceRows[7]});
  const a=auditChainConstituentProvenance({underlying:under,expiry,atmStrike:24500,ceRows:u.ceRows,peRows:u.peRows,nowIso:now,freshMaxMs:5000});
  assert.equal(a.metrics.BAND7_OI_PCR.usable,false);
  assert.ok(a.reasons.includes("DUPLICATE_SIDE_STRIKE"));
  assert.ok(a.reasons.includes("DUPLICATE_INSTRUMENT_TOKEN"));
});

test("derived metrics emit null rather than fabricate values when provenance is blocked", () => {
  const u=universe();
  const a=auditChainConstituentProvenance({underlying:under,expiry,atmStrike:24500,ceRows:u.ceRows,peRows:u.peRows,nowIso:now,freshMaxMs:5000});
  const d=deriveChainMetricsFromVerifiedConstituents({audit:a,atmStrike:24500,ceRows:u.ceRows,peRows:u.peRows});
  assert.equal(d.atmStraddleLtp,195);
  assert.ok(typeof d.band7OiPcr === "number");
  assert.equal(d.fullChainOiPcr,null);
  assert.equal(d.callWallStrike,null);
  assert.equal(d.putWallStrike,null);
  assert.equal(d.maxPain,null);
});

test("max pain stays blocked until its calculation provenance is separately audited", () => {
  const u=universe();
  const a=auditChainConstituentProvenance({underlying:under,expiry,atmStrike:24500,ceRows:u.ceRows,peRows:u.peRows,nowIso:now,freshMaxMs:5000,universeExpectation:{expectedCeCount:15,expectedPeCount:15,expectedStrikes:u.strikes,provenance:"MASTER"}});
  assert.equal(a.universeComplete,true);
  assert.equal(a.metrics.MAX_PAIN.usable,false);
  assert.ok(a.metrics.MAX_PAIN.reasons.includes("MAX_PAIN_CALCULATION_PROVENANCE_NOT_AUDITED"));
});

test("Phase 45 safety contract keeps chain audit outside production decisions", () => {
  const c=chainConstituentSafetyContract();
  assert.equal(c.fullChainLabelRequiresUniverseCompletenessProof,true);
  assert.equal(c.missingConstituentNeverTreatedAsZero,true);
  assert.equal(c.affectsVerdict,false);
  assert.equal(c.affectsTelegram,false);
  assert.equal(c.affectsExecution,false);
});

test("current Storage V3 adapter still proves why Phase 45 universe marker is required", () => {
  const src=fs.readFileSync("storage-v3-adapter.ts","utf8");
  assert.match(src,/const callWall = maxOiWall\(ceRows\)/);
  assert.match(src,/fullChainOiPcr: isCurrent \? finite\(fast\?\.fullChainPcr\) : null/);
  assert.match(src,/forcedIdentityState: provider\(fast\?\.sourceProvider/);
  assert.doesNotMatch(src,/expectedCeCount|expectedPeCount|CHAIN_UNIVERSE/);
});
