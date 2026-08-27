import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const source = readFileSync("server.ts", "utf8");
const names = ["serverGetEffectiveTimestamp", "serverComputePcrTrendValue", "serverComputeFibPivotValue"];

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Missing function ${name}`);
  let i = source.indexOf("{", start);
  if (i < 0) throw new Error(`Missing body for ${name}`);
  let depth = 0, inSingle = false, inDouble = false, inTemplate = false, escaped = false;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (!inDouble && !inTemplate && ch === "'") { inSingle = !inSingle; continue; }
    if (!inSingle && !inTemplate && ch === '"') { inDouble = !inDouble; continue; }
    if (!inSingle && !inDouble && ch === '`') { inTemplate = !inTemplate; continue; }
    if (inSingle || inDouble || inTemplate) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Unclosed body for ${name}`);
}

const helpers = Object.fromEntries(names.map((name) => [name, extractFunction(name)]));
const report = {
  version: "PHASE65_REPLAY_HELPER_CONTRACT_V1",
  architectureRole: "STATIC_REPLAY_HELPER_EXTRACTION_ONLY",
  productionImpact: "NONE",
  mutationAllowed: false,
  brokerCalls: false,
  telegramCalls: false,
  executionCalls: false,
  helpers,
  safety: {
    duplicateScoringFormulaAllowed: false,
    fabricateMissingFieldsAllowed: false,
    sourceOfTruth: "server.ts exact helper bodies"
  }
};
mkdirSync("docs", { recursive: true });
writeFileSync("docs/phase65-replay-helper-contract.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
