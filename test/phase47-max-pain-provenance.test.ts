import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  calculateCanonicalMaxPain,
  MAX_PAIN_CALCULATION_VERSION,
  MAX_PAIN_INTERPRETATION_GUARD,
  PHASE47_MAX_PAIN_SAFETY,
} from "../max-pain-provenance.js";

function independentLegacyMirror(rows: Array<{strike:number;side:"CE"|"PE";oi:number}>): number {
  const strikes = [...new Set(rows.map(r=>r.strike))].sort((a,b)=>a-b);
  let maxPain = 0;
  let minimumPayout = Number.POSITIVE_INFINITY;
  for (const settlement of strikes) {
    let payout = 0;
    for (const row of rows) {
      if (row.side === "CE") payout += Math.max(0, settlement-row.strike)*row.oi;
      else payout += Math.max(0, row.strike-settlement)*row.oi;
    }
    if (payout < minimumPayout) { minimumPayout = payout; maxPain = settlement; }
  }
  return maxPain;
}

test("hand-calculated complete chain resolves minimum aggregate intrinsic payout", () => {
  const rows = [
    {strike:100,side:"CE" as const,oi:10},{strike:100,side:"PE" as const,oi:20},
    {strike:110,side:"CE" as const,oi:30},{strike:110,side:"PE" as const,oi:10},
    {strike:120,side:"CE" as const,oi:10},{strike:120,side:"PE" as const,oi:10},
  ];
  const r = calculateCanonicalMaxPain(rows);
  assert.equal(r.state,"VALID");
  assert.equal(r.maxPain,110);
  assert.equal(r.minimumPayout,300);
  assert.equal(r.calculationVersion,MAX_PAIN_CALCULATION_VERSION);
});

test("canonical calculator matches an independently written mirror across deterministic matrices", () => {
  for (let seed=1; seed<=25; seed++) {
    const rows: Array<{strike:number;side:"CE"|"PE";oi:number}> = [];
    for (let i=0;i<7;i++) {
      const strike=22000+i*50;
      rows.push({strike,side:"CE",oi:100+((seed*37+i*71)%900)});
      rows.push({strike,side:"PE",oi:120+((seed*53+i*41)%850)});
    }
    const canonical=calculateCanonicalMaxPain(rows);
    assert.equal(canonical.state,"VALID");
    assert.equal(canonical.maxPain,independentLegacyMirror(rows),`seed ${seed}`);
  }
});

test("equal minimum payout exposes ties and deterministically chooses lowest strike", () => {
  const rows = [
    {strike:100,side:"CE" as const,oi:10},{strike:100,side:"PE" as const,oi:10},
    {strike:110,side:"CE" as const,oi:10},{strike:110,side:"PE" as const,oi:10},
  ];
  const r=calculateCanonicalMaxPain(rows);
  assert.deepEqual(r.tieStrikes,[100,110]);
  assert.equal(r.maxPain,100);
});

test("missing OI is blocked instead of silently becoming zero", () => {
  const r=calculateCanonicalMaxPain([
    {strike:100,side:"CE",oi:10},{strike:100,side:"PE",oi:null},
    {strike:110,side:"CE",oi:10},{strike:110,side:"PE",oi:20},
  ]);
  assert.equal(r.state,"BLOCKED");
  assert.equal(r.maxPain,null);
  assert.ok(r.reasons.includes("MAX_PAIN_OI_FIELD_INCOMPLETE"));
});

test("negative OI, duplicate contract key and empty universe fail closed", () => {
  assert.equal(calculateCanonicalMaxPain([]).state,"BLOCKED");
  assert.ok(calculateCanonicalMaxPain([{strike:100,side:"CE",oi:-1}]).reasons.includes("MAX_PAIN_OI_FIELD_INCOMPLETE"));
  assert.ok(calculateCanonicalMaxPain([
    {strike:100,side:"CE",oi:1},{strike:100,side:"CE",oi:2}
  ]).reasons.includes("MAX_PAIN_DUPLICATE_CONTRACT_KEY"));
});

test("current live source uses the audited payout equations and deterministic strict-less tie behavior", () => {
  const source=readFileSync(new URL("../server.ts",import.meta.url),"utf8");
  assert.match(source,/const oi = quote\?\.oi \|\| 0/);
  assert.match(source,/Math\.max\(0, settlement - inst\.strike\) \* oi/);
  assert.match(source,/Math\.max\(0, inst\.strike - settlement\) \* oi/);
  assert.match(source,/if \(payout < minimumPayout\)/);
  assert.match(source,/Array\.from\(new Set\(allInstruments\.map\(\(inst\) => inst\.strike\)\)\)/);
});

test("legacy directional Max Pain influence is explicitly detected as a promotion blocker", () => {
  const source=readFileSync(new URL("../server.ts",import.meta.url),"utf8");
  const legacy=/add\(['\"]max_pain['\"],\s*m\.current < m\.maxPain \? 0\.5 : m\.current > m\.maxPain \? -0\.5 : 0,\s*0\.5\)/g;
  const matches=source.match(legacy) ?? [];
  assert.ok(matches.length >= 1,"legacy directional Max Pain weight must remain visible until explicitly neutralized");
});

test("audited Max Pain is contextual only and has no production decision authority", () => {
  assert.match(MAX_PAIN_INTERPRETATION_GUARD,/not a seller target/i);
  assert.deepEqual(PHASE47_MAX_PAIN_SAFETY,{
    readOnlyForTrading:true,shadowOnly:true,affectsVerdict:false,affectsTelegram:false,affectsExecution:false,
    interpretation:"CONTEXTUAL_EXPIRY_EQUILIBRIUM_REFERENCE_ONLY",
  });
});
