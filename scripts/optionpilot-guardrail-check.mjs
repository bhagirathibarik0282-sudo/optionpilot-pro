#!/usr/bin/env node
import fs from "node:fs";

const manifestPath = "config/optionpilot-coverage-manifest.json";
const guardrailPath = "OPTIONPILOT_GUARDRAILS.md";
const requiredComponents = [
  "kite_live_truth","recorder_continuity","canonical_archive","spot_structure","smc_structure","candle_context",
  "futures","heavyweights_sectors","vix","premium_pair","exact_contract_identity","oi_pcr_walls","multi_dte",
  "iv_skew","greeks_residual","depth_microprice_liquidity","candidate_authority","telegram_meaningful_dedup",
  "business_views_stars","forward_outcomes","historical_calibration","execution_shadow","real_execution_readiness"
];

function fail(msg){ console.error("[OPTIONPILOT-GUARDRAIL] FAIL:", msg); process.exit(1); }
if (!fs.existsSync(guardrailPath)) fail("guardrail document missing");
if (!fs.existsSync(manifestPath)) fail("coverage manifest missing");

const m = JSON.parse(fs.readFileSync(manifestPath,"utf8"));
const statuses = new Set(["PROVEN","PARTIAL","NOT_PROVEN","BLOCKED"]);
for (const id of requiredComponents) {
  const row = m.components.find((x)=>x.id===id);
  if (!row) fail(`required component missing: ${id}`);
  if (!statuses.has(row.status)) fail(`invalid status for ${id}: ${row.status}`);
  if (row.status === "PROVEN") {
    const e = row.runtimeEvidence;
    if (!e || typeof e !== "object") fail(`PROVEN without runtimeEvidence: ${id}`);
    if (!e.observedAt || !e.source || e.result !== "PASS") fail(`PROVEN evidence incomplete: ${id}`);
  }
  if (row.status === "BLOCKED" && !row.blocker) fail(`BLOCKED without blocker: ${id}`);
}

const architecture = [
  "KITE_LIVE_TRUTH","RECORDER_CONTINUITY","CANONICAL_ARCHIVE","DETERMINISTIC_ENGINES","CANDIDATE_AUTHORITY",
  "TELEGRAM_DASHBOARD","FORWARD_OUTCOMES","HISTORICAL_CALIBRATION","EXECUTION_SHADOW","REAL_EXECUTION_READINESS"
];
if (JSON.stringify(m.architecture)!==JSON.stringify(architecture)) fail("frozen architecture order changed");
if (m.rules?.mergedIsNotWorking !== true) fail("mergedIsNotWorking rule disabled");
if (m.rules?.missingDataMustRemainMissing !== true) fail("missing-data anti-fabrication rule disabled");
if (m.rules?.oneCandidateAuthority !== true) fail("single candidate authority rule disabled");
if (m.rules?.railwayAiAgentForbidden !== true) fail("Railway AI Agent prohibition disabled");
if (JSON.stringify(m.rules?.candleContextAllowed)!==JSON.stringify(["DISPLACEMENT","REJECTION","FAILED_BREAK","COMPRESSION_TO_EXPANSION"])) fail("Candle Context vocabulary drift");

const replay = fs.readFileSync("h1-replay-http.ts","utf8");
if (!replay.includes("continuity") || !replay.includes("canonical")) fail("replay continuity/canonical proof surface missing");
const bridge = fs.readFileSync("h1-runtime-bridge.ts","utf8");
if (!bridge.includes("H1_CANONICAL_MARKET_ARCHIVE")) fail("canonical full runtime archive missing");
const server = fs.readFileSync("server.ts","utf8");
if (!server.includes("H1_CONTINUOUS_RECORDER_AUTHORITY_FALLBACK_V1")) fail("server-owned recorder authority fallback missing");

console.log("[OPTIONPILOT-GUARDRAIL] PASS");
