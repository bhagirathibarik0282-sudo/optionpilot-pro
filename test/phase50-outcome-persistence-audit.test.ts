import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function hits(source: string, needle: string, radius = 18) {
  const lines = source.split(/\r?\n/);
  return lines.flatMap((line, i) => line.includes(needle) ? [{ line: i + 1, text: lines.slice(Math.max(0, i-radius), Math.min(lines.length, i+radius+1)).map(s => s.trim()) }] : []);
}

test("audit whether exact KNOWN_THEN score decomposition is durably persisted today", () => {
  const source = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  const db = readFileSync(new URL("../db.ts", import.meta.url), "utf8");
  const evidence = {
    outcomeRecords: hits(source, "outcomeRecords", 14).slice(0, 20),
    signalContributions: hits(source, "signalContributions", 14).slice(0, 20),
    outcomeDbDouble: hits(source, 'dbInsert("outcome', 8),
    outcomeDbSingle: hits(source, "dbInsert('outcome", 8),
    outcomeKind: hits(source, "outcome_record", 8),
    outcomeRestore: hits(source, "dbLoadRecent", 10).filter(x => x.text.some(s => /outcome/i.test(s))).slice(0, 20),
    dbOutcomeSchema: hits(db, "outcome", 8).slice(0, 20),
  };
  console.log("[Phase50OutcomePersistenceAudit]", JSON.stringify(evidence));
  assert.ok(evidence.outcomeRecords.length > 0, "outcomeRecords path must exist");
  assert.ok(evidence.signalContributions.length > 0, "signal contributions path must exist");
});
