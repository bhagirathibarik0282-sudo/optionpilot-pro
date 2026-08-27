import fs from "node:fs";

const path = "server.ts";
let src = fs.readFileSync(path, "utf8");
const start = src.indexOf('app.get("/api/offline-research/nifty-deterministic-replay"');
const end = src.indexOf('app.get("/api/research/shadow-diagnostic-trace"', start);
if (start < 0 || end < 0) throw new Error("replay route missing");
let block = src.slice(start, end);
if (block.includes("PHASE71_MULTI_INDEX_REPLAY_V1")) {
  console.log("Phase71 already present");
  process.exit(0);
}

const oldSymbol = '    const symbol = "NIFTY";';
const newSymbol = `    const requestedSymbol = String(c.req.query("symbol") || "NIFTY").toUpperCase();\n    const supportedSymbols = ["NIFTY", "BANKNIFTY", "SENSEX"] as const;\n    if (!supportedSymbols.includes(requestedSymbol as any)) {\n      return c.json({ version: "PHASE71_MULTI_INDEX_REPLAY_V1", readiness: "UNSUPPORTED_SYMBOL", supportedSymbols }, 400);\n    }\n    const symbol = requestedSymbol as "NIFTY" | "BANKNIFTY" | "SENSEX";\n    // PHASE71_MULTI_INDEX_REPLAY_V1`;
if (!block.includes(oldSymbol)) throw new Error("NIFTY symbol anchor missing");
block = block.replace(oldSymbol, newSymbol);

const oldHistory = '      replaySession.snapshotHistory!.push({ timestamp: bucketIso, NIFTY: { spot: current, pcr, vix } });';
const newHistory = '      replaySession.snapshotHistory!.push({ timestamp: bucketIso, [symbol]: { spot: current, pcr, vix } } as any);';
if (!block.includes(oldHistory)) throw new Error("hardcoded NIFTY history anchor missing");
block = block.replace(oldHistory, newHistory);

const responseSymbolAnchor = '      symbol,\n      processedBuckets: processed,';
if (!block.includes(responseSymbolAnchor)) throw new Error("response symbol anchor missing");
block = block.replace(responseSymbolAnchor, '      symbol,\n      supportedSymbols,\n      processedBuckets: processed,');

for (const required of [
  'PHASE71_MULTI_INDEX_REPLAY_V1',
  '"BANKNIFTY"',
  '"SENSEX"',
  '[symbol]: { spot: current, pcr, vix }',
  'validateDataServer(symbol, m, replaySession, null, marketBucketMs)',
  'runRuleEngineServerCore(symbol, m, validation, null)'
]) {
  if (!block.includes(required)) throw new Error(`missing Phase71 invariant: ${required}`);
}
if (block.includes('NIFTY: { spot: current, pcr, vix }')) throw new Error("hardcoded NIFTY replay history remains");
for (const forbidden of ["placeOrder(", "sendTelegram", "persistKnownThenScoreObservation(", "dbInsert("]) {
  if (block.includes(forbidden)) throw new Error(`forbidden side effect in Phase71 route: ${forbidden}`);
}

src = src.slice(0, start) + block + src.slice(end);
fs.writeFileSync(path, src);
console.log("Phase71 multi-index replay support applied");
