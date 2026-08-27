import { readFileSync, writeFileSync } from "node:fs";

const path = "server.ts";
let source = readFileSync(path, "utf8");
const marker = "PHASE66_NIFTY_DETERMINISTIC_REPLAY_V1";
if (!source.includes(marker)) throw new Error("[Phase66-vix] replay marker missing");

const replacements = [
  ["future_basis, india_vix, india_india_vix_change", "future_basis, india_vix, india_vix_change"],
  ["const india_vix = Number(row.india_vix);", "const vix = Number(row.india_vix);"],
  ["const india_vixChange = Number(row.india_india_vix_change);", "const vixChange = Number(row.india_vix_change);"],
  ["      india_vix,\n      india_vixChange,\n      india_vixChangePercent: 0,", "      vix,\n      vixChange,\n      vixChangePercent: 0,"],
  ["NIFTY: { spot: current, pcr, india_vix }", "NIFTY: { spot: current, pcr, vix }"],
];

for (const [from, to] of replacements) {
  const count = source.split(from).length - 1;
  if (count !== 1) throw new Error(`[Phase66-vix] expected exactly one match for ${from}, got ${count}`);
  source = source.replace(from, to);
}

if (source.includes("india_india_vix_change")) throw new Error("[Phase66-vix] invalid doubled column remains");
if (!source.includes("const vix = Number(row.india_vix);")) throw new Error("[Phase66-vix] vix mapping missing");
if (!source.includes("const vixChange = Number(row.india_vix_change);")) throw new Error("[Phase66-vix] vixChange mapping missing");
if (!source.includes("      vix,\n      vixChange,\n      vixChangePercent: 0,")) throw new Error("[Phase66-vix] IndexMetrics VIX contract missing");

writeFileSync(path, source, "utf8");
console.log("[Phase66-vix] exact VIX replay contract repaired");
