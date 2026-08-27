import { readFileSync, writeFileSync } from "node:fs";

const path = "server.ts";
const marker = "PHASE66_QUERY_DIAGNOSTIC_V1";
let source = readFileSync(path, "utf8");
if (source.includes(marker)) {
  console.log(`[Phase66Diag] ${marker} already present; no change.`);
  process.exit(0);
}

const marketOld = 'if (!marketRows) return c.json({ version: "PHASE66_NIFTY_DETERMINISTIC_REPLAY_V1", readiness: "READ_QUERY_FAILED" }, 500);';
const chainOld = 'if (!chainRows) return c.json({ version: "PHASE66_NIFTY_DETERMINISTIC_REPLAY_V1", readiness: "READ_QUERY_FAILED" }, 500);';
const first = source.indexOf(marketOld);
if (first < 0) throw new Error("[Phase66Diag] market generic failure anchor missing");
const second = source.indexOf(chainOld, first + marketOld.length);
if (second < 0) throw new Error("[Phase66Diag] chain generic failure anchor missing");

source = source.slice(0, first)
  + `// ${marker}\n  if (!marketRows) return c.json({ version: "PHASE66_NIFTY_DETERMINISTIC_REPLAY_V1", readiness: "MARKET_QUERY_FAILED" }, 500);`
  + source.slice(first + marketOld.length, second)
  + 'if (!chainRows) return c.json({ version: "PHASE66_NIFTY_DETERMINISTIC_REPLAY_V1", readiness: "CHAIN_QUERY_FAILED" }, 500);'
  + source.slice(second + chainOld.length);

if (!source.includes('readiness: "MARKET_QUERY_FAILED"')) throw new Error("[Phase66Diag] market diagnostic missing");
if (!source.includes('readiness: "CHAIN_QUERY_FAILED"')) throw new Error("[Phase66Diag] chain diagnostic missing");
writeFileSync(path, source, "utf8");
console.log(`[Phase66Diag] Applied ${marker}`);
