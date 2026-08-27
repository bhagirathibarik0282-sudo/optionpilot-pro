import fs from "node:fs";

const path = "server.ts";
let src = fs.readFileSync(path, "utf8");
const start = src.indexOf('app.get("/api/offline-research/nifty-deterministic-replay"');
const end = src.indexOf('app.get("/api/research/shadow-diagnostic-trace"', start);
if (start < 0 || end < 0) throw new Error("Phase66 replay route not found");
let block = src.slice(start, end);
if (block.includes("PHASE70_BLOCKER_ISOLATION_GATE_V1")) {
  console.log("Phase70 gate already present");
  process.exit(0);
}

const anchor = '    // PHASE69_REPLAY_RESULT_AUDIT_V1\n    return c.json({';
if (!block.includes(anchor)) throw new Error("Phase69 audit anchor missing");

const gateLogic = `    // PHASE69_REPLAY_RESULT_AUDIT_V1\n    // Phase70 does not invent P0 severity from a missing metric name. It gates by observed replay outcome.\n    const phase70Gate = processed === 0\n      ? "NO_INPUT"\n      : validated === 0 || finiteScores === 0\n        ? "ISOLATE_BLOCKERS"\n        : blocked > 0 || finiteScores < processed\n          ? "PROCEED_WITH_ISOLATION"\n          : "PARITY_CLEAN";\n    const isolatedSignals = topBlockers.map(({ signal, count }) => ({\n      signal,\n      count,\n      classification: "P1_ISOLATE",\n      action: "FAIL_CLOSED_AND_KEEP_OUT_OF_PARITY_SET",\n    }));\n    const phase70StopReason = processed === 0 ? "NO_REPLAY_INPUT" : null;\n    // PHASE70_BLOCKER_ISOLATION_GATE_V1\n    return c.json({`;
block = block.replace(anchor, gateLogic);

const insertAnchor = '      phase69Audit: {\n        state: phase69AuditState,\n        validationRate,\n        finiteScoreRate,\n        topBlockers,\n      },\n      blockerCounts,';
if (!block.includes(insertAnchor)) throw new Error("Phase69 response object anchor missing");
const insert = `      phase69Audit: {\n        state: phase69AuditState,\n        validationRate,\n        finiteScoreRate,\n        topBlockers,\n      },\n      phase70Gate: {\n        state: phase70Gate,\n        stopReason: phase70StopReason,\n        isolatedSignals,\n        p0Detected: false,\n        p0DetectionNote: "P0 is not inferred from metric absence alone; semantic/data-integrity P0s require explicit evidence.",\n      },\n      blockerCounts,`;
block = block.replace(insertAnchor, insert);

for (const required of [
  "PHASE70_BLOCKER_ISOLATION_GATE_V1",
  "ISOLATE_BLOCKERS",
  "PROCEED_WITH_ISOLATION",
  "PARITY_CLEAN",
  "P1_ISOLATE",
  "FAIL_CLOSED_AND_KEEP_OUT_OF_PARITY_SET",
]) {
  if (!block.includes(required)) throw new Error(`missing Phase70 invariant: ${required}`);
}
for (const forbidden of ["placeOrder(", "sendTelegram", "persistKnownThenScoreObservation(", "dbInsert("]) {
  if (block.includes(forbidden)) throw new Error(`forbidden side effect in Phase70 route: ${forbidden}`);
}

src = src.slice(0, start) + block + src.slice(end);
fs.writeFileSync(path, src);
console.log("Phase70 blocker isolation gate applied");
