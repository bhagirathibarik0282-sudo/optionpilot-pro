import fs from "node:fs";

const path = "server.ts";
let src = fs.readFileSync(path, "utf8");
const start = src.indexOf('app.get("/api/offline-research/nifty-deterministic-replay"');
const end = src.indexOf('app.get("/api/research/shadow-diagnostic-trace"', start);
if (start < 0 || end < 0) throw new Error("Phase66 replay route not found");
let block = src.slice(start, end);
if (block.includes("PHASE69_REPLAY_RESULT_AUDIT_V1")) {
  console.log("Phase69 audit already present");
  process.exit(0);
}

const responseAnchor = '    stage = "RESPONSE";\n    return c.json({';
if (!block.includes(responseAnchor)) throw new Error("Phase66 response anchor missing");

const auditLogic = `    stage = "RESPONSE";\n    const validationRate = processed > 0 ? validated / processed : 0;\n    const finiteScoreRate = processed > 0 ? finiteScores / processed : 0;\n    const topBlockers = Object.entries(blockerCounts)\n      .sort((a, b) => Number(b[1]) - Number(a[1]))\n      .slice(0, 8)\n      .map(([signal, count]) => ({ signal, count }));\n    const phase69AuditState = processed === 0\n      ? "NO_INPUT"\n      : validated === 0\n        ? "ALL_BLOCKED"\n        : finiteScores === 0\n          ? "NO_FINITE_SCORES"\n          : "REPLAY_RESULTS_AVAILABLE";\n    // PHASE69_REPLAY_RESULT_AUDIT_V1\n    return c.json({`;
block = block.replace(responseAnchor, auditLogic);

const insertAnchor = '      finiteScoreBuckets: finiteScores,\n      blockerCounts,';
if (!block.includes(insertAnchor)) throw new Error("Phase66 result-count anchor missing");
const insert = `      finiteScoreBuckets: finiteScores,\n      phase69Audit: {\n        state: phase69AuditState,\n        validationRate,\n        finiteScoreRate,\n        topBlockers,\n      },\n      blockerCounts,`;
block = block.replace(insertAnchor, insert);

for (const required of [
  "PHASE69_REPLAY_RESULT_AUDIT_V1",
  "validationRate",
  "finiteScoreRate",
  "topBlockers",
  "REPLAY_RESULTS_AVAILABLE",
  "ALL_BLOCKED",
  "NO_FINITE_SCORES",
]) {
  if (!block.includes(required)) throw new Error(`missing Phase69 audit invariant: ${required}`);
}
for (const forbidden of ["placeOrder(", "sendTelegram", "persistKnownThenScoreObservation(", "dbInsert("]) {
  if (block.includes(forbidden)) throw new Error(`forbidden side effect in Phase69 route: ${forbidden}`);
}

src = src.slice(0, start) + block + src.slice(end);
fs.writeFileSync(path, src);
console.log("Phase69 replay result audit summary applied");
