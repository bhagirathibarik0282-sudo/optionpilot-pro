import { readFileSync, writeFileSync } from "node:fs";

const path = "server.ts";
const marker = "PHASE66_NIFTY_DETERMINISTIC_REPLAY_V1";
const endAnchor = 'app.get("/api/research/shadow-diagnostic-trace"';
let source = readFileSync(path, "utf8");

const start = source.indexOf(`// ${marker}`);
if (start < 0) throw new Error("[Phase66Fix] replay marker missing; refusing to patch");
const end = source.indexOf(endAnchor, start);
if (end < 0) throw new Error("[Phase66Fix] end anchor missing; refusing to patch");

const before = source.slice(0, start);
let block = source.slice(start, end);
const after = source.slice(end);

const slashTick = "\\" + String.fromCharCode(96);
const tick = String.fromCharCode(96);
const badCount = block.split(slashTick).length - 1;
if (badCount !== 4) {
  throw new Error(`[Phase66Fix] expected exactly 4 escaped backticks in replay block, found ${badCount}; refusing to patch`);
}
block = block.split(slashTick).join(tick);

if (block.includes(slashTick)) throw new Error("[Phase66Fix] escaped backtick remains");
if (!block.includes("const marketRows = await dbQuerySafe(`")) throw new Error("[Phase66Fix] market SQL template not repaired");
if (!block.includes("const chainRows = await dbQuerySafe(`")) throw new Error("[Phase66Fix] chain SQL template not repaired");

source = before + block + after;
writeFileSync(path, source, "utf8");
console.log(`[Phase66Fix] repaired ${badCount} escaped backticks in ${marker}`);
