import test from "node:test";
import assert from "node:assert/strict";
import { canonicalBusinessRuntimeRegistry } from "../canonical-business-runtime-registry.js";
import { buildBusinessDashboardV1 } from "../business-dashboard-v1.js";
import { deriveObservationData, renderBusinessDashboardV1Html } from "../business-dashboard-v1-view.js";
import { readFileSync } from "node:fs";

test("dashboard fails softly to WAIT without inventing a candidate", () => {
  canonicalBusinessRuntimeRegistry.clear();
  const out = buildBusinessDashboardV1("NIFTY", new Date().toISOString());
  assert.equal(out.ready, false);
  assert.equal(out.state, "WAIT");
  assert.equal(out.candidate, null);
  assert.equal(out.horizons.length, 3);
  assert.ok(out.horizons.every((h) => h.action === "WAIT"));
  assert.equal(out.affectsCandidateAuthority, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.createsOrders, false);
  assert.equal(out.decisionCard.state, "WAIT");
  assert.equal(out.decisionCard.action, "WAIT");
  assert.equal(out.decisionCard.authority, "NONE");
  assert.equal(out.decisionCard.decisionId, null);
  assert.equal(out.decisionCard.candidateKey, null);
  assert.equal(out.decisionCard.identityLocked, false);
  assert.equal(out.decisionCard.executionPlan.state, "NOT_PUBLISHED");
  assert.equal(out.decisionCard.executionPlan.entry, null);
  assert.equal(out.decisionCard.goldResearch.grantsBusinessAuthority, false);
});

test("dashboard reuses the same canonical business candidate and horizon views", () => {
  canonicalBusinessRuntimeRegistry.clear();
  const now = Date.now();
  const consumer:any = {
    version:"CANONICAL_BUSINESS_CONSUMER_V1",
    buyerCandidate:{decisionId:"decision-dashboard-1",candidateKey:"NIFTY:CE:23800:2026-09-08:DTE1:ATM",role:"OPTION_BUYER",symbol:"NIFTY",optionSide:"CE",strike:23800,expiryDate:"2026-09-08",dte:1,moneyness:"ATM",premiumLtp:120,dteBucket:"CURRENT_OR_NEAR",sourceAuthority:"EXECUTION_CANDIDATE_SELECTOR_V2"},
    horizons:[
      {horizon:"INTRADAY",action:"BUYER_EDGE",buyerStars:5,sellerStars:2,headline:"Buyer edge",reasons:[],devilCheck:"PASS"},
      {horizon:"MULTIDAY",action:"WAIT",buyerStars:3,sellerStars:3,headline:"No clear edge — wait",reasons:[],devilCheck:"PASS"},
      {horizon:"EXPIRY",action:"SELLER_EDGE",buyerStars:2,sellerStars:4,headline:"Seller edge",reasons:[],devilCheck:"PASS"},
    ],
    telegram:{allowed:true,reason:"BUYER_READY"},decisionId:"decision-dashboard-1",candidateKey:"NIFTY:CE:23800:2026-09-08:DTE1:ATM",sameCanonicalCandidateForDashboardAndTelegram:true,affectsExecution:false,createsOrders:false,aiMayOverride:false,
  };
  assert.equal(canonicalBusinessRuntimeRegistry.publish("NIFTY", consumer, now), true);
  const out = buildBusinessDashboardV1("NIFTY", new Date(now).toISOString());
  assert.equal(out.ready, true);
  assert.equal(out.candidate?.candidateKey, consumer.candidateKey);
  assert.equal(out.candidate?.decisionId, consumer.decisionId);
  assert.equal(out.horizons[0].buyerStars, 5);
  assert.equal(out.horizons[2].sellerStars, 4);
  assert.equal(out.sameCanonicalCandidateForDashboardAndTelegram, true);
  assert.equal(out.decisionCard.state, "CANDIDATE_READY");
  assert.equal(out.decisionCard.action, "REVIEW_BUYER_CANDIDATE");
  assert.equal(out.decisionCard.authority, "EXECUTION_CANDIDATE_SELECTOR_V2");
  assert.equal(out.decisionCard.decisionId, consumer.decisionId);
  assert.equal(out.decisionCard.candidateKey, consumer.candidateKey);
  assert.equal(out.decisionCard.identityLocked, true);
  assert.deepEqual(out.decisionCard.buyerEdgeHorizons, ["INTRADAY"]);
  assert.equal(out.decisionCard.telegram.allowed, true);
  assert.equal(out.decisionCard.executionPlan.entry, null);
  const html = renderBusinessDashboardV1Html(out);
  assert.match(html, /DATA ONLY/);
  assert.doesNotMatch(html, /NIFTY CE 23800|BUSINESS DECISION CARD|REVIEW_BUYER_CANDIDATE/);
  canonicalBusinessRuntimeRegistry.clear();
});

test("business card fails closed when canonical decision identity drifts", () => {
  canonicalBusinessRuntimeRegistry.clear();
  const now = Date.now();
  const consumer:any = {
    version:"CANONICAL_BUSINESS_CONSUMER_V1",
    buyerCandidate:{decisionId:"candidate-decision",candidateKey:"NIFTY:CE:23800:2026-09-08:DTE1:ATM",role:"OPTION_BUYER",symbol:"NIFTY",optionSide:"CE",strike:23800,expiryDate:"2026-09-08",dte:1,moneyness:"ATM",premiumLtp:120,dteBucket:"CURRENT_OR_NEAR",sourceAuthority:"EXECUTION_CANDIDATE_SELECTOR_V2"},
    horizons:[
      {horizon:"INTRADAY",action:"BUYER_EDGE",buyerStars:5,sellerStars:2,headline:"Buyer edge",reasons:[],devilCheck:"PASS"},
      {horizon:"MULTIDAY",action:"WAIT",buyerStars:3,sellerStars:3,headline:"No clear edge — wait",reasons:[],devilCheck:"PASS"},
      {horizon:"EXPIRY",action:"WAIT",buyerStars:3,sellerStars:3,headline:"No clear edge — wait",reasons:[],devilCheck:"PASS"},
    ],
    telegram:{allowed:true,reason:"BUYER_READY"},
    decisionId:"consumer-decision",
    candidateKey:"NIFTY:CE:23800:2026-09-08:DTE1:ATM",
    sameCanonicalCandidateForDashboardAndTelegram:true,
    affectsExecution:false,
    createsOrders:false,
    aiMayOverride:false,
  };
  canonicalBusinessRuntimeRegistry.publish("NIFTY", consumer, now);
  const out = buildBusinessDashboardV1("NIFTY", new Date(now).toISOString());
  assert.equal(out.ready, false);
  assert.equal(out.state, "WAIT");
  assert.equal(out.candidate, null);
  assert.equal(out.decisionCard.state, "WAIT");
  assert.equal(out.decisionCard.authority, "NONE");
  assert.equal(out.decisionCard.identityLocked, false);
  assert.equal(out.decisionCard.decisionId, null);
  assert.equal(out.decisionCard.candidateKey, null);
  assert.equal(out.decisionCard.telegram.allowed, false);
  assert.equal(out.decisionCard.telegram.reason, "IDENTITY_LOCK_NOT_VERIFIED");
  canonicalBusinessRuntimeRegistry.clear();
});

test("research router exposes read-only business dashboard routes", () => {
  const router = readFileSync(new URL("../research-router.ts", import.meta.url), "utf8");
  assert.match(router, /researchRouter\.get\("\/business-dashboard"/);
  assert.match(router, /researchRouter\.get\("\/business-dashboard\/view"/);
  assert.match(router, /READ_ONLY_BUSINESS_DASHBOARD_V1/);
  assert.doesNotMatch(router, /researchRouter\.post\("\/business-dashboard"/);
});

test("dashboard intelligence remains low-noise and fail-closed without verified live edge", () => {
  canonicalBusinessRuntimeRegistry.clear();
  const out = buildBusinessDashboardV1("SENSEX", new Date().toISOString());
  assert.equal(out.intelligence.length, 9);
  assert.ok(out.intelligence.every((x) => x.state === "WAIT"));
  assert.equal(out.intelligence.find((x) => x.key === "MARKET_DNA")?.detail, "Context-only layer; never counted as an extra vote");
  const html = renderBusinessDashboardV1Html(out);
  assert.match(html, /Premium PDH \/ PDL breaks/);
  assert.match(html, /DATA ONLY/);
  assert.doesNotMatch(html, /id="candidate-state"|id="business-decision-card"/);
});

test("data dashboard uses existing read-only observation sources", () => {
  const html = renderBusinessDashboardV1Html(buildBusinessDashboardV1("NIFTY"));
  for (const path of ["/api/research/h1-replay?", "/api/research/h1-theory-dates", "/api/index-stocks?symbol=", "/api/sector-heatmap"]) assert.ok(html.includes(path));
  assert.doesNotMatch(html, /h1-live-selector-decisions|candidate-state|business-decision-card/);
  assert.doesNotMatch(html, /fetch\([^)]*method\s*:\s*["']POST/i);
  assert.match(html, /full_chain_oi_pcr/);
});

test("observation terminal exposes compact views, bounded replay loading and explicit source states", () => {
  const html = renderBusinessDashboardV1Html(buildBusinessDashboardV1("NIFTY"));
  for (const label of ["Overview", "Premium ladder", "PCR + Spot", "OI changes", "Day memory", "Sectors"]) assert.ok(html.includes(label));
  for (const state of ["LIVE", "DELAYED", "RECORDED", "RETAINED", "UNAVAILABLE"]) assert.ok(html.includes(state));
  assert.match(html, /function replayWindows\(from,to,size=60\)/);
  assert.match(html, /function mergeReplayParts\(/);
  assert.match(html, /function replayFreshness\(/);
  assert.match(html, /const populated=values\.filter/);
  assert.match(html, /requestedToTime:to/);
  assert.match(html, /getReplay\(s\+' session'/);
  assert.match(html, /sameScope&&oldData\[s\]/);
  assert.match(html, /CORE covers recorded ATM ±7/);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
});

const obs = (minute: number, ltp: number | null, pdh: number | null = 100) => ({symbol:'NIFTY',expiry:'2026-09-22',strike:23350,option_type:'CE',minute_bucket:`2026-09-22T04:${String(minute).padStart(2,'0')}:00Z`,ltp,pdh,pdl:50});
test('premium crossing preserves exact contract, interval gaps and missing levels', () => {
 const d=deriveObservationData({options:[obs(0,90),obs(3,110),obs(6,120),obs(12,40),{...obs(15,120),pdh:null,pdl:null}]});
 assert.equal(d.breaks.length,2);
 assert.equal(d.breaks.find(r=>r.event==='ABOVE PDH').previous,90);
 assert.equal(d.breaks.find(r=>r.event==='BELOW PDL').gapMinutes,6);
 const first=deriveObservationData({options:[obs(0,110)]});
 assert.equal(first.breaks[0].kind,'First observed outside level');
 assert.equal(deriveObservationData({options:[obs(0,90),obs(3,110,105)]}).breaks[0].kind,'First observed outside level');
});
test('PCR never falls back to band PCR, wall migration stays expiry-specific', () => {
 const c=(m:number,e:string,p:any,w:number)=>({...obs(m,1),expiry:e,full_chain_oi_pcr:p,band7_oi_pcr:9,call_wall_strike:w,call_wall_oi:100,put_wall_strike:23000});
 const d=deriveObservationData({chain:[c(0,'2026-09-22',1,23300),c(3,'2026-09-22',1.2,23400),c(0,'2026-09-29',null,24000),c(3,'2026-09-29',null,24000)]},{chain:[c(0,'2026-09-22',.8,23200)]});
 assert.ok(Math.abs(d.walls[0].pcrImmediate-.2)<1e-10);
 assert.ok(Math.abs(d.walls[0].pcrSwing-.4)<1e-10);
 assert.equal(d.walls[1].pcrImmediate,null);
 assert.equal(d.wallEvents.length,1);
 assert.equal(d.wallEvents[0].migration,100);
});
test('swing premium requires same exact contract; null and zero bases stay unavailable',()=>{
 const a=obs(0,100),b=obs(3,120);
 const d=deriveObservationData({options:[a,b]},{options:[{...a,ltp:60},{...a,strike:23400,ltp:10}]});
 assert.equal(d.contracts[0].swingPct,100);
 assert.equal(deriveObservationData({options:[a]},{options:[{...a,strike:23400,ltp:10}]}).contracts[0].swingPct,null);
 assert.equal(deriveObservationData({options:[a]},{options:[{...a,ltp:0}]}).contracts[0].swingPct,null);
});
