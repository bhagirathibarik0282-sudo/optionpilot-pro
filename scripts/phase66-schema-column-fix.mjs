import { readFileSync, writeFileSync } from "node:fs";

const path = "server.ts";
const marker = "PHASE66_NIFTY_DETERMINISTIC_REPLAY_V1";
let source = readFileSync(path, "utf8");
if (!source.includes(marker)) throw new Error("[Phase66SchemaFix] replay marker missing");

const replacements = [
  ["backend_received_at", "backend_timestamp"],
  ["spot_vwap", "vwap"],
  ["spot_pdh", "pdh"],
  ["spot_pdl", "pdl"],
  ["vix_change", "india_vix_change"],
  ["vix", "india_vix"],
  ["full_chain_pcr", "full_chain_oi_pcr"],
];

const start = source.indexOf(`// ${marker}`);
const end = source.indexOf('app.get("/api/research/shadow-diagnostic-trace"', start);
if (start < 0 || end < 0) throw new Error("[Phase66SchemaFix] replay block bounds missing");
let block = source.slice(start, end);
for (const [from, to] of replacements) {
  if (!block.includes(from)) throw new Error(`[Phase66SchemaFix] expected token missing: ${from}`);
  block = block.split(from).join(to);
}

for (const forbidden of ["backend_received_at", "spot_vwap", "spot_pdh", "spot_pdl", "full_chain_pcr"]) {
  if (block.includes(forbidden)) throw new Error(`[Phase66SchemaFix] stale schema token remains: ${forbidden}`);
}
if (!block.includes("backend_timestamp") || !block.includes("full_chain_oi_pcr") || !block.includes("india_vix")) {
  throw new Error("[Phase66SchemaFix] required canonical columns missing after patch");
}

source = source.slice(0, start) + block + source.slice(end);
writeFileSync(path, source, "utf8");
console.log("[Phase66SchemaFix] canonical DB column names applied");
