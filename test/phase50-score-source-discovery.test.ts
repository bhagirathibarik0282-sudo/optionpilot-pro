import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function windows(source: string, needle: string, radius = 28) {
  const lines = source.split(/\r?\n/);
  const out: Array<{ line: number; text: string[] }> = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(needle)) continue;
    out.push({
      line: i + 1,
      text: lines.slice(Math.max(0, i - radius), Math.min(lines.length, i + radius + 1)).map((s) => s.trim()),
    });
  }
  return out;
}

test("discover exact current decision-score and persistence anchors for Phase 50", () => {
  const source = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  const db = readFileSync(new URL("../db.ts", import.meta.url), "utf8");

  const evidence = {
    maxPainVotesSingle: windows(source, "add('max_pain'"),
    maxPainVotesDouble: windows(source, 'add("max_pain"'),
    scoreTerms: windows(source, "totalScore", 18).slice(0, 12),
    scoreGeneric: windows(source, "score:", 18).slice(0, 12),
    verdictTerms: windows(source, "verdict", 14).slice(0, 12),
    dbInsertCalls: windows(source, "dbInsert(", 12).slice(0, 20),
    candidateWrites: windows(source, "candidate_history", 10).slice(0, 10),
    tradePlanWrites: windows(source, "trade_plan_history", 10).slice(0, 10),
    appStateKinds: windows(source, "app_state_log", 8).slice(0, 10),
    dbCandidateSchema: windows(db, "CREATE TABLE IF NOT EXISTS candidate_history", 4),
    dbTradePlanSchema: windows(db, "CREATE TABLE IF NOT EXISTS trade_plan_history", 4),
  };

  console.log("[Phase50ScorePersistenceDiscovery]", JSON.stringify(evidence));
  assert.ok(evidence.maxPainVotesSingle.length + evidence.maxPainVotesDouble.length >= 2, "expected current legacy Max Pain vote sites");
  assert.match(db, /CREATE TABLE IF NOT EXISTS candidate_history/);
  assert.match(db, /CREATE TABLE IF NOT EXISTS trade_plan_history/);
  assert.match(db, /CREATE TABLE IF NOT EXISTS app_state_log/);
});
