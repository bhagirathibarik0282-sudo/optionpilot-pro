import { readFileSync, writeFileSync } from "node:fs";

const path = new URL("../server.ts", import.meta.url);
let source = readFileSync(path, "utf8");
const checkOnly = process.argv.includes("--check");

const DB_IMPORT = 'import { dbInit, dbInsert, dbLoadRecent, dbIsConfigured } from "./db.js";';
const HISTORY_IMPORT = 'import { mergeOutcomeHistory, outcomePersistenceFingerprint, persistOutcomeRecord, restoreOutcomeRecords } from "./outcome-history-store.js";';
const CANDIDATE_HISTORY_IMPORT = 'import { candidateHistoryIdFromOutcome, persistCandidateHistoryFromOutcome } from "./candidate-history-outcome-bridge.js";';
const OUTCOME_ANCHOR = `const outcomeRecords: OutcomeRecord[] = [];\nconst OUTCOME_MAX_RECORDS = 500;`;
const WIRE_BEGIN = "// OUTCOME_HISTORY_RUNTIME_WIRE_BEGIN";
const WIRE_END = "// OUTCOME_HISTORY_RUNTIME_WIRE_END";

function fail(message) {
  console.error(`[Outcome History wire] ${message}`);
  process.exitCode = 1;
}

if (!source.includes(DB_IMPORT)) {
  fail("db import anchor not found");
} else if (!source.includes(OUTCOME_ANCHOR) && !source.includes(WIRE_BEGIN)) {
  fail("outcomeRecords anchor not found");
}

if (process.exitCode) process.exit();

if (checkOnly) {
  console.log("[Outcome History wire] anchors verified");
  process.exit(0);
}

if (!source.includes(HISTORY_IMPORT)) {
  source = source.replace(DB_IMPORT, `${DB_IMPORT}\n${HISTORY_IMPORT}`);
}
if (!source.includes(CANDIDATE_HISTORY_IMPORT)) {
  source = source.replace(HISTORY_IMPORT, `${HISTORY_IMPORT}\n${CANDIDATE_HISTORY_IMPORT}`);
}

if (!source.includes(WIRE_BEGIN)) {
  const wiring = `${OUTCOME_ANCHOR}\n\n${WIRE_BEGIN}\n// Fail-open restart persistence for deterministic Outcome Engine records.\n// Candidate History is a historical side-car only: it mirrors already-created\n// deterministic signals and never changes verdict, scoring, Telegram, execution,\n// or market-data acquisition.\nconst outcomeHistoryFingerprints = new Map<string, string>();\nconst candidateHistorySynced = new Set<string>();\nlet outcomeHistoryRestoreSettled = false;\n\nvoid restoreOutcomeRecords(OUTCOME_MAX_RECORDS)\n  .then((restored) => {\n    for (const row of restored) {\n      outcomeHistoryFingerprints.set(row.outcomeId, outcomePersistenceFingerprint(row));\n    }\n    // If a live record appeared while DB restore was in flight, keep that\n    // in-process version authoritative by placing it after restored rows.\n    const merged = mergeOutcomeHistory([...restored, ...outcomeRecords], OUTCOME_MAX_RECORDS);\n    outcomeRecords.splice(0, outcomeRecords.length, ...merged);\n    outcomeHistoryRestoreSettled = true;\n    console.log(\`[Outcome History] restore complete restored=\${restored.length} active=\${outcomeRecords.length}\`);\n  })\n  .catch((err) => {\n    outcomeHistoryRestoreSettled = true;\n    console.error(\"[Outcome History] restore failed; live engine continues in-memory:\", err instanceof Error ? err.message : err);\n  });\n\nasync function flushOutcomeHistoryChanges(): Promise<void> {\n  if (!outcomeHistoryRestoreSettled) return;\n  const candidateAttemptedThisFlush = new Set<string>();\n  for (const record of outcomeRecords) {\n    const fingerprint = outcomePersistenceFingerprint(record);\n    if (outcomeHistoryFingerprints.get(record.outcomeId) !== fingerprint) {\n      await persistOutcomeRecord(record);\n      outcomeHistoryFingerprints.set(record.outcomeId, fingerprint);\n    }\n\n    const candidateId = candidateHistoryIdFromOutcome(record);\n    if (candidateHistorySynced.has(candidateId) || candidateAttemptedThisFlush.has(candidateId)) continue;\n    candidateAttemptedThisFlush.add(candidateId);\n    try {\n      const candidateResult = await persistCandidateHistoryFromOutcome(record);\n      if (candidateResult.ok) {\n        candidateHistorySynced.add(candidateId);\n      } else {\n        console.warn(\"[Candidate History] persistence deferred for retry\", candidateId, candidateResult.reason ?? \"UNKNOWN\");\n      }\n    } catch (err) {\n      console.error(\"[Candidate History] persistence failed; live engine unaffected:\", err instanceof Error ? err.message : err);\n    }\n  }\n}\n\nconst outcomeHistoryPersistTimer = setInterval(() => {\n  void flushOutcomeHistoryChanges().catch((err) => {\n    console.error(\"[Outcome History] persistence flush failed; live engine unaffected:\", err instanceof Error ? err.message : err);\n  });\n}, 15_000);\noutcomeHistoryPersistTimer.unref?.();\n${WIRE_END}`;
  source = source.replace(OUTCOME_ANCHOR, wiring);
}

writeFileSync(path, source, "utf8");
console.log("[Outcome History wire] runtime persistence wiring ready");
