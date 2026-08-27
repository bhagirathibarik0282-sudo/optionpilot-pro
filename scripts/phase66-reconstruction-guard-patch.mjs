import { readFileSync, writeFileSync } from "node:fs";

const path = "server.ts";
const marker = "PHASE66_REPLAY_RECONSTRUCTION_GUARD_V1";
let source = readFileSync(path, "utf8");
if (source.includes(marker)) {
  console.log(`[Phase66] ${marker} already present; no change.`);
  process.exit(0);
}

const chainOld = `  for (const row of chainRows) {\n    const key = new Date(row.minute_bucket).toISOString();`;
const chainNew = `  for (const row of chainRows) {\n    const chainBucketMs = new Date(row.minute_bucket).getTime();\n    if (!Number.isFinite(chainBucketMs)) return c.json({ version: "PHASE66_NIFTY_DETERMINISTIC_REPLAY_V1", readiness: "RECONSTRUCTION_RUNTIME_FAILED", stage: "CHAIN_BUCKET_TIMESTAMP" }, 500);\n    const key = new Date(chainBucketMs).toISOString();`;

const marketOld = `  for (const row of marketRows) {\n    const bucketIso = new Date(row.minute_bucket).toISOString();`;
const marketNew = `  for (const row of marketRows) {\n    const marketBucketMs = new Date(row.minute_bucket).getTime();\n    if (!Number.isFinite(marketBucketMs)) return c.json({ version: "PHASE66_NIFTY_DETERMINISTIC_REPLAY_V1", readiness: "RECONSTRUCTION_RUNTIME_FAILED", stage: "MARKET_BUCKET_TIMESTAMP" }, 500);\n    const bucketIso = new Date(marketBucketMs).toISOString();\n    // ${marker}`;

if (!source.includes(chainOld)) throw new Error("[Phase66] chain timestamp anchor missing; refusing patch");
if (!source.includes(marketOld)) throw new Error("[Phase66] market timestamp anchor missing; refusing patch");
source = source.replace(chainOld, chainNew).replace(marketOld, marketNew);

if (!source.includes(marker)) throw new Error("[Phase66] reconstruction guard marker missing after patch");
if (!source.includes('readiness: "VALIDATION_RUNTIME_FAILED"')) throw new Error("[Phase66] validation catcher missing");
if (!source.includes('readiness: "RULE_ENGINE_RUNTIME_FAILED"')) throw new Error("[Phase66] rule-engine catcher missing");
writeFileSync(path, source, "utf8");
console.log(`[Phase66] Applied ${marker}`);
