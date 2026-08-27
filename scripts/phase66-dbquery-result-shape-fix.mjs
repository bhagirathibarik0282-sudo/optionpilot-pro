import fs from "node:fs";

const path = "server.ts";
let src = fs.readFileSync(path, "utf8");
const marker = 'app.get("/api/offline-research/nifty-deterministic-replay"';
const start = src.indexOf(marker);
if (start < 0) throw new Error("Phase66 replay route not found");
const end = src.indexOf('app.get("/api/research/shadow-diagnostic-trace"', start);
if (end < 0) throw new Error("Phase66 replay route end anchor not found");
let block = src.slice(start, end);

const replacements = [
  ['const marketRows = await dbQuerySafe(`', 'const marketQuery = await dbQuerySafe(`'],
  ['if (!marketRows) return c.json({ version: "PHASE66_NIFTY_DETERMINISTIC_REPLAY_V1", readiness: "MARKET_QUERY_FAILED" }, 500);', 'if (!marketQuery) return c.json({ version: "PHASE66_NIFTY_DETERMINISTIC_REPLAY_V1", readiness: "MARKET_QUERY_FAILED" }, 500);\n  const marketRows = marketQuery.rows;'],
  ['const chainRows = await dbQuerySafe(`', 'const chainQuery = await dbQuerySafe(`'],
  ['if (!chainRows) return c.json({ version: "PHASE66_NIFTY_DETERMINISTIC_REPLAY_V1", readiness: "CHAIN_QUERY_FAILED" }, 500);', 'if (!chainQuery) return c.json({ version: "PHASE66_NIFTY_DETERMINISTIC_REPLAY_V1", readiness: "CHAIN_QUERY_FAILED" }, 500);\n  const chainRows = chainQuery.rows;'],
];

for (const [from, to] of replacements) {
  const count = block.split(from).length - 1;
  if (count !== 1) throw new Error(`Expected exactly one occurrence of anchor: ${from}; found ${count}`);
  block = block.replace(from, to);
}

if (!block.includes('const marketRows = marketQuery.rows;')) throw new Error("market rows unwrap missing");
if (!block.includes('const chainRows = chainQuery.rows;')) throw new Error("chain rows unwrap missing");
if (block.includes('for (const row of chainQuery)')) throw new Error("unsafe chainQuery iteration detected");
if (block.includes('for (const row of marketQuery)')) throw new Error("unsafe marketQuery iteration detected");
block = block.replace('const marketRows = marketQuery.rows;', 'const marketRows = marketQuery.rows;\n  // PHASE66_DBQUERY_RESULT_SHAPE_FIX_V1');

src = src.slice(0, start) + block + src.slice(end);
fs.writeFileSync(path, src);
console.log("Phase66 dbQuerySafe result-shape repair applied");
