import { readFileSync, writeFileSync } from "node:fs";

const path = "server.ts";
let source = readFileSync(path, "utf8");
const marker = "PHASE66_REPLAY_RUNTIME_STAGE_DIAGNOSTIC_V1";
if (source.includes(marker)) {
  console.log(`[Phase66] ${marker} already present`);
  process.exit(0);
}

const old = `    const nowMs = new Date(bucketIso).getTime();\n    const validation = validateDataServer(symbol, m, replaySession, null, nowMs);\n    const result = runRuleEngineServerCore(symbol, m, validation, null);`;
const replacement = `    const nowMs = new Date(bucketIso).getTime();\n    let validation: ServerValidationResult;\n    try {\n      validation = validateDataServer(symbol, m, replaySession, null, nowMs);\n    } catch {\n      return c.json({ version: \"PHASE66_NIFTY_DETERMINISTIC_REPLAY_V1\", readiness: \"VALIDATION_RUNTIME_FAILED\", stage: \"VALIDATION\", bucket: bucketIso }, 500);\n    }\n    let result: ReturnType<typeof runRuleEngineServerCore>;\n    try {\n      result = runRuleEngineServerCore(symbol, m, validation, null);\n    } catch {\n      return c.json({ version: \"PHASE66_NIFTY_DETERMINISTIC_REPLAY_V1\", readiness: \"RULE_ENGINE_RUNTIME_FAILED\", stage: \"RULE_ENGINE\", bucket: bucketIso }, 500);\n    }\n    // ${marker}`;

if (!source.includes(old)) throw new Error("[Phase66] exact validator/core anchor missing; refusing to patch");
source = source.replace(old, replacement);
writeFileSync(path, source, "utf8");
console.log(`[Phase66] Applied ${marker}`);
