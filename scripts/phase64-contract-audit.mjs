import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const source = readFileSync("server.ts", "utf8");

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Missing function ${name}`);
  let i = source.indexOf("{", start);
  if (i < 0) throw new Error(`Missing body for ${name}`);
  let depth = 0;
  let inSingle = false, inDouble = false, inTemplate = false, escaped = false;
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

function extractConstArray(name) {
  const start = source.indexOf(`const ${name}`);
  if (start < 0) throw new Error(`Missing const ${name}`);
  const end = source.indexOf("];", start);
  if (end < 0) throw new Error(`Unclosed const ${name}`);
  return source.slice(start, end + 2);
}

const validate = extractFunction("validateDataServer");
const rule = extractFunction("runRuleEngineServerCore");
const catalog = extractConstArray("SERVER_SIGNAL_CATALOG");

const fieldRefs = [...new Set([
  ...[...validate.matchAll(/\bm\.([A-Za-z0-9_]+)/g)].map((m) => m[1]),
  ...[...rule.matchAll(/\bm\.([A-Za-z0-9_]+)/g)].map((m) => m[1]),
])].sort();
const sessionRefs = [...new Set([
  ...[...validate.matchAll(/\bsession\.([A-Za-z0-9_]+)/g)].map((m) => m[1]),
  ...[...rule.matchAll(/\bsession\.([A-Za-z0-9_]+)/g)].map((m) => m[1]),
])].sort();
const helperCalls = [...new Set([
  ...[...validate.matchAll(/\b(server[A-Z][A-Za-z0-9_]*)\(/g)].map((m) => m[1]),
  ...[...rule.matchAll(/\b(server[A-Z][A-Za-z0-9_]*)\(/g)].map((m) => m[1]),
])].sort();

const report = {
  version: "PHASE64_REPLAY_CONTRACT_AUDIT_V1",
  architectureRole: "STATIC_REPLAY_MAPPING_AUDIT_ONLY",
  productionImpact: "NONE",
  mutationAllowed: false,
  brokerCalls: false,
  telegramCalls: false,
  executionCalls: false,
  validatorSignature: validate.slice(0, validate.indexOf("{")).trim(),
  ruleEngineSignature: rule.slice(0, rule.indexOf("{")).trim(),
  serverSignalCatalog: catalog,
  indexMetricFieldReferences: fieldRefs,
  kiteSessionFieldReferences: sessionRefs,
  serverHelperCalls: helperCalls,
  validatorUsesInjectedClock: /nowMs\s*=\s*Date\.now\(\)/.test(validate) && /nowMs\s*-\s*new Date\(effTs\)\.getTime\(\)/.test(validate),
  replaySafety: {
    duplicateScoringFormulaAllowed: false,
    fabricateMissingFieldsAllowed: false,
    historicalClockRequired: true,
    liveDefaultClockUnchangedRequired: true
  }
};

mkdirSync("docs", { recursive: true });
writeFileSync("docs/phase64-replay-contract-audit.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
