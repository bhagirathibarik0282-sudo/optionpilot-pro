import test from "node:test";
import assert from "node:assert/strict";
import { canonicalBusinessRuntimeRegistry } from "../canonical-business-runtime-registry.js";
import { buildBusinessDashboardV1 } from "../business-dashboard-v1.js";
import { renderBusinessDashboardV1Html } from "../business-dashboard-v1-view.js";
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
});

test("dashboard reuses the same canonical business candidate and horizon views", () => {
  canonicalBusinessRuntimeRegistry.clear();
  const now = Date.now();
  const consumer:any = {
    version:"CANONICAL_BUSINESS_CONSUMER_V1",
    buyerCandidate:{candidateKey:"NIFTY:CE:23800:2026-09-08:DTE1:ATM",role:"OPTION_BUYER",symbol:"NIFTY",optionSide:"CE",strike:23800,expiryDate:"2026-09-08",dte:1,moneyness:"ATM",premiumLtp:120,dteBucket:"CURRENT_OR_NEAR",sourceAuthority:"EXECUTION_CANDIDATE_SELECTOR_V2"},
    horizons:[
      {horizon:"INTRADAY",action:"BUYER_EDGE",buyerStars:5,sellerStars:2,headline:"Buyer edge",reasons:[],devilCheck:"PASS"},
      {horizon:"MULTIDAY",action:"WAIT",buyerStars:3,sellerStars:3,headline:"No clear edge — wait",reasons:[],devilCheck:"PASS"},
      {horizon:"EXPIRY",action:"SELLER_EDGE",buyerStars:2,sellerStars:4,headline:"Seller edge",reasons:[],devilCheck:"PASS"},
    ],
    telegram:{allowed:true,reason:"BUYER_READY"},candidateKey:"NIFTY:CE:23800:2026-09-08:DTE1:ATM",sameCanonicalCandidateForDashboardAndTelegram:true,affectsExecution:false,createsOrders:false,aiMayOverride:false,
  };
  assert.equal(canonicalBusinessRuntimeRegistry.publish("NIFTY", consumer, now), true);
  const out = buildBusinessDashboardV1("NIFTY", new Date(now).toISOString());
  assert.equal(out.ready, true);
  assert.equal(out.candidate?.candidateKey, consumer.candidateKey);
  assert.equal(out.horizons[0].buyerStars, 5);
  assert.equal(out.horizons[2].sellerStars, 4);
  assert.equal(out.sameCanonicalCandidateForDashboardAndTelegram, true);
  const html = renderBusinessDashboardV1Html(out);
  assert.match(html, /BUSINESS DASHBOARD V1/);
  assert.match(html, /NIFTY CE 23800/);
  assert.match(html, /INTRADAY/);
  assert.match(html, /MULTIDAY/);
  assert.match(html, /EXPIRY/);
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
  assert.match(html, /SMC \+ Candle Context/);
  assert.match(html, /Futures/);
  assert.match(html, /CE\/PE Premium Reality/);
  assert.match(html, /OI \/ PCR \/ Wall Migration/);
  assert.match(html, /Multi-DTE/);
  assert.match(html, /IV \/ Skew/);
  assert.match(html, /Market DNA/);
  assert.match(html, /Heavyweights \/ Sectors/);
  assert.match(html, /Liquidity \/ Executability/);
});

test("dashboard view wires every business intelligence card only to read-only verified sources", () => {
  canonicalBusinessRuntimeRegistry.clear();
  const html = renderBusinessDashboardV1Html(buildBusinessDashboardV1("NIFTY", new Date().toISOString()));
  assert.match(html, /\/api\/research\/h1-live-selector-decisions/);
  assert.match(html, /\/api\/research\/positioning-pair-diagnostic/);
  assert.match(html, /\/api\/research\/h1-replay\?/);
  assert.match(html, /\/api\/research\/h1-replay-intelligence/);
  assert.match(html, /\/api\/research\/broad-market-size\/dashboard/);
  for (const key of ["SMC_CANDLE","FUTURES","PREMIUM_REALITY","OI_PCR_WALLS","MULTI_DTE","IV_SKEW","MARKET_DNA","HEAVYWEIGHTS_SECTORS","LIQUIDITY","HISTORICAL_EDGE"]) assert.match(html, new RegExp(`data-intel-key="${key}"`));
  assert.match(html, /Theta\/IV burden pass/);
  assert.match(html, /conflict-clear/);
  assert.match(html, /exact skew not exposed; no skew fabricated/);
  assert.match(html, /pattern labels only when separately verified/);
  assert.match(html, /constituent-level heavyweight\/sector detail remains fail-closed until verified/);
  assert.match(html, /coverage only, not a claimed trade edge/);
  assert.doesNotMatch(html, /notWired\(/);
  assert.doesNotMatch(html, /fetch\([^)]*method\s*:\s*["']POST/i);
  assert.doesNotMatch(html, /createsOrders\s*=\s*true/i);
});
